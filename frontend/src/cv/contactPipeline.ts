import { getKeyCollisions, type Fingertip } from "./collision";
import {
  getKnuckleBoundaryY,
  type DepthFinger,
  type PersistedDepthCalibration,
} from "./depthCalibration";
import {
  evaluateShadowContact,
  type ShadowContactEvaluation,
  type ShadowObservation,
} from "./shadowHeuristics";
import type { Point } from "./types";

export const KNUCKLE_RANGE_TOLERANCE = 0.002;
export const KNUCKLE_PLAYING_MARGIN_Y = 0.025;
export const KNUCKLE_ELIGIBILITY_HYSTERESIS_Y = 0.012;

interface KnuckleEligibilityInput {
  finger: DepthFinger;
  calibration: PersistedDepthCalibration | null;
  knuckleDistance: number | null;
  fingertipScreenY: number | null;
  previouslyEligible: boolean;
}

export function checkKeyOverlap(
  fingertip: Fingertip,
  whiteKeys: Point[][] | null,
) {
  return whiteKeys
    ? getKeyCollisions([fingertip], whiteKeys, 8).map(
        ({ keyIndex }) => keyIndex,
      )
    : [];
}

export function checkKnuckleEligibility({
  calibration,
  finger,
  knuckleDistance,
  fingertipScreenY,
  previouslyEligible,
}: KnuckleEligibilityInput): boolean {
  if (!calibration || knuckleDistance === null || fingertipScreenY === null)
    return false;
  const boundaryY = getKnuckleBoundaryY(
    calibration,
    finger,
    knuckleDistance,
    false,
    KNUCKLE_RANGE_TOLERANCE,
  );
  if (boundaryY === null) return false;
  const threshold =
    boundaryY -
    KNUCKLE_PLAYING_MARGIN_Y -
    (previouslyEligible ? KNUCKLE_ELIGIBILITY_HYSTERESIS_Y : 0);
  return fingertipScreenY >= threshold;
}

/** Worker response: check shadow area before updating the press/release state. */
export function checkShadowContact({
  observation,
  frameAtMs,
  previous,
  sampledKeyOverlap,
  currentKeyOverlap,
}: {
  observation: ShadowObservation;
  frameAtMs: number;
  previous: ShadowContactEvaluation | null;
  sampledKeyOverlap: boolean;
  currentKeyOverlap: boolean;
}) {
  return evaluateShadowContact(
    observation.contour?.areaPixels ?? 0,
    frameAtMs,
    previous,
    observation.measurement.available && sampledKeyOverlap && currentKeyOverlap,
  );
}
