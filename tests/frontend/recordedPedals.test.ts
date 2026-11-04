import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  createRecorder,
  downloadMidi,
  type Recording,
} from "../../frontend/src/app/midi/midiUtils";
import {
  pedalsOff,
  performanceBoundaries,
  validRecordedPedals,
} from "../../frontend/src/app/midi/recordedPedals";
import {
  createPlaybackTimeline,
  type PlaybackAudio,
} from "../../frontend/src/app/midi/playbackTimeline";
import {
  saveRecordings,
  loadRecordings,
} from "../../frontend/src/app/midi/recordingsLibrary";
import { validateUpload } from "../../frontend/src/lib/recordings";
import { Synth } from "../../frontend/public/audio/synth.js";

const off = pedalsOff();
const take = (): Recording => ({
  id: "pedals",
  name: "Pedals",
  bpm: 120,
  createdAt: "2026-11-02T12:00:00Z",
  notes: [
    { pitch: "C4", velocity: 80, startMs: 0, durationMs: 100 },
    { pitch: "C4", velocity: 80, startMs: 50, durationMs: 100 },
  ],
  pedals: {
    version: 1,
    noteOrder: [
      { on: 0, off: 3 },
      { on: 2, off: 4 },
    ],
    events: [
      { timeMs: 50, order: 1, state: { ...off, sostenuto: true, soft: true } },
      { timeMs: 200, order: 5, state: off },
    ],
  },
});

beforeEach(() =>
  vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout", "performance"] }),
);
afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

function audioFixture() {
  const synth = new Synth(8000);
  synth.handle({ type: "reset", session: 1 });
  let press = 0;
  const listeners = new Set<() => void>();
  const audio = {
    initialize: vi.fn(async () => {}),
    noteOn: vi.fn((note: number, velocity: number) => {
      const token = { session: 1, press: ++press };
      synth.handle({ type: "note-on", ...token, note, velocity });
      return token;
    }),
    noteOff: vi.fn((token: { session: number; press: number }) => {
      synth.handle({ type: "note-off", ...token });
      return true;
    }),
    setPedals: vi.fn((state) => {
      synth.handle({ type: "pedals", version: 1, session: 1, ...state });
      return true;
    }),
    silencePlayback: vi.fn(() => {
      synth.handle({ type: "release-all", session: 1 });
      return true;
    }),
    subscribeInvalidation: (fn: () => void) => {
      listeners.add(fn);
      return () => {
        listeners.delete(fn);
      };
    },
  } satisfies PlaybackAudio;
  return {
    audio,
    synth,
    interrupt: () => {
      synth.handle({ type: "release-all", session: 1 });
      for (const fn of listeners) fn();
    },
  };
}

function midiEvents(recording: Recording) {
    const link = { href: "", download: "", click: vi.fn() };
    vi.stubGlobal("document", { createElement: () => link });
    downloadMidi(recording);
    const bytes = Buffer.from(link.href.split(",")[1], "base64");
    // Parse the SMF track, including variable-length deltas and metadata.
    let p = 22,
      tick = 0;
    const events: number[][] = [];
    function vlq() {
      let n = 0,
        b: number;
      do {
        b = bytes[p++];
        n = n * 128 + (b & 127);
      } while (b & 128);
      return n;
    }
    while (p < bytes.length) {
      tick += vlq();
      const status = bytes[p++];
      if (status === 255) {
        p++;
        const length = vlq();
        p += length;
      } else events.push([tick, status, bytes[p++], bytes[p++]]);
    }
    return events;
}

describe("ordered pedal performance", () => {
  it("does not resurrect a stolen held press after later retained voices are cleared", async () => {
    const { audio } = audioFixture();
    const recording = take();
    recording.notes = Array.from({ length: 12 }, (_, i) => ({ pitch: "C4", velocity: 80, startMs: i * 10, durationMs: i === 0 ? 2000 : 5 }));
    recording.pedals = { version: 1,
      noteOrder: recording.notes.map((_, i) => ({ on: i === 0 ? 1 : i * 2 + 1, off: i === 0 ? 26 : i * 2 + 2 })),
      events: [
        { timeMs: 0, order: 0, state: { ...off, sustain: true } },
        { timeMs: 500, order: 25, state: off },
      ],
    };
    const timeline = createPlaybackTimeline(recording, audio); timeline.seek(1000); await timeline.play();
    expect(audio.noteOn).not.toHaveBeenCalled(); timeline.dispose();
  });
  it("does not silence another player when an idle or retired timeline is disposed", async () => {
    const { audio, interrupt } = audioFixture();
    const idle = createPlaybackTimeline(take(), audio);
    const playing = createPlaybackTimeline(take(), audio);
    await playing.play(); idle.dispose();
    expect(audio.silencePlayback).not.toHaveBeenCalled();
    interrupt();
    const replacement = createPlaybackTimeline(take(), audio); await replacement.play();
    playing.dispose();
    expect(audio.silencePlayback).not.toHaveBeenCalled();
    replacement.dispose(); expect(audio.silencePlayback).toHaveBeenCalledTimes(1);
  });
  it("records physical releases and effective control edges with same-time ordering", () => {
    const recorder = createRecorder();
    recorder.startRecording(120);
    recorder.noteOn("C4", 80, 0, "first");
    vi.advanceTimersByTime(50);
    recorder.pedals({ ...off, sostenuto: true, soft: true });
    recorder.pedals({ ...off, sostenuto: true, soft: true });
    recorder.noteOn("C4", 80, 50, "second");
    vi.advanceTimersByTime(50);
    recorder.noteOff("C4", 100, "first");
    vi.advanceTimersByTime(50);
    recorder.noteOff("C4", 150, "second");
    vi.advanceTimersByTime(50);
    recorder.pedals(off);
    const result = recorder.stopRecording()!;
    expect(result.notes).toEqual(take().notes);
    expect(result.pedals).toEqual(take().pedals);
    result.pedals!.events[0].state.soft = false;
    expect(recorder.stopRecording()!.pedals!.events[0].state.soft).toBe(true);
  });

  it("closes pedals at pause, excludes paused time and ignores stopped writes", () => {
    const r = createRecorder();
    r.startRecording(120);
    r.pedals({ ...off, sustain: true });
    r.noteOn("C4", 80);
    vi.advanceTimersByTime(100);
    r.pauseRecording();
    vi.advanceTimersByTime(1000);
    r.pedals({ ...off, soft: true });
    r.resumeRecording();
    r.pedals({ ...off, soft: true });
    vi.advanceTimersByTime(100);
    const result = r.stopRecording()!;
    expect(result.notes[0].durationMs).toBe(100);
    expect(result.pedals!.events.map((e) => e.timeMs)).toEqual([
      0, 100, 100, 200,
    ]);
    r.pedals({ ...off, sustain: true });
    expect(r.stopRecording()).toEqual(result);
  });

  it("replays press-identity sostenuto and strike-only soft at deterministic boundaries", async () => {
    const { audio, synth } = audioFixture();
    const timeline = createPlaybackTimeline(take(), audio);
    await timeline.play();
    vi.advanceTimersByTime(50);
    expect(synth.voices[0].captured).toBe(true);
    expect(synth.voices[1].captured).toBe(false);
    expect(synth.voices[1].gain).toBeCloseTo(synth.voices[0].gain * 0.65);
    vi.advanceTimersByTime(100);
    expect(synth.voices[0].releasing).toBe(false);
    expect(synth.voices[1].releasing).toBe(true);
    vi.advanceTimersByTime(50);
    expect(audio.silencePlayback).toHaveBeenCalled();
    expect(synth.pedals).toEqual(off);
    timeline.dispose();
  });

  it("silences tails on pause/seek and restores only held identities in historical capture order", async () => {
    const { audio, synth, interrupt } = audioFixture();
    const timeline = createPlaybackTimeline(take(), audio);
    await timeline.play();
    vi.advanceTimersByTime(110);
    timeline.pause();
    expect(synth.pedals).toEqual(off);
    timeline.seek(120);
    await timeline.play();
    // First physical press is already released: its retained tail stays retired.
    expect(audio.noteOn).toHaveBeenCalledTimes(3);
    const current = synth.voices.find((v) => v.press === 3)!;
    expect(current.captured).toBe(false);
    interrupt();
    expect(timeline.getSnapshot().state).toBe("paused");
    expect(synth.pedals).toEqual(off);
    const count = audio.noteOn.mock.calls.length;
    vi.advanceTimersByTime(1000);
    expect(audio.noteOn).toHaveBeenCalledTimes(count);
    timeline.stop();
    timeline.dispose();
  });

  it("fails safely on control rejection and does not restart a canceled initialization", async () => {
    const { audio } = audioFixture();
    audio.setPedals.mockReturnValue(false);
    const t = createPlaybackTimeline(take(), audio);
    expect(await t.play()).toBe(false);
    expect(t.getSnapshot().state).toBe("paused");
    expect(audio.silencePlayback).toHaveBeenCalled();
    t.dispose();
    let ready!: () => void;
    audio.initialize.mockImplementation(
      () =>
        new Promise<void>((resolve) => {
          ready = resolve;
        }),
    );
    const pending = createPlaybackTimeline(take(), audio);
    const play = pending.play();
    pending.stop();
    ready();
    expect(await play).toBe(false);
    expect(audio.noteOn).not.toHaveBeenCalled();
    pending.dispose();
  });

  it("restores a long performance with at most ten voices and bounded control dispatch", async () => {
    const { audio, synth } = audioFixture();
    const recording = take();
    recording.notes = Array.from({ length: 20 }, (_, i) => ({
      pitch: "C4",
      velocity: 80,
      startMs: i,
      durationMs: 2000,
    }));
    recording.pedals = {
      version: 1,
      noteOrder: recording.notes.map((_, i) => ({ on: i, off: 1020 + i })),
      events: Array.from({ length: 1000 }, (_, i) => ({
        timeMs: 20 + i,
        order: 20 + i,
        state: { ...off, soft: i % 2 === 0 },
      })),
    };
    const timeline = createPlaybackTimeline(recording, audio);
    timeline.seek(1500);
    await timeline.play();
    expect(audio.noteOn).toHaveBeenCalledTimes(10);
    expect(audio.setPedals.mock.calls.length).toBeLessThan(25);
    expect(synth.voices.filter((v) => v.press !== 0)).toHaveLength(10);
    timeline.dispose();
  });

  it("retains a physical press captured before seeking and does not capture a later repeated pitch", async () => {
    const { audio, synth } = audioFixture();
    const timeline = createPlaybackTimeline(take(), audio);
    timeline.seek(80);
    await timeline.play();
    expect(synth.voices[0].captured).toBe(true);
    expect(synth.voices[1].captured).toBe(false);
    expect(synth.voices[1].gain).toBeCloseTo(synth.voices[0].gain * 0.65);
    timeline.stop();
    expect(synth.pedals).toEqual(off);
    expect(timeline.getSnapshot().positionMs).toBe(0);
    await timeline.play();
    expect(audio.initialize).toHaveBeenCalledTimes(2);
    timeline.dispose();
  });

  it("validates controls on persistence and uploads, and keeps legacy note-only takes", () => {
    const memory = new Map<string, string>();
    const storage = {
      getItem: (k: string) => memory.get(k) ?? null,
      setItem: (k: string, v: string) => {
        memory.set(k, v);
      },
      removeItem: (k: string) => {
        memory.delete(k);
      },
    };
    expect(saveRecordings([take()], () => storage).ok).toBe(true);
    expect(loadRecordings(() => storage)[0]).toMatchObject(take());
    const upload = {
      title: "Pedals",
      authorName: "Tester",
      deviceId: "test",
      bpm: 120,
      notes: take().notes,
      pedals: take().pedals,
    };
    expect(validateUpload(upload).ok).toBe(true);
    for (const pedals of [
      null,
      { ...take().pedals, version: 2 },
      { ...take().pedals, noteOrder: [] },
      { ...take().pedals, events: [{ timeMs: NaN, order: 0, state: off }] },
    ]) {
      expect(validRecordedPedals(pedals, take().notes)).toBe(false);
      expect(() => downloadMidi({ ...take(), pedals: pedals as never })).toThrow();
      expect(validateUpload({ ...upload, pedals }).ok).toBe(false);
      expect(() =>
        createPlaybackTimeline({ ...take(), pedals: pedals as never }),
      ).toThrow();
    }
    expect(validRecordedPedals(undefined, take().notes)).toBe(true);
    expect(performanceBoundaries(take().notes).map((e) => e.kind)).toEqual([
      "on",
      "on",
      "off",
      "off",
    ]);
  });

  it("exports physical releases through sustained ten-voice channel reuse", () => {
    const recording = take();
    recording.notes = Array.from({ length: 12 }, (_, i) => ({ pitch: "C4", velocity: 80, startMs: i * 10, durationMs: 5 }));
    recording.pedals = { version: 1,
      noteOrder: recording.notes.map((_, i) => ({ on: i * 2 + 1, off: i * 2 + 2 })),
      events: [{ timeMs: 0, order: 0, state: { ...off, sustain: true } }, { timeMs: 1000, order: 25, state: off }],
    };
    const events = midiEvents(recording);
    const ons = events.filter(e => (e[1] & 0xf0) === 0x90);
    const offs = events.filter(e => (e[1] & 0xf0) === 0x80);
    expect(ons).toHaveLength(12); expect(offs).toHaveLength(12);
    for (let i = 0; i < 12; i++) {
      expect(ons[i][0]).toBe(Math.round(i * 10 * 256 / 1000));
      expect(offs[i][0]).toBe(Math.round((i * 10 + 5) * 256 / 1000));
      expect(offs[i][1] & 15).toBe(ons[i][1] & 15);
    }
    expect(new Set(ons.slice(0, 10).map(e => e[1] & 15)).size).toBe(10);
    expect(ons[10][1]).toBe(ons[0][1]);
    expect(events.some(e => e[0] === ons[10][0] && e[1] === 0xb0 && e[2] === 120)).toBe(true);
  });

  it("rejects channel exhaustion before triggering a corrupted download", () => {
    const recording = take();
    recording.notes = Array.from({ length: 16 }, (_, i) => ({ pitch: "C4", velocity: 80, startMs: i * 10, durationMs: 5000 }));
    recording.pedals = { version: 1, events: [], noteOrder: recording.notes.map((_, i) => ({ on: i, off: 16 + i })) };
    expect(() => midiEvents(recording)).toThrow("fifteen simultaneous physical presses");
  });

  it("exports actual MIDI bytes with isolated repeated-pitch channels and ordered controls", () => {
    const events = midiEvents(take());
    expect(
      events.filter((e) => (e[1] & 0xf0) === 0x90 || (e[1] & 0xf0) === 0x80),
    ).toEqual([
      [0, 0x90, 60, 102],
      [13, 0x91, 60, 102],
      [26, 0x80, 60, 0],
      [38, 0x81, 60, 0],
    ]);
    expect(
      events.findIndex((e) => e[1] === 0xb0 && e[2] === 66 && e[3] === 127),
    ).toBeLessThan(events.findIndex((e) => e[1] === 0x91));
    expect(events.slice(-3).map((e) => e.slice(1))).toEqual([
      [0xbf, 64, 0],
      [0xbf, 66, 0],
      [0xbf, 67, 0],
    ]);
    expect(events.some((e) => (e[1] & 15) === 9)).toBe(false);
  });
});
