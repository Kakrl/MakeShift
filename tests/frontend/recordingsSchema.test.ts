import { describe, expect, it } from "vitest";
import type { RecordedNote } from "../../frontend/src/app/midi/midiUtils";
import { pitchToMidi } from "../../frontend/src/cv/noteMap";
import {
  RECORDING_LIMITS,
  recordingDurationMs,
  validateUpload,
} from "../../frontend/src/lib/recordings";

const note = { pitch: "C4", velocity: 80, startMs: 0, durationMs: 250 };
const valid = () => ({
  title: "First take",
  authorName: "Jadden",
  deviceId: "device-123",
  bpm: 120,
  notes: [note, { pitch: "F#3", velocity: 1, startMs: 300, durationMs: 0 }],
});

function issueFields(body: unknown): string[] {
  const result = validateUpload(body);
  if (result.ok) throw new Error("expected validation to fail");
  return result.issues.map((issue) => issue.field);
}

describe("validateUpload", () => {
  it("accepts a valid upload and returns a normalized copy", () => {
    const body = {
      ...valid(),
      title: "  First take  ",
      extra: "dropped",
      notes: [{ ...note, id: "dropped" }],
    };
    const result = validateUpload(body);
    expect(result).toEqual({
      ok: true,
      value: {
        title: "First take",
        authorName: "Jadden",
        deviceId: "device-123",
        bpm: 120,
        notes: [note],
      },
    });
    if (result.ok) expect(result.value.notes[0]).not.toBe(body.notes[0]);
  });

  it("accepts every boundary value", () => {
    const { titleLength, authorNameLength, deviceIdLength, bpm, velocity, maxNotes, maxDurationMs } =
      RECORDING_LIMITS;
    const notes: RecordedNote[] = Array.from({ length: maxNotes }, () => ({
      pitch: "G9",
      velocity: velocity.max,
      startMs: maxDurationMs - 1,
      durationMs: 1,
    }));
    notes[0] = { pitch: "C-1", velocity: velocity.min, startMs: 0, durationMs: 0 };
    for (const body of [
      { ...valid(), title: "x".repeat(titleLength.max), bpm: bpm.min, notes },
      {
        ...valid(),
        authorName: "x".repeat(authorNameLength.max),
        deviceId: "x".repeat(deviceIdLength.max),
        bpm: bpm.max,
      },
    ])
      expect(validateUpload(body).ok).toBe(true);
  });

  it("counts code points like Postgres char_length", () => {
    const max = RECORDING_LIMITS.titleLength.max;
    expect(validateUpload({ ...valid(), title: "🎹".repeat(max) }).ok).toBe(true);
    expect(issueFields({ ...valid(), title: "🎹".repeat(max + 1) })).toEqual(["title"]);
  });

  it.each([
    ["title", { title: "   " }],
    ["title", { title: "x".repeat(101) }],
    ["title", { title: 5 }],
    ["authorName", { authorName: "" }],
    ["authorName", { authorName: "x".repeat(51) }],
    ["deviceId", { deviceId: undefined }],
    ["deviceId", { deviceId: "x".repeat(129) }],
    ["bpm", { bpm: 19 }],
    ["bpm", { bpm: 401 }],
    ["bpm", { bpm: 120.5 }],
    ["bpm", { bpm: "120" }],
    ["notes", { notes: [] }],
    ["notes", { notes: "C4" }],
    ["notes", { notes: Array(RECORDING_LIMITS.maxNotes + 1).fill(note) }],
  ])("rejects an invalid %s", (field, change) => {
    expect(issueFields({ ...valid(), ...change })).toEqual([field]);
  });

  it.each([
    ["not an object", null, /object/],
    ["a malformed pitch", { ...note, pitch: "H4" }, /pitch/],
    ["a pitch above MIDI 127", { ...note, pitch: "G#9" }, /pitch/],
    ["a pitch below MIDI 0", { ...note, pitch: "Cb-1" }, /pitch/],
    ["velocity 0", { ...note, velocity: 0 }, /velocity/],
    ["velocity above 100", { ...note, velocity: 101 }, /velocity/],
    ["a fractional velocity", { ...note, velocity: 50.5 }, /velocity/],
    ["a negative start", { ...note, startMs: -1 }, /startMs/],
    ["a non-finite start", { ...note, startMs: Number.POSITIVE_INFINITY }, /startMs/],
    ["a negative duration", { ...note, durationMs: -1 }, /durationMs/],
    [
      "a note ending after the duration cap",
      { ...note, startMs: RECORDING_LIMITS.maxDurationMs - 10, durationMs: 11 },
      /durationMs/,
    ],
  ])("rejects a note with %s", (_label, bad, message) => {
    const result = validateUpload({ ...valid(), notes: [note, bad, bad] });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    // Only the first bad note is reported, so errors stay bounded.
    expect(result.issues).toHaveLength(1);
    expect(result.issues[0].field).toBe("notes[1]");
    expect(result.issues[0].message).toMatch(message);
  });

  it("reports every invalid top-level field together", () => {
    expect(
      issueFields({ title: "", authorName: "", deviceId: "", bpm: 0, notes: null }),
    ).toEqual(["title", "authorName", "deviceId", "bpm", "notes"]);
  });

  it.each([null, [], "body", 42])("rejects a non-object body %j", (body) => {
    expect(issueFields(body)).toEqual(["body"]);
  });
});

describe("recordingDurationMs", () => {
  it("is the latest note end, not the last note's end", () => {
    expect(recordingDurationMs([])).toBe(0);
    expect(
      recordingDurationMs([
        { ...note, startMs: 0, durationMs: 1000 },
        { ...note, startMs: 200, durationMs: 100 },
      ]),
    ).toBe(1000);
  });
});

describe("pitchToMidi", () => {
  it.each([
    ["C-1", 0],
    ["C4", 60],
    ["F#3", 54],
    ["Bb2", 46],
    ["G9", 127],
  ])("parses %s as %i", (pitch, midi) => {
    expect(pitchToMidi(pitch)).toBe(midi);
  });

  it.each(["", "c4", "C", "C##4", "G#9", "Cb-1", "C4 "])(
    "rejects %j",
    (pitch) => {
      expect(pitchToMidi(pitch)).toBeNull();
    },
  );
});
