import { isMeter, restoreMeter } from "../../lib/meter";
// Mock shared recordings (#203), with the same #117 shapes as the real
// recordings API. Append `?mock=1` to a page URL to use these fixtures
// instead of the API, or `?mock=empty` / `?mock=error` for those states.
// Shares made in the browser are kept in localStorage so a copied link
// opens in a new tab.
import type { RecordedNote, Recording } from "../midi/midiUtils";
import {
  RECORDING_LIST_PAGE_SIZE,
  recordingDurationMs,
  validateUpload,
  type RecordingListResponse,
  type RecordingSummary,
  type SharedRecording,
  type UploadRecordingRequest,
  type UploadRecordingResponse,
} from "../../lib/recordings";
import { readStored, writeStored, type StorageAccess } from "../../lib/storage";
import { ShareNotFoundError, type ShareStore } from "./shareApi";

const STORAGE_NAME = "mock-shared-recordings";
const STORAGE_VERSION = 1;
const LATENCY_MS = 350;

export type MockMode = "normal" | "empty" | "error";

/** Reads `?mock=` from the current URL; null means use the real API. */
export function mockMode(): MockMode | null {
  if (typeof window === "undefined") return null;
  const value = new URLSearchParams(window.location.search).get("mock");
  if (value === null) return null;
  return value === "empty" || value === "error" ? value : "normal";
}

/**
 * One token per beat: a note (`C4`), a chord (`C3+E3+G3`), `-` to hold the
 * previous token another beat, or `.` for a rest. Each string is one voice
 * (melody, left-hand chords); voices play together from beat zero.
 */
function song(bpm: number, ...voices: string[]): RecordedNote[] {
  const beatMs = 60000 / bpm;
  const notes: RecordedNote[] = [];
  for (const [voice, tune] of voices.entries()) {
    // Lower voices are chords; play them a little softer than the melody.
    const base = voice === 0 ? 78 : 58;
    let held: RecordedNote[] = [];
    tune.split(/\s+/).forEach((token, beat) => {
      if (token === "-") {
        for (const note of held) note.durationMs += beatMs;
        return;
      }
      held = token === "." ? [] : token.split("+").map((pitch) => ({
        pitch,
        velocity: base + ((beat * 7) % 15),
        startMs: Math.round(beat * beatMs),
        durationMs: Math.round(beatMs * 0.9),
      }));
      notes.push(...held);
    });
  }
  return notes.sort((a, b) => a.startMs - b.startMs);
}

// Every example must be playable on today's sheets: white keys only (black
// keys are #25) within the largest layout, three octaves from C3 to C6.
// Chords stay in the C3 octave so they never share a key with the melody.
export const PLAYABLE_RANGE = { lowMidi: 48, highMidi: 84 } as const;
const C = "C3+E3+G3";
const F = "C3+F3+A3";
const G = "D3+G3+B3";
const AM = "C3+E3+A3";
const EM = "E3+G3+B3";

const TWINKLE = "C4 C4 G4 G4 A4 A4 G4 - F4 F4 E4 E4 D4 D4 C4 -";
const TWINKLE_CHORDS = `${C} - ${C} - ${F} - ${C} - ${F} - ${C} - ${G} - ${C} -`;
const ODE = "E4 E4 F4 G4 G4 F4 E4 D4 C4 C4 D4 E4 E4 - D4 D4 -";
const ODE_CHORDS = `${C} - - - ${G} - - - ${C} - - - ${G} - - - ${C}`;
const MARY = "E4 D4 C4 D4 E4 E4 E4 - D4 D4 D4 - E4 G4 G4 -";
const SCALE = "C4 D4 E4 F4 G4 A4 B4 C5 - B4 A4 G4 F4 E4 D4 C4 -";
const JINGLE = "E4 E4 E4 - E4 E4 E4 - E4 G4 C4 D4 E4 - - -";
const JINGLE_CHORDS = `${C} - - - ${C} - - - ${C} - - - ${C} - - -`;
// Pachelbel's Canon moved to C major (no black keys), two beats per chord.
const CANON = "E5 - D5 - C5 - B4 - A4 - G4 - A4 - B4 -";
const CANON_CHORDS = `${C} - ${G} - ${AM} - ${EM} - ${F} - ${C} - ${F} - ${G} -`;
const PRACTICE = `${C} - ${F} - ${G} - ${C} - . ${C} ${F} ${G} ${C} - - -`;

const FIXTURES: { title: string; authorName: string; bpm: number; voices: string[] }[] = [
  { title: "Canon in C (both hands!)", authorName: "Ms. Rivera", bpm: 72, voices: [CANON, CANON_CHORDS] },
  { title: "Twinkle on paper", authorName: "Maya", bpm: 100, voices: [TWINKLE] },
  { title: "Ode to Joy with chords", authorName: "Leo", bpm: 120, voices: [ODE, ODE_CHORDS] },
  { title: "Mary's little lamb", authorName: "Priya", bpm: 110, voices: [MARY] },
  { title: "Jingle Bells, left hand too", authorName: "Kai", bpm: 132, voices: [JINGLE, JINGLE_CHORDS] },
  { title: "Up and down the scale", authorName: "Sam", bpm: 140, voices: [SCALE] },
  { title: "Twinkle with chords", authorName: "Maya", bpm: 96, voices: [TWINKLE, TWINKLE_CHORDS] },
  { title: "C, F, G chord practice", authorName: "Grandpa Joe", bpm: 90, voices: [PRACTICE] },
];

// Fixed dates so the list order and labels never change between renders.
const FIXTURE_RECORDINGS: SharedRecording[] = FIXTURES.map((fixture, index) => {
  const notes = song(fixture.bpm, ...fixture.voices);
  return {
    id: `demo-${index + 1}`,
    title: fixture.title,
    authorName: fixture.authorName,
    bpm: fixture.bpm,
    durationMs: recordingDurationMs(notes),
    noteCount: notes.length,
    createdAt: new Date(Date.UTC(2026, 9, 12 - index, 18 - index, 15)).toISOString(),
    notes,
  };
});

type StoredShare = SharedRecording & { deleteToken: string };

function isStoredShares(value: unknown): value is StoredShare[] {
  return (
    Array.isArray(value) &&
    value.every(
      (entry) =>
        typeof entry === "object" &&
        entry !== null &&
        typeof entry.id === "string" &&
        typeof entry.deleteToken === "string" &&
        (entry.meter === undefined || isMeter(entry.meter)) &&
        Array.isArray(entry.notes),
    )
  );
}

function withoutToken(share: StoredShare): SharedRecording {
  const recording: SharedRecording & { deleteToken?: string } = { ...share };
  delete recording.deleteToken;
  return { ...recording, meter: restoreMeter(recording.meter) };
}

function summarize(recording: SharedRecording): RecordingSummary {
  const { id, title, authorName, bpm, durationMs, noteCount, createdAt } = recording;
  return { id, title, authorName, bpm, meter: restoreMeter(recording.meter), durationMs, noteCount, createdAt };
}

export function createMockShareStore(
  storage?: StorageAccess,
  latencyMs = LATENCY_MS,
  mode: () => MockMode = () => mockMode() ?? "normal",
): ShareStore {
  const loadShares = () =>
    readStored<StoredShare[]>(STORAGE_NAME, STORAGE_VERSION, [], isStoredShares, storage);

  async function respond<T>(value: () => T): Promise<T> {
    if (latencyMs > 0) await new Promise((resolve) => setTimeout(resolve, latencyMs));
    if (mode() === "error") throw new Error("Shared recordings could not be loaded.");
    return value();
  }

  function all(): SharedRecording[] {
    if (mode() === "empty") return [];
    const shares = loadShares().map(withoutToken);
    return [...shares, ...FIXTURE_RECORDINGS].sort((a, b) =>
      b.createdAt.localeCompare(a.createdAt),
    );
  }

  return {
    /** `GET /api/recordings`. The cursor is the next offset. */
    list(cursor: string | null = null): Promise<RecordingListResponse> {
      return respond(() => {
        const recordings = all();
        const start = cursor ? Number(cursor) : 0;
        const end = start + RECORDING_LIST_PAGE_SIZE;
        const page = recordings.slice(start, end).map(summarize);
        return {
          recordings: page,
          nextCursor: end < recordings.length ? String(end) : null,
        };
      });
    },

    /** `GET /api/recordings/:id`; null stands in for a 404. */
    get(id: string): Promise<SharedRecording | null> {
      return respond(() => all().find((recording) => recording.id === id) ?? null);
    },

    /** `POST /api/recordings`. */
    upload(request: UploadRecordingRequest): Promise<UploadRecordingResponse> {
      return respond(() => {
        const result = validateUpload(request);
        if (!result.ok) throw new Error(result.issues[0].message);
        const upload = result.value;
        const share: StoredShare = {
          title: upload.title,
          authorName: upload.authorName,
          bpm: upload.bpm,
          meter: restoreMeter(upload.meter),
          notes: upload.notes,
          id: crypto.randomUUID().slice(0, 8),
          durationMs: recordingDurationMs(upload.notes),
          noteCount: upload.notes.length,
          createdAt: new Date().toISOString(),
          deleteToken: crypto.randomUUID(),
        };
        const saved = writeStored(
          STORAGE_NAME,
          STORAGE_VERSION,
          [share, ...loadShares()],
          storage,
        );
        if (!saved.ok) throw new Error("The mock share could not be saved.");
        return { id: share.id, deleteToken: share.deleteToken };
      });
    },

    /** `DELETE /api/recordings/:id`. */
    remove(id: string, deleteToken: string): Promise<{ deleted: true }> {
      return respond(() => {
        const shares = loadShares();
        const kept = shares.filter(
          (share) => !(share.id === id && share.deleteToken === deleteToken),
        );
        if (kept.length === shares.length) throw new ShareNotFoundError();
        writeStored(STORAGE_NAME, STORAGE_VERSION, kept, storage);
        return { deleted: true as const };
      });
    },
  };
}

/**
 * Dev-only stand-in for a just-finished take (`?dev=1&demo=take`), so the
 * post-recording share prompt can be seen without a sheet or camera. The id
 * is fixed, so reloading does not pile up copies in the library.
 */
export function demoTake(): Recording {
  return {
    id: "demo-take",
    name: "My Twinkle take",
    bpm: 100,
    createdAt: new Date().toISOString(),
    notes: song(100, TWINKLE, TWINKLE_CHORDS),
  };
}
