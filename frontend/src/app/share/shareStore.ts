import { restoreMeter } from "../../lib/meter";
// The shared recordings store the share UI uses (#203, #133): the real
// recordings API, or the mock fixtures when the page URL has `?mock=`.
// Also keeps which local takes are shared, with their delete tokens.
import type { Recording } from "../midi/midiUtils";
import {
  RECORDING_LIST_PAGE_SIZE,
  recordingDurationMs,
  type SharedRecording,
  type UploadRecordingResponse,
} from "../../lib/recordings";
import { readStored, writeStored, type StorageAccess, type WriteResult } from "../../lib/storage";
import { loadOrCreateProfile, saveProfile } from "../../lib/deviceProfile";
import { createShareApi, ShareNotFoundError, type ShareStore } from "./shareApi";
import { createMockShareStore, mockMode } from "./mockShareStore";

export { ShareNotFoundError };
export const PAGE_SIZE = RECORDING_LIST_PAGE_SIZE;

const api = createShareApi();
const mock = createMockShareStore();
const current = () => (mockMode() ? mock : api);

export const shareStore: ShareStore = {
  list: (cursor) => current().list(cursor),
  get: (id) => current().get(id),
  upload: (request) => current().upload(request),
  remove: (id, deleteToken) => current().remove(id, deleteToken),
};

// Which local takes are shared. #133 keeps the returned id and delete token
// next to the take, so stopping a share works after a reload. `mock` marks
// a share made under `?mock=`, so it is only ever stopped in the mock store.
const TAKE_SHARES_NAME = "take-shares";
const TAKE_SHARES_VERSION = 1;
export type TakeShare = UploadRecordingResponse & { mock?: true };
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
        typeof share.deleteToken === "string" &&
        (share.mock === undefined || share.mock === true),
    )
  );
}

export function loadTakeShares(storage?: StorageAccess): TakeShares {
  return readStored(TAKE_SHARES_NAME, TAKE_SHARES_VERSION, {}, isTakeShares, storage);
}

export function saveTakeShares(shares: TakeShares, storage?: StorageAccess): WriteResult {
  return writeStored(TAKE_SHARES_NAME, TAKE_SHARES_VERSION, shares, storage);
}

/** Keeps a new share next to its take, or forgets it on null. */
export type KeepShare = (share: TakeShare | null) => WriteResult;

/** The sharing name from the device profile (#125), shown in the sidebar too. */
export const loadShareName = () => loadOrCreateProfile().profile.displayName;

/**
 * Uploads a local take under a title and display name, from this device's
 * profile ID, and keeps the name as the profile's sharing name. A share
 * whose delete token can't be saved is undone, since it couldn't be stopped
 * after a reload; if undoing fails, it stays kept in memory and this throws.
 */
export async function uploadTake(
  take: Recording,
  title: string,
  authorName: string,
  keep: KeepShare,
): Promise<TakeShare> {
  const mocked = mockMode() !== null;
  const uploaded = await (mocked ? mock : api).upload({
    title,
    authorName,
    deviceId: loadOrCreateProfile().profile.deviceId,
    bpm: take.bpm,
    meter: restoreMeter(take.meter),
    notes: take.notes,
  });
  const { profile } = loadOrCreateProfile();
  if (profile.displayName !== authorName.trim()) saveProfile({ ...profile, displayName: authorName });
  const share: TakeShare = mocked ? { ...uploaded, mock: true } : uploaded;
  if (keep(share).ok) return share;
  try {
    await stopShare(share);
  } catch {
    throw new Error("Shared, but this device couldn't save it. Retry saving or stop sharing in My recordings before you leave.");
  }
  keep(null);
  throw new Error("This device couldn't save the share, so it was undone. Free up storage and try again.");
}

/**
 * Stops a take's share in the store it was made in. A share that is already
 * gone counts as stopped; any other failure throws, and the caller keeps the
 * token so stopping can be retried.
 */
export async function stopShare(share: TakeShare): Promise<void> {
  try {
    await (share.mock ? mock : api).remove(share.id, share.deleteToken);
  } catch (cause) {
    if (!(cause instanceof ShareNotFoundError)) throw cause;
  }
}

/** A local take in the shared shape, so the shared player can preview it. */
export function asSharedRecording(take: Recording): SharedRecording {
  return {
    id: take.id,
    title: take.name,
    authorName: "",
    bpm: take.bpm,
    meter: restoreMeter(take.meter),
    durationMs: recordingDurationMs(take.notes),
    noteCount: take.notes.length,
    createdAt: take.createdAt,
    notes: take.notes,
  };
}

/** A mock share's link keeps `?mock=1`, or it would open the real API. */
export function shareUrl(id: string, mock = mockMode() !== null): string {
  const origin = typeof window === "undefined" ? "" : window.location.origin;
  return `${origin}/play/${id}${mock ? "?mock=1" : ""}`;
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
