import { MAX_QUERY_IDS } from "./recordings";
import { readStored, writeStored, type StorageAccess, type WriteResult } from "./storage";

const NAME = "favorites";
const VERSION = 1;

const isIds = (value: unknown): value is string[] =>
  Array.isArray(value) &&
  value.every((id) => typeof id === "string" && id.length > 0 && id.length <= 128) &&
  new Set(value).size === value.length;

/** Favorite recording ids, newest first, kept in this browser only. */
export function createFavorites(storage?: StorageAccess) {
  let ids: readonly string[] | null = null;
  const listeners = new Set<() => void>();
  const snapshot = (): readonly string[] =>
    (ids ??= Object.freeze(readStored<string[]>(NAME, VERSION, [], isIds, storage).slice(0, MAX_QUERY_IDS)));

  return {
    getSnapshot: snapshot,
    subscribe(listener: () => void) {
      listeners.add(listener);
      return () => void listeners.delete(listener);
    },
    has: (id: string) => snapshot().includes(id),
    /** Flips one id; on a failed write the change is kept for this visit only. */
    toggle(id: string): WriteResult {
      const current = snapshot();
      ids = Object.freeze(
        current.includes(id) ? current.filter((value) => value !== id) : [id, ...current].slice(0, MAX_QUERY_IDS),
      );
      listeners.forEach((listener) => listener());
      return writeStored(NAME, VERSION, ids, storage);
    },
  };
}

export type Favorites = ReturnType<typeof createFavorites>;
export const favorites = createFavorites();
