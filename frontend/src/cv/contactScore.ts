import { CONTACT_HEURISTICS } from "./contactHeuristics";

/** Inputs available to the modular contact heuristics for one fingertip. */
export interface ContactFrame {
  keyOverlap: boolean;
  zBoundaryCrossed?: boolean;
  knuckleBoundaryCrossed?: boolean;
  fingerIsCurved?: boolean;
  motion?: "approaching" | "stationary" | "retracting" | "unknown";
  shadow?: "darkening" | "disappeared" | "stable" | "returning" | "unknown";
}

export type ContactHeuristicId =
  | "key-overlap"
  | "z-boundary"
  | "knuckle-boundary"
  | "finger-posture"
  | "motion"
  | "shadow";

export interface ContactEvidence {
  id: ContactHeuristicId;
  confidence: number;
  weight: number;
  available: boolean;
}

export type ContactHeuristic = (frame: ContactFrame) => ContactEvidence;

export interface ContactScoreOptions {
  heuristics?: readonly ContactHeuristic[];
  minimumSupportingEvidence?: number;
  pressThreshold?: number;
}

export interface ContactScoreResult {
  score: number;
  pressed: boolean;
  evidence: ContactEvidence[];
  supportingEvidenceCount: number;
}

/** Combine available heuristic outputs into one conservative press score. */
export function scoreContact(
  frame: ContactFrame,
  options: ContactScoreOptions = {},
): ContactScoreResult {
  const heuristics = options.heuristics ?? CONTACT_HEURISTICS;
  const evidence = heuristics.map((heuristic) => heuristic(frame));
  const availableEvidence = evidence.filter(({ available }) => available);
  const totalWeight = availableEvidence.reduce(
    (sum, { weight }) => sum + weight,
    0,
  );
  const weightedConfidence = availableEvidence.reduce(
    (sum, { confidence, weight }) => sum + confidence * weight,
    0,
  );
  const score = totalWeight === 0 ? 0 : weightedConfidence / totalWeight;
  const supportingEvidenceCount = availableEvidence.filter(
    ({ id }) => id !== "key-overlap",
  ).length;
  const minimumSupportingEvidence = options.minimumSupportingEvidence ?? 1;
  const pressThreshold = options.pressThreshold ?? 0.7;
  const hasKeyOverlap = frame.keyOverlap;

  return {
    score,
    pressed:
      hasKeyOverlap &&
      score >= pressThreshold &&
      supportingEvidenceCount >= minimumSupportingEvidence,
    evidence,
    supportingEvidenceCount,
  };
}
