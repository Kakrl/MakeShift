import { createHash } from "node:crypto";
import { describe, expect, it, vi } from "vitest";
import {
  deleteRecording,
  getRecording,
  listRecordings,
  MAX_UPLOAD_BYTES,
  uploadRecording,
  type RecordingsDeps,
} from "../../frontend/src/server/recordings";
import { createShareApi, ShareNotFoundError } from "../../frontend/src/app/share/shareApi";
import { shareUrl, stopShare } from "../../frontend/src/app/share/shareStore";
import { RECORDING_LIST_PAGE_SIZE } from "../../frontend/src/lib/recordings";

const env = {
  SUPABASE_URL: "https://example.supabase.co/",
  SUPABASE_SECRET_KEY: "sb_secret_test",
};
const ID = "6f1c2b8e-1d2a-4c3b-9a7e-0123456789ab";

type Call = { url: URL; init: RequestInit };

/** A fake PostgREST that answers each call in turn and records it. */
function database(...responses: (unknown[] | Response)[]) {
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
      durationMs: 1000,
      noteCount: 2,
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
    const { calls, deps } = database([{ id: ID }]);
    const response = await uploadRecording(post(upload), deps);
    expect(response.status).toBe(201);
    const { id, deleteToken } = await response.json();
    expect(id).toBe(ID);
    expect(deleteToken).toMatch(/^[A-Za-z0-9_-]{43}$/);

    expect(calls[0].init.method).toBe("POST");
    expect(calls[0].init.headers).toMatchObject({ Prefer: "return=representation" });
    const stored = JSON.parse(calls[0].init.body as string);
    expect(stored).toEqual({
      title: "My song",
      author_name: "Jo",
      device_id: "device",
      bpm: 120,
      duration_ms: 650,
      note_count: 2,
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

  it("returns 502 when the insert returns no row", async () => {
    const { deps } = database([]);
    expect((await uploadRecording(post(upload), deps)).status).toBe(502);
  });

  it("stays closed on every Vercel deployment until uploads are enabled", async () => {
    const { calls, deps } = database([{ id: ID }]);
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

  it("keeps mock links on the mock store", () => {
    expect(shareUrl(ID, false)).toBe(`/play/${ID}`);
    expect(shareUrl("ab12cd34", true)).toBe("/play/ab12cd34?mock=1");
  });
});
