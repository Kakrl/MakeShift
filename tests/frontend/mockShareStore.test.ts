import { describe, expect, it } from "vitest";
import {
  createMockShareStore,
  loadTakeShares,
  PAGE_SIZE,
  PLAYABLE_RANGE,
  saveTakeShare,
  type MockMode,
} from "../../frontend/src/app/share/mockShareStore";
import type { StorageArea } from "../../frontend/src/lib/storage";
import { pitchToMidi } from "../../frontend/src/cv/noteMap";

function memoryStorage() {
  const items = new Map<string, string>();
  const area: StorageArea = {
    getItem: (key) => items.get(key) ?? null,
    setItem: (key, value) => void items.set(key, value),
    removeItem: (key) => void items.delete(key),
  };
  return () => area;
}

function store(mode: MockMode = "normal", storage = memoryStorage()) {
  return createMockShareStore(storage, 0, () => mode);
}

const upload = {
  title: "  My song  ",
  authorName: "Jo",
  deviceId: "device",
  bpm: 120,
  notes: [{ pitch: "C4", velocity: 80, startMs: 0, durationMs: 500 }],
};

describe("mock share store", () => {
  it("pages through every recording newest first without notes", async () => {
    const shares = store();
    const seen: string[] = [];
    let cursor: string | null = null;
    let previous = "9999";
    do {
      const page = await shares.list(cursor);
      expect(page.recordings.length).toBeLessThanOrEqual(PAGE_SIZE);
      for (const summary of page.recordings) {
        expect(summary).not.toHaveProperty("notes");
        expect(summary.createdAt <= previous).toBe(true);
        previous = summary.createdAt;
        seen.push(summary.id);
      }
      cursor = page.nextCursor;
    } while (cursor);
    expect(new Set(seen).size).toBe(seen.length);
    expect(seen.length).toBeGreaterThan(PAGE_SIZE);
  });

  it("only uses white keys a three-octave sheet can play", async () => {
    const shares = store();
    const { recordings } = await shares.list();
    const more = await shares.list(PAGE_SIZE.toString());
    const black = new Set([1, 3, 6, 8, 10]);
    for (const { id } of [...recordings, ...more.recordings]) {
      for (const { pitch } of (await shares.get(id))!.notes) {
        const midi = pitchToMidi(pitch)!;
        expect(midi, `${id} ${pitch}`).toBeGreaterThanOrEqual(PLAYABLE_RANGE.lowMidi);
        expect(midi, `${id} ${pitch}`).toBeLessThanOrEqual(PLAYABLE_RANGE.highMidi);
        expect(black.has(midi % 12), `${id} ${pitch} is a black key`).toBe(false);
      }
    }
  });

  it("returns null for a missing id", async () => {
    expect(await store().get("nope")).toBeNull();
  });

  it("uploads, lists first, and deletes only with the right token", async () => {
    const shares = store();
    const { id, deleteToken } = await shares.upload(upload);
    const first = (await shares.list()).recordings[0];
    expect(first).toMatchObject({ id, title: "My song", noteCount: 1, durationMs: 500 });
    expect((await shares.get(id))?.notes).toEqual(upload.notes);

    await expect(shares.remove(id, "wrong")).rejects.toThrow();
    await expect(shares.remove(id, deleteToken)).resolves.toEqual({ deleted: true });
    expect(await shares.get(id)).toBeNull();
  });

  it("rejects an upload the real schema rejects", async () => {
    await expect(store().upload({ ...upload, notes: [] })).rejects.toThrow(/notes/);
  });

  it("simulates the empty and error states", async () => {
    expect((await store("empty").list()).recordings).toEqual([]);
    await expect(store("error").list()).rejects.toThrow();
  });

  it("remembers and forgets which takes are shared", () => {
    const storage = memoryStorage();
    saveTakeShare("take", { id: "abc", deleteToken: "t" }, storage);
    expect(loadTakeShares(storage)).toEqual({ take: { id: "abc", deleteToken: "t" } });
    saveTakeShare("take", null, storage);
    expect(loadTakeShares(storage)).toEqual({});
  });
});
