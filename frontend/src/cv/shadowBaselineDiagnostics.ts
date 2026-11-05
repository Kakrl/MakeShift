import type { detectShadowBaseline } from "./liveShadowBaseline";

export type BaselineCandidate = ReturnType<typeof detectShadowBaseline>["candidates"][number];
export type BaselineDfs = NonNullable<BaselineCandidate["dfs"]>;
export type BaselineLevel = BaselineDfs["levels"][number];
export type BaselineSnapshot = Pick<BaselineCandidate, "id" | "x" | "y" | "width" | "keyIndex" | "decision" | "accepted">;

/** Paused-frame integrity check, not a cryptographic provenance digest. */
export function shadowPixelFingerprint(image: ImageData) {
  let hash = 2166136261;
  for (const value of [image.width, image.height]) hash = Math.imul(hash ^ value, 16777619) >>> 0;
  for (const value of image.data) hash = Math.imul(hash ^ value, 16777619) >>> 0;
  return hash.toString(16).padStart(8, "0");
}

export function baselineSnapshot(candidates: readonly BaselineSnapshot[]): BaselineSnapshot[] {
  return candidates.map(({ id, x, y, width, keyIndex, decision, accepted }) =>
    ({ id, x, y, width, keyIndex, decision, accepted }));
}

export function explainShadowDecision(keyIndex: number, dfs: BaselineDfs | null, level: BaselineLevel | undefined) {
  if (keyIndex < 0) return { label: "EXCLUDED", reason: "Outside the calibrated white keys. DFS was not run; this proposal cannot activate a key." };
  if (!dfs || !level) return { label: "UNKNOWN", reason: "DFS measurements are unavailable. This proposal contributes no press." };
  if (level.downwardVeto) return { label: "NO PRESS", reason: `A downward path reaches the veto row y=${dfs.downwardY} at (${level.rejectionPixel?.x}, ${level.rejectionPixel?.y}). Any downward witness vetoes, even when an upward path also succeeds.` };
  if (!level.upwardReached && !level.upwardUnknown) return { label: "NO PRESS", reason: `No upward path reaches support row y=${dfs.upwardY}, with no unavailable upward evidence. Upward support is required.` };
  if (level.downwardUnknown || !level.upwardReached) return { label: "UNKNOWN", reason: !dfs.crossSection.complete
    ? "The local finger cross-section is incomplete or merged. The boundary cannot establish contact; this proposal contributes no press."
    : "Incomplete boundary or unavailable pixels leave downward clearance or upward support uncertain. This proposal contributes no press." };
  return { label: "PRESS", reason: `An upward path reaches support row y=${dfs.upwardY} at (${level.supportingPixel?.x}, ${level.supportingPixel?.y}); no downward path reaches veto row y=${dfs.downwardY}, and downward evidence is available.` };
}
