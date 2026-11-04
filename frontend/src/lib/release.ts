export const REPO_URL = "https://github.com/Kakrl/MakeShift";
const LATEST_RELEASE_API = "https://api.github.com/repos/Kakrl/MakeShift/releases/latest";
export const RELEASE_REVALIDATE_SECONDS = 3600;

/** Latest GitHub release tag (for example `v0.7.1`), or null when unavailable. */
export async function getLatestRelease(fetchImpl: typeof fetch = fetch): Promise<string | null> {
  try {
    const response = await fetchImpl(LATEST_RELEASE_API, {
      headers: { Accept: "application/vnd.github+json" },
      next: { revalidate: RELEASE_REVALIDATE_SECONDS },
    });
    if (!response.ok) return null;
    const { tag_name: tag } = (await response.json()) as { tag_name?: unknown };
    return typeof tag === "string" && tag.trim() ? tag.trim() : null;
  } catch {
    return null;
  }
}
