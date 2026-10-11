import { DEFAULT_LAYOUT, validLayout, sameLayout, type KeyboardLayout } from "../cv/keyboardLayout";
import { CALIBRATION_KEY } from "../cv/calibration";
import { DEPTH_CALIBRATION_STORAGE_KEY } from "../cv/depthCalibration";
import { browserStorage, readStored, writeStored, type WriteResult } from "./storage";

const NAME = "keyboard-layout";
const VERSION = 1;
const listeners = new Set<() => void>();
let snapshot = DEFAULT_LAYOUT;

export function loadKeyboardLayout(): Readonly<KeyboardLayout> {
  const next = readStored(NAME, VERSION, DEFAULT_LAYOUT, validLayout);
  if (!sameLayout(snapshot, next)) snapshot = Object.freeze({ ...next });
  return snapshot;
}
export function subscribeKeyboardLayout(listener: () => void): () => void {
  listeners.add(listener);
  const storageChanged = (event: StorageEvent) => {
    if (event.key === null || event.key === `makeshift:${NAME}:v${VERSION}` ||
        event.key === CALIBRATION_KEY) listener();
  };
  if (typeof window !== "undefined") window.addEventListener("storage", storageChanged);
  return () => {
    listeners.delete(listener);
    if (typeof window !== "undefined") window.removeEventListener("storage", storageChanged);
  };
}
/** Invalidate hand/marker calibration before exposing a new configuration.
 * Synchronous notifications retire audio sessions before React rerenders. */
export function saveKeyboardLayout(layout: KeyboardLayout): WriteResult {
  if (!validLayout(layout)) return { ok: false, reason: "error" };
  if (sameLayout(loadKeyboardLayout(), layout)) return { ok: true };
  try {
    const area = browserStorage();
    if (!area) return { ok: false, reason: "unavailable" };
    area.removeItem(CALIBRATION_KEY);
    area.removeItem(DEPTH_CALIBRATION_STORAGE_KEY);
  } catch {
    for (const listener of listeners) listener();
    return { ok: false, reason: "error" };
  }
  const result = writeStored(NAME, VERSION, layout);
  for (const listener of listeners) listener();
  return result;
}
