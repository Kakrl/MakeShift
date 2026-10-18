// Mock shared recordings (#203). Stands in for the recordings API (#119,
// #122, #128) with the same #117 request and response shapes, so wiring the
// real routes only replaces this module. Fixtures are fixed; shares made in
// the browser are kept in localStorage so a copied link opens in a new tab.
// Append `?mock=empty` or `?mock=error` to a page URL to see those states.
import type { RecordedNote, Recording } from "../midi/midiUtils";
import {
  recordingDurationMs,
  validateUpload,
  type RecordingListResponse,
  type RecordingSummary,
  type SharedRecording,
  type UploadRecordingRequest,
  type UploadRecordingResponse,
} from "../../lib/recordings";
import { readStored, writeStored, type StorageAccess } from "../../lib/storage";
import { loadOrCreateProfile, saveProfile } from "../../lib/deviceProfile";

export const PAGE_SIZE = 6;
const STORAGE_NAME = "mock-shared-recordings";
const STORAGE_VERSION = 1;
const LATENCY_MS = 350;

export type MockMode = "normal" | "empty" | "error";

/** Reads `?mock=` from the current URL. */
export function mockMode(): MockMode {
  if (typeof window === "undefined") return "normal";
  const value = new URLSearchParams(window.location.search).get("mock");
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
        Array.isArray(entry.notes),
    )
  );
}

function withoutToken(share: StoredShare): SharedRecording {
  const recording: SharedRecording & { deleteToken?: string } = { ...share };
  delete recording.deleteToken;
  return recording;
}

function summarize(recording: SharedRecording): RecordingSummary {
  const { id, title, authorName, bpm, durationMs, noteCount, createdAt } = recording;
  return { id, title, authorName, bpm, durationMs, noteCount, createdAt };
}

export function createMockShareStore(
  storage?: StorageAccess,
  latencyMs = LATENCY_MS,
  mode: () => MockMode = mockMode,
) {
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
        const end = start + PAGE_SIZE;
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

/** The share is already gone (a 404), so there is nothing left to stop. */
export class ShareNotFoundError extends Error {
  constructor() {
    super("Recording not found.");
    this.name = "ShareNotFoundError";
  }
}

export const mockShareStore = createMockShareStore();

// Which local takes are shared. #133 keeps the returned id and delete token
// next to the take, so stopping a share works after a reload.
const TAKE_SHARES_NAME = "take-shares";
const TAKE_SHARES_VERSION = 1;
export type TakeShare = UploadRecordingResponse;
type TakeShares = Record<string, TakeShare>;

function isTakeShares(value: unknown): value is TakeShares {
  return (
    typeof value === "object" &&
    value !== null &&
    !Array.isArray(value) &&
    Object.values(value).every(
      (share) =>
        typeof share === "object" &&
        share !== null &&
        typeof share.id === "string" &&
        typeof share.deleteToken === "string",
    )
  );
}

export function loadTakeShares(storage?: StorageAccess): TakeShares {
  return readStored(TAKE_SHARES_NAME, TAKE_SHARES_VERSION, {}, isTakeShares, storage);
}

export function saveTakeShare(
  takeId: string,
  share: TakeShare | null,
  storage?: StorageAccess,
): TakeShares {
  const next = { ...loadTakeShares(storage) };
  if (share) next[takeId] = share;
  else delete next[takeId];
  writeStored(TAKE_SHARES_NAME, TAKE_SHARES_VERSION, next, storage);
  return next;
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

/** The sharing name from the device profile (#125), shown in the sidebar too. */
export const loadShareName = () => loadOrCreateProfile().profile.displayName;

/**
 * Uploads a local take under a title and display name, from this device's
 * profile ID, and keeps the name as the profile's sharing name.
 */
export async function uploadTake(
  take: Recording,
  title: string,
  authorName: string,
): Promise<TakeShare> {
  const share = await mockShareStore.upload({
    title,
    authorName,
    deviceId: loadOrCreateProfile().profile.deviceId,
    bpm: take.bpm,
    notes: take.notes,
  });
  const { profile } = loadOrCreateProfile();
  if (profile.displayName !== authorName.trim()) saveProfile({ ...profile, displayName: authorName });
  return share;
}

/** A local take in the shared shape, so the shared player can preview it. */
export function asSharedRecording(take: Recording): SharedRecording {
  return {
    id: take.id,
    title: take.name,
    authorName: "",
    bpm: take.bpm,
    durationMs: recordingDurationMs(take.notes),
    noteCount: take.notes.length,
    createdAt: take.createdAt,
    notes: take.notes,
  };
}

export function shareUrl(id: string): string {
  const origin = typeof window === "undefined" ? "" : window.location.origin;
  return `${origin}/play/${id}`;
}

export function formatDuration(ms: number): string {
  const seconds = Math.round(ms / 1000);
  return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, "0")}`;
}

export function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}
