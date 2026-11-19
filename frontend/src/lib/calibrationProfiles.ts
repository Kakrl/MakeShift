import { paperOctaves, validLayout, type KeyboardLayout } from "../cv/keyboardLayout";
import type { Point } from "../cv/types";
import { browserStorage, readStored, writeStored, type StorageAccess, type WriteResult } from "./storage";

const NAME = "calibration-profiles";
const VERSION = 1;
export const PROFILE_NAME_MAX = 40;

/** Corners are reference only; loading still detects markers. */
export interface CalibrationProfile {
  id: string;
  name: string;
  octaves: number;
  startingNote: number;
  paperOctaves?: number;
  paperFitOverride?: boolean;
  corners?: Point[];
}

export type ProfileResult =
  | { ok: true; profile: CalibrationProfile }
  | { ok: false; reason: Exclude<WriteResult, { ok: true }>["reason"] | "invalid-name" | "invalid-layout" | "duplicate-name" | "not-found" };

const finitePoint = (p: unknown): p is Point =>
  !!p && typeof p === "object" &&
  Number.isFinite((p as Point).x) && Number.isFinite((p as Point).y);

function validCorners(value: unknown): value is Point[] {
  return Array.isArray(value) && value.length === 4 && value.every(finitePoint);
}

export function profileLayout(profile: CalibrationProfile): KeyboardLayout {
  const layout: KeyboardLayout = {
    octaves: profile.octaves,
    startingMidi: profile.startingNote,
    whiteKeys: profile.octaves * 7 + 1,
  };
  if (profile.paperOctaves !== undefined) layout.paperOctaves = profile.paperOctaves;
  if (profile.paperFitOverride !== undefined) layout.paperFitOverride = profile.paperFitOverride;
  return layout;
}

export function validProfile(value: unknown): value is CalibrationProfile {
  if (!value || typeof value !== "object") return false;
  const v = value as CalibrationProfile;
  return typeof v.id === "string" && v.id.length > 0 &&
    typeof v.name === "string" && cleanName(v.name) === v.name && v.name.length > 0 &&
    Number.isInteger(v.octaves) && Number.isInteger(v.startingNote) &&
    validLayout(profileLayout(v)) &&
    (v.corners === undefined || validCorners(v.corners));
}

export function cleanName(name: string): string {
  return name.replace(/\s+/g, " ").trim().slice(0, PROFILE_NAME_MAX).trim();
}

const sameName = (a: string, b: string) => a.toLocaleLowerCase() === b.toLocaleLowerCase();

function copy(profile: CalibrationProfile): CalibrationProfile {
  return { ...profile, ...(profile.corners && { corners: profile.corners.map((p) => ({ x: p.x, y: p.y })) }) };
}

function newId(): string {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") return crypto.randomUUID();
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

export function listProfiles(storage: StorageAccess = browserStorage): CalibrationProfile[] {
  const stored = readStored<unknown[]>(NAME, VERSION, [], Array.isArray, storage);
  return stored.filter(validProfile).map(copy);
}

function write(profiles: CalibrationProfile[], profile: CalibrationProfile, storage: StorageAccess): ProfileResult {
  const result = writeStored(NAME, VERSION, profiles, storage);
  return result.ok ? { ok: true, profile: copy(profile) } : result;
}

/** Saving under an existing name replaces that profile. */
export function saveProfile(
  name: string,
  layout: KeyboardLayout,
  corners?: Point[] | null,
  storage: StorageAccess = browserStorage,
): ProfileResult {
  const cleaned = cleanName(name);
  if (!cleaned) return { ok: false, reason: "invalid-name" };
  const profiles = listProfiles(storage);
  const existing = profiles.find((p) => sameName(p.name, cleaned));
  const profile: CalibrationProfile = {
    id: existing?.id ?? newId(),
    name: cleaned,
    octaves: layout.octaves,
    startingNote: layout.startingMidi,
    paperOctaves: paperOctaves(layout),
    paperFitOverride: !!layout.paperFitOverride,
  };
  if (corners && validCorners(corners)) profile.corners = corners.map((p) => ({ x: p.x, y: p.y }));
  if (!validProfile(profile)) return { ok: false, reason: "invalid-layout" };
  const next = existing
    ? profiles.map((p) => (p.id === existing.id ? profile : p))
    : [...profiles, profile];
  return write(next, profile, storage);
}

export function renameProfile(id: string, name: string, storage: StorageAccess = browserStorage): ProfileResult {
  const cleaned = cleanName(name);
  if (!cleaned) return { ok: false, reason: "invalid-name" };
  const profiles = listProfiles(storage);
  const target = profiles.find((p) => p.id === id);
  if (!target) return { ok: false, reason: "not-found" };
  if (profiles.some((p) => p.id !== id && sameName(p.name, cleaned))) return { ok: false, reason: "duplicate-name" };
  const renamed = { ...target, name: cleaned };
  return write(profiles.map((p) => (p.id === id ? renamed : p)), renamed, storage);
}

export function deleteProfile(id: string, storage: StorageAccess = browserStorage): ProfileResult {
  const profiles = listProfiles(storage);
  const target = profiles.find((p) => p.id === id);
  if (!target) return { ok: false, reason: "not-found" };
  return write(profiles.filter((p) => p.id !== id), target, storage);
}
