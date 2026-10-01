import { describe, expect, it } from "vitest";
import {
  keyOverlapHeuristic,
  zBoundaryHeuristic,
} from "../../frontend/src/cv/contactHeuristics";
import { scoreContact } from "../../frontend/src/cv/contactScore";

describe("contact score", () => {
  it("does not press from key overlap alone", () => {
    const result = scoreContact({ keyOverlap: true });

    expect(result.score).toBe(1);
    expect(result.pressed).toBe(false);
    expect(result.supportingEvidenceCount).toBe(0);
  });

  it("combines available supporting evidence", () => {
    const result = scoreContact({
      keyOverlap: true,
      zBoundaryCrossed: true,
      fingerIsCurved: true,
      motion: "approaching",
    });

    expect(result.pressed).toBe(true);
    expect(result.supportingEvidenceCount).toBe(3);
    expect(result.evidence.map(({ id }) => id)).toEqual([
      "key-overlap",
      "z-boundary",
      "knuckle-boundary",
      "finger-posture",
      "motion",
      "shadow",
    ]);
  });

  it("allows a caller to use a focused set of heuristics", () => {
    const result = scoreContact(
      { keyOverlap: true, zBoundaryCrossed: true },
      {
        heuristics: [keyOverlapHeuristic, zBoundaryHeuristic],
        pressThreshold: 0.9,
      },
    );

    expect(result.pressed).toBe(true);
    expect(result.score).toBe(1);
  });
});
