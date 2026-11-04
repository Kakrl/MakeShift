import { describe, expect, it, vi } from "vitest";
import { getLatestRelease, RELEASE_REVALIDATE_SECONDS } from "../../frontend/src/lib/release";

const fakeFetch = (impl: () => Promise<Response>) => vi.fn(impl) as unknown as typeof fetch;

describe("getLatestRelease", () => {
  it("returns the latest GitHub release tag and revalidates hourly", async () => {
    const fetchImpl = fakeFetch(async () => Response.json({ tag_name: "v0.7.1" }));
    expect(await getLatestRelease(fetchImpl)).toBe("v0.7.1");
    const [url, init] = vi.mocked(fetchImpl).mock.calls[0];
    expect(url).toBe("https://api.github.com/repos/Kakrl/MakeShift/releases/latest");
    expect(init).toMatchObject({ next: { revalidate: RELEASE_REVALIDATE_SECONDS } });
  });

  it("returns null when GitHub fails, rate limits or sends no tag", async () => {
    expect(await getLatestRelease(fakeFetch(async () => new Response("", { status: 403 })))).toBeNull();
    expect(await getLatestRelease(fakeFetch(async () => Response.json({})))).toBeNull();
    expect(await getLatestRelease(fakeFetch(async () => Response.json({ tag_name: " " })))).toBeNull();
    expect(await getLatestRelease(fakeFetch(async () => { throw new TypeError("offline"); }))).toBeNull();
  });
});
