/**
 * Server-only recordings API (#119, #122, #128) over the Supabase REST API.
 * Route files stay thin and call these handlers, so the specs can run them
 * with a mocked `fetch`. Like ./supabase, this holds the secret key and must
 * never be imported from client code. Error bodies never echo keys or
 * database messages.
 */
import {
  RECORDING_LIST_PAGE_SIZE,
  recordingDurationMs,
  validateUpload,
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
    /** `1` allows uploads on Vercel; off until rate limiting lands (#122). */
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

const SUMMARY_COLUMNS = "id,title,author_name,bpm,duration_ms,note_count,created_at";
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
// A Postgres timestamptz as PostgREST returns it. Kept as text, because a JS
// Date would drop the microseconds the keyset compares against.
const TIMESTAMP = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d{1,6})?(Z|[+-]\d{2}:\d{2})$/;

type SummaryRow = {
  id: string;
  title: string;
  author_name: string;
  bpm: number;
  duration_ms: number;
  note_count: number;
  created_at: string;
};

const json = <T>(body: T, status = 200) =>
  Response.json(body, { status, headers: { "Cache-Control": "no-store" } });

const fail = (status: number, error: string, issues?: RecordingApiError["issues"]) =>
  json<RecordingApiError>(issues ? { error, issues } : { error }, status);

class DatabaseError extends Error {}

function database({ env, fetchImpl = fetch }: RecordingsDeps) {
  const url = env.SUPABASE_URL?.trim().replace(/\/+$/, "");
  const key = env.SUPABASE_SECRET_KEY?.trim();
  if (!url || !key) return null;

  return async function rest<T>(
    query: string,
    init: { method?: string; body?: unknown; prefer?: string } = {},
  ): Promise<T> {
    let response: Response;
    try {
      response = await fetchImpl(`${url}/rest/v1/recordings?${query}`, {
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
    durationMs: row.duration_ms,
    noteCount: row.note_count,
    createdAt: row.created_at,
  };
}

// The cursor is the last row's sort key, so pages stay stable while new
// recordings arrive (an offset would repeat rows).
function encodeCursor({ created_at, id }: SummaryRow): string {
  return Buffer.from(JSON.stringify([created_at, id])).toString("base64url");
}

function decodeCursor(cursor: string): [string, string] | null {
  try {
    const value: unknown = JSON.parse(Buffer.from(cursor, "base64url").toString());
    if (
      Array.isArray(value) &&
      value.length === 2 &&
      typeof value[0] === "string" &&
      TIMESTAMP.test(value[0]) &&
      typeof value[1] === "string" &&
      UUID.test(value[1])
    )
      return [value[0], value[1]];
  } catch {}
  return null;
}

/** `GET /api/recordings?cursor=`: visible recordings, newest first. */
export function listRecordings(request: Request, deps: RecordingsDeps) {
  const cursor = new URL(request.url).searchParams.get("cursor");
  const after = cursor ? decodeCursor(cursor) : null;
  if (cursor && !after) return Promise.resolve(fail(400, "Invalid cursor."));

  return withDatabase(deps, async (rest) => {
    const pageSize = RECORDING_LIST_PAGE_SIZE;
    const params = new URLSearchParams({
      select: SUMMARY_COLUMNS,
      hidden: "is.false",
      order: "created_at.desc,id.desc",
      // One extra row says whether another page exists.
      limit: String(pageSize + 1),
    });
    if (after) {
      const [createdAt, id] = after;
      params.set("or", `(created_at.lt."${createdAt}",and(created_at.eq."${createdAt}",id.lt.${id}))`);
    }
    const rows = await rest<SummaryRow[]>(params.toString());
    const page = rows.slice(0, pageSize);
    return json<RecordingListResponse>({
      recordings: page.map(summary),
      nextCursor: rows.length > pageSize ? encodeCursor(page[page.length - 1]) : null,
    });
  });
}

/** `GET /api/recordings/:id`: one visible recording with its notes. */
export function getRecording(id: string, deps: RecordingsDeps) {
  if (!UUID.test(id)) return Promise.resolve(fail(404, "Recording not found."));
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
    const rows = await rest<{ id: string }[]>("select=id", {
      method: "POST",
      prefer: "return=representation",
      body: {
        title: upload.title,
        author_name: upload.authorName,
        device_id: upload.deviceId,
        bpm: upload.bpm,
        duration_ms: Math.round(recordingDurationMs(upload.notes)),
        note_count: upload.notes.length,
        notes: upload.notes,
        delete_token_hash: await sha256Hex(deleteToken),
      },
    });
    if (typeof rows[0]?.id !== "string") throw new DatabaseError("Insert returned no row");
    return json<UploadRecordingResponse>({ id: rows[0].id, deleteToken }, 201);
  });
}

/** `DELETE /api/recordings/:id`: deletes only when the token's hash matches. */
export async function deleteRecording(id: string, request: Request, deps: RecordingsDeps) {
  const read = await readJson(request);
  if (!read.ok) return read.response;
  const token = (read.body as { deleteToken?: unknown } | null)?.deleteToken;
  if (typeof token !== "string" || token.length === 0 || token.length > 256)
    return fail(403, "A valid delete token is required.");
  if (!UUID.test(id)) return fail(404, "Recording not found.");

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
