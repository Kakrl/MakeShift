import { computeHomography, projectPoint } from "./homography";
import type { MarkerDetectionResult, Point } from "./types";

export const CALIBRATION_KEY = "makeshift.calibration.v1";
export const SHEET_ID = "aruco-0-3-white-keys-v1";
// Matches the geometry and MIDI mapping currently shipped. #36 expands this.
export const CURRENT_LAYOUT = {
  octaves: 1,
  startingMidi: 48,
  whiteKeys: 8,
} as const;
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
export interface LandmarkSample {
  x: number;
  y: number;
  z: number;
}
export interface CalibrationResult {
  version: 1;
  coordinates: "unmirrored-frame-pixels/marker-unit-square";
  sheet: typeof SHEET_ID;
  camera: CameraSignature;
  layout: { octaves: number; startingMidi: number; whiteKeys: number };
  corners: Point[];
  contact: {
    model: "landmark-reference-v1";
    hover: LandmarkSample[][];
    rest: LandmarkSample[][];
  };
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
export function markerCorners(
  detection: MarkerDetectionResult,
  camera: CameraSignature,
): Point[] | null {
  if (detection.missingIds.length || detection.observations.length !== 4)
    return null;
  const corners = [0, 1, 2, 3].map(
    (id) => detection.observations.find((p) => p.id === id)?.center,
  );
  return validCorners(corners, camera) ? corners.map((p) => ({ ...p })) : null;
}
export function validSamples(value: unknown): value is LandmarkSample[][] {
  return (
    Array.isArray(value) &&
    value.length >= 1 &&
    value.length <= 2 &&
    value.every(
      (hand) =>
        Array.isArray(hand) &&
        hand.length === 21 &&
        hand.every(
          (p) =>
            object(p) &&
            finite(p.x) &&
            finite(p.y) &&
            finite(p.z) &&
            p.x >= 0 &&
            p.x <= 1 &&
            p.y >= 0 &&
            p.y <= 1 &&
            Math.abs(p.z) <= 2,
        ),
    )
  );
}
export function validateCalibration(value: unknown): CalibrationResult | null {
  if (
    !object(value) ||
    value.version !== 1 ||
    value.coordinates !== "unmirrored-frame-pixels/marker-unit-square" ||
    value.sheet !== SHEET_ID ||
    !validCamera(value.camera) ||
    !validCorners(value.corners, value.camera) ||
    !object(value.layout) ||
    ![1, 2, 3].includes(value.layout.octaves as number) ||
    !Number.isInteger(value.layout.startingMidi) ||
    (value.layout.startingMidi as number) < 0 ||
    (value.layout.startingMidi as number) +
      12 * (value.layout.octaves as number) >
      127 ||
    value.layout.whiteKeys !== 7 * (value.layout.octaves as number) + 1 ||
    !object(value.contact) ||
    value.contact.model !== "landmark-reference-v1" ||
    !validSamples(value.contact.hover) ||
    !validSamples(value.contact.rest)
  )
    return null;
  return structuredClone(value) as unknown as CalibrationResult;
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
    result.layout.octaves === layout.octaves &&
    result.layout.startingMidi === layout.startingMidi &&
    result.layout.whiteKeys === layout.whiteKeys &&
    result.corners.every(
      (p, i) =>
        Math.hypot(p.x - corners[i].x, p.y - corners[i].y) <=
        Math.hypot(camera.width, camera.height) * 0.01,
    )
  );
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
