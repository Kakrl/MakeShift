// Shared recordings API contract (#117). Server routes and client code both
// import these types and `validateUpload`, so an upload the client accepts is
// exactly one the server accepts. Limits mirror the `recordings` table checks
// in supabase/migrations; note and duration caps are API-only.
import type { RecordedNote } from "../app/midi/midiUtils";
import { pitchToMidi } from "../cv/noteMap";

export const RECORDING_LIMITS = {
  titleLength: { min: 1, max: 100 },
  authorNameLength: { min: 1, max: 50 },
  deviceIdLength: { min: 1, max: 128 },
  bpm: { min: 20, max: 400 },
  // Recorder velocities are 1-100 (see pianoConsumers.ts).
  velocity: { min: 1, max: 100 },
  maxNotes: 10_000,
  maxDurationMs: 30 * 60 * 1000,
} as const;

/** One row in `GET /api/recordings`; omits the note list. */
export type RecordingSummary = {
  id: string;
  title: string;
  authorName: string;
  bpm: number;
  durationMs: number;
  noteCount: number;
  createdAt: string;
};

/** `GET /api/recordings/:id`. */
export type SharedRecording = RecordingSummary & { notes: RecordedNote[] };

/** `GET /api/recordings`, newest first. Pass `nextCursor` back to get the next page; null on the last page. */
export type RecordingListResponse = {
  recordings: RecordingSummary[];
  nextCursor: string | null;
};

/** `POST /api/recordings` body. The server derives duration and note count from `notes`. */
export type UploadRecordingRequest = {
  title: string;
  authorName: string;
  deviceId: string;
  bpm: number;
  notes: RecordedNote[];
};

/** Returned once on upload; only a hash of `deleteToken` is stored. */
export type UploadRecordingResponse = { id: string; deleteToken: string };

/** `DELETE /api/recordings/:id` body. */
export type DeleteRecordingRequest = { deleteToken: string };
export type DeleteRecordingResponse = { deleted: true };

export type ValidationIssue = { field: string; message: string };

/** Error body for any non-2xx response; `issues` is set for 400 validation failures. */
export type RecordingApiError = { error: string; issues?: ValidationIssue[] };

export type UploadValidation =
  | { ok: true; value: UploadRecordingRequest }
  | { ok: false; issues: ValidationIssue[] };

/** End of the last note, in recording milliseconds. */
export function recordingDurationMs(notes: readonly RecordedNote[]): number {
  return notes.reduce(
    (end, note) => Math.max(end, note.startMs + note.durationMs),
    0,
  );
}

// Counts code points, as Postgres char_length does, not UTF-16 units.
const charLength = (value: string) => [...value].length;

function text(
  issues: ValidationIssue[],
  body: Record<string, unknown>,
  field: "title" | "authorName" | "deviceId",
  limits: { min: number; max: number },
): string {
  const value = body[field];
  if (typeof value !== "string") {
    issues.push({ field, message: `${field} must be a string` });
    return "";
  }
  const trimmed = value.trim();
  const length = charLength(trimmed);
  if (length < limits.min || length > limits.max)
    issues.push({
      field,
      message: `${field} must be ${limits.min}-${limits.max} characters`,
    });
  return trimmed;
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const inRange = (value: unknown, min: number, max: number): value is number =>
  typeof value === "number" && Number.isFinite(value) && value >= min && value <= max;

function noteIssue(note: unknown): string | null {
  if (!isRecord(note)) return "must be an object";
  const { pitch, velocity, startMs, durationMs } = note;
  if (typeof pitch !== "string" || pitchToMidi(pitch) === null)
    return "pitch must be a note name such as C4 within MIDI 0-127";
  const { min, max } = RECORDING_LIMITS.velocity;
  if (!Number.isInteger(velocity) || !inRange(velocity, min, max))
    return `velocity must be an integer ${min}-${max}`;
  const maxMs = RECORDING_LIMITS.maxDurationMs;
  if (!inRange(startMs, 0, maxMs))
    return `startMs must be 0-${maxMs}`;
  if (!inRange(durationMs, 0, maxMs - startMs))
    return `durationMs must be non-negative and end by ${maxMs} ms`;
  return null;
}

/**
 * Validates an untrusted upload body. Returns a normalized copy (trimmed text,
 * known note fields only) or every top-level issue plus the first bad note.
 */
export function validateUpload(body: unknown): UploadValidation {
  if (!isRecord(body))
    return { ok: false, issues: [{ field: "body", message: "body must be an object" }] };

  const issues: ValidationIssue[] = [];
  const title = text(issues, body, "title", RECORDING_LIMITS.titleLength);
  const authorName = text(issues, body, "authorName", RECORDING_LIMITS.authorNameLength);
  const deviceId = text(issues, body, "deviceId", RECORDING_LIMITS.deviceIdLength);

  const { bpm } = body;
  const bpmLimits = RECORDING_LIMITS.bpm;
  if (!Number.isInteger(bpm) || !inRange(bpm, bpmLimits.min, bpmLimits.max))
    issues.push({
      field: "bpm",
      message: `bpm must be an integer ${bpmLimits.min}-${bpmLimits.max}`,
    });

  const { notes } = body;
  if (!Array.isArray(notes)) {
    issues.push({ field: "notes", message: "notes must be an array" });
  } else if (notes.length === 0 || notes.length > RECORDING_LIMITS.maxNotes) {
    issues.push({
      field: "notes",
      message: `notes must contain 1-${RECORDING_LIMITS.maxNotes} notes`,
    });
  } else {
    // Report only the first bad note so a large invalid upload gives a bounded error.
    for (const [index, note] of notes.entries()) {
      const message = noteIssue(note);
      if (message) {
        issues.push({ field: `notes[${index}]`, message });
        break;
      }
    }
  }

  if (issues.length > 0) return { ok: false, issues };
  return {
    ok: true,
    value: {
      title,
      authorName,
      deviceId,
      bpm: bpm as number,
      notes: (notes as RecordedNote[]).map(
        ({ pitch, velocity, startMs, durationMs }) => ({
          pitch,
          velocity,
          startMs,
          durationMs,
        }),
      ),
    },
  };
}
