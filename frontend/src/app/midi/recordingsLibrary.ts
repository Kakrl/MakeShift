import {
  readStored,
  writeStored,
  type StorageAccess,
  type WriteResult,
} from "../../lib/storage";
import type { Recording } from "./midiUtils";

const STORAGE_NAME = "recordings";
const STORAGE_VERSION = 1;
export type LibraryEntry = { recording: Recording; saved: boolean };

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function isNonnegative(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value) && value >= 0;
}

function isPitch(value: unknown): value is string {
  if (typeof value !== "string") return false;
  const match = /^([A-G])([#b]?)(-?\d+)$/.exec(value);
  if (!match) return false;
  const offsets: Record<string, number> = {
    C: 0,
    D: 2,
    E: 4,
    F: 5,
    G: 7,
    A: 9,
    B: 11,
  };
  const accidental = match[2] === "#" ? 1 : match[2] === "b" ? -1 : 0;
  const midi = (Number(match[3]) + 1) * 12 + offsets[match[1]] + accidental;
  return Number.isInteger(midi) && midi >= 0 && midi <= 127;
}

function isRecording(value: unknown): value is Recording {
  return (
    isObject(value) &&
    typeof value.id === "string" &&
    value.id.trim().length > 0 &&
    typeof value.name === "string" &&
    value.name.trim().length > 0 &&
    typeof value.bpm === "number" &&
    Number.isFinite(value.bpm) &&
    value.bpm > 0 &&
    typeof value.createdAt === "string" &&
    Number.isFinite(Date.parse(value.createdAt)) &&
    Array.isArray(value.notes) &&
    value.notes.every(
      (note) =>
        isObject(note) &&
        isPitch(note.pitch) &&
        isNonnegative(note.velocity) &&
        note.velocity <= 100 &&
        isNonnegative(note.startMs) &&
        isNonnegative(note.durationMs) &&
        Number.isFinite(note.startMs + note.durationMs),
    )
  );
}

function isLibrary(value: unknown): value is Recording[] {
  return (
    Array.isArray(value) &&
    value.every(isRecording) &&
    new Set(value.map((take) => take.id)).size === value.length
  );
}

function copyRecording(recording: Recording): Recording {
  return { ...recording, notes: recording.notes.map((note) => ({ ...note })) };
}

export function loadRecordings(storage?: StorageAccess): Recording[] {
  return readStored(STORAGE_NAME, STORAGE_VERSION, [], isLibrary, storage);
}

export function saveRecordings(
  recordings: Recording[],
  storage?: StorageAccess,
): WriteResult {
  if (!isLibrary(recordings)) return { ok: false, reason: "error" };
  return writeStored(STORAGE_NAME, STORAGE_VERSION, recordings, storage);
}

// Owns the current list so UI callbacks do not need duplicate state/ref lists.
// Storage writes occur only for completed takes or explicit library actions.
export function createRecordingsLibrary(storage?: StorageAccess) {
  let entries: LibraryEntry[] = loadRecordings(storage).map((recording) => ({
    recording,
    saved: true,
  }));

  function list(): LibraryEntry[] {
    return entries.map((entry) => ({
      ...entry,
      recording: copyRecording(entry.recording),
    }));
  }

  function saveLibraryChanges(next: LibraryEntry[]): WriteResult {
    const result = saveRecordings(
      next.map((entry) => entry.recording),
      storage,
    );
    if (result.ok)
      entries = next.map((entry) => ({
        recording: copyRecording(entry.recording),
        saved: true,
      }));
    return result;
  }

  function completeTake(take: Recording): WriteResult {
    if (!isRecording(take)) return { ok: false, reason: "error" };
    const existing = entries.find((entry) => entry.recording.id === take.id);
    if (existing) return existing.saved ? { ok: true } : retrySaving();
    const next = [{ recording: copyRecording(take), saved: false }, ...entries];
    const result = saveLibraryChanges(next);
    // Preserve a failed save in memory for download/retry; never claim durability.
    if (!result.ok) entries = next;
    return result;
  }

  function renameRecording(id: string, rawName: string): WriteResult {
    const name = rawName.trim();
    if (!name || !entries.some((entry) => entry.recording.id === id))
      return { ok: false, reason: "error" };
    return saveLibraryChanges(
      entries.map((entry) =>
        entry.recording.id === id
          ? { ...entry, recording: { ...entry.recording, name } }
          : entry,
      ),
    );
  }

  function deleteRecording(id: string): WriteResult {
    const target = entries.find((entry) => entry.recording.id === id);
    if (!target) return { ok: false, reason: "error" };
    const next = entries.filter((entry) => entry.recording.id !== id);
    if (!target.saved) {
      entries = next;
      return { ok: true };
    }
    // Persist only already-saved takes first: a large unsaved take must not
    // prevent deleting an older take to free space for a later retry.
    const result = saveRecordings(
      next.filter((entry) => entry.saved).map((entry) => entry.recording),
      storage,
    );
    if (result.ok) entries = next;
    return result;
  }

  function retrySaving(): WriteResult {
    return saveLibraryChanges(entries);
  }

  return { list, completeTake, renameRecording, deleteRecording, retrySaving };
}
