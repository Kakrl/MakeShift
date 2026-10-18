import { readStored, writeStored, type StorageAccess } from "./storage";
import { RECORDING_LIMITS } from "./recordings";

const STORAGE_NAME = "profile";
const STORAGE_VERSION = 1;
export type DeviceProfile = { deviceId: string; displayName: string };

/** Fired on `window` after a save, so every view showing the name stays in step. */
export const PROFILE_CHANGE_EVENT = "makeshift:profile-change";

export function isValidDisplayName(value: string): boolean {
  const { min, max } = RECORDING_LIMITS.authorNameLength;
  let length = 0;
  for (const character of value.trim()) {
    void character;
    if (++length > max) return false;
  }
  return length >= min;
}

function isDeviceProfile(value: unknown): value is DeviceProfile {
  if (typeof value !== "object" || value === null) return false;
  const profile = value as Record<string, unknown>;
  return (
    typeof profile.deviceId === "string" &&
    profile.deviceId.trim().length > 0 &&
    profile.deviceId.length <= RECORDING_LIMITS.deviceIdLength.max &&
    typeof profile.displayName === "string" &&
    (profile.displayName === "" || isValidDisplayName(profile.displayName))
  );
}

export function loadOrCreateProfile(storage?: StorageAccess) {
  const saved = readStored<DeviceProfile | null>(
    STORAGE_NAME,
    STORAGE_VERSION,
    null,
    isDeviceProfile,
    storage,
  );
  if (saved) return { profile: saved, result: { ok: true } as const };
  const profile: DeviceProfile = {
    deviceId: crypto.randomUUID(),
    displayName: "",
  };
  return {
    profile,
    result: writeStored(STORAGE_NAME, STORAGE_VERSION, profile, storage),
  };
}

export function saveProfile(profile: DeviceProfile, storage?: StorageAccess) {
  if (!isDeviceProfile(profile) || !isValidDisplayName(profile.displayName))
    return { ok: false, reason: "error" } as const;
  // A different tab may have persisted an ID while this tab could not save.
  const saved = readStored<DeviceProfile | null>(
    STORAGE_NAME,
    STORAGE_VERSION,
    null,
    isDeviceProfile,
    storage,
  );
  const next: DeviceProfile = {
    deviceId: saved?.deviceId ?? profile.deviceId,
    displayName: profile.displayName.trim(),
  };
  const result = writeStored(STORAGE_NAME, STORAGE_VERSION, next, storage);
  if (!result.ok) return result;
  if (typeof window !== "undefined")
    window.dispatchEvent(new CustomEvent<DeviceProfile>(PROFILE_CHANGE_EVENT, { detail: next }));
  return { ok: true, profile: next } as const;
}
