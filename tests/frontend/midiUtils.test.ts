import { describe, expect, it, vi } from "vitest";

const setTempo = vi.fn();
const addEvent = vi.fn();
const dataUri = vi.fn(() => "data:audio/midi;base64,test");

vi.mock("midi-writer-js", () => {
  class MockTrack {
    setTempo = setTempo;
    addEvent = addEvent;
  }

  class MockNoteEvent {
    type = "note";
    pitch: string;
    velocity: number;
    tick: number;
    duration: string;

    constructor(options: {
      pitch: string;
      velocity: number;
      tick: number;
      duration: string;
    }) {
      this.pitch = options.pitch;
      this.velocity = options.velocity;
      this.tick = options.tick;
      this.duration = options.duration;
    }
  }

  class MockWriter {
    dataUri = dataUri;
  }

  return {
    default: {
      Track: MockTrack,
      NoteEvent: MockNoteEvent,
      Writer: MockWriter,
    },
  };
});

import {
  millisecondsToTicks,
  startRecording,
  noteOn,
  noteOff,
  stopRecording,
  downloadMidi,
} from "../../frontend/src/app/midi/midiUtils";

describe("millisecondsToTicks", () => {
  it("converts 500 ms at 120 BPM to 128 ticks", () => {
    expect(millisecondsToTicks(500, 120)).toBe(128);
  });
});

describe("startRecording", () => {
  it("sets the track tempo to the given BPM", () => {
    startRecording(120);

    expect(setTempo).toHaveBeenCalledWith(120);
  });
});

describe("noteOn and noteOff", () => {
  it("creates a note event using the note start time and duration", () => {
    vi.spyOn(performance, "now")
      .mockReturnValueOnce(1000)
      .mockReturnValueOnce(1500)
      .mockReturnValueOnce(2000);

    startRecording(120);

    addEvent.mockClear();

    noteOn("C4", 80);
    noteOff("C4");

    expect(addEvent).toHaveBeenCalledWith({
      type: "note",
      pitch: "C4",
      velocity: 80,
      tick: 128,
      duration: "T128",
    });
  });

  it("ignores repeated note-on calls for the same pitch", () => {
    vi.spyOn(performance, "now")
      .mockReturnValueOnce(1000)
      .mockReturnValueOnce(1500)
      .mockReturnValueOnce(2000);

    startRecording(120);

    addEvent.mockClear();

    noteOn("C4", 80);
    noteOn("C4", 50);
    noteOff("C4");

    expect(addEvent).toHaveBeenCalledWith({
      type: "note",
      pitch: "C4",
      velocity: 80,
      tick: 128,
      duration: "T128",
    });

    expect(addEvent).toHaveBeenCalledTimes(1);
  });
});

describe("stopRecording", () => {
  it("finishes every note that is still being held", () => {
    vi.spyOn(performance, "now")
      .mockReturnValueOnce(3000)
      .mockReturnValueOnce(3000)
      .mockReturnValueOnce(3000)
      .mockReturnValueOnce(3000)
      .mockReturnValueOnce(3500);

    startRecording(120);

    noteOn("C4", 80);
    noteOn("D4", 80);
    noteOn("E4", 80);

    addEvent.mockClear();

    stopRecording();

    expect(addEvent).toHaveBeenCalledTimes(3);

    expect(addEvent).toHaveBeenCalledWith({
      type: "note",
      pitch: "C4",
      velocity: 80,
      tick: 0,
      duration: "T128",
    });

    expect(addEvent).toHaveBeenCalledWith({
      type: "note",
      pitch: "D4",
      velocity: 80,
      tick: 0,
      duration: "T128",
    });

    expect(addEvent).toHaveBeenCalledWith({
      type: "note",
      pitch: "E4",
      velocity: 80,
      tick: 0,
      duration: "T128",
    });
  });
});

describe("chords", () => {
  it("records multiple simultaneous notes independently", () => {
    vi.spyOn(performance, "now")
      .mockReturnValueOnce(4000)
      .mockReturnValueOnce(4500)
      .mockReturnValueOnce(4500)
      .mockReturnValueOnce(4500)
      .mockReturnValueOnce(5000)
      .mockReturnValueOnce(5000)
      .mockReturnValueOnce(5000);

    startRecording(120);

    noteOn("C4", 80);
    noteOn("E4", 80);
    noteOn("G4", 80);

    addEvent.mockClear();

    noteOff("C4");
    noteOff("E4");
    noteOff("G4");

    expect(addEvent).toHaveBeenCalledTimes(3);

    expect(addEvent).toHaveBeenCalledWith({
      type: "note",
      pitch: "C4",
      velocity: 80,
      tick: 128,
      duration: "T128",
    });

    expect(addEvent).toHaveBeenCalledWith({
      type: "note",
      pitch: "E4",
      velocity: 80,
      tick: 128,
      duration: "T128",
    });

    expect(addEvent).toHaveBeenCalledWith({
      type: "note",
      pitch: "G4",
      velocity: 80,
      tick: 128,
      duration: "T128",
    });
  });
});

describe("downloadMidi", () => {
  it("creates a MIDI download", () => {
    startRecording(120);

    const click = vi.fn();

    const link = {
      href: "",
      download: "",
      click,
    };

    vi.stubGlobal("document", {
      createElement: vi.fn(() => link),
    });

    downloadMidi();

    expect(dataUri).toHaveBeenCalled();
    expect(link.href).toBe("data:audio/midi;base64,test");
    expect(link.download).toBe("recording.mid");
    expect(click).toHaveBeenCalled();

    vi.unstubAllGlobals();
  });
});