// Shared live marker cadence.
export const MARKER_CHECK_INTERVAL_MS = 10_000;

import { computeHomography, projectPoint } from "./homography";
import type { Point } from "./types";
import { DEFAULT_LAYOUT, usableLayout, sameLayout, type KeyboardLayout } from "./keyboardLayout";

export const CALIBRATION_KEY = "makeshift.calibration.v2";
export const SHEET_ID = "aruco-0-3-white-keys-v1";
// Backward-compatible name for callers using the default configuration.
export const CURRENT_LAYOUT = DEFAULT_LAYOUT;
export const PAGE_CORNERS: Point[] = [
  { x: 0, y: 0 },
  { x: 1, y: 0 },
  { x: 1, y: 1 },
  { x: 0, y: 1 },
];
export interface CameraSignature {
  deviceId: string;
  width: number;
  height: number;
  facingMode: string;
}
export interface CalibrationResult {
  version: 2;
  coordinates: "unmirrored-frame-pixels/marker-unit-square";
  sheet: typeof SHEET_ID;
  camera: CameraSignature;
  layout: KeyboardLayout;
  corners: Point[];
  detector: "vision-reference-v1";
}

const finite = (n: unknown): n is number =>
  typeof n === "number" && Number.isFinite(n);
const object = (v: unknown): v is Record<string, unknown> =>
  !!v && typeof v === "object";
export function validCamera(v: unknown): v is CameraSignature {
  return (
    object(v) &&
    typeof v.deviceId === "string" &&
    v.deviceId.length > 0 &&
    typeof v.facingMode === "string" &&
    finite(v.width) &&
    finite(v.height) &&
    Number.isInteger(v.width) &&
    Number.isInteger(v.height) &&
    v.width > 0 &&
    v.height > 0
  );
}
export function cameraSignature(
  stream: MediaStream | null,
  video: HTMLVideoElement | null,
): CameraSignature | null {
  const track = stream?.getVideoTracks()[0];
  if (!track || track.readyState !== "live" || !video || video.readyState < 2)
    return null;
  const settings = track.getSettings();
  const value = {
    deviceId: settings.deviceId ?? "",
    width: video.videoWidth,
    height: video.videoHeight,
    facingMode: settings.facingMode ?? "",
  };
  return validCamera(value) ? value : null;
}
export function validCorners(
  value: unknown,
  camera: CameraSignature,
): value is Point[] {
  if (
    !Array.isArray(value) ||
    value.length !== 4 ||
    !value.every(
      (p) =>
        object(p) &&
        finite(p.x) &&
        finite(p.y) &&
        p.x >= 0 &&
        p.y >= 0 &&
        p.x <= camera.width &&
        p.y <= camera.height,
    )
  )
    return false;
  const points = value as Point[];
  // Positive winding, convexity and minimum area reject crossings and near-collinearity.
  for (let i = 0; i < 4; i++) {
    const a = points[i],
      b = points[(i + 1) % 4],
      c = points[(i + 2) % 4];
    if (
      (b.x - a.x) * (c.y - b.y) - (b.y - a.y) * (c.x - b.x) <
      camera.width * camera.height * 0.001
    )
      return false;
  }
  const h = computeHomography(points, PAGE_CORNERS);
  return (
    !!h &&
    h.every(Number.isFinite) &&
    points.every((p, i) => {
      const mapped = projectPoint(h, p);
      return (
        mapped &&
        Math.hypot(mapped.x - PAGE_CORNERS[i].x, mapped.y - PAGE_CORNERS[i].y) <
          1e-6
      );
    })
  );
}
export function validateCalibration(value: unknown): CalibrationResult | null {
  if (
    !object(value) ||
    value.version !== 2 ||
    value.coordinates !== "unmirrored-frame-pixels/marker-unit-square" ||
    value.sheet !== SHEET_ID ||
    !validCamera(value.camera) ||
    !validCorners(value.corners, value.camera) ||
    !usableLayout(value.layout as KeyboardLayout) ||
    value.detector !== "vision-reference-v1"
  )
    return null;
  return structuredClone({
    version: 2, coordinates: value.coordinates, sheet: value.sheet,
    camera: value.camera, layout: value.layout, corners: value.corners,
    detector: value.detector,
  }) as CalibrationResult;
}
export function compatibleCalibration(
  result: CalibrationResult,
  camera: CameraSignature,
  corners: Point[],
  layout: CalibrationResult["layout"] = CURRENT_LAYOUT,
  sheet: string = SHEET_ID,
): boolean {
  return (
    !!validateCalibration(result) &&
    validCamera(camera) &&
    validCorners(corners, camera) &&
    result.sheet === sheet &&
    result.camera.deviceId === camera.deviceId &&
    result.camera.width === camera.width &&
    result.camera.height === camera.height &&
    result.camera.facingMode === camera.facingMode &&
    usableLayout(layout) && sameLayout(result.layout, layout) &&
    result.corners.every(
      (p, i) =>
        Math.hypot(p.x - corners[i].x, p.y - corners[i].y) <=
        Math.hypot(camera.width, camera.height) * 0.01,
    )
  );
}

export type CalibrationReason = "calibration-missing" | "calibration-invalid" |
  "camera-unavailable" | "camera-device" | "camera-dimensions" | "camera-facing" |
  "layout-changed" | "markers-unavailable" | "geometry-mismatch";

/** Ordered diagnostics; compatibility remains the authoritative safety gate. */
export function calibrationReason(value: unknown, camera: CameraSignature | null,
  corners: Point[] | null, layout: KeyboardLayout): CalibrationReason | null {
  if (value == null) return "calibration-missing";
  const saved = validateCalibration(value);
  if (!saved) return "calibration-invalid";
  if (!camera || !validCamera(camera)) return "camera-unavailable";
  if (saved.camera.deviceId !== camera.deviceId) return "camera-device";
  if (saved.camera.width !== camera.width || saved.camera.height !== camera.height)
    return "camera-dimensions";
  if (saved.camera.facingMode !== camera.facingMode) return "camera-facing";
  if (!usableLayout(layout) || !sameLayout(saved.layout, layout)) return "layout-changed";
  if (!corners || !validCorners(corners, camera)) return "markers-unavailable";
  return compatibleCalibration(saved, camera, corners, layout) ? null : "geometry-mismatch";
}
type StorageAccess = () => Pick<Storage, "getItem" | "setItem" | "removeItem">;
const browserStorage: StorageAccess = () => window.localStorage;
export function loadCalibration(
  storage: StorageAccess = browserStorage,
): CalibrationResult | null {
  try {
    return validateCalibration(
      JSON.parse(storage().getItem(CALIBRATION_KEY) ?? "null"),
    );
  } catch {
    return null;
  }
}
export function saveCalibration(
  value: unknown,
  storage: StorageAccess = browserStorage,
): boolean {
  const result = validateCalibration(value);
  if (!result) return false;
  try {
    storage().setItem(CALIBRATION_KEY, JSON.stringify(result));
    return true;
  } catch {
    return false;
  }
}
