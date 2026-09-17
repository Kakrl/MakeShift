import { describe, expect, it, vi } from "vitest";

const setTempo = vi.fn();
const addEvent = vi.fn();
const dataUri = vi.fn(() => "data:audio/midi;base64,test");

vi.mock("midi-writer-js", () => {
  class MockTrack {
    setTempo = setTempo;
    addEvent = addEvent;
  }

  class MockNoteOnEvent {
    type = "noteOn";
    pitch: string;
    velocity: number;
    tick: number;

    constructor(options: {
      pitch: string;
      velocity: number;
      tick: number;
    }) {
      this.pitch = options.pitch;
      this.velocity = options.velocity;
      this.tick = options.tick;
    }
  }

  class MockNoteOffEvent {
    type = "noteOff";
    pitch: string;
    tick: number;

    constructor(options: {
      pitch: string;
      tick: number;
    }) {
      this.pitch = options.pitch;
      this.tick = options.tick;
    }
  }

  class MockWriter {
    dataUri = dataUri;
  }

  return {
    default: {
      Track: MockTrack,
      NoteOnEvent: MockNoteOnEvent,
      NoteOffEvent: MockNoteOffEvent,
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

describe("noteOn", () => {
  it("adds a note-on event to the track", () => {
    vi.spyOn(performance, "now")
      .mockReturnValueOnce(1000)
      .mockReturnValueOnce(1500);

    startRecording(120);
    noteOn("C4", 80);

    expect(addEvent).toHaveBeenCalledWith({
      type: "noteOn",
      pitch: "C4",
      velocity: 80,
      tick: 128,
    });
  });
});

describe("noteOff", () => {
  it("adds a note-off event to the track", () => {
    vi.spyOn(performance, "now")
      .mockReturnValueOnce(2000)
      .mockReturnValueOnce(2500);

    startRecording(120);
    noteOff("C4");

    expect(addEvent).toHaveBeenCalledWith({
      type: "noteOff",
      pitch: "C4",
      tick: 128,
    });
  });
});

describe("stopRecording", () => {
  it("adds a note-off event for every supplied pitch", () => {
    vi.spyOn(performance, "now")
      .mockReturnValueOnce(3000)
      .mockReturnValueOnce(3500);

    startRecording(120);

    addEvent.mockClear();

    stopRecording(["C4", "D4", "E4"]);

    expect(addEvent).toHaveBeenCalledTimes(3);

    expect(addEvent).toHaveBeenCalledWith({
      type: "noteOff",
      pitch: "C4",
      tick: 128,
    });

    expect(addEvent).toHaveBeenCalledWith({
      type: "noteOff",
      pitch: "D4",
      tick: 128,
    });

    expect(addEvent).toHaveBeenCalledWith({
      type: "noteOff",
      pitch: "E4",
      tick: 128,
    });
  });
});

describe("chords", () => {
  it("adds multiple note-on events for simultaneous notes", () => {
    vi.spyOn(performance, "now")
      .mockReturnValueOnce(4000)
      .mockReturnValue(4500);

    startRecording(120);

    addEvent.mockClear();

    noteOn("C4", 80);
    noteOn("E4", 80);
    noteOn("G4", 80);

    expect(addEvent).toHaveBeenCalledTimes(3);

    expect(addEvent).toHaveBeenCalledWith({
      type: "noteOn",
      pitch: "C4",
      velocity: 80,
      tick: 128,
    });

    expect(addEvent).toHaveBeenCalledWith({
      type: "noteOn",
      pitch: "E4",
      velocity: 80,
      tick: 128,
    });

    expect(addEvent).toHaveBeenCalledWith({
      type: "noteOn",
      pitch: "G4",
      velocity: 80,
      tick: 128,
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