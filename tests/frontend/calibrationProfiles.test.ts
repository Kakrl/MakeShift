import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import {
  PROFILE_NAME_MAX,
  deleteProfile,
  listProfiles,
  profileLayout,
  renameProfile,
  saveProfile,
} from "../../frontend/src/lib/calibrationProfiles";
import type { StorageArea } from "../../frontend/src/lib/storage";

const KEY = "makeshift:calibration-profiles:v1";
const TWO_OCTAVES = { octaves: 2, startingMidi: 36, whiteKeys: 15, paperOctaves: 2 };
const CORNERS = [{ x: 10, y: 10 }, { x: 90, y: 10 }, { x: 90, y: 60 }, { x: 10, y: 60 }];

function memoryStorage(entries: Record<string, string> = {}) {
  const items = new Map(Object.entries(entries));
  const area: StorageArea = {
    getItem: (k) => items.get(k) ?? null,
    setItem: (k, v) => void items.set(k, v),
    removeItem: (k) => void items.delete(k),
  };
  return { items, access: () => area };
}

describe("calibration profile storage", () => {
  it("saves, reloads from serialized storage, renames and deletes profiles", () => {
    const first = memoryStorage();
    const saved = saveProfile("  Desk   setup ", TWO_OCTAVES, CORNERS, first.access);
    expect(saved.ok).toBe(true);
    if (!saved.ok) return;
    expect(saved.profile).toMatchObject({ name: "Desk setup", octaves: 2, startingNote: 36, corners: CORNERS });

    const reloaded = memoryStorage({ [KEY]: first.items.get(KEY)! });
    const [profile] = listProfiles(reloaded.access);
    expect(profile).toEqual(saved.profile);
    expect(profileLayout(profile)).toEqual({ ...TWO_OCTAVES, paperFitOverride: false });

    expect(renameProfile(profile.id, "Kitchen", reloaded.access)).toMatchObject({ ok: true, profile: { name: "Kitchen" } });
    expect(listProfiles(reloaded.access).map((p) => p.name)).toEqual(["Kitchen"]);
    expect(deleteProfile(profile.id, reloaded.access).ok).toBe(true);
    expect(listProfiles(reloaded.access)).toEqual([]);
  });

  it("makes marker corners optional and replaces a profile saved under the same name", () => {
    const { access } = memoryStorage();
    const first = saveProfile("Desk", TWO_OCTAVES, null, access);
    const second = saveProfile("desk", { octaves: 1, startingMidi: 60, whiteKeys: 8 }, undefined, access);
    expect(first.ok && second.ok && first.profile.id === second.profile.id).toBe(true);
    const profiles = listProfiles(access);
    expect(profiles).toHaveLength(1);
    expect(profiles[0]).toMatchObject({ name: "desk", octaves: 1, startingNote: 60, paperOctaves: 1 });
    expect(profiles[0].corners).toBeUndefined();
  });

  it("rejects empty and duplicate names, unknown ids and invalid layouts", () => {
    const { access, items } = memoryStorage();
    expect(saveProfile("   ", TWO_OCTAVES, null, access)).toEqual({ ok: false, reason: "invalid-name" });
    expect(saveProfile("Bad", { octaves: 2, startingMidi: 37, whiteKeys: 15 }, null, access)).toEqual({ ok: false, reason: "error" });
    const a = saveProfile("A", TWO_OCTAVES, null, access);
    saveProfile("B", TWO_OCTAVES, null, access);
    if (!a.ok) throw new Error("save failed");
    expect(renameProfile(a.profile.id, "b", access)).toEqual({ ok: false, reason: "duplicate-name" });
    expect(renameProfile(a.profile.id, "", access)).toEqual({ ok: false, reason: "invalid-name" });
    expect(renameProfile("missing", "C", access)).toEqual({ ok: false, reason: "not-found" });
    expect(deleteProfile("missing", access)).toEqual({ ok: false, reason: "not-found" });
    expect(saveProfile("x".repeat(80), TWO_OCTAVES, null, access)).toMatchObject({ ok: true, profile: { name: "x".repeat(PROFILE_NAME_MAX) } });
    expect(JSON.parse(items.get(KEY)!)).toHaveLength(3);
  });

  it("drops corrupt entries and ignores malformed corners or unparsable data", () => {
    const valid = { id: "1", name: "Ok", octaves: 1, startingNote: 48 };
    const { access } = memoryStorage({
      [KEY]: JSON.stringify([
        valid,
        { ...valid, id: "2", octaves: 4 },
        { ...valid, id: "3", corners: [{ x: 1, y: 2 }] },
        { ...valid, id: "", name: "No id" },
        null,
      ]),
    });
    expect(listProfiles(access)).toEqual([valid]);
    expect(listProfiles(memoryStorage({ [KEY]: "{not json" }).access)).toEqual([]);
    expect(listProfiles(memoryStorage({ [KEY]: "{}" }).access)).toEqual([]);
  });

  it("reports blocked and full storage without throwing", () => {
    expect(saveProfile("A", TWO_OCTAVES, null, () => null)).toEqual({ ok: false, reason: "unavailable" });
    const full: StorageArea = {
      getItem: () => null,
      setItem: () => { throw Object.assign(new Error("full"), { name: "QuotaExceededError" }); },
      removeItem: () => undefined,
    };
    expect(saveProfile("A", TWO_OCTAVES, null, () => full)).toEqual({ ok: false, reason: "quota" });
  });
});

describe("legacy calibration flag", () => {
  it("is never read or written by frontend source", () => {
    const root = fileURLToPath(new URL("../../frontend/src", import.meta.url));
    const files: string[] = [];
    const walk = (dir: string) => {
      for (const entry of readdirSync(dir)) {
        const path = join(dir, entry);
        if (statSync(path).isDirectory()) walk(path);
        else if (/\.(ts|tsx|js|mjs)$/.test(entry)) files.push(path);
      }
    };
    walk(root);
    expect(files.length).toBeGreaterThan(0);
    expect(files.filter((file) => readFileSync(file, "utf8").includes("isCalibrated"))).toEqual([]);
  });
});
