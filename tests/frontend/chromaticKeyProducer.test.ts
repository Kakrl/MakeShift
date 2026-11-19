import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { LiveSession } from "../../frontend/src/events/liveSession";
import { createChromaticKeyProducer } from "../../frontend/src/events/chromaticKeyProducer";
import { connectPianoConsumers } from "../../frontend/src/events/pianoConsumers";
import { createRecorder } from "../../frontend/src/app/midi/midiUtils";
import type { BrowserAudio } from "../../frontend/src/app/audio/audioEngine";
let now: number;
let session: LiveSession;
let producer: ReturnType<typeof createChromaticKeyProducer>;
let audio: {
  noteOn: ReturnType<typeof vi.fn>;
  noteOff: ReturnType<typeof vi.fn>;
  releaseAll: ReturnType<typeof vi.fn>;
};
let recorder: ReturnType<typeof createRecorder>;
let pitches: ReadonlySet<number>;
let disconnect: () => void;
const camera = { deviceId: "test", width: 1000, height: 1000, facingMode: "" };
const corners = [
  { x: 100, y: 100 },
  { x: 900, y: 100 },
  { x: 900, y: 900 },
  { x: 100, y: 900 },
];
function observe() {
  session.observeUncalibratedSheet(camera, corners);
  session.observeTracking();
}
beforeEach(async () => {
  vi.useFakeTimers();
  now = 1000;
  let press = 0;
  vi.spyOn(performance, "now").mockImplementation(() => now);
  audio = {
    noteOn: vi.fn(() => ({ session: 1, press: ++press })),
    noteOff: vi.fn(() => true),
    releaseAll: vi.fn(),
  };
  session = new LiveSession(
    {
      ...audio,
      status: "ready",
      initialize: async () => {},
      pauseInput: vi.fn(),
      resumeInput: vi.fn(),
    } as unknown as BrowserAudio,
    () => now,
  );
  recorder = createRecorder();
  pitches = new Set();
  disconnect = connectPianoConsumers(session, recorder, (next) => {
    pitches = next;
  });
  observe();
  await session.prepare();
  session.play();
  recorder.startRecording(120);
  producer = createChromaticKeyProducer(session);
});
afterEach(() => {
  session.stop();
  disconnect();
  vi.restoreAllMocks();
  vi.useRealTimers();
});
it("sends a chromatic chord to audio immediately, then MIDI and feedback, holds without retrigger, and releases missing keys", () => {
  const id = session.sessionId;
  producer([0, 1, 4, 12], now, id);
  expect(audio.noteOn.mock.calls).toEqual([
    [48, 0.2],
    [49, 0.2],
    [52, 0.2],
    [60, 0.2],
  ]);
  expect(pitches.size).toBe(0);
  session.flushNotes();
  expect([...pitches]).toEqual([48, 49, 52, 60]);
  now += 50;
  producer([0, 1, 4, 12], now, id);
  expect(audio.noteOn).toHaveBeenCalledTimes(4);
  producer([1], now, id);
  expect(audio.noteOff).toHaveBeenCalledTimes(3);
  now += 25;
  producer([], now, id);
  session.flushNotes();
  expect(audio.noteOff).toHaveBeenCalledTimes(4);
  expect(pitches.size).toBe(0);
  expect(
    recorder
      .stopRecording()!
      .notes.map((n) => [n.pitch, n.velocity, n.durationMs]),
  ).toEqual([
    ["C3", 20, 50],
    ["E3", 20, 50],
    ["C4", 20, 50],
    ["C#3", 20, 75],
  ]);
});
it("rejects old-session and pre-play frames and creates fresh identities after restart", async () => {
  const old = session.sessionId;
  producer([0], now, old);
  session.stop();
  now += 10;
  observe();
  await session.prepare();
  const current = session.play();
  const calls = audio.noteOn.mock.calls.length;
  producer([1], now, old);
  producer([1], now, null);
  expect(audio.noteOn).toHaveBeenCalledTimes(calls);
  producer([1], now, current);
  expect(audio.noteOn).toHaveBeenLastCalledWith(49, 0.2);
});
it("preserves count-in suppression until release and a fresh press", () => {
  const id = session.sessionId;
  session.pauseInput();
  producer([0], now, id);
  session.resumeInput();
  producer([0], now, id);
  expect(audio.noteOn).not.toHaveBeenCalled();
  now++;
  producer([], now, id);
  producer([0], now, id);
  expect(audio.noteOn).toHaveBeenCalledTimes(1);
});
it.each([2, 3])(
  "uses the configured starting pitch and final C for %i octaves",
  async (octaves) => {
    session.stop();
    session.setLayout({
      octaves,
      whiteKeys: octaves * 7 + 1,
      startingMidi: 60,
    });
    observe();
    await session.prepare();
    const id = session.play();
    producer([1, octaves * 12], now, id);
    expect(audio.noteOn.mock.calls).toEqual([
      [61, 0.2],
      [60 + octaves * 12, 0.2],
    ]);
  },
);
it("invalid key snapshots retire the session and release held notes", () => {
  const id = session.sessionId;
  producer([0], now, id);
  producer([13], now, id);
  expect(session.sessionId).toBeNull();
  expect(audio.releaseAll).toHaveBeenCalled();
});
