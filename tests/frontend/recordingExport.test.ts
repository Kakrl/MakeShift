import { afterEach, expect, it, vi } from "vitest";
import { createRecorder, downloadMidi } from "../../frontend/src/app/midi/midiUtils";
import { NoteSession } from "../../frontend/src/events/noteSession";

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

// Independent reader for the writer's format-0 output; fail on unexpected data.
function readMidi(uri: string) {
  const bytes = Buffer.from(uri.split(",")[1], "base64");
  expect(bytes.toString("ascii", 0, 4)).toBe("MThd");
  expect(bytes.readUInt32BE(4)).toBe(6);
  expect(bytes.readUInt16BE(8)).toBe(0);
  expect(bytes.readUInt16BE(10)).toBe(1);
  expect(bytes.readUInt16BE(12)).toBe(128);
  expect(bytes.toString("ascii", 14, 18)).toBe("MTrk");
  expect(bytes.readUInt32BE(18)).toBe(bytes.length - 22);
  let offset = 22;
  let tick = 0;
  let tempo = 0;
  let meter: number[] = [];
  let ended = false;
  const notes: { tick: number; on: boolean; pitch: number; velocity: number }[] = [];
  function variableLength() {
    let value = 0;
    for (let count = 0; count < 4; count++) {
      expect(offset).toBeLessThan(bytes.length);
      const byte = bytes[offset++];
      value = value * 128 + (byte & 127);
      if (!(byte & 128)) return value;
    }
    throw new Error("Invalid MIDI variable-length value");
  }
  while (offset < bytes.length) {
    expect(ended).toBe(false);
    tick += variableLength();
    const status = bytes[offset++];
    if (status === 255) {
      const type = bytes[offset++];
      const length = variableLength();
      if (type === 81) {
        expect(length).toBe(3);
        tempo = bytes.readUIntBE(offset, 3);
      } else if (type === 88) {
        expect(tick).toBe(0);
        expect(length).toBe(4);
        meter = [...bytes.subarray(offset, offset + length)];
      } else {
        expect(type).toBe(47);
        expect(length).toBe(0);
        ended = true;
      }
      offset += length;
    } else {
      expect([128, 144]).toContain(status);
      notes.push({ tick, on: status === 144, pitch: bytes[offset++], velocity: bytes[offset++] });
    }
  }
  expect(ended).toBe(true);
  return { tempo, notes, meter };
}

it("exports zero gated onsets and excludes start/resume count-in time", () => {
  let now = 1000;
  vi.spyOn(performance, "now").mockImplementation(() => now);
  const link = { href: "", download: "", click: vi.fn() };
  vi.stubGlobal("document", { createElement: () => link });
  const recorder = createRecorder();
  const session = new NoteSession(() => true, () => now), id = session.start();
  session.subscribe(({ event }) => {
    if (event.type === "release-all") recorder.releaseAllNotes(event.timestampMs);
    else if (event.type === "note-on") recorder.noteOn("C4", 80, event.timestampMs, String(event.pressId));
    else recorder.noteOff("C4", event.timestampMs, String(event.pressId));
  });
  let sequence = 0;
  const event = (type: "note-on" | "note-off", pressId: number) => session.receive({
    version: 1, sessionId: id, sequence: ++sequence, timestampMs: now, type, pressId, pitch: 60, velocity: 0.8,
  });
  session.pauseInput(); event("note-on", 1); now += 2000;
  recorder.startRecording(120); session.resumeInput();
  event("note-off", 1); event("note-on", 2); session.flushObservers();
  now += 500; recorder.pauseRecording(); session.pauseInput(); event("note-on", 3);
  now += 3000; recorder.resumeRecording(); session.resumeInput();
  event("note-off", 2); event("note-off", 3); event("note-on", 4); session.flushObservers();
  now += 250; session.stop(); session.flushObservers();
  const take = recorder.stopRecording()!; downloadMidi(take);
  expect(take.notes.map(n => [n.startMs, n.durationMs])).toEqual([[0, 500], [500, 250]]);
  expect(readMidi(link.href).notes.map(n => [n.tick, n.on])).toEqual([[0, true], [128, false], [128, true], [192, false]]);
});

it("exports chords, split held notes and stop boundaries with the real writer", () => {
  let now = 1000;
  vi.spyOn(performance, "now").mockImplementation(() => now);
  const link = { href: "", download: "", click: vi.fn() };
  vi.stubGlobal("document", { createElement: () => link });
  const recorder = createRecorder();
  expect(recorder.getState()).toBe("stopped");
  recorder.startRecording(120, undefined, { numerator: 7, denominator: 8 });
  expect(recorder.getState()).toBe("recording");
  recorder.noteOn("C4", 80, now, "finger-1");
  recorder.noteOn("E4", 50, now, "finger-2");
  now += 500;
  recorder.pauseRecording();
  expect(recorder.getState()).toBe("paused");
  recorder.noteOn("G4", 90);
  now += 3000; // Pause and resume count-in are excluded.
  recorder.resumeRecording();
  recorder.noteOn("C4", 80, now, "finger-1");
  now += 250;
  const take = recorder.stopRecording()!;
  expect(recorder.getState()).toBe("stopped");
  recorder.noteOn("G4", 90);
  recorder.noteOff("C4");
  downloadMidi(take);
  expect(link.click).toHaveBeenCalledOnce();
  const decoded = readMidi(link.href);
  expect(decoded.tempo).toBe(500000);
  expect(decoded.meter).toEqual([7, 3, 24, 8]);
  expect(decoded.notes.filter(note => note.on)).toEqual([
    { tick: 0, on: true, pitch: 60, velocity: 102 },
    { tick: 0, on: true, pitch: 64, velocity: 64 },
    { tick: 128, on: true, pitch: 60, velocity: 102 },
  ]);
  expect(decoded.notes.filter(note => !note.on)).toEqual([
    { tick: 128, on: false, pitch: 60, velocity: 102 },
    { tick: 128, on: false, pitch: 64, velocity: 64 },
    { tick: 192, on: false, pitch: 60, velocity: 102 },
  ]);
  expect(decoded.notes.findIndex(note => !note.on && note.pitch === 60))
    .toBeLessThan(decoded.notes.findIndex(note => note.on && note.tick === 128));
  recorder.startRecording(60);
  now += 500;
  recorder.noteOn("D4", 100);
  now += 500;
  downloadMidi(recorder.stopRecording()!);
  expect(readMidi(link.href)).toEqual({ tempo: 1000000, meter: [4, 2, 24, 8], notes: [
    { tick: 64, on: true, pitch: 62, velocity: 127 },
    { tick: 128, on: false, pitch: 62, velocity: 127 },
  ] });
  expect(take.notes).toHaveLength(3);
});
