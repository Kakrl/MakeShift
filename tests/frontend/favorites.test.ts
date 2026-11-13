import { describe, expect, it } from "vitest";
import { createFavorites } from "../../frontend/src/lib/favorites";
import { MAX_QUERY_IDS } from "../../frontend/src/lib/recordings";
import { storageKey, type StorageArea } from "../../frontend/src/lib/storage";

const KEY = storageKey("favorites", 1);

function memory(initial?: string) {
  const items = new Map<string, string>(initial === undefined ? [] : [[KEY, initial]]);
  const area: StorageArea = {
    getItem: (key) => items.get(key) ?? null,
    setItem: (key, value) => void items.set(key, value),
    removeItem: (key) => void items.delete(key),
  };
  return { items, access: () => area };
}

describe("favorites store", () => {
  it("toggles an id on and off and keeps it across a reload", () => {
    const { access } = memory();
    const favorites = createFavorites(access);
    expect(favorites.toggle("a").ok).toBe(true);
    expect(favorites.has("a")).toBe(true);
    expect(createFavorites(access).getSnapshot()).toEqual(["a"]);
    favorites.toggle("a");
    expect(createFavorites(access).getSnapshot()).toEqual([]);
  });

  it("lists the newest favorite first and keeps only the newest 100", () => {
    const favorites = createFavorites(memory().access);
    for (let i = 0; i < MAX_QUERY_IDS + 5; i++) favorites.toggle(`id-${i}`);
    const ids = favorites.getSnapshot();
    expect(ids).toHaveLength(MAX_QUERY_IDS);
    expect(ids[0]).toBe(`id-${MAX_QUERY_IDS + 4}`);
  });

  it("notifies subscribers with a new snapshot, and stops after unsubscribe", () => {
    const favorites = createFavorites(memory().access);
    let calls = 0;
    const stop = favorites.subscribe(() => calls++);
    const before = favorites.getSnapshot();
    favorites.toggle("a");
    expect(calls).toBe(1);
    expect(favorites.getSnapshot()).not.toBe(before);
    stop();
    favorites.toggle("b");
    expect(calls).toBe(1);
  });

  it.each(["not json", '{"a":1}', '["a","a"]', "[1]", '[""]'])("falls back to none for corrupt storage %s", (raw) => {
    expect(createFavorites(memory(raw).access).getSnapshot()).toEqual([]);
  });

  it("keeps a favorite for this visit and reports the failure when storage is blocked", () => {
    const favorites = createFavorites(() => null);
    expect(favorites.getSnapshot()).toEqual([]);
    expect(favorites.toggle("a")).toEqual({ ok: false, reason: "unavailable" });
    expect(favorites.has("a")).toBe(true);
  });

  it("reports a full storage", () => {
    const area: StorageArea = {
      getItem: () => null,
      setItem: () => {
        throw Object.assign(new Error("full"), { name: "QuotaExceededError" });
      },
      removeItem: () => {},
    };
    expect(createFavorites(() => area).toggle("a")).toEqual({ ok: false, reason: "quota" });
  });
});
