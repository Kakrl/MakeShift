export const REPO_URL = "https://github.com/Kakrl/MakeShift";
const LATEST_RELEASE_API = "https://api.github.com/repos/Kakrl/MakeShift/releases/latest";
export const RELEASE_REVALIDATE_SECONDS = 3600;
export const RELEASE_TIMEOUT_MS = 3000;

let lastTag: string | null = null;

/** Latest GitHub release tag (for example `v0.7.1`), or null when none has been fetched. */
export async function getLatestRelease(fetchImpl: typeof fetch = fetch): Promise<string | null> {
  try {
    const response = await fetchImpl(LATEST_RELEASE_API, {
      headers: { Accept: "application/vnd.github+json" },
      next: { revalidate: RELEASE_REVALIDATE_SECONDS },
      signal: AbortSignal.timeout(RELEASE_TIMEOUT_MS),
    });
    if (response.status === 404) return (lastTag = null);
    if (!response.ok) return lastTag;
    const { tag_name: tag } = (await response.json()) as { tag_name?: unknown };
    if (typeof tag === "string" && tag.trim()) lastTag = tag.trim();
    return lastTag;
  } catch {
    return lastTag;
  }
}
