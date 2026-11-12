import { describe, expect, it } from "vitest";
import { createMockShareStore } from "../../frontend/src/app/share/mockShareStore";
import { listQueryString } from "../../frontend/src/app/share/shareApi";
import { DEFAULT_FILTERS, filterMine, toListQuery } from "../../frontend/src/app/share/songFilters";
import { PAGE_SIZE } from "../../frontend/src/app/share/shareStore";
import type { LibraryEntry } from "../../frontend/src/app/midi/recordingsLibrary";
import { MAX_SEARCH_LENGTH, type RecordingListQuery, type RecordingSummary } from "../../frontend/src/lib/recordings";
import type { StorageArea } from "../../frontend/src/lib/storage";

const memory = (): (() => StorageArea) => {
  const items = new Map<string, string>();
  const area: StorageArea = {
    getItem: (key) => items.get(key) ?? null,
    setItem: (key, value) => void items.set(key, value),
    removeItem: (key) => void items.delete(key),
  };
  return () => area;
};
const store = () => createMockShareStore(memory(), 0, () => "normal");

async function everything(query: RecordingListQuery) {
  const shared = store();
  const rows: RecordingSummary[] = [];
  let cursor: string | null = null;
  do {
    const page = await shared.list(cursor, query);
    rows.push(...page.recordings);
    cursor = page.nextCursor;
  } while (cursor);
  return rows;
}

const A = "0b6f1a52-3c4d-4e5f-8a9b-0c1d2e3f4a5b";
const B = "9f8e7d6c-5b4a-4c3d-9e2f-1a0b9c8d7e6f";

describe("listQueryString", () => {
  it("is empty for a plain newest-first list", () => {
    expect(listQueryString(null)).toBe("");
    expect(listQueryString(null, { sort: "newest" })).toBe("");
  });

  it("sends trimmed, capped search, sort, octaves, ids and the cursor", () => {
    const text = listQueryString("abc", {
      q: `  ${"x".repeat(MAX_SEARCH_LENGTH + 20)}  `,
      sort: "longest",
      maxOctaves: 2,
      ids: [A, B],
    });
    const params = new URLSearchParams(text);
    expect(params.get("q")).toBe("x".repeat(MAX_SEARCH_LENGTH));
    expect(params.get("sort")).toBe("longest");
    expect(params.get("maxOctaves")).toBe("2");
    expect(params.get("ids")).toBe(`${A},${B}`);
    expect(params.get("cursor")).toBe("abc");
  });

  it("drops mock and local favorite ids the API would reject", () => {
    expect(new URLSearchParams(listQueryString(null, { ids: ["demo-1", A, "1a2b3c4d"] })).get("ids")).toBe(A);
    expect(new URLSearchParams(listQueryString(null, { ids: ["demo-1"] })).get("ids")).toBe("");
  });

  it("drops a blank search", () => {
    expect(listQueryString(null, { q: "   " })).toBe("");
  });
});

describe("mock store queries", () => {
  it("searches titles without regard to case", async () => {
    const rows = await everything({ q: "JINGLE" });
    expect(rows.map((r) => r.title)).toEqual(["Jingle Bells, left hand too"]);
  });

  it("returns nothing, not an error, when no title matches", async () => {
    expect(await everything({ q: "zzzz" })).toEqual([]);
  });

  it.each([
    ["newest", (a: RecordingSummary, b: RecordingSummary) => b.createdAt.localeCompare(a.createdAt)],
    ["oldest", (a: RecordingSummary, b: RecordingSummary) => a.createdAt.localeCompare(b.createdAt)],
    ["longest", (a: RecordingSummary, b: RecordingSummary) => b.durationMs - a.durationMs],
  ] as const)("sorts %s across every page with no repeats", async (sort, compare) => {
    const rows = await everything({ sort });
    expect(rows.length).toBeGreaterThan(PAGE_SIZE);
    expect(new Set(rows.map((r) => r.id)).size).toBe(rows.length);
    rows.slice(1).forEach((row, i) => expect(compare(rows[i], row)).toBeLessThanOrEqual(0));
  });

  it("filters to songs that fit the sheet", async () => {
    const all = await everything({});
    const one = await everything({ maxOctaves: 1 });
    const three = await everything({ maxOctaves: 3 });
    expect(one.every((r) => r.octaves <= 1)).toBe(true);
    expect(one.length).toBeLessThan(all.length);
    expect(three).toHaveLength(all.length);
  });

  it("limits to the given ids, and an empty list matches nothing", async () => {
    expect((await everything({ ids: ["demo-2", "demo-4", "missing"] })).map((r) => r.id).sort()).toEqual(["demo-2", "demo-4"]);
    expect(await everything({ ids: [] })).toEqual([]);
  });

  it("combines search, size and ids", async () => {
    expect((await everything({ q: "chords", ids: ["demo-3"], maxOctaves: 3 })).map((r) => r.id)).toEqual(["demo-3"]);
    expect(await everything({ q: "scale", ids: ["demo-1"] })).toEqual([]);
  });
});

const entry = (id: string, name: string, createdAt: string, notes: { pitch: string; ms: number }[]): LibraryEntry => ({
  saved: true,
  recording: {
    id,
    name,
    bpm: 120,
    createdAt,
    notes: notes.map(({ pitch, ms }, i) => ({ pitch, velocity: 80, startMs: i * ms, durationMs: ms })),
  },
});
const mine = [
  entry("a", "Scale", "2026-01-02T00:00:00.000Z", [{ pitch: "C4", ms: 100 }, { pitch: "D4", ms: 100 }]),
  entry("b", "Wide leap", "2026-01-03T00:00:00.000Z", [{ pitch: "C3", ms: 500 }, { pitch: "C5", ms: 500 }]),
  entry("c", "scale again", "2026-01-01T00:00:00.000Z", [{ pitch: "C4", ms: 300 }, { pitch: "G4", ms: 300 }]),
];
const ids = (rows: LibraryEntry[]) => rows.map(({ recording }) => recording.id);

describe("filters for My recordings and the Shared query", () => {
  it("builds the shared query from the controls", () => {
    expect(toListQuery(DEFAULT_FILTERS, ["x"])).toEqual({ sort: "newest" });
    expect(toListQuery({ search: " lamb ", sort: "oldest", maxOctaves: 2, favoritesOnly: true }, ["x", "y"])).toEqual({
      q: "lamb",
      sort: "oldest",
      maxOctaves: 2,
      ids: ["x", "y"],
    });
  });

  it("sorts newest, oldest and longest", () => {
    expect(ids(filterMine(mine, DEFAULT_FILTERS, []))).toEqual(["b", "a", "c"]);
    expect(ids(filterMine(mine, { ...DEFAULT_FILTERS, sort: "oldest" }, []))).toEqual(["c", "a", "b"]);
    expect(ids(filterMine(mine, { ...DEFAULT_FILTERS, sort: "longest" }, []))).toEqual(["b", "c", "a"]);
  });

  it("searches names, filters by octaves and by favorites", () => {
    expect(ids(filterMine(mine, { ...DEFAULT_FILTERS, search: "SCALE" }, []))).toEqual(["a", "c"]);
    expect(ids(filterMine(mine, { ...DEFAULT_FILTERS, maxOctaves: 1 }, []))).toEqual(["a", "c"]);
    expect(ids(filterMine(mine, { ...DEFAULT_FILTERS, favoritesOnly: true }, ["b"]))).toEqual(["b"]);
    expect(filterMine(mine, { ...DEFAULT_FILTERS, favoritesOnly: true }, [])).toEqual([]);
  });
});
