import type { DepthFinger, DepthLandmark } from "./depthCalibration";

export type FingerPosture =
  | "playing position"
  | "hover position"
  | "invalid";

const FINGER_CHAINS: Record<
  Exclude<DepthFinger, "thumb"> | "thumb",
  readonly [number, number, number, number]
> = {
  thumb: [1, 2, 3, 4],
  index: [5, 6, 7, 8],
  middle: [9, 10, 11, 12],
  ring: [13, 14, 15, 16],
  pinky: [17, 18, 19, 20],
};

const CURLED_ANGLE_THRESHOLDS: Record<DepthFinger, number> = {
  thumb: 165,
  index: 155,
  middle: 155,
  ring: 155,
  pinky: 165,
};

function angleAtJoint(
  previous: DepthLandmark,
  joint: DepthLandmark,
  next: DepthLandmark,
): number {
  const firstX = previous.x - joint.x;
  const firstY = previous.y - joint.y;
  const nextX = next.x - joint.x;
  const nextY = next.y - joint.y;
  const firstLength = Math.hypot(firstX, firstY);
  const nextLength = Math.hypot(nextX, nextY);
  if (firstLength === 0 || nextLength === 0) return Number.NaN;

  const cosine =
    (firstX * nextX + firstY * nextY) / (firstLength * nextLength);
  return (Math.acos(Math.max(-1, Math.min(1, cosine))) * 180) / Math.PI;
}

export function getFingerPosture(
  landmarks: readonly DepthLandmark[],
  finger: DepthFinger,
): FingerPosture {
  const [mcpIndex, pipIndex, dipIndex, tipIndex] = FINGER_CHAINS[finger];
  const mcp = landmarks[mcpIndex];
  const pip = landmarks[pipIndex];
  const dip = landmarks[dipIndex];
  const tip = landmarks[tipIndex];
  if (!mcp || !pip || !dip || !tip) return "invalid";

  const pipAngle = angleAtJoint(mcp, pip, dip);
  const dipAngle = angleAtJoint(pip, dip, tip);
  if (!Number.isFinite(pipAngle) || !Number.isFinite(dipAngle)) {
    return "invalid";
  }

  const averageAngle = (pipAngle + dipAngle) / 2;
  return averageAngle <= CURLED_ANGLE_THRESHOLDS[finger]
    ? "playing position"
    : "hover position";
}
