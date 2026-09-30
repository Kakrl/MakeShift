import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  createPlaybackTimeline,
  type PlaybackAudio,
  type PlaybackTimeline,
} from "../../frontend/src/app/midi/playbackTimeline";
import type {
  RecordedNote,
  Recording,
} from "../../frontend/src/app/midi/midiUtils";

const note = (
  pitch = "C4",
  startMs = 0,
  durationMs = 1000,
  velocity = 80,
): RecordedNote => ({ pitch, startMs, durationMs, velocity });
const recording = (...notes: RecordedNote[]): Recording => ({
  id: "fixture",
  name: "Fixture",
  createdAt: "2026-09-29T00:00:00Z",
  bpm: 120,
  notes,
});
type Token = { session: number; press: number };
function audioFixture() {
  let press = 0;
  const held = new Map<number, number>();
  const listeners = new Set<() => void>();
  const events: {
    type: string;
    time: number;
    pitch: number;
    velocity?: number;
  }[] = [];
  const audio = {
    initialize: vi.fn(async () => {}),
    noteOn: vi.fn((pitch: number, velocity = 0.8): Token | null => {
      const token = { session: 1, press: ++press };
      held.set(token.press, pitch);
      events.push({ type: "on", time: performance.now(), pitch, velocity });
      return token;
    }),
    noteOff: vi.fn((token: Token) => {
      const pitch = held.get(token.press);
      held.delete(token.press);
      if (pitch !== undefined)
        events.push({ type: "off", time: performance.now(), pitch });
      return true;
    }),
    subscribeInvalidation: (listener: () => void) => {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
  } satisfies PlaybackAudio;
  return {
    audio,
    held,
    events,
    listeners,
    interrupt: () => {
      for (const listener of listeners) listener();
    },
  };
}
let timelines: PlaybackTimeline[];
function setup(take = recording(note())) {
  const fixture = audioFixture();
  const timeline = createPlaybackTimeline(take, fixture.audio);
  timelines.push(timeline);
  return { ...fixture, timeline };
}
beforeEach(() => {
  vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout", "performance"] });
  timelines = [];
});
afterEach(() => {
  for (const timeline of timelines) timeline.dispose();
  vi.restoreAllMocks();
  vi.useRealTimers();
});

describe("recording playback timing", () => {
  it.each([0.25, 0.5, 1, 2, 4])(
    "dispatches chords and releases at %sx without React",
    async (rate) => {
      const { timeline, events, held } = setup(
        recording(
          note("G4", 200, 400),
          note("C4", 100, 200),
          note("E4", 100, 200),
        ),
      );
      timeline.setPlaybackRate(rate);
      await timeline.play();
      await vi.advanceTimersByTimeAsync(600 / rate);
      expect(events).toEqual([
        { type: "on", time: 100 / rate, pitch: 60, velocity: 0.8 },
        { type: "on", time: 100 / rate, pitch: 64, velocity: 0.8 },
        { type: "on", time: 200 / rate, pitch: 67, velocity: 0.8 },
        { type: "off", time: 300 / rate, pitch: 60 },
        { type: "off", time: 300 / rate, pitch: 64 },
        { type: "off", time: 600 / rate, pitch: 67 },
      ]);
      expect(held.size).toBe(0);
      expect(timeline.getSnapshot()).toMatchObject({
        state: "ended",
        positionMs: 600,
        bpm: 120 * rate,
      });
      expect(vi.getTimerCount()).toBe(0);
    },
  );

  it("changes rate continuously without retriggering held notes or accumulating drift", async () => {
    const { timeline, audio, events } = setup();
    await timeline.play();
    await vi.advanceTimersByTimeAsync(200);
    timeline.setPlaybackRate(2);
    expect(timeline.getSnapshot().positionMs).toBe(200);
    await vi.advanceTimersByTimeAsync(100);
    expect(timeline.getSnapshot().positionMs).toBe(400);
    timeline.setPlaybackRate(0.5);
    await vi.advanceTimersByTimeAsync(1200);
    expect(audio.noteOn).toHaveBeenCalledTimes(1);
    expect(events.at(-1)).toEqual({ type: "off", pitch: 60, time: 1500 });
    expect(timeline.getSnapshot().state).toBe("ended");
  });

  it("keeps overlapping same-pitch voices separate and releases before a same-time retrigger", async () => {
    const { timeline, audio, held, events } = setup(
      recording(note("C4", 0, 200), note("C4", 100, 300), note("C4", 200, 100)),
    );
    await timeline.play();
    await vi.advanceTimersByTimeAsync(100);
    expect(held.size).toBe(2);
    await vi.advanceTimersByTimeAsync(100);
    expect(events.filter((e) => e.time === 200).map((e) => e.type)).toEqual([
      "off",
      "on",
    ]);
    expect(held.size).toBe(2);
    await vi.advanceTimersByTimeAsync(200);
    expect(held.size).toBe(0);
    expect(audio.noteOff.mock.calls.map(([token]) => token.press)).toEqual([
      1, 3, 2,
    ]);
  });

  it("skips expired notes after a delayed callback and plays only the remaining held interval", async () => {
    const { timeline, events } = setup(
      recording(note("C4", 100, 100), note("E4", 300, 700)),
    );
    await timeline.play();
    vi.spyOn(performance, "now").mockReturnValue(600);
    await vi.advanceTimersByTimeAsync(100);
    expect(events).toEqual([
      { type: "on", time: 600, pitch: 64, velocity: 0.8 },
    ]);
    vi.mocked(performance.now).mockReturnValue(1000);
    await vi.advanceTimersByTimeAsync(400);
    expect(events.at(-1)).toEqual({ type: "off", time: 1000, pitch: 64 });
    expect(timeline.getSnapshot().state).toBe("ended");
  });
});

describe("transport lifecycle", () => {
  it("pauses immediately, freezes position, and resumes held notes for their remaining duration", async () => {
    const { timeline, held, events } = setup();
    await timeline.play();
    await vi.advanceTimersByTimeAsync(250);
    timeline.pause();
    timeline.pause();
    expect(held.size).toBe(0);
    expect(vi.getTimerCount()).toBe(0);
    await vi.advanceTimersByTimeAsync(5000);
    expect(timeline.getSnapshot().positionMs).toBe(250);
    await timeline.play();
    await vi.advanceTimersByTimeAsync(750);
    expect(events.map((e) => [e.type, e.time])).toEqual([
      ["on", 0],
      ["off", 250],
      ["on", 5250],
      ["off", 6000],
    ]);
    expect(held.size).toBe(0);
  });

  it("seeks forward/backward while playing, restores spanning notes, and clamps endpoints", async () => {
    const { timeline, held, audio } = setup(
      recording(note("C4", 0, 500), note("E4", 600, 400)),
    );
    await timeline.play();
    timeline.seek(750);
    expect([...held.values()]).toEqual([64]);
    expect(timeline.getSnapshot().positionMs).toBe(750);
    await vi.advanceTimersByTimeAsync(250);
    expect(held.size).toBe(0);
    timeline.seek(-100);
    expect(timeline.getSnapshot()).toMatchObject({
      state: "paused",
      positionMs: 0,
    });
    await timeline.play();
    expect([...held.values()]).toEqual([60]);
    timeline.seek(500);
    expect(held.size).toBe(0);
    timeline.seek(600);
    expect([...held.values()]).toEqual([64]);
    timeline.seek(2000);
    expect(timeline.getSnapshot()).toMatchObject({
      state: "ended",
      positionMs: 1000,
    });
    expect(held.size).toBe(0);
    expect(audio.noteOn).toHaveBeenCalledTimes(4);
  });

  it("seeks silently while paused and replays from the start after completion", async () => {
    const { timeline, audio, held } = setup();
    timeline.seek(400);
    expect(audio.noteOn).not.toHaveBeenCalled();
    await timeline.play();
    await vi.advanceTimersByTimeAsync(600);
    expect(timeline.getSnapshot().state).toBe("ended");
    await timeline.play();
    expect(timeline.getSnapshot().positionMs).toBe(0);
    expect(held.size).toBe(1);
    timeline.stop();
    expect(timeline.getSnapshot()).toMatchObject({
      state: "stopped",
      positionMs: 0,
    });
    expect(held.size).toBe(0);
  });

  it("repeated Play does not duplicate voices or timers; dispose cleans up only owned notes", async () => {
    const { timeline, audio, held, listeners } = setup();
    const other = audio.noteOn(72)!;
    await timeline.play();
    await timeline.play();
    expect(audio.noteOn).toHaveBeenCalledTimes(2);
    expect(vi.getTimerCount()).toBe(1);
    timeline.dispose();
    timeline.dispose();
    expect(listeners.size).toBe(0);
    expect([...held.keys()]).toEqual([other.press]);
    expect(vi.getTimerCount()).toBe(0);
    expect(await timeline.play()).toBe(false);
    timeline.seek(0);
    timeline.stop();
    expect(timeline.getSnapshot().state).toBe("disposed");
  });

  it.each(["pause", "stop", "seek", "dispose"] as const)(
    "%s cancels pending audio initialization",
    async (action) => {
      const { timeline, audio } = setup();
      let resolve!: () => void;
      audio.initialize.mockImplementation(
        () =>
          new Promise<void>((done) => {
            resolve = done;
          }),
      );
      const pending = timeline.play();
      if (action === "seek") timeline.seek(400);
      else timeline[action]();
      resolve();
      expect(await pending).toBe(false);
      expect(audio.noteOn).not.toHaveBeenCalled();
      expect(vi.getTimerCount()).toBe(0);
    },
  );

  it("audio initialization failure is retryable", async () => {
    const { timeline, audio } = setup();
    audio.initialize.mockRejectedValueOnce(new Error("Device unavailable"));
    expect(await timeline.play()).toBe(false);
    expect(timeline.getSnapshot()).toMatchObject({
      state: "paused",
      error: "Device unavailable",
    });
    expect(await timeline.play()).toBe(true);
    expect(timeline.getSnapshot()).toMatchObject({
      state: "playing",
      error: null,
    });
  });

  it("ignores a stale timer callback after stop and restart", async () => {
    const timerSpy = vi.spyOn(globalThis, "setTimeout");
    const { timeline, audio } = setup();
    await timeline.play();
    const stale = timerSpy.mock.calls.at(-1)![0] as () => void;
    timeline.stop();
    await timeline.play();
    stale();
    expect(audio.noteOn).toHaveBeenCalledTimes(2);
    expect(vi.getTimerCount()).toBe(1);
    timeline.pause();
    expect(vi.getTimerCount()).toBe(0);
  });

  it("ignores initialization reset but pauses on subsequent audio invalidation", async () => {
    const { timeline, audio, interrupt, held } = setup();
    audio.initialize.mockImplementation(async () => interrupt());
    expect(await timeline.play()).toBe(true);
    await vi.advanceTimersByTimeAsync(200);
    interrupt();
    expect(timeline.getSnapshot()).toMatchObject({
      state: "paused",
      positionMs: 200,
    });
    expect(held.size).toBe(0);
    expect(vi.getTimerCount()).toBe(0);
    await vi.advanceTimersByTimeAsync(1000);
    expect(audio.noteOn).toHaveBeenCalledTimes(1);
  });

  it("a rejected chord note stops the timeline and releases earlier accepted notes", async () => {
    const { timeline, audio, held } = setup(recording(note("C4"), note("E4")));
    const accept = audio.noteOn.getMockImplementation()!;
    audio.noteOn.mockImplementationOnce(accept).mockReturnValueOnce(null);
    expect(await timeline.play()).toBe(false);
    expect(held.size).toBe(0);
    expect(timeline.getSnapshot().state).toBe("paused");
    expect(vi.getTimerCount()).toBe(0);
  });
});

describe("recording inputs", () => {
  it("copies notes and metadata, supports accidental pitches, and maps writer velocity to audio", async () => {
    const take = recording(
      note("Db4", 0, 100, 25),
      note("C#4", 0, 100, 100),
      note("C-1", 0, 100, 1),
      note("G9", 0, 100),
    );
    const { timeline, audio } = setup(take);
    take.notes[0].pitch = "G4";
    take.notes.length = 0;
    take.bpm = 60;
    await timeline.play();
    expect(audio.noteOn.mock.calls).toEqual([
      [61, 0.25],
      [61, 1],
      [0, 0.01],
      [127, 0.8],
    ]);
    expect(timeline.getSnapshot().bpm).toBe(120);
  });

  it("handles empty, zero-duration, and silent recordings without stuck notes", async () => {
    const empty = setup(recording());
    await empty.timeline.play();
    expect(empty.timeline.getSnapshot().state).toBe("ended");
    const { timeline, audio } = setup(
      recording(note("C4", 200, 0), note("E4", 0, 300, 0)),
    );
    await timeline.play();
    await vi.advanceTimersByTimeAsync(300);
    expect(timeline.getSnapshot().state).toBe("ended");
    expect(audio.noteOn).not.toHaveBeenCalled();
    expect(vi.getTimerCount()).toBe(0);
  });

  it.each([
    note("bad"),
    note("C10"),
    note("C-2"),
    note("C4", -1),
    note("C4", 0, -1),
    note("C4", NaN),
    note("C4", 0, Infinity),
    note("C4", 0, 1, 101),
    note("C4", 0, 1, -1),
  ])(
    "rejects invalid notes before subscribing or scheduling: %j",
    (invalid) => {
      const { audio, listeners } = audioFixture();
      expect(() => createPlaybackTimeline(recording(invalid), audio)).toThrow(
        RangeError,
      );
      expect(listeners.size).toBe(0);
      expect(vi.getTimerCount()).toBe(0);
    },
  );

  it("rejects invalid BPM, rates and seeks without changing an active timeline", async () => {
    expect(() => setup({ ...recording(), bpm: 0 })).toThrow(RangeError);
    const { timeline, held } = setup();
    await timeline.play();
    for (const value of [NaN, Infinity, 0, -1, 0.1, 5])
      expect(() => timeline.setPlaybackRate(value)).toThrow(RangeError);
    expect(() => timeline.seek(NaN)).toThrow(RangeError);
    expect(timeline.getSnapshot()).toMatchObject({
      state: "playing",
      playbackRate: 1,
      positionMs: 0,
    });
    expect(held.size).toBe(1);
  });
});
