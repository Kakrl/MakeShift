import { beforeEach, describe, expect, it, vi } from "vitest";

const fakeFetch = (impl: () => Promise<Response>) => vi.fn(impl) as unknown as typeof fetch;

async function load() {
  vi.resetModules();
  return import("../../frontend/src/lib/release");
}

describe("getLatestRelease", () => {
  beforeEach(() => vi.resetModules());

  it("returns the latest GitHub release tag and revalidates hourly", async () => {
    const { getLatestRelease, RELEASE_REVALIDATE_SECONDS } = await load();
    const fetchImpl = fakeFetch(async () => Response.json({ tag_name: "v0.7.1" }));
    expect(await getLatestRelease(fetchImpl)).toBe("v0.7.1");
    const [url, init] = vi.mocked(fetchImpl).mock.calls[0];
    expect(url).toBe("https://api.github.com/repos/Kakrl/MakeShift/releases/latest");
    expect(init).toMatchObject({ next: { revalidate: RELEASE_REVALIDATE_SECONDS } });
  });

  it("passes an abort signal so a stalled lookup cannot hold up the build", async () => {
    const { getLatestRelease } = await load();
    const fetchImpl = fakeFetch(async () => Response.json({ tag_name: "v1.0.0" }));
    await getLatestRelease(fetchImpl);
    expect(vi.mocked(fetchImpl).mock.calls[0][1]?.signal).toBeInstanceOf(AbortSignal);
  });

  it("returns null when no tag has been fetched yet", async () => {
    const { getLatestRelease } = await load();
    expect(await getLatestRelease(fakeFetch(async () => new Response("", { status: 403 })))).toBeNull();
    expect(await getLatestRelease(fakeFetch(async () => Response.json({})))).toBeNull();
    expect(await getLatestRelease(fakeFetch(async () => Response.json({ tag_name: " " })))).toBeNull();
    expect(await getLatestRelease(fakeFetch(async () => { throw new TypeError("offline"); }))).toBeNull();
  });

  it("keeps the last successful tag on transient errors", async () => {
    const { getLatestRelease } = await load();
    await getLatestRelease(fakeFetch(async () => Response.json({ tag_name: "v0.7.1" })));
    expect(await getLatestRelease(fakeFetch(async () => new Response("", { status: 403 })))).toBe("v0.7.1");
    expect(await getLatestRelease(fakeFetch(async () => new Response("", { status: 503 })))).toBe("v0.7.1");
    expect(await getLatestRelease(fakeFetch(async () => { throw new DOMException("t", "TimeoutError"); }))).toBe("v0.7.1");
  });

  it("clears the tag when the repo has no release (404)", async () => {
    const { getLatestRelease } = await load();
    await getLatestRelease(fakeFetch(async () => Response.json({ tag_name: "v0.7.1" })));
    expect(await getLatestRelease(fakeFetch(async () => new Response("", { status: 404 })))).toBeNull();
  });
});
