import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { setTempo, addEvent, dataUri } = vi.hoisted(() => ({
  setTempo: vi.fn(),
  addEvent: vi.fn(),
  dataUri: vi.fn(() => "data:audio/midi;base64,test"),
}));

vi.mock("midi-writer-js", () => ({
  default: {
    Track: class {
      setTempo = setTempo;
      addEvent = addEvent;
    },
    NoteEvent: class {
      constructor(options: object) {
        Object.assign(this, options);
      }
    },
    Writer: class {
      dataUri = dataUri;
    },
  },
}));

import {
  createRecorder,
  downloadMidi,
  millisecondsToTicks,
  type Recording,
} from "../../frontend/src/app/midi/midiUtils";

let now = 1000;

beforeEach(() => {
  now = 1000;
  vi.clearAllMocks();
  vi.spyOn(performance, "now").mockImplementation(() => now);
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe("recording metadata and timing", () => {
  it("converts milliseconds at different tempos and rounds to ticks", () => {
    expect(millisecondsToTicks(500, 120)).toBe(128);
    expect(millisecondsToTicks(500, 60)).toBe(64);
    expect(millisecondsToTicks(3, 120)).toBe(1);
  });

  it("creates identifiable, serializable recording data without building MIDI", () => {
    const recorder = createRecorder();
    const before = Date.now();
    recorder.startRecording(90, "First take");
    const take = recorder.stopRecording()!;
    expect(take).toMatchObject({ name: "First take", bpm: 90, notes: [] });
    expect(take.id).toMatch(/^[0-9a-f-]{36}$/i);
    expect(Date.parse(take.createdAt)).toBeGreaterThanOrEqual(before);
    expect(Date.parse(take.createdAt)).toBeLessThanOrEqual(Date.now());
    expect(JSON.parse(JSON.stringify(take))).toEqual(take);
    expect(setTempo).not.toHaveBeenCalled();
    expect(addEvent).not.toHaveBeenCalled();
  });

  it("rejects invalid BPM without replacing an existing take", () => {
    const recorder = createRecorder();
    recorder.startRecording(120);
    recorder.noteOn("C4", 80);
    for (const bpm of [0, -1, NaN, Infinity]) {
      expect(() => recorder.startRecording(bpm)).toThrow(RangeError);
    }
    now = 1500;
    expect(recorder.stopRecording()?.notes).toEqual([
      { pitch: "C4", velocity: 80, startMs: 0, durationMs: 500 },
    ]);
  });
});

describe("note pairing", () => {
  it("records pitch, velocity, start offset and duration in milliseconds", () => {
    const recorder = createRecorder();
    recorder.startRecording(120);
    now = 1500;
    recorder.noteOn("C4", 80);
    now = 2000;
    recorder.noteOff("C4");
    expect(recorder.stopRecording()?.notes).toEqual([
      { pitch: "C4", velocity: 80, startMs: 500, durationMs: 500 },
    ]);
  });

  it("ignores duplicate presses and unknown releases but permits a fresh retrigger", () => {
    const recorder = createRecorder();
    recorder.startRecording(120);
    recorder.noteOn("C4", 80);
    now = 1100;
    recorder.noteOn("C4", 20);
    recorder.noteOff("D4");
    now = 1200;
    recorder.noteOff("C4");
    recorder.noteOff("C4");
    now = 1300;
    recorder.noteOn("C4", 60);
    now = 1400;
    recorder.noteOff("C4");
    expect(recorder.stopRecording()?.notes).toEqual([
      { pitch: "C4", velocity: 80, startMs: 0, durationMs: 200 },
      { pitch: "C4", velocity: 60, startMs: 300, durationMs: 100 },
    ]);
  });

  it("keeps overlapping notes independent and orders results by start time", () => {
    const recorder = createRecorder();
    recorder.startRecording(120);
    recorder.noteOn("C4", 80);
    now = 1100;
    recorder.noteOn("E4", 60);
    recorder.noteOn("G4", 70);
    now = 1200;
    recorder.noteOff("G4");
    now = 1300;
    recorder.noteOff("E4");
    now = 1500;
    recorder.noteOff("C4");
    const notes = recorder.stopRecording()!.notes;
    expect(notes.map((note) => note.startMs)).toEqual([0, 100, 100]);
    expect(notes).toEqual(expect.arrayContaining([
      { pitch: "C4", velocity: 80, startMs: 0, durationMs: 500 },
      { pitch: "E4", velocity: 60, startMs: 100, durationMs: 200 },
      { pitch: "G4", velocity: 70, startMs: 100, durationMs: 100 },
    ]));
  });

  it("closes every held chord note at stop and rejects later input", () => {
    const recorder = createRecorder();
    recorder.startRecording(120);
    for (const pitch of ["C4", "E4", "G4"]) recorder.noteOn(pitch, 80);
    now = 1500;
    const take = recorder.stopRecording();
    expect(take?.notes).toEqual(["C4", "E4", "G4"].map((pitch) => ({
      pitch, velocity: 80, startMs: 0, durationMs: 500,
    })));
    now = 3000;
    recorder.noteOn("D4", 70);
    recorder.noteOff("C4");
    recorder.releaseAllNotes();
    recorder.pauseRecording();
    recorder.resumeRecording();
    expect(recorder.stopRecording()).toEqual(take);
  });

  it("release-all ends held notes once while allowing later notes", () => {
    const recorder = createRecorder();
    recorder.startRecording(120);
    recorder.noteOn("C4", 80);
    now = 1100;
    recorder.releaseAllNotes();
    recorder.releaseAllNotes();
    recorder.noteOff("C4");
    now = 1200;
    recorder.noteOn("D4", 60);
    now = 1300;
    expect(recorder.stopRecording()?.notes).toEqual([
      { pitch: "C4", velocity: 80, startMs: 0, durationMs: 100 },
      { pitch: "D4", velocity: 60, startMs: 200, durationMs: 100 },
    ]);
  });

  it("allows a note pressed and released at the same timestamp", () => {
    const recorder = createRecorder();
    recorder.startRecording(120);
    recorder.noteOn("C4", 80);
    recorder.noteOff("C4");
    expect(recorder.stopRecording()?.notes[0].durationMs).toBe(0);
  });
});

describe("pause and resume", () => {
  it("closes held notes on pause, ignores paused input and removes the whole pause", () => {
    const recorder = createRecorder();
    recorder.startRecording(120);
    recorder.noteOn("C4", 80);
    now = 1500;
    recorder.pauseRecording();
    now = 2000;
    recorder.pauseRecording(); // Must not move the pause boundary.
    recorder.noteOff("C4");
    recorder.noteOn("D4", 70);
    recorder.releaseAllNotes();
    now = 4000; // Includes any UI count-in before resume is called.
    recorder.resumeRecording();
    now = 4100;
    recorder.resumeRecording(); // Must not shift the timeline again.
    recorder.noteOff("D4");
    recorder.noteOn("E4", 60);
    now = 4400;
    expect(recorder.stopRecording()?.notes).toEqual([
      { pitch: "C4", velocity: 80, startMs: 0, durationMs: 500 },
      { pitch: "E4", velocity: 60, startMs: 600, durationMs: 300 },
    ]);
  });

  it("accumulates multiple pauses and does not synthesize held notes on resume", () => {
    const recorder = createRecorder();
    recorder.startRecording(120);
    recorder.noteOn("C4", 80);
    now = 1100;
    recorder.pauseRecording();
    now = 2100;
    recorder.resumeRecording();
    recorder.noteOff("C4"); // The note already ended at pause.
    now = 2200;
    recorder.pauseRecording();
    now = 4200;
    recorder.resumeRecording();
    recorder.noteOn("C4", 60);
    now = 4300;
    expect(recorder.stopRecording()?.notes).toEqual([
      { pitch: "C4", velocity: 80, startMs: 0, durationMs: 100 },
      { pitch: "C4", velocity: 60, startMs: 200, durationMs: 100 },
    ]);
  });

  it("stops while paused without extending notes or allowing resume after stop", () => {
    const recorder = createRecorder();
    recorder.startRecording(120);
    recorder.noteOn("C4", 80);
    now = 1200;
    recorder.pauseRecording();
    now = 9000;
    const take = recorder.stopRecording();
    recorder.resumeRecording();
    recorder.noteOn("D4", 80);
    expect(recorder.stopRecording()).toEqual(take);
    expect(take?.notes).toEqual([
      { pitch: "C4", velocity: 80, startMs: 0, durationMs: 200 },
    ]);
  });

  it("ignores input and lifecycle calls before the first take", () => {
    const recorder = createRecorder();
    recorder.noteOn("C4", 80);
    recorder.noteOff("C4");
    recorder.pauseRecording();
    recorder.resumeRecording();
    recorder.releaseAllNotes();
    expect(recorder.stopRecording()).toBeNull();
  });
});

describe("session isolation", () => {
  it("resets paused timing and active notes when starting another take", () => {
    const recorder = createRecorder();
    recorder.startRecording(120);
    recorder.noteOn("C4", 80);
    now = 1200;
    recorder.pauseRecording();
    const first = recorder.stopRecording()!;
    now = 5000;
    recorder.startRecording(60);
    recorder.noteOn("D4", 70);
    now = 5300;
    const second = recorder.stopRecording()!;
    expect(second.id).not.toBe(first.id);
    expect(second.name).toBe("Untitled recording");
    expect(second.bpm).toBe(60);
    expect(second.notes).toEqual([
      { pitch: "D4", velocity: 70, startMs: 0, durationMs: 300 },
    ]);
    expect(first.notes).toEqual([
      { pitch: "C4", velocity: 80, startMs: 0, durationMs: 200 },
    ]);
  });

  it("replaces an unfinished take without leaking active notes", () => {
    const recorder = createRecorder();
    recorder.startRecording(120);
    recorder.noteOn("C4", 80);
    now = 1500;
    recorder.startRecording(90);
    recorder.noteOff("C4");
    expect(recorder.stopRecording()?.notes).toEqual([]);
  });

  it("isolates two simultaneously active recorder instances", () => {
    const first = createRecorder();
    const second = createRecorder();
    first.startRecording(120);
    first.noteOn("C4", 80);
    now = 1100;
    second.startRecording(60);
    second.noteOn("C4", 40);
    now = 1200;
    first.pauseRecording();
    now = 1400;
    expect(second.stopRecording()?.notes).toEqual([
      { pitch: "C4", velocity: 40, startMs: 0, durationMs: 300 },
    ]);
    expect(first.stopRecording()?.notes).toEqual([
      { pitch: "C4", velocity: 80, startMs: 0, durationMs: 200 },
    ]);
  });

  it("returns deep-enough snapshots that caller mutations cannot change the recorder", () => {
    const recorder = createRecorder();
    recorder.startRecording(120);
    recorder.noteOn("C4", 80);
    now = 1500;
    const first = recorder.stopRecording()!;
    first.notes[0].pitch = "D4";
    first.notes.push({ pitch: "G4", velocity: 10, startMs: 0, durationMs: 1 });
    first.name = "Changed";
    const second = recorder.stopRecording()!;
    expect(second.name).toBe("Untitled recording");
    expect(second.notes).toEqual([
      { pitch: "C4", velocity: 80, startMs: 0, durationMs: 500 },
    ]);
  });
});

describe("downloadMidi adapter (MIDI writer and DOM mocked)", () => {
  function download(take: Recording) {
    const link = { href: "", download: "", click: vi.fn() };
    vi.stubGlobal("document", { createElement: vi.fn(() => link) });
    downloadMidi(take);
    return link;
  }

  it("builds MIDI on demand using the take BPM and rounded start/end ticks", () => {
    const take: Recording = {
      id: "take", name: "Example", bpm: 120,
      createdAt: "2026-09-26T00:00:00.000Z",
      notes: [
        { pitch: "C4", velocity: 80, startMs: 2, durationMs: 2 },
        { pitch: "E4", velocity: 60, startMs: 500, durationMs: 250 },
      ],
    };
    const before = JSON.stringify(take);
    const link = download(take);
    expect(setTempo).toHaveBeenCalledWith(120);
    expect(addEvent.mock.calls.map(([event]) => event)).toEqual([
      { pitch: "C4", velocity: 80, tick: 1, duration: "T0" },
      { pitch: "E4", velocity: 60, tick: 128, duration: "T64" },
    ]);
    expect(link.href).toBe("data:audio/midi;base64,test");
    expect(link.download).toBe("Example.mid");
    expect(link.click).toHaveBeenCalledOnce();
    expect(JSON.stringify(take)).toBe(before);
  });

  it("uses a safe bounded filename with a fallback for an empty name", () => {
    const take: Recording = { id: "take", name: "../Take:one", bpm: 120,
      createdAt: "2026-10-03T00:00:00Z", notes: [] };
    expect(download(take).download).toBe("___Take_one.mid");
    expect(download({ ...take, name: " " }).download).toBe("recording.mid");
    expect(download({ ...take, name: "a".repeat(100) }).download).toBe(`${"a".repeat(80)}.mid`);
  });

  it("exports a completed paused/resumed take without inserting the pause", () => {
    const recorder = createRecorder();
    recorder.startRecording(60);
    recorder.noteOn("C4", 80);
    now = 1500;
    recorder.pauseRecording();
    now = 5500;
    recorder.resumeRecording();
    recorder.noteOn("E4", 60);
    now = 6000;
    download(recorder.stopRecording()!);
    expect(addEvent.mock.calls.map(([event]) => event)).toEqual([
      { pitch: "C4", velocity: 80, tick: 0, duration: "T64" },
      { pitch: "E4", velocity: 60, tick: 64, duration: "T64" },
    ]);
  });

  it("supports an empty take and rebuilds events independently for repeated exports", () => {
    const recorder = createRecorder();
    recorder.startRecording(120);
    const take = recorder.stopRecording()!;
    download(take);
    expect(addEvent).not.toHaveBeenCalled();
    take.notes.push({ pitch: "C4", velocity: 80, startMs: 0, durationMs: 500 });
    download(take);
    download(take);
    expect(addEvent).toHaveBeenCalledTimes(2);
    expect(dataUri).toHaveBeenCalledTimes(3);
  });
});
