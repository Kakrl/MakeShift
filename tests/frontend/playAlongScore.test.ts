import { afterEach, describe, expect, it, vi } from "vitest";
import { FALL_LEAD_MS } from "../../frontend/src/cv/fallingNotes";
import { HIT_WINDOW_MS, createScorer } from "../../frontend/src/app/midi/playAlongScore";
import { createPlayAlong, getPlayAlong, scorePlayAlongPress, startPlayAlong, stopPlayAlong } from "../../frontend/src/app/midi/playAlong";

const song = [
  { midi: 60, startMs: 1000 },
  { midi: 64, startMs: 2000 },
  { midi: 67, startMs: 3000 },
];

describe("createScorer matching", () => {
  it("counts an on-time press of the right pitch as a hit", () => {
    const scorer = createScorer(song);
    expect(scorer.press(60, 1000)).toBe(true);
    expect(scorer.snapshot(1000)).toMatchObject({ hits: 1, misses: 0 });
  });

  it("accepts early and late presses at the window edge", () => {
    const scorer = createScorer(song);
    expect(scorer.press(60, 1000 - HIT_WINDOW_MS)).toBe(true);
    expect(scorer.press(64, 2000 + HIT_WINDOW_MS)).toBe(true);
  });

  it("counts a press outside the window as a miss", () => {
    const scorer = createScorer(song);
    expect(scorer.press(60, 1000 + HIT_WINDOW_MS + 1)).toBe(false);
    expect(scorer.press(64, 2000 - HIT_WINDOW_MS - 1)).toBe(false);
    expect(scorer.snapshot(2000).hits).toBe(0);
    expect(scorer.snapshot(2000).misses).toBeGreaterThanOrEqual(2);
  });

  it("counts a wrong pitch as a miss and leaves the expected note open", () => {
    const scorer = createScorer(song);
    expect(scorer.press(61, 1000)).toBe(false);
    expect(scorer.snapshot(1000)).toMatchObject({ hits: 0, misses: 1 });
    expect(scorer.press(60, 1050)).toBe(true);
  });

  it("matches one press to one note", () => {
    const scorer = createScorer(song);
    expect(scorer.press(60, 1000)).toBe(true);
    expect(scorer.press(60, 1010)).toBe(false);
  });

  it("lets a late-delivered in-window press override expiry from a refresh", () => {
    const scorer = createScorer(song);
    expect(scorer.snapshot(1000 + HIT_WINDOW_MS + 50)).toMatchObject({ hits: 0, misses: 1 });
    expect(scorer.press(60, 1100)).toBe(true);
    expect(scorer.snapshot(1000 + HIT_WINDOW_MS + 50)).toMatchObject({ hits: 1, misses: 0 });
  });

  it("gives a repeated pitch to the nearest note", () => {
    const scorer = createScorer([
      { midi: 60, startMs: 1000 },
      { midi: 60, startMs: 1100 },
    ]);
    expect(scorer.press(60, 1090)).toBe(true);
    expect(scorer.press(60, 1090)).toBe(true);
    expect(scorer.snapshot(1090).hits).toBe(2);
  });
});

describe("createScorer misses and score", () => {
  it("counts unplayed notes as misses once their window has passed", () => {
    const scorer = createScorer(song);
    expect(scorer.snapshot(1000 + HIT_WINDOW_MS)).toMatchObject({ hits: 0, misses: 0 });
    expect(scorer.snapshot(1000 + HIT_WINDOW_MS + 1)).toMatchObject({ hits: 0, misses: 1 });
    expect(scorer.snapshot(10_000)).toMatchObject({ hits: 0, misses: 3, total: 3, score: 0 });
  });

  it("scores a clean run at 100 and a half run at 50", () => {
    const clean = createScorer(song);
    song.forEach((note) => clean.press(note.midi, note.startMs));
    expect(clean.snapshot(10_000)).toMatchObject({ hits: 3, misses: 0, score: 100 });

    const half = createScorer(song.slice(0, 2));
    half.press(60, 1000);
    expect(half.snapshot(10_000)).toMatchObject({ hits: 1, misses: 1, score: 50 });
  });

  it("lowers the score for extra presses", () => {
    const scorer = createScorer(song.slice(0, 1));
    scorer.press(60, 1000);
    scorer.press(72, 1500);
    expect(scorer.snapshot(10_000)).toMatchObject({ hits: 1, misses: 1, score: 50 });
  });

  it("scores an empty song as zero", () => {
    expect(createScorer([]).snapshot(1000)).toMatchObject({ hits: 0, misses: 0, total: 0, score: 0 });
  });

  it("starts over on reset", () => {
    const scorer = createScorer(song);
    scorer.press(60, 1000);
    scorer.press(99, 1000);
    scorer.snapshot(10_000);
    scorer.reset();
    expect(scorer.snapshot(0)).toMatchObject({ hits: 0, misses: 0 });
    expect(scorer.press(60, 1000)).toBe(true);
  });
});

const recording = {
  id: "take",
  name: "Song",
  bpm: 120,
  createdAt: "2026-11-09T00:00:00.000Z",
  notes: [
    { pitch: "C4", velocity: 80, startMs: 0, durationMs: 500 },
    { pitch: "C6", velocity: 80, startMs: 1000, durationMs: 500 },
  ],
};
const noteOn = (pitch: number, timestampMs: number) =>
  ({ version: 1, sessionId: "s", sequence: 1, timestampMs, type: "note-on", pressId: 1, pitch, velocity: 0.8 }) as const;

describe("play-along scoring", () => {
  afterEach(() => {
    stopPlayAlong();
    vi.useRealTimers();
  });

  it("does not score notes outside the keyboard layout", () => {
    const song = createPlayAlong(recording, undefined, { octaves: 1, startingMidi: 60, whiteKeys: 8 });
    expect(song.score.snapshot(100_000)).toMatchObject({ total: 1, misses: 1 });
  });

  it("ignores presses while the song is not playing", () => {
    startPlayAlong(recording, { octaves: 1, startingMidi: 60, whiteKeys: 8 });
    const song = getPlayAlong()!;
    song.timeline.pause();
    scorePlayAlongPress(noteOn(60, performance.now()));
    expect(song.score.snapshot(0).misses).toBe(0);
  });

  it("maps a note event's timestamp onto the song clock", async () => {
    const song = createPlayAlong(recording);
    await song.timeline.play();
    const at = performance.now() + 500;
    expect(song.timeline.positionAt(at)! - song.timeline.positionAt(at - 200)!).toBeCloseTo(200, 0);
    song.timeline.dispose();
  });

  it("keeps scoring through the final hit window after a short last note", async () => {
    vi.useFakeTimers();
    startPlayAlong({ ...recording, notes: [{ pitch: "C4", velocity: 80, startMs: 0, durationMs: 50 }] });
    const song = getPlayAlong()!;
    await vi.advanceTimersByTimeAsync(0);
    const onset = performance.now() + FALL_LEAD_MS;
    await vi.advanceTimersByTimeAsync(FALL_LEAD_MS + 100);
    scorePlayAlongPress(noteOn(60, onset + 100));
    expect(song.score.snapshot(FALL_LEAD_MS + 100)).toMatchObject({ hits: 1, misses: 0 });
    expect(song.timeline.getSnapshot().state).toBe("playing");
    await vi.advanceTimersByTimeAsync(HIT_WINDOW_MS);
    expect(song.timeline.getSnapshot()).toMatchObject({ state: "ended", durationMs: FALL_LEAD_MS + HIT_WINDOW_MS });
  });

  it("counts a skipped final note as a miss once the song ends", async () => {
    vi.useFakeTimers();
    startPlayAlong({ ...recording, notes: [{ pitch: "C4", velocity: 80, startMs: 0, durationMs: 50 }] });
    const song = getPlayAlong()!;
    await vi.advanceTimersByTimeAsync(FALL_LEAD_MS + HIT_WINDOW_MS + 10);
    expect(song.timeline.getSnapshot().state).toBe("ended");
    expect(song.score.snapshot(Infinity)).toMatchObject({ hits: 0, misses: 1 });
  });

  it("drops a press made while paused even when it arrives after resume", async () => {
    vi.useFakeTimers();
    startPlayAlong(recording, { octaves: 1, startingMidi: 60, whiteKeys: 8 });
    const song = getPlayAlong()!;
    await vi.advanceTimersByTimeAsync(FALL_LEAD_MS - 50);
    song.timeline.pause();
    await vi.advanceTimersByTimeAsync(20);
    const pausedPress = performance.now();
    await vi.advanceTimersByTimeAsync(1000);
    await song.timeline.play();
    scorePlayAlongPress(noteOn(60, pausedPress));
    expect(song.score.snapshot(FALL_LEAD_MS - 50)).toMatchObject({ hits: 0, misses: 0 });
    scorePlayAlongPress(noteOn(60, performance.now() + 50));
    expect(song.score.snapshot(FALL_LEAD_MS)).toMatchObject({ hits: 1, misses: 0 });
  });

  it("scores a press made before a pause at its playing-time position", async () => {
    vi.useFakeTimers();
    startPlayAlong(recording, { octaves: 1, startingMidi: 60, whiteKeys: 8 });
    const song = getPlayAlong()!;
    await vi.advanceTimersByTimeAsync(0);
    const onset = performance.now() + FALL_LEAD_MS;
    await vi.advanceTimersByTimeAsync(FALL_LEAD_MS + 20);
    song.timeline.pause();
    await vi.advanceTimersByTimeAsync(5000);
    await song.timeline.play();
    scorePlayAlongPress(noteOn(60, onset));
    expect(song.score.snapshot(FALL_LEAD_MS + 20)).toMatchObject({ hits: 1, misses: 0 });
  });
});
