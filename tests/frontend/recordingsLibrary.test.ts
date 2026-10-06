import { describe, expect, it } from "vitest";
import {
  createRecordingsLibrary,
  loadRecordings,
  saveRecordings,
} from "../../frontend/src/app/midi/recordingsLibrary";
import { storageKey } from "../../frontend/src/lib/storage";
import type { Recording } from "../../frontend/src/app/midi/midiUtils";

function take(id = "one"): Recording {
  return {
    id,
    name: "Take",
    bpm: 120,
    createdAt: "2026-10-03T12:00:00Z",
    notes: [{ pitch: "C4", velocity: 75, startMs: 0, durationMs: 100 }],
  };
}

function storageFixture() {
  const data = new Map<string, string>();
  let fail = false;
  return {
    data,
    failWrites(value: boolean) {
      fail = value;
    },
    access: () => ({
      getItem: (key: string) => data.get(key) ?? null,
      setItem: (key: string, value: string) => {
        if (fail)
          throw Object.assign(new Error("full"), {
            name: "QuotaExceededError",
          });
        data.set(key, value);
      },
      removeItem: (key: string) => {
        data.delete(key);
      },
    }),
  };
}

describe("recordings library", () => {
  it("saves multiple takes, deduplicates completion, and reloads renamed/deleted takes", () => {
    const storage = storageFixture();
    const library = createRecordingsLibrary(storage.access);
    expect(library.completeTake(take())).toEqual({ ok: true });
    library.completeTake(take());
    library.completeTake(take("two"));
    expect(library.list()).toHaveLength(2);
    expect(library.renameRecording("one", "  First  ")).toEqual({ ok: true });
    expect(library.deleteRecording("two")).toEqual({ ok: true });
    expect(createRecordingsLibrary(storage.access).list()).toEqual([
      { recording: { ...take(), name: "First" }, saved: true },
    ]);
  });

  it("retains unsaved takes on quota errors and can delete saved takes before retry", () => {
    const storage = storageFixture();
    const library = createRecordingsLibrary(storage.access);
    library.completeTake(take());
    storage.failWrites(true);
    expect(library.completeTake(take("two"))).toEqual({
      ok: false,
      reason: "quota",
    });
    expect(library.list()[0].saved).toBe(false);
    expect(
      loadRecordings(storage.access).map((recording) => recording.id),
    ).toEqual(["one"]);
    storage.failWrites(false);
    library.deleteRecording("one");
    expect(loadRecordings(storage.access)).toEqual([]);
    expect(library.list()[0].saved).toBe(false);
    expect(library.retrySaving()).toEqual({ ok: true });
    expect(createRecordingsLibrary(storage.access).list()[0].recording.id).toBe(
      "two",
    );
  });

  it("failed rename/delete preserve the list; unsaved deletion requires no storage write", () => {
    const storage = storageFixture();
    const library = createRecordingsLibrary(storage.access);
    library.completeTake(take());
    storage.failWrites(true);
    expect(library.renameRecording("one", "Changed").ok).toBe(false);
    expect(library.deleteRecording("one").ok).toBe(false);
    expect(library.list()[0].recording.name).toBe("Take");
    library.completeTake(take("two"));
    expect(library.deleteRecording("two")).toEqual({ ok: true });
    expect(library.list()).toHaveLength(1);
    expect(library.renameRecording("one", " ").ok).toBe(false);
    expect(library.deleteRecording("missing").ok).toBe(false);
  });

  it("isolates stored takes from caller and snapshot mutations", () => {
    const storage = storageFixture();
    const library = createRecordingsLibrary(storage.access);
    const original = take();
    library.completeTake(original);
    original.notes[0].pitch = "D4";
    library.list()[0].recording.notes[0].pitch = "E4";
    expect(library.list()[0].recording.notes[0].pitch).toBe("C4");
  });

  it.each([
    "broken",
    "null",
    "{}",
    JSON.stringify([take(), take()]),
    JSON.stringify([{ ...take(), bpm: 0 }]),
    JSON.stringify([
      {
        ...take(),
        notes: [{ pitch: "G10", velocity: 75, startMs: 0, durationMs: 1 }],
      },
    ]),
    JSON.stringify([
      {
        ...take(),
        notes: [{ pitch: "C4", velocity: 101, startMs: -1, durationMs: 1 }],
      },
    ]),
  ])("rejects corrupt or invalid stored data: %s", (raw) => {
    const storage = storageFixture();
    storage.data.set(storageKey("recordings", 1), raw);
    expect(loadRecordings(storage.access)).toEqual([]);
  });

  it("supports empty takes and unavailable/throwing storage without throwing", () => {
    const storage = storageFixture();
    expect(saveRecordings([{ ...take(), notes: [] }], storage.access)).toEqual({
      ok: true,
    });
    expect(
      loadRecordings(() => {
        throw new Error("blocked");
      }),
    ).toEqual([]);
    const library = createRecordingsLibrary(() => null);
    expect(library.completeTake(take())).toEqual({
      ok: false,
      reason: "unavailable",
    });
    expect(library.list()[0].saved).toBe(false);
  });
});
