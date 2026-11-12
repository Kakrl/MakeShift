/**
 * Server-only recordings API (#119, #122, #128, #129) over the Supabase REST API.
 * Route files stay thin and call these handlers, so the specs can run them
 * with a mocked `fetch`. Like ./supabase, this holds the secret key and must
 * never be imported from client code. Error bodies never echo keys or
 * database messages.
 */
import { restoreMeter } from "../lib/meter";
import {
  MAX_QUERY_IDS,
  MAX_SEARCH_LENGTH,
  RECORDING_ID,
  RECORDING_LIST_PAGE_SIZE,
  RECORDING_SORTS,
  recordingDurationMs,
  recordingOctaves,
  validateUpload,
  type RecordingSort,
  type DeleteRecordingResponse,
  type RecordingApiError,
  type RecordingListResponse,
  type RecordingSummary,
  type SharedRecording,
  type UploadRecordingResponse,
} from "../lib/recordings";
import type { RecordedNote } from "../app/midi/midiUtils";
import type { SupabaseEnv } from "./supabase";

export type RecordingsDeps = {
  env: SupabaseEnv & {
    /** Set on every Vercel deployment (`production`, `preview`). */
    VERCEL_ENV?: string;
    /** `1` allows uploads on Vercel once the rate limit migration is applied. */
    RECORDING_UPLOADS?: string;
  };
  fetchImpl?: typeof fetch;
};

/** Route dependencies from the server environment. */
export function recordingsDeps(): RecordingsDeps {
  return {
    env: {
      SUPABASE_URL: process.env.SUPABASE_URL,
      SUPABASE_SECRET_KEY: process.env.SUPABASE_SECRET_KEY,
      VERCEL_ENV: process.env.VERCEL_ENV,
      RECORDING_UPLOADS: process.env.RECORDING_UPLOADS,
    },
  };
}

// 10,000 notes of ~80 bytes each fit well inside this.
export const MAX_UPLOAD_BYTES = 1_000_000;

/** Accepted uploads per client network in a sliding window (#129). */
export const UPLOAD_RATE_LIMIT = { uploads: 5, windowSeconds: 600 } as const;

const SUMMARY_COLUMNS = "id,title,author_name,bpm,meter,duration_ms,note_count,octaves,created_at";
// A Postgres timestamptz as PostgREST returns it. Kept as text, because a JS
// Date would drop the microseconds the keyset compares against.
const TIMESTAMP = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d{1,6})?(Z|[+-]\d{2}:\d{2})$/;

type SummaryRow = {
  id: string;
  title: string;
  author_name: string;
  bpm: number;
  meter?: unknown;
  duration_ms: number;
  note_count: number;
  octaves: number;
  created_at: string;
};

const json = <T>(body: T, status = 200, headers: Record<string, string> = {}) =>
  Response.json(body, { status, headers: { "Cache-Control": "no-store", ...headers } });

const fail = (status: number, error: string, issues?: RecordingApiError["issues"]) =>
  json<RecordingApiError>(issues ? { error, issues } : { error }, status);

class DatabaseError extends Error {}

function database({ env, fetchImpl = fetch }: RecordingsDeps) {
  const url = env.SUPABASE_URL?.trim().replace(/\/+$/, "");
  const key = env.SUPABASE_SECRET_KEY?.trim();
  if (!url || !key) return null;

  return async function rest<T>(
    query: string,
    init: { method?: string; body?: unknown; prefer?: string; resource?: string } = {},
  ): Promise<T> {
    let response: Response;
    try {
      response = await fetchImpl(`${url}/rest/v1/${init.resource ?? "recordings"}?${query}`, {
        method: init.method ?? "GET",
        headers: {
          apikey: key,
          "Content-Type": "application/json",
          ...(init.prefer ? { Prefer: init.prefer } : {}),
        },
        body: init.body === undefined ? undefined : JSON.stringify(init.body),
        cache: "no-store",
        signal: AbortSignal.timeout(8000),
      });
    } catch {
      throw new DatabaseError();
    }
    if (!response.ok) throw new DatabaseError(`HTTP ${response.status}`);
    return (await response.json()) as T;
  };
}

/** Runs a handler body, mapping a missing config or database failure to 503/502. */
async function withDatabase(
  deps: RecordingsDeps,
  run: (rest: NonNullable<ReturnType<typeof database>>) => Promise<Response>,
): Promise<Response> {
  const rest = database(deps);
  if (!rest) return fail(503, "Shared recordings are not configured.");
  try {
    return await run(rest);
  } catch (cause) {
    if (cause instanceof DatabaseError) return fail(502, "The recordings database could not be reached.");
    throw cause;
  }
}

function summary(row: SummaryRow): RecordingSummary {
  return {
    id: row.id,
    title: row.title,
    authorName: row.author_name,
    bpm: row.bpm,
    meter: restoreMeter(row.meter),
    durationMs: row.duration_ms,
    noteCount: row.note_count,
    octaves: row.octaves,
    createdAt: row.created_at,
  };
}

// Each sort orders by one key, then id, so pages stay stable while new
// recordings arrive (an offset would repeat rows).
const SORTS: Record<RecordingSort, { column: "created_at" | "duration_ms"; descending: boolean }> = {
  newest: { column: "created_at", descending: true },
  oldest: { column: "created_at", descending: false },
  longest: { column: "duration_ms", descending: true },
};

type Cursor = [string | number, string];

function encodeCursor(sort: RecordingSort, row: SummaryRow): string {
  const cursor: Cursor = [row[SORTS[sort].column], row.id];
  return Buffer.from(JSON.stringify(cursor)).toString("base64url");
}

function decodeCursor(cursor: string, sort: RecordingSort): Cursor | null {
  try {
    const value: unknown = JSON.parse(Buffer.from(cursor, "base64url").toString());
    if (!Array.isArray(value) || value.length !== 2 || typeof value[1] !== "string" || !RECORDING_ID.test(value[1]))
      return null;
    const key = value[0];
    const valid =
      SORTS[sort].column === "created_at"
        ? typeof key === "string" && TIMESTAMP.test(key)
        : typeof key === "number" && Number.isSafeInteger(key) && key >= 0;
    if (valid) return [key, value[1]];
  } catch {}
  return null;
}

// LIKE wildcards in what the person typed are plain characters.
const likePattern = (text: string) => `*${text.replace(/[\\%_]/g, "\\$&").replaceAll("*", "")}*`;

type ListQuery = {
  sort: RecordingSort;
  search: string;
  maxOctaves: number | null;
  ids: string[] | null;
  cursor: string | null;
};

function parseListQuery(url: URL): ListQuery | string {
  const get = (name: string) => url.searchParams.get(name);
  const sort = get("sort") ?? "newest";
  if (!(RECORDING_SORTS as readonly string[]).includes(sort)) return "Invalid sort.";
  const search = (get("q") ?? "").trim();
  if (search.length > MAX_SEARCH_LENGTH) return "Search is too long.";
  const octaves = get("maxOctaves");
  if (octaves !== null && !/^\d{1,2}$/.test(octaves)) return "Invalid maxOctaves.";
  const ids = get("ids");
  const list = ids === null ? null : ids === "" ? [] : ids.split(",");
  if (list && (list.length > MAX_QUERY_IDS || !list.every((id) => RECORDING_ID.test(id)))) return "Invalid ids.";
  return {
    sort: sort as RecordingSort,
    search,
    maxOctaves: octaves === null ? null : Number(octaves),
    ids: list,
    cursor: get("cursor"),
  };
}

/**
 * `GET /api/recordings`: visible recordings. Optional `q` (title contains),
 * `sort` (newest, oldest, longest), `maxOctaves`, `ids` (comma-separated)
 * and `cursor` from the previous page.
 */
export function listRecordings(request: Request, deps: RecordingsDeps) {
  const query = parseListQuery(new URL(request.url));
  if (typeof query === "string") return Promise.resolve(fail(400, query));
  const { sort, search, maxOctaves, ids, cursor } = query;
  const after = cursor ? decodeCursor(cursor, sort) : null;
  if (cursor && !after) return Promise.resolve(fail(400, "Invalid cursor."));
  if (ids?.length === 0) return Promise.resolve(json<RecordingListResponse>({ recordings: [], nextCursor: null }));

  return withDatabase(deps, async (rest) => {
    const pageSize = RECORDING_LIST_PAGE_SIZE;
    const { column, descending } = SORTS[sort];
    const direction = descending ? "desc" : "asc";
    const params = new URLSearchParams({
      select: SUMMARY_COLUMNS,
      hidden: "is.false",
      order: `${column}.${direction},id.${direction}`,
      // One extra row says whether another page exists.
      limit: String(pageSize + 1),
    });
    if (search) params.set("title", `ilike.${likePattern(search)}`);
    if (maxOctaves !== null) params.set("octaves", `lte.${maxOctaves}`);
    if (ids) params.set("id", `in.(${ids.join(",")})`);
    if (after) {
      const [key, id] = after;
      const op = descending ? "lt" : "gt";
      const value = typeof key === "string" ? `"${key}"` : String(key);
      params.set("or", `(${column}.${op}.${value},and(${column}.eq.${value},id.${op}.${id}))`);
    }
    const rows = await rest<SummaryRow[]>(params.toString());
    const page = rows.slice(0, pageSize);
    return json<RecordingListResponse>({
      recordings: page.map(summary),
      nextCursor: rows.length > pageSize ? encodeCursor(sort, page[page.length - 1]) : null,
    });
  });
}

/** `GET /api/recordings/:id`: one visible recording with its notes. */
export function getRecording(id: string, deps: RecordingsDeps) {
  if (!RECORDING_ID.test(id)) return Promise.resolve(fail(404, "Recording not found."));
  return withDatabase(deps, async (rest) => {
    const rows = await rest<(SummaryRow & { notes: RecordedNote[] })[]>(
      new URLSearchParams({
        select: `${SUMMARY_COLUMNS},notes`,
        id: `eq.${id}`,
        hidden: "is.false",
      }).toString(),
    );
    if (rows.length === 0) return fail(404, "Recording not found.");
    return json<SharedRecording>({ ...summary(rows[0]), notes: rows[0].notes });
  });
}

async function sha256Hex(value: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
  return Buffer.from(digest).toString("hex");
}

/**
 * The rate limit key. Vercel overwrites `x-forwarded-for` with the client
 * address, so callers cannot spoof it there. IPv6 clients usually control a
 * whole /64, so they share one key per /64.
 */
export function uploadClientKey(request: Request): string {
  const ip =
    request.headers.get("x-forwarded-for")?.split(",")[0].trim() ||
    request.headers.get("x-real-ip")?.trim() ||
    "unknown";
  // Also unwraps IPv4-mapped IPv6 (`::ffff:1.2.3.4`).
  const v4 = ip.match(/\d{1,3}(\.\d{1,3}){3}/);
  if (v4) return v4[0];
  if (!ip.includes(":")) return ip;
  const [head, tail = ""] = ip.toLowerCase().split("::");
  const front = head ? head.split(":") : [];
  const back = tail ? tail.split(":") : [];
  const groups = [...front, ...Array(Math.max(0, 8 - front.length - back.length)).fill("0"), ...back];
  return `${groups.slice(0, 4).map((group) => parseInt(group, 16).toString(16)).join(":")}::/64`;
}

/** Reads at most MAX_UPLOAD_BYTES, so a body without Content-Length cannot exhaust memory. */
async function readJson(request: Request): Promise<{ ok: true; body: unknown } | { ok: false; response: Response }> {
  const tooLarge = { ok: false, response: fail(413, "Recording is too large.") } as const;
  if (Number(request.headers.get("content-length")) > MAX_UPLOAD_BYTES) return tooLarge;
  const chunks: Uint8Array[] = [];
  let size = 0;
  if (request.body) {
    const reader = request.body.getReader();
    for (let chunk = await reader.read(); !chunk.done; chunk = await reader.read()) {
      size += chunk.value.byteLength;
      if (size > MAX_UPLOAD_BYTES) {
        await reader.cancel();
        return tooLarge;
      }
      chunks.push(chunk.value);
    }
  }
  try {
    return { ok: true, body: JSON.parse(Buffer.concat(chunks).toString("utf8")) };
  } catch {
    return { ok: false, response: fail(400, "Body must be JSON.") };
  }
}

/** `POST /api/recordings`: stores a validated upload and returns its delete token once. */
export async function uploadRecording(request: Request, deps: RecordingsDeps) {
  // Preview URLs are public too, so every Vercel deployment needs the opt-in.
  if (deps.env.VERCEL_ENV && deps.env.RECORDING_UPLOADS !== "1")
    return fail(503, "Sharing is not open yet.");
  const read = await readJson(request);
  if (!read.ok) return read.response;
  const result = validateUpload(read.body);
  if (!result.ok) return fail(400, "Invalid recording.", result.issues);

  return withDatabase(deps, async (rest) => {
    const upload = result.value;
    const deleteToken = Buffer.from(crypto.getRandomValues(new Uint8Array(32))).toString("base64url");
    const stored = await rest<{ id?: unknown; retry_after?: unknown } | null>("", {
      method: "POST",
      resource: "rpc/upload_recording",
      body: {
        p_key_hash: await sha256Hex(uploadClientKey(request)),
        p_limit: UPLOAD_RATE_LIMIT.uploads,
        p_window_seconds: UPLOAD_RATE_LIMIT.windowSeconds,
        p_recording: {
          title: upload.title,
          author_name: upload.authorName,
          device_id: upload.deviceId,
          bpm: upload.bpm,
          meter: restoreMeter(upload.meter),
          duration_ms: Math.round(recordingDurationMs(upload.notes)),
          note_count: upload.notes.length,
          octaves: recordingOctaves(upload.notes),
          notes: upload.notes,
          delete_token_hash: await sha256Hex(deleteToken),
        },
      },
    });
    const retryAfter = stored?.retry_after;
    if (typeof retryAfter === "number" && retryAfter > 0) {
      const minutes = Math.ceil(retryAfter / 60);
      return json<RecordingApiError>(
        { error: `Too many uploads. Try again in ${minutes} minute${minutes === 1 ? "" : "s"}.` },
        429,
        { "Retry-After": String(retryAfter) },
      );
    }
    if (typeof stored?.id !== "string") throw new DatabaseError("Upload returned no row");
    return json<UploadRecordingResponse>({ id: stored.id, deleteToken }, 201);
  });
}

/** `DELETE /api/recordings/:id`: deletes only when the token's hash matches. */
export async function deleteRecording(id: string, request: Request, deps: RecordingsDeps) {
  const read = await readJson(request);
  if (!read.ok) return read.response;
  const token = (read.body as { deleteToken?: unknown } | null)?.deleteToken;
  if (typeof token !== "string" || token.length === 0 || token.length > 256)
    return fail(403, "A valid delete token is required.");
  if (!RECORDING_ID.test(id)) return fail(404, "Recording not found.");

  return withDatabase(deps, async (rest) => {
    const deleted = await rest<{ id: string }[]>(
      new URLSearchParams({
        select: "id",
        id: `eq.${id}`,
        delete_token_hash: `eq.${await sha256Hex(token)}`,
      }).toString(),
      { method: "DELETE", prefer: "return=representation" },
    );
    if (deleted.length > 0) return json<DeleteRecordingResponse>({ deleted: true });
    // Nothing matched: tell a wrong token apart from a recording that is gone.
    const existing = await rest<{ id: string }[]>(`select=id&id=eq.${id}`);
    return existing.length > 0
      ? fail(403, "A valid delete token is required.")
      : fail(404, "Recording not found.");
  });
}
