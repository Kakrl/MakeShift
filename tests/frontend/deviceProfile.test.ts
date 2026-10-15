import { describe, expect, it } from "vitest";
import {
  loadOrCreateProfile,
  saveProfile,
  isValidDisplayName,
} from "../../frontend/src/lib/deviceProfile";
import { storageKey, type StorageArea } from "../../frontend/src/lib/storage";

function memory() {
  const values = new Map<string, string>();
  const area: StorageArea = {
    getItem: (key) => values.get(key) ?? null,
    setItem: (key, value) => {
      values.set(key, value);
    },
    removeItem: (key) => {
      values.delete(key);
    },
  };
  return { values, access: () => area };
}
describe("device profile", () => {
  it("keeps the ID across loads and name changes", () => {
    const storage = memory();
    const first = loadOrCreateProfile(storage.access);
    expect(first.result.ok).toBe(true);
    expect(first.profile.deviceId).toMatch(/^[0-9a-f-]{36}$/);
    expect(loadOrCreateProfile(storage.access).profile).toEqual(first.profile);
    expect(
      saveProfile({ ...first.profile, displayName: " Harry " }, storage.access)
        .ok,
    ).toBe(true);
    expect(loadOrCreateProfile(storage.access).profile).toEqual({
      ...first.profile,
      displayName: "Harry",
    });
  });
  it("enforces shared name limits by Unicode code points", () => {
    expect(isValidDisplayName(" ")).toBe(false);
    expect(isValidDisplayName("a")).toBe(true);
    expect(isValidDisplayName("\u{1F3B9}".repeat(50))).toBe(true);
    expect(isValidDisplayName("\u{1F3B9}".repeat(51))).toBe(false);
  });
  it("leaves the saved profile unchanged on invalid names", () => {
    const storage = memory();
    const first = loadOrCreateProfile(storage.access);
    expect(
      saveProfile({ ...first.profile, displayName: " " }, storage.access).ok,
    ).toBe(false);
    expect(loadOrCreateProfile(storage.access).profile).toEqual(first.profile);
  });
  it.each([
    "broken",
    JSON.stringify({
      deviceId: "",
      displayName: "Harry",
    }),
  ])("replaces invalid storage: %s", (raw) => {
    const storage = memory();
    storage.values.set(storageKey("profile", 1), raw);
    const result = loadOrCreateProfile(storage.access);
    expect(result.result.ok).toBe(true);
    expect(result.profile.deviceId).toMatch(/^[0-9a-f-]{36}$/);
    expect(loadOrCreateProfile(storage.access).profile).toEqual(result.profile);
  });
  it("preserves another tab's saved ID when retrying failed initial persistence", () => {
    const storage = memory();
    const tabA = loadOrCreateProfile(() => null);
    expect(tabA.result.ok).toBe(false);
    const tabB = loadOrCreateProfile(storage.access);
    expect(tabB.result.ok).toBe(true);
    const result = saveProfile(
      { ...tabA.profile, displayName: "Harry" },
      storage.access,
    );
    const expected = { deviceId: tabB.profile.deviceId, displayName: "Harry" };
    expect(result).toEqual({ ok: true, profile: expected });
    expect(loadOrCreateProfile(storage.access).profile).toEqual(expected);
  });
  it("reports unavailable storage", () => {
    expect(loadOrCreateProfile(() => null).result).toEqual({
      ok: false,
      reason: "unavailable",
    });
  });
  it("preserves the saved name on quota failure", () => {
    const storage = memory();
    const first = loadOrCreateProfile(storage.access);
    const blocked = () => ({
      ...storage.access(),
      setItem: () => {
        const e = new Error();
        e.name = "QuotaExceededError";
        throw e;
      },
    });
    expect(
      saveProfile({ ...first.profile, displayName: "Harry" }, blocked),
    ).toEqual({ ok: false, reason: "quota" });
    expect(loadOrCreateProfile(storage.access).profile).toEqual(first.profile);
  });
});
