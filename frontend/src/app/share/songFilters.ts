import {
  MAX_SEARCH_LENGTH,
  recordingDurationMs,
  recordingOctaves,
  type RecordingListQuery,
  type RecordingSort,
} from "../../lib/recordings";
import type { LibraryEntry } from "../midi/recordingsLibrary";

/** The controls' state; `favoritesOnly` is applied by the caller with the saved ids. */
export type SongFilters = {
  search: string;
  sort: RecordingSort;
  /** 0 is any size. */
  maxOctaves: number;
  favoritesOnly: boolean;
};

export const DEFAULT_FILTERS: SongFilters = { search: "", sort: "newest", maxOctaves: 0, favoritesOnly: false };

export const isFiltered = (filters: SongFilters) =>
  filters.search.trim() !== "" || filters.maxOctaves !== 0 || filters.favoritesOnly;

/** The API query for a Shared list; favorites-only needs the saved ids. */
export function toListQuery(filters: SongFilters, favoriteIds: readonly string[]): RecordingListQuery {
  const query: RecordingListQuery = { sort: filters.sort };
  const q = filters.search.trim().slice(0, MAX_SEARCH_LENGTH);
  if (q) query.q = q;
  if (filters.maxOctaves) query.maxOctaves = filters.maxOctaves;
  if (filters.favoritesOnly) query.ids = [...favoriteIds];
  return query;
}

/** Same rules as the server, applied to the local library. */
export function filterMine(
  entries: readonly LibraryEntry[],
  filters: SongFilters,
  favoriteIds: readonly string[],
): LibraryEntry[] {
  const q = filters.search.trim().toLowerCase();
  const rows = entries
    .filter(({ recording }) => !q || recording.name.toLowerCase().includes(q))
    .filter(({ recording }) => !filters.maxOctaves || recordingOctaves(recording.notes) <= filters.maxOctaves)
    .filter(({ recording }) => !filters.favoritesOnly || favoriteIds.includes(recording.id))
    .map((entry) => ({ entry, duration: recordingDurationMs(entry.recording.notes) }));
  const by = (a: (typeof rows)[number], b: (typeof rows)[number]) => {
    const at = a.entry.recording.createdAt;
    const bt = b.entry.recording.createdAt;
    const order =
      filters.sort === "longest" ? b.duration - a.duration : filters.sort === "oldest" ? at.localeCompare(bt) : bt.localeCompare(at);
    return order || a.entry.recording.id.localeCompare(b.entry.recording.id);
  };
  return rows.sort(by).map(({ entry }) => entry);
}
