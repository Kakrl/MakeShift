import { identifyFilteredFingertips } from "./fingertipCandidates";
import { measureShadowDifference } from "./shadowHeatmap";
import { measureMonotoneShadowPaths } from "./shadowTipEvidence";
import { pointInPolygon, updateKeyTransitions } from "./collision";
import { projectPoint, type Homography } from "./homography";
import { getWhiteKeyPolygons } from "./keyboardGeometry";
import type { KeyboardLayout } from "./keyboardLayout";

export const SHADOW_BASELINE_CUTOFFS = [5, 20, 40, 60] as const;
export type ShadowBaselineCutoff = typeof SHADOW_BASELINE_CUTOFFS[number];

export function shadowAnalysisSize(width: number, height: number) {
  const scale = Math.min(1, 640 / Math.max(width, height));
  return { width: Math.round(width * scale), height: Math.round(height * scale) };
}

/** Same CPU measurement/proposal/DFS implementation as the reviewed gallery.
 * Mapping uses the unmirrored frame and the marker-unit-square transform.
 * No temporal contact state or MediaPipe data enters this path.
 */
export function detectShadowBaseline(
  current: ImageData, reference: ImageData, frameWidth: number, frameHeight: number,
  frameToSheet: Homography, layout: KeyboardLayout, cutoff: ShadowBaselineCutoff = 20,
  includeDiagnostics = false,
) {
  if (!SHADOW_BASELINE_CUTOFFS.includes(cutoff)) throw new Error("Unsupported DFS cutoff");
  const difference = measureShadowDifference(current, reference, 40);
  if (!difference) throw new Error("Reference/current dimensions do not match");
  const estimate = identifyFilteredFingertips(difference);
  if (!estimate) throw new Error("Invalid shadow analysis inputs");
  const keys = getWhiteKeyPolygons(layout);
  const pressedKeys = new Set<number>();
  const candidates = estimate.candidates.map(candidate => {
    const sheet = projectPoint(frameToSheet, {
      x: candidate.x * frameWidth / current.width,
      y: candidate.y * frameHeight / current.height,
    });
    // One candidate maps to one key, including a shared polygon boundary.
    const keyIndex = sheet ? keys.findIndex(key => pointInPolygon(sheet, key)) : -1;
    const dfs = keyIndex < 0 ? null : measureMonotoneShadowPaths(
      difference, estimate.mask, candidate, undefined, { corridorRadius: 4 },
    );
    const decision = dfs?.levels.find(level => level.threshold === cutoff)?.patternMatch ?? null;
    const accepted = decision === true;
    if (accepted) pressedKeys.add(keyIndex);
    return { ...candidate, keyIndex, decision, accepted, dfs: includeDiagnostics ? dfs : null };
  });
  return { pressedKeys, candidates, diagnostics: includeDiagnostics ? { difference, mask: estimate.mask } : null };
}

/** Only key transitions persist: UNKNOWN, rejection and missing tips release. */
export class ShadowKeyTransitions {
  private previous = new Set<number>();
  update(current: ReadonlySet<number>) {
    const result = updateKeyTransitions(this.previous, current);
    this.previous = new Set(current);
    return { pressed: result.pressed.map(keyIndex => ({ keyIndex, velocity: 1 })), released: result.released };
  }
  reset() { return this.update(new Set()); }
}
