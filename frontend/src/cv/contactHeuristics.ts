import type {
  ContactEvidence,
  ContactHeuristic,
} from "./contactScore";
import {
  DEPTH_BOUNDARY_SIDE,
  getKnuckleBoundaryY,
  isBeyondDepthBoundary,
} from "./depthCalibration";

function booleanEvidence(
  id: ContactEvidence["id"],
  value: boolean | undefined,
  weight: number,
): ContactEvidence {
  return {
    id,
    confidence: value === true ? 1 : 0,
    weight,
    available: value !== undefined,
  };
}

export const keyOverlapHeuristic: ContactHeuristic = (frame) =>
  booleanEvidence("key-overlap", frame.keyOverlap, 1);

export const zBoundaryHeuristic: ContactHeuristic = (frame) => {
  if (frame.zBoundaryCrossed !== undefined) {
    return booleanEvidence("z-boundary", frame.zBoundaryCrossed, 1);
  }
  if (
    !frame.finger ||
    frame.fingertipSheetY === undefined ||
    frame.fingertipZ === undefined ||
    !frame.depthCalibration
  ) {
    return booleanEvidence("z-boundary", undefined, 1);
  }

  return booleanEvidence(
    "z-boundary",
    isBeyondDepthBoundary(
      frame.depthCalibration.zLines[frame.finger],
      frame.fingertipZ,
      frame.fingertipSheetY,
      frame.depthBoundarySide ?? DEPTH_BOUNDARY_SIDE,
    ),
    1,
  );
};

export const knuckleBoundaryHeuristic: ContactHeuristic = (frame) => {
  if (frame.knuckleBoundaryCrossed !== undefined) {
    return booleanEvidence("knuckle-boundary", frame.knuckleBoundaryCrossed, 1);
  }
  if (
    !frame.finger ||
    frame.fingertipSheetY === undefined ||
    frame.knuckleDistance === undefined ||
    !frame.depthCalibration
  ) {
    return booleanEvidence("knuckle-boundary", undefined, 1);
  }

  const boundaryY = getKnuckleBoundaryY(
    frame.depthCalibration,
    frame.finger,
    frame.knuckleDistance,
  );
  return booleanEvidence(
    "knuckle-boundary",
    boundaryY !== null && frame.fingertipSheetY >= boundaryY,
    1,
  );
};

export const fingerPostureHeuristic: ContactHeuristic = (frame) =>
  booleanEvidence("finger-posture", frame.fingerIsCurved, 0.5);

export const motionHeuristic: ContactHeuristic = (frame) => {
  if (frame.motion === undefined || frame.motion === "unknown") {
    return {
      id: "motion",
      confidence: 0,
      weight: 1,
      available: false,
    };
  }

  return {
    id: "motion",
    confidence:
      frame.motion === "approaching"
        ? 1
        : frame.motion === "stationary"
          ? 0.25
          : 0,
    weight: 1,
    available: true,
  };
};

export const shadowHeuristic: ContactHeuristic = (frame) => {
  if (frame.shadow === undefined || frame.shadow === "unknown") {
    return {
      id: "shadow",
      confidence: 0,
      weight: 1,
      available: false,
    };
  }

  return {
    id: "shadow",
    confidence:
      frame.shadow === "disappeared"
        ? 1
        : frame.shadow === "darkening"
          ? 0.75
          : frame.shadow === "stable"
            ? 0.2
            : 0,
    weight: 1,
    available: true,
  };
};

/** The order here is also the order used in score diagnostics. */
export const CONTACT_HEURISTICS: readonly ContactHeuristic[] = [
  keyOverlapHeuristic,
  zBoundaryHeuristic,
  knuckleBoundaryHeuristic,
  fingerPostureHeuristic,
  motionHeuristic,
  shadowHeuristic,
];
