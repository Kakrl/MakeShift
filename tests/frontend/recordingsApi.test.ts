import { createHash } from "node:crypto";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  deleteRecording,
  getRecording,
  listRecordings,
  MAX_UPLOAD_BYTES,
  UPLOAD_RATE_LIMIT,
  uploadClientKey,
  uploadRecording,
  type RecordingsDeps,
} from "../../frontend/src/server/recordings";
import { createShareApi, ShareNotFoundError } from "../../frontend/src/app/share/shareApi";
import { shareUrl, stopShare, uploadTake, type TakeShare } from "../../frontend/src/app/share/shareStore";
import { RECORDING_LIST_PAGE_SIZE } from "../../frontend/src/lib/recordings";

const env = {
  SUPABASE_URL: "https://example.supabase.co/",
  SUPABASE_SECRET_KEY: "sb_secret_test",
};
const ID = "6f1c2b8e-1d2a-4c3b-9a7e-0123456789ab";

type Call = { url: URL; init: RequestInit };

/** A fake PostgREST that answers each call in turn and records it. */
function database(...responses: unknown[]) {
  const calls: Call[] = [];
  const fetchImpl = vi.fn(async (url: string, init: RequestInit) => {
    calls.push({ url: new URL(url), init });
    const next = responses.shift();
    if (next === undefined) throw new Error("unexpected database call");
    return next instanceof Response ? next : Response.json(next);
  });
  const deps: RecordingsDeps = { env, fetchImpl: fetchImpl as unknown as typeof fetch };
  return { calls, deps };
}

const row = (index: number) => ({
  id: `00000000-0000-4000-8000-${String(index).padStart(12, "0")}`,
  title: `Song ${index}`,
  author_name: "Jo",
  bpm: 100,
  duration_ms: 1000,
  note_count: 2,
  octaves: 1,
  created_at: `2026-10-${String(20 - index).padStart(2, "0")}T12:00:00.123456+00:00`,
});

const upload = {
  title: "  My song  ",
  authorName: "Jo",
  deviceId: "device",
  bpm: 120,
  notes: [
    { pitch: "C4", velocity: 80, startMs: 0, durationMs: 500, extra: true },
    { pitch: "E4", velocity: 70, startMs: 250, durationMs: 400 },
  ],
};

const post = (body: unknown) =>
  new Request("http://localhost/api/recordings", {
    method: "POST",
    body: typeof body === "string" ? body : JSON.stringify(body),
  });

const del = (body: unknown) =>
  new Request(`http://localhost/api/recordings/${ID}`, {
    method: "DELETE",
    body: JSON.stringify(body),
  });

const sha256 = (value: string) => createHash("sha256").update(value).digest("hex");

describe("GET /api/recordings", () => {
  it("lists visible summaries newest first and pages with a keyset cursor", async () => {
    const rows = Array.from({ length: RECORDING_LIST_PAGE_SIZE + 1 }, (_, i) => row(i));
    const { calls, deps } = database(rows, [row(RECORDING_LIST_PAGE_SIZE)]);

    const first = await listRecordings(new Request("http://localhost/api/recordings"), deps);
    expect(first.status).toBe(200);
    const page = await first.json();
    expect(page.recordings).toHaveLength(RECORDING_LIST_PAGE_SIZE);
    expect(page.recordings[0]).toEqual({
      id: rows[0].id,
      title: "Song 0",
      authorName: "Jo",
      bpm: 100,
      meter: { numerator: 4, denominator: 4 },
      durationMs: 1000,
      noteCount: 2,
      octaves: 1,
      createdAt: rows[0].created_at,
    });
    expect(page.recordings[0]).not.toHaveProperty("notes");
    const query = calls[0].url.searchParams;
    expect(calls[0].url.pathname).toBe("/rest/v1/recordings");
    expect(query.get("hidden")).toBe("is.false");
    expect(query.get("order")).toBe("created_at.desc,id.desc");
    expect(query.get("limit")).toBe(String(RECORDING_LIST_PAGE_SIZE + 1));
    expect(query.get("select")).not.toContain("notes");
    expect(calls[0].init.headers).toMatchObject({ apikey: "sb_secret_test" });

    const second = await listRecordings(
      new Request(`http://localhost/api/recordings?cursor=${page.nextCursor}`),
      deps,
    );
    expect((await second.json()).nextCursor).toBeNull();
    const last = rows[RECORDING_LIST_PAGE_SIZE - 1];
    expect(calls[1].url.searchParams.get("or")).toBe(
      `(created_at.lt."${last.created_at}",and(created_at.eq."${last.created_at}",id.lt.${last.id}))`,
    );
  });

  it("rejects a malformed or filter-smuggling cursor without querying", async () => {
    const { calls, deps } = database();
    // Date.parse accepts this, but it would add terms to the or() filter.
    const smuggled = Buffer.from(
      JSON.stringify(['Jan 1 2020 (",title.eq.x,created_at.gt.")', ID]),
    ).toString("base64url");
    for (const cursor of ["nope", smuggled]) {
      const response = await listRecordings(new Request(`http://localhost/api/recordings?cursor=${cursor}`), deps);
      expect(response.status).toBe(400);
    }
    expect(calls).toHaveLength(0);
  });

  it("filters by title, octaves and ids, escaping LIKE wildcards", async () => {
    const { calls, deps } = database([row(0)]);
    const ids = [ID, "00000000-0000-4000-8000-000000000001"];
    const url = new URL("http://localhost/api/recordings");
    url.searchParams.set("q", "  50%_off\\*  ");
    url.searchParams.set("maxOctaves", "2");
    url.searchParams.set("ids", ids.join(","));
    expect((await listRecordings(new Request(url), deps)).status).toBe(200);
    const query = calls[0].url.searchParams;
    expect(query.get("title")).toBe("ilike.*50\\%\\_off\\\\*");
    expect(query.get("octaves")).toBe("lte.2");
    expect(query.get("id")).toBe(`in.(${ids.join(",")})`);
  });

  it("answers an empty ids list without querying", async () => {
    const { calls, deps } = database();
    const response = await listRecordings(new Request("http://localhost/api/recordings?ids="), deps);
    expect(await response.json()).toEqual({ recordings: [], nextCursor: null });
    expect(calls).toHaveLength(0);
  });

  it.each([
    ["sort=sideways"],
    ["maxOctaves=lots"],
    ["ids=not-a-uuid"],
    [`ids=${Array.from({ length: 101 }, () => ID).join(",")}`],
    [`q=${"x".repeat(101)}`],
  ])("rejects an invalid query (%s) without querying", async (search) => {
    const { calls, deps } = database();
    const response = await listRecordings(new Request(`http://localhost/api/recordings?${search}`), deps);
    expect(response.status).toBe(400);
    expect(calls).toHaveLength(0);
  });

  it.each([
    ["oldest", "created_at.asc,id.asc", "gt"],
    ["longest", "duration_ms.desc,id.desc", "lt"],
  ])("orders by %s and pages with a cursor for that sort", async (sort, order, op) => {
    const rows = Array.from({ length: RECORDING_LIST_PAGE_SIZE + 1 }, (_, i) => row(i));
    const { calls, deps } = database(rows, []);
    const first = await listRecordings(new Request(`http://localhost/api/recordings?sort=${sort}`), deps);
    expect(calls[0].url.searchParams.get("order")).toBe(order);
    const page = await first.json();
    await listRecordings(new Request(`http://localhost/api/recordings?sort=${sort}&cursor=${page.nextCursor}`), deps);
    const last = rows[RECORDING_LIST_PAGE_SIZE - 1];
    const key = sort === "longest" ? String(last.duration_ms) : `"${last.created_at}"`;
    const column = sort === "longest" ? "duration_ms" : "created_at";
    expect(calls[1].url.searchParams.get("or")).toBe(
      `(${column}.${op}.${key},and(${column}.eq.${key},id.${op}.${last.id}))`,
    );
  });

  it("rejects a cursor from a different sort", async () => {
    const { calls, deps } = database();
    const timestamp = Buffer.from(JSON.stringify([row(0).created_at, ID])).toString("base64url");
    const duration = Buffer.from(JSON.stringify([1000, ID])).toString("base64url");
    for (const search of [`sort=longest&cursor=${timestamp}`, `sort=newest&cursor=${duration}`]) {
      const response = await listRecordings(new Request(`http://localhost/api/recordings?${search}`), deps);
      expect(response.status).toBe(400);
    }
    expect(calls).toHaveLength(0);
  });

  it("stores the octaves a song spans", async () => {
    const { calls, deps } = database({ id: ID });
    const wide = { ...upload, notes: [
      { pitch: "C3", velocity: 80, startMs: 0, durationMs: 100 },
      { pitch: "D5", velocity: 80, startMs: 100, durationMs: 100 },
    ] };
    await uploadRecording(post(wide), deps);
    expect(JSON.parse(calls[0].init.body as string).p_recording.octaves).toBe(3);
  });

  it("returns 503 when unconfigured and 502 without echoing database errors", async () => {
    const unconfigured = await listRecordings(new Request("http://localhost/api/recordings"), { env: {} });
    expect(unconfigured.status).toBe(503);

    const { deps } = database(new Response("permission denied for sb_secret_test", { status: 401 }));
    const failed = await listRecordings(new Request("http://localhost/api/recordings"), deps);
    expect(failed.status).toBe(502);
    expect(await failed.text()).not.toMatch(/sb_secret|permission/);
  });
});

describe("GET /api/recordings/:id", () => {
  it("returns the full recording with notes", async () => {
    const notes = [{ pitch: "C4", velocity: 80, startMs: 0, durationMs: 500 }];
    const { calls, deps } = database([{ ...row(1), id: ID, notes }]);
    const response = await getRecording(ID, deps);
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ id: ID, authorName: "Jo", notes });
    expect(calls[0].url.searchParams.get("id")).toBe(`eq.${ID}`);
    expect(calls[0].url.searchParams.get("hidden")).toBe("is.false");
  });

  it("returns 404 for missing, hidden or non-UUID ids", async () => {
    const { calls, deps } = database([]);
    expect((await getRecording(ID, deps)).status).toBe(404);
    expect((await getRecording("demo-1", deps)).status).toBe(404);
    expect(calls).toHaveLength(1);
  });
});

describe("POST /api/recordings", () => {
  it("stores the validated upload with only the token hash", async () => {
    const { calls, deps } = database({ id: ID });
    const response = await uploadRecording(post(upload), deps);
    expect(response.status).toBe(201);
    const { id, deleteToken } = await response.json();
    expect(id).toBe(ID);
    expect(deleteToken).toMatch(/^[A-Za-z0-9_-]{43}$/);

    expect(calls).toHaveLength(1);
    expect(calls[0].url.pathname).toBe("/rest/v1/rpc/upload_recording");
    expect(calls[0].init.method).toBe("POST");
    const stored = JSON.parse(calls[0].init.body as string).p_recording;
    expect(stored).toEqual({
      title: "My song",
      author_name: "Jo",
      device_id: "device",
      bpm: 120,
      meter: { numerator: 4, denominator: 4 },
      duration_ms: 650,
      note_count: 2,
      octaves: 1,
      notes: [
        { pitch: "C4", velocity: 80, startMs: 0, durationMs: 500 },
        { pitch: "E4", velocity: 70, startMs: 250, durationMs: 400 },
      ],
      delete_token_hash: sha256(deleteToken),
    });
    expect(calls[0].init.body).not.toContain(deleteToken);
  });

  it("returns 400 with the validation issues and stores nothing", async () => {
    const { calls, deps } = database();
    const response = await uploadRecording(post({ ...upload, bpm: 9000 }), deps);
    expect(response.status).toBe(400);
    expect((await response.json()).issues).toEqual([
      { field: "bpm", message: "bpm must be an integer 20-400" },
    ]);
    expect((await uploadRecording(post("{not json"), deps)).status).toBe(400);
    expect(calls).toHaveLength(0);
  });

  it("rejects oversized bodies, including streamed ones without Content-Length", async () => {
    const { calls, deps } = database();
    const response = await uploadRecording(post("x".repeat(MAX_UPLOAD_BYTES + 1)), deps);
    expect(response.status).toBe(413);

    const chunk = new Uint8Array(64 * 1024);
    let sent = 0;
    const stream = new ReadableStream<Uint8Array>({
      pull(controller) {
        sent += chunk.byteLength;
        controller.enqueue(chunk);
      },
    });
    const streamed = new Request("http://localhost/api/recordings", {
      method: "POST",
      body: stream,
      duplex: "half",
    } as RequestInit);
    expect(streamed.headers.get("content-length")).toBeNull();
    expect((await uploadRecording(streamed, deps)).status).toBe(413);
    // Reading stopped just past the limit instead of draining the stream.
    expect(sent).toBeLessThan(MAX_UPLOAD_BYTES + 4 * chunk.byteLength);
    expect(calls).toHaveLength(0);
  });

  it("returns 502 when the upload returns no row", async () => {
    const { deps } = database({});
    expect((await uploadRecording(post(upload), deps)).status).toBe(502);
  });

  it("stays closed on every Vercel deployment until uploads are enabled", async () => {
    const { calls, deps } = database({ id: ID });
    for (const VERCEL_ENV of ["production", "preview"]) {
      const closed = await uploadRecording(post(upload), { ...deps, env: { ...env, VERCEL_ENV } });
      expect(closed.status).toBe(503);
    }
    expect(calls).toHaveLength(0);
    const open = await uploadRecording(post(upload), {
      ...deps,
      env: { ...env, VERCEL_ENV: "preview", RECORDING_UPLOADS: "1" },
    });
    expect(open.status).toBe(201);
  });
});

describe("upload rate limit", () => {
  const WINDOW_MS = UPLOAD_RATE_LIMIT.windowSeconds * 1000;

  /** A fake PostgREST whose rpc keeps upload_recording's window and rollback. */
  function limitedDatabase({ insertFails = false } = {}) {
    const claims = new Map<string, number[]>();
    const calls: Call[] = [];
    let inserts = 0;
    const fetchImpl = vi.fn(async (url: string, init: RequestInit) => {
      calls.push({ url: new URL(url), init });
      const { p_key_hash, p_limit, p_window_seconds } = JSON.parse(init.body as string);
      const now = Date.now();
      const windowMs = p_window_seconds * 1000;
      const live = (claims.get(p_key_hash) ?? []).filter((at) => at > now - windowMs);
      if (live.length >= p_limit)
        return Response.json({ retry_after: Math.max(1, Math.ceil((live[0] + windowMs - now) / 1000)) });
      if (insertFails) return new Response("insert failed", { status: 500 });
      claims.set(p_key_hash, [...live, now]);
      inserts++;
      return Response.json({ id: ID });
    });
    return {
      calls,
      deps: { env, fetchImpl: fetchImpl as unknown as typeof fetch } as RecordingsDeps,
      inserts: () => inserts,
      setInsertFails: (fails: boolean) => (insertFails = fails),
    };
  }

  const from = (ip: string, body: unknown = upload) =>
    new Request("http://localhost/api/recordings", {
      method: "POST",
      headers: { "x-forwarded-for": `${ip}, 10.0.0.1` },
      body: JSON.stringify(body),
    });

  afterEach(() => vi.useRealTimers());

  it("returns 429 on the sixth upload in the window and reopens after it", async () => {
    vi.useFakeTimers({ now: new Date("2026-10-31T12:00:00Z") });
    const { deps, inserts } = limitedDatabase();
    for (let i = 0; i < UPLOAD_RATE_LIMIT.uploads; i++) {
      expect((await uploadRecording(from("203.0.113.7"), deps)).status).toBe(201);
      vi.advanceTimersByTime(1000);
    }
    const stored = inserts();

    const limited = await uploadRecording(from("203.0.113.7"), deps);
    expect(limited.status).toBe(429);
    expect(limited.headers.get("Retry-After")).toBe(String(UPLOAD_RATE_LIMIT.windowSeconds - 5));
    expect((await limited.json()).error).toBe("Too many uploads. Try again in 10 minutes.");
    expect(inserts()).toBe(stored);

    // Another client is unaffected.
    expect((await uploadRecording(from("198.51.100.2"), deps)).status).toBe(201);

    // Only the first upload has left the window, so one slot reopens.
    vi.advanceTimersByTime(WINDOW_MS - 5000);
    expect((await uploadRecording(from("203.0.113.7"), deps)).status).toBe(201);
    expect((await uploadRecording(from("203.0.113.7"), deps)).status).toBe(429);
    vi.advanceTimersByTime(WINDOW_MS);
    expect((await uploadRecording(from("203.0.113.7"), deps)).status).toBe(201);
  });

  it("claims with the limit and a hashed key, never the raw address", async () => {
    const { calls, deps } = limitedDatabase();
    await uploadRecording(from("203.0.113.7"), deps);
    expect(calls[0].url.pathname).toBe("/rest/v1/rpc/upload_recording");
    expect(calls[0].init.method).toBe("POST");
    expect(JSON.parse(calls[0].init.body as string)).toMatchObject({
      p_key_hash: sha256("203.0.113.7"),
      p_limit: UPLOAD_RATE_LIMIT.uploads,
      p_window_seconds: UPLOAD_RATE_LIMIT.windowSeconds,
    });
    expect(calls[0].init.body).not.toContain("203.0.113.7");
  });

  it("leaves the quota unchanged when the insert fails", async () => {
    const { deps, inserts, setInsertFails } = limitedDatabase({ insertFails: true });
    for (let i = 0; i < UPLOAD_RATE_LIMIT.uploads * 2; i++)
      expect((await uploadRecording(from("203.0.113.7"), deps)).status).toBe(502);
    setInsertFails(false);
    for (let i = 0; i < UPLOAD_RATE_LIMIT.uploads; i++)
      expect((await uploadRecording(from("203.0.113.7"), deps)).status).toBe(201);
    expect(inserts()).toBe(UPLOAD_RATE_LIMIT.uploads);
    expect((await uploadRecording(from("203.0.113.7"), deps)).status).toBe(429);
  });

  it("does not spend a slot on rejected uploads", async () => {
    const { calls, deps } = limitedDatabase();
    for (let i = 0; i < 10; i++)
      expect((await uploadRecording(from("203.0.113.7", { ...upload, bpm: 9000 }), deps)).status).toBe(400);
    expect(calls).toHaveLength(0);
  });

  it("fails closed with 502 when the limit cannot be checked", async () => {
    const { calls, deps } = database(new Response("down", { status: 500 }));
    expect((await uploadRecording(post(upload), deps)).status).toBe(502);
    expect(calls).toHaveLength(1);
  });

  it("keys IPv4 by address and IPv6 by /64", () => {
    const key = (headers: Record<string, string>) =>
      uploadClientKey(new Request("http://localhost/api/recordings", { headers }));
    expect(key({ "x-forwarded-for": "203.0.113.7, 10.0.0.1" })).toBe("203.0.113.7");
    expect(key({ "x-real-ip": "203.0.113.8" })).toBe("203.0.113.8");
    expect(key({ "x-forwarded-for": "::ffff:203.0.113.9" })).toBe("203.0.113.9");
    expect(key({ "x-forwarded-for": "2001:db8:aa:bb:1:2:3:4" })).toBe("2001:db8:aa:bb::/64");
    expect(key({ "x-forwarded-for": "2001:DB8:aa:bb::9" })).toBe("2001:db8:aa:bb::/64");
    expect(key({ "x-forwarded-for": "2001:db8::1" })).toBe("2001:db8:0:0::/64");
    expect(key({})).toBe("unknown");
  });
});

describe("DELETE /api/recordings/:id", () => {
  it("deletes when the token hash matches", async () => {
    const { calls, deps } = database([{ id: ID }]);
    const response = await deleteRecording(ID, del({ deleteToken: "secret" }), deps);
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ deleted: true });
    expect(calls[0].init.method).toBe("DELETE");
    expect(calls[0].url.searchParams.get("id")).toBe(`eq.${ID}`);
    expect(calls[0].url.searchParams.get("delete_token_hash")).toBe(`eq.${sha256("secret")}`);
  });

  it("returns 403 for a wrong token and 404 when the recording is gone", async () => {
    const wrong = database([], [{ id: ID }]);
    expect((await deleteRecording(ID, del({ deleteToken: "wrong" }), wrong.deps)).status).toBe(403);

    const gone = database([], []);
    expect((await deleteRecording(ID, del({ deleteToken: "secret" }), gone.deps)).status).toBe(404);
  });

  it("returns 403 for a missing token without touching the database", async () => {
    const { calls, deps } = database();
    expect((await deleteRecording(ID, del({}), deps)).status).toBe(403);
    expect(calls).toHaveLength(0);
  });
});

describe("share API client", () => {
  function client(response: Response) {
    const fetchImpl = vi.fn(async () => response);
    return { api: createShareApi(fetchImpl as unknown as typeof fetch), fetchImpl };
  }

  it("maps 404s to null and ShareNotFoundError", async () => {
    const missing = () => Response.json({ error: "Recording not found." }, { status: 404 });
    expect(await client(missing()).api.get(ID)).toBeNull();
    await expect(client(missing()).api.remove(ID, "t")).rejects.toBeInstanceOf(ShareNotFoundError);
  });

  it("surfaces the first validation issue on a rejected upload", async () => {
    const { api } = client(
      Response.json(
        { error: "Invalid recording.", issues: [{ field: "title", message: "title must be 1-100 characters" }] },
        { status: 400 },
      ),
    );
    await expect(api.upload({ ...upload, title: "" })).rejects.toThrow("title must be 1-100 characters");
  });

  it("passes the cursor through", async () => {
    const { api, fetchImpl } = client(Response.json({ recordings: [], nextCursor: null }));
    await api.list("abc=");
    expect(fetchImpl).toHaveBeenCalledWith("/api/recordings?cursor=abc%3D", expect.anything());
  });
});

describe("stopping a take's share", () => {
  it("treats an already-deleted share as stopped and throws on other failures", async () => {
    const fetchMock = vi.fn(async () => Response.json({ error: "Recording not found." }, { status: 404 }));
    vi.stubGlobal("fetch", fetchMock);
    try {
      await expect(stopShare({ id: ID, deleteToken: "t" })).resolves.toBeUndefined();
      expect(fetchMock).toHaveBeenCalledWith(`/api/recordings/${ID}`, expect.objectContaining({ method: "DELETE" }));
      fetchMock.mockResolvedValueOnce(Response.json({ error: "down" }, { status: 502 }));
      await expect(stopShare({ id: ID, deleteToken: "t" })).rejects.toThrow("down");
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it("undoes a share whose delete token can't be saved", async () => {
    const take = { id: "take", name: "Take", createdAt: "2026-10-15T00:00:00.000Z", bpm: 120, notes: upload.notes };
    const uploaded = () => Response.json({ id: ID, deleteToken: "t" }, { status: 201 });
    const kept: (TakeShare | null)[] = [];
    const full = (share: TakeShare | null) => {
      kept.push(share);
      return { ok: false, reason: "quota" } as const;
    };
    const fetchMock = vi.fn(uploaded).mockResolvedValueOnce(uploaded()).mockResolvedValueOnce(Response.json({ deleted: true }));
    vi.stubGlobal("fetch", fetchMock);
    try {
      await expect(uploadTake(take, "Take", "Jo", full)).rejects.toThrow(/undone/);
      expect(fetchMock).toHaveBeenLastCalledWith(`/api/recordings/${ID}`, expect.objectContaining({ method: "DELETE" }));
      expect(kept).toEqual([{ id: ID, deleteToken: "t" }, null]);

      // When undoing fails too, the share stays kept in memory for a retry.
      kept.length = 0;
      fetchMock.mockResolvedValueOnce(uploaded()).mockResolvedValueOnce(Response.json({ error: "down" }, { status: 502 }));
      await expect(uploadTake(take, "Take", "Jo", full)).rejects.toThrow(/Retry saving/);
      expect(kept).toEqual([{ id: ID, deleteToken: "t" }]);
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it("checks and normalizes the take with the shared schema before uploading", async () => {
    const take = { id: "take", name: "Take", createdAt: "2026-10-15T00:00:00.000Z", bpm: 120, notes: upload.notes };
    const keep = () => ({ ok: true }) as const;
    const fetchMock = vi.fn(async () => Response.json({ id: ID, deleteToken: "t" }, { status: 201 }));
    vi.stubGlobal("fetch", fetchMock);
    try {
      await expect(uploadTake({ ...take, notes: [] }, "Take", "Jo", keep)).rejects.toThrow("notes must contain 1-");
      await expect(uploadTake({ ...take, bpm: 12.5 }, "Take", "Jo", keep)).rejects.toThrow("bpm must be an integer");
      await expect(uploadTake(take, "   ", "Jo", keep)).rejects.toThrow("title must be 1-100 characters");
      expect(fetchMock).not.toHaveBeenCalled();

      await expect(uploadTake(take, "  Take  ", "Jo", keep)).resolves.toEqual({ id: ID, deleteToken: "t" });
      const sent = JSON.parse((fetchMock.mock.calls[0] as unknown as [string, RequestInit])[1].body as string);
      expect(sent.title).toBe("Take");
      expect(sent.notes[0]).toEqual({ pitch: "C4", velocity: 80, startMs: 0, durationMs: 500 });
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it("keeps mock links on the mock store", () => {
    expect(shareUrl(ID, false)).toBe(`/play/${ID}`);
    expect(shareUrl("ab12cd34", true)).toBe("/play/ab12cd34?mock=1");
  });
});

it("preserves meter on upload, list and read with legacy fallback", async () => {
  const meter = {numerator:7,denominator:8};
  const db=database({id:ID},[{...row(1),id:ID,meter}],[{...row(1),id:ID,meter,notes:upload.notes}]);
  expect((await uploadRecording(post({...upload,meter}),db.deps)).status).toBe(201);
  expect(JSON.parse(db.calls[0].init.body as string).p_recording.meter).toEqual(meter);
  expect((await (await listRecordings(new Request("http://localhost/api/recordings"),db.deps)).json()).recordings[0].meter).toEqual(meter);
  expect((await (await getRecording(ID,db.deps)).json()).meter).toEqual(meter);
});
it.each([{numerator:0,denominator:4},{numerator:7,denominator:3},null])("rejects invalid uploaded meter before touching the database", async meter => {
  const db=database();
  expect((await uploadRecording(post({...upload,meter}),db.deps)).status).toBe(400);
  expect(db.calls).toHaveLength(0);
});

it("normalizes legacy/corrupt API meter and rejects invalid client uploads", async () => {
  const fetchImpl=vi.fn(async () => Response.json({id:ID,meter:{numerator:7,denominator:3}}));
  const client=createShareApi(fetchImpl as unknown as typeof fetch);
  expect((await client.get(ID))!.meter).toEqual({numerator:4,denominator:4});
  await expect(client.upload({...upload,meter:{numerator:33,denominator:4}})).rejects.toThrow("Invalid time signature");
  expect(fetchImpl).toHaveBeenCalledTimes(1);
});
