import { afterEach, describe, expect, it, vi } from "vitest";
import { FALL_LEAD_MS, fallingBars, keyColumns, type FallingNote } from "../../frontend/src/cv/fallingNotes";
import type { KeyboardLayout } from "../../frontend/src/cv/keyboardLayout";
import type { Point } from "../../frontend/src/cv/types";
import { createPlayAlong, getPlayAlong, startPlayAlong, stopPlayAlong, subscribePlayAlong } from "../../frontend/src/app/midi/playAlong";

const layout = (octaves: number): KeyboardLayout => ({ octaves, startingMidi: 48, whiteKeys: 7 * octaves + 1 });
// Page space scaled to a 1000 px frame; the piano's v=0 edge sits at y=100.
const upright = (point: Point) => ({ x: point.x * 1000, y: point.y * 1000 });
// A camera facing the other way puts the v=1 edge higher on screen.
const flipped = (point: Point) => ({ x: point.x * 1000, y: 1000 - point.y * 1000 });

describe("keyColumns", () => {
  it.each([1, 2, 3])("covers every key of a %i-octave layout on the keyboard line", (octaves) => {
    const columns = keyColumns(layout(octaves), upright)!;
    expect(columns.size).toBe(12 * octaves + 1);
    for (let midi = 48; midi <= 48 + 12 * octaves; midi++) {
      const column = columns.get(midi)!;
      expect(column.left.y).toBeCloseTo(100);
      expect(column.right.x).toBeGreaterThan(column.left.x);
    }
    expect(columns.get(49)!.black).toBe(true);
    expect(columns.get(48)!.black).toBe(false);
    // Keys run left to right in pitch order across the white keys.
    const whites = [...columns.entries()].filter(([, c]) => !c.black).sort(([a], [b]) => a - b);
    whites.slice(1).forEach(([, column], i) => expect(column.left.x).toBeCloseTo(whites[i][1].right.x));
  });

  it("lands on whichever long edge of the piano is higher on screen", () => {
    expect(keyColumns(layout(1), flipped)!.get(48)!.left.y).toBeCloseTo(100);
  });

  it("returns null when the projection fails", () => {
    expect(keyColumns(layout(1), () => null)).toBeNull();
  });
});

describe("fallingBars", () => {
  const columns = keyColumns(layout(1), upright)!;
  const note: FallingNote = { midi: 52, startMs: 5000, endMs: 5500 };
  const bottom = (position: number) => fallingBars([note], position, columns)[0]?.corners[2].y;

  it("reaches the keyboard line exactly at the note's start", () => {
    expect(fallingBars([note], note.startMs - FALL_LEAD_MS, columns)).toEqual([]);
    expect(bottom(note.startMs - FALL_LEAD_MS / 2)).toBeCloseTo(50);
    expect(bottom(note.startMs)).toBeCloseTo(100);
  });

  it("stays on the line while sounding, shrinks, then disappears", () => {
    const [bar] = fallingBars([note], 5250, columns);
    expect(bar.sounding).toBe(true);
    expect(bar.corners[2].y).toBeCloseTo(100);
    expect(bar.corners[0].y).toBeCloseTo(100 * (1 - 250 / FALL_LEAD_MS));
    expect(fallingBars([note], note.endMs, columns)).toEqual([]);
  });

  it("clips long notes at the top of the frame and keeps short ones visible", () => {
    const [long] = fallingBars([{ midi: 48, startMs: 1000, endMs: 60_000 }], 0, columns);
    expect(long.corners[0].y).toBeCloseTo(0);
    const [short] = fallingBars([{ midi: 48, startMs: 1000, endMs: 1000 }], 0, columns);
    expect(short.corners[2].y - short.corners[0].y).toBeGreaterThan(0);
  });

  it("skips notes outside the layout", () => {
    expect(fallingBars([{ midi: 72, startMs: 100, endMs: 200 }], 0, columns)).toEqual([]);
  });
});

describe("play along", () => {
  const recording = {
    id: "take",
    name: "Song",
    bpm: 120,
    createdAt: "2026-10-31T00:00:00.000Z",
    notes: [
      { pitch: "C3", velocity: 80, startMs: 0, durationMs: 500 },
      { pitch: "E3", velocity: 80, startMs: 1000, durationMs: 250 },
    ],
  };

  afterEach(() => stopPlayAlong());

  it("starts one fall early so the first note begins at the top of the frame", () => {
    const playAlong = createPlayAlong(recording);
    expect(playAlong.notes).toEqual([
      { midi: 48, startMs: FALL_LEAD_MS, endMs: FALL_LEAD_MS + 500 },
      { midi: 52, startMs: FALL_LEAD_MS + 1000, endMs: FALL_LEAD_MS + 1250 },
    ]);
    expect(playAlong.timeline.getSnapshot().durationMs).toBe(FALL_LEAD_MS + 1250);
    playAlong.timeline.dispose();
  });

  it("keeps time on a silent timeline", async () => {
    const playAlong = createPlayAlong(recording);
    expect(await playAlong.timeline.play()).toBe(true);
    expect(playAlong.timeline.getSnapshot().state).toBe("playing");
    playAlong.timeline.dispose();
  });

  it("holds one song at a time and disposes the one it replaces", () => {
    const listener = vi.fn();
    const unsubscribe = subscribePlayAlong(listener);
    startPlayAlong(recording);
    const first = getPlayAlong()!;
    startPlayAlong({ ...recording, name: "Other" });
    expect(first.timeline.getSnapshot().state).toBe("disposed");
    expect(getPlayAlong()!.title).toBe("Other");
    stopPlayAlong();
    expect(getPlayAlong()).toBeNull();
    expect(listener).toHaveBeenCalledTimes(3);
    unsubscribe();
  });
});
