import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { LiveSession } from "../../frontend/src/events/liveSession";
import { createKeyEventProducer } from "../../frontend/src/events/keyEventProducer";
import { connectPianoConsumers } from "../../frontend/src/events/pianoConsumers";
import { createRecorder } from "../../frontend/src/app/midi/midiUtils";
import type { BrowserAudio } from "../../frontend/src/app/audio/audioEngine";
import { CURRENT_LAYOUT, SHEET_ID } from "../../frontend/src/cv/calibration";
import { Synth } from "../../frontend/public/audio/synth.js";

let now: number;
let gate: LiveSession;
let recorder: ReturnType<typeof createRecorder>;
let producer: ReturnType<typeof createKeyEventProducer>;
let pitches: ReadonlySet<number>;
let synth: Synth;
let audio: { noteOn: ReturnType<typeof vi.fn>; noteOff: ReturnType<typeof vi.fn> };
let detach: () => void;
let disconnect: ReturnType<typeof connectPianoConsumers>;

function observe() {
  const camera = { deviceId: "fixture", width: 1000, height: 1000, facingMode: "" };
  const corners = [{ x: 100, y: 100 }, { x: 900, y: 100 }, { x: 900, y: 900 }, { x: 100, y: 900 }];
  gate.observeCalibration({
    version: 1, coordinates: "unmirrored-frame-pixels/marker-unit-square",
    sheet: SHEET_ID, camera, corners, layout: CURRENT_LAYOUT,
    contact: { model: "landmark-reference-v1",
      hover: [Array(21).fill({ x: 0.5, y: 0.4, z: 0 })],
      rest: [Array(21).fill({ x: 0.5, y: 0.5, z: 0 })] },
  }, camera, corners);
  gate.observeTracking();
}
async function start() {
  observe();
  expect(await gate.prepare()).toBe(true);
  const id = gate.play()!;
  producer = createKeyEventProducer(gate, id);
}
beforeEach(async () => {
  vi.useFakeTimers();
  now = 1000;
  vi.spyOn(performance, "now").mockImplementation(() => now);
  synth = new Synth(48000);
  synth.handle({ type: "reset", session: 1 });
  let press = 0;
  audio = {
    noteOn: vi.fn((note: number, velocity: number) => {
      const token = { session: 1, press: ++press };
      synth.handle({ type: "note-on", ...token, note, velocity });
      return token;
    }),
    noteOff: vi.fn((token: { session: number; press: number }) => {
      synth.handle({ type: "note-off", ...token });
      return true;
    }),
  };
  gate = new LiveSession({ ...audio, status: "ready", initialize: async () => {},
    subscribeInvalidation: () => () => {},
    releaseAll: () => synth.handle({ type: "release-all", session: 1 }),
  } as unknown as BrowserAudio, () => now);
  detach = gate.attach();
  recorder = createRecorder();
  pitches = new Set();
  disconnect = connectPianoConsumers(gate, recorder, (value) => { pitches = value; });
  await start();
  recorder.startRecording(120);
});
afterEach(() => {
  detach();
  gate.flushNotes();
  disconnect();
  vi.restoreAllMocks();
  vi.useRealTimers();
});
function render() {
  const output = new Float32Array(48000);
  synth.render(output);
  return output;
}
function finish() {
  gate.stop();
  gate.flushNotes();
  return recorder.stopRecording()!;
}

it.each([48, 50, 52, 53, 55, 57, 59, 60].map((pitch, keyIndex) => ({ pitch, keyIndex })))(
  "maps key $keyIndex to MIDI $pitch in audio, recording and feedback", ({ pitch, keyIndex }) => {
    producer([{ keyIndex, velocity: 0.4 }], [], now);
    expect(audio.noteOn).toHaveBeenCalledWith(pitch, 0.4);
    expect(pitches.size).toBe(0); // Observers cannot delay audio.
    const output = render();
    let crossings = 0;
    for (let i = 24000; i < output.length - 1; i++)
      if (output[i] <= 0 && output[i + 1] > 0) crossings++;
    expect(Math.abs(crossings * 2 - 440 * 2 ** ((pitch - 69) / 12))).toBeLessThan(2.1);
    gate.flushNotes();
    expect([...pitches]).toEqual([pitch]);
    now += 100;
    const take = finish();
    expect(take.notes[0]).toMatchObject({ velocity: 40, startMs: 0, durationMs: 100 });
    expect(pitches.size).toBe(0);
    expect(render().every((value) => value === 0)).toBe(true);
  },
);

it("preserves observation times and variable chord velocities despite deferred consumption", async () => {
  producer([{ keyIndex: 0, velocity: 0.25 }, { keyIndex: 2, velocity: 0.75 }], [], now);
  now += 80;
  producer([], [0, 2], now);
  now += 120;
  await vi.advanceTimersByTimeAsync(0);
  expect(finish().notes).toEqual([
    { pitch: "C3", velocity: 25, startMs: 0, durationMs: 80 },
    { pitch: "E3", velocity: 75, startMs: 0, durationMs: 80 },
  ]);
});

it("does not retrigger held keys and assigns a fresh press on release/repress", () => {
  const chord = [{ keyIndex: 0, velocity: 0.8 }, { keyIndex: 7, velocity: 1 }];
  producer(chord, [], now);
  now += 50;
  producer(chord, [], now);
  producer([chord[0]], [0], now);
  expect(audio.noteOn).toHaveBeenCalledTimes(3);
  now += 50;
  expect(finish().notes.map((note) => note.durationMs)).toEqual([50, 100, 50]);
});

it("flushes a press and terminal event before an immediate Stop snapshot", () => {
  producer([{ keyIndex: 0, velocity: 0.8 }], [], now);
  now += 20;
  const take = finish();
  expect(take.notes).toEqual([{ pitch: "C3", velocity: 80, startMs: 0, durationMs: 20 }]);
  expect(pitches.size).toBe(0);
  gate.flushNotes();
  expect(recorder.stopRecording()).toEqual(take);
});

it("retains separate same-pitch press identities and keeps feedback until both release", () => {
  const sessionId = gate.sessionId!;
  const base = { version: 1, sessionId, timestampMs: now, pitch: 48 };
  gate.receive({ ...base, type: "note-on", sequence: 1, pressId: 1, velocity: 0.3 });
  gate.receive({ ...base, type: "note-on", sequence: 2, pressId: 2, velocity: 0.7 });
  now += 30;
  gate.receive({ ...base, timestampMs: now, type: "note-off", sequence: 3, pressId: 1 });
  gate.flushNotes();
  expect([...pitches]).toEqual([48]);
  now += 20;
  expect(finish().notes.map((note) => [note.velocity, note.durationMs])).toEqual([[30, 30], [70, 50]]);
});

it("tracking interruption clears every consumer and rejects an old producer after restart", async () => {
  producer([{ keyIndex: 0, velocity: 0.8 }], [], now);
  const stale = producer;
  now += 20;
  gate.trackingFailed();
  gate.flushNotes();
  expect(pitches.size).toBe(0);
  expect(recorder.stopRecording()!.notes[0].durationMs).toBe(20);
  await start();
  recorder.startRecording(120);
  stale([{ keyIndex: 1, velocity: 1 }], [], now);
  producer([{ keyIndex: 7, velocity: 0.5 }], [], now);
  expect(audio.noteOn.mock.calls.map(([pitch]) => pitch)).toEqual([48, 60]);
  expect(finish().notes.map((note) => note.pitch)).toEqual(["C4"]);
});

it("rejected audio creates neither a recorded note nor a highlighted key", () => {
  audio.noteOn.mockReturnValueOnce(null);
  producer([{ keyIndex: 0, velocity: 0.8 }], [], now);
  expect(finish().notes).toEqual([]);
  expect(pitches.size).toBe(0);
});

it("ignores unsupported key indexes and fails closed on invalid velocity", () => {
  producer([-1, 8, 0.5, NaN].map((keyIndex) => ({ keyIndex, velocity: 1 })), [], now);
  expect(audio.noteOn).not.toHaveBeenCalled();
  producer([{ keyIndex: 0, velocity: 0.5 }], [], now);
  producer([{ keyIndex: 1, velocity: NaN }], [], now);
  gate.flushNotes();
  expect(gate.sessionId).toBeNull();
  expect(pitches.size).toBe(0);
  expect(render().every((value) => value === 0)).toBe(true);
});

it("captures held identities at recording boundaries without replaying pre-boundary history or audio", () => {
  recorder.stopRecording();
  const id = gate.sessionId!;
  gate.noteOn(id, 1, 48, 0.3);
  gate.noteOn(id, 2, 48, 0.7);
  gate.noteOn(id, 3, 50, 0.5);
  now += 20;
  gate.noteOff(id, 3, 50);
  gate.flushNotes();
  recorder.startRecording(120);
  disconnect.captureHeld();
  now += 30;
  gate.noteOff(id, 1, 48);
  gate.flushNotes();
  recorder.pauseRecording();
  now += 50;
  gate.flushNotes();
  recorder.resumeRecording();
  disconnect.captureHeld();
  now += 40;
  gate.noteOff(id, 2, 48);
  gate.flushNotes();
  expect(recorder.stopRecording()!.notes).toEqual([
    { pitch: "C3", velocity: 30, startMs: 0, durationMs: 30 },
    { pitch: "C3", velocity: 70, startMs: 0, durationMs: 30 },
    { pitch: "C3", velocity: 70, startMs: 30, durationMs: 40 },
  ]);
  expect(audio.noteOn).toHaveBeenCalledTimes(3);
  expect(pitches.size).toBe(0);
});
