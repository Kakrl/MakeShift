import type { CandidateFilter, ShadowDifference } from "./shadowHeatmap";

export interface ShadowSampleContext {
  source: { id: string; name: string; kind: "image" | "video"; nativeWidth: number; nativeHeight: number; timeSeconds: number | null; frame: number | null; frameIdentity: "approximate" | "replay-index" | null; fps: number | null };
  reference: { id: string; name: string; timeSeconds: number | null };
}
export interface ShadowSampleSettings extends CandidateFilter {
  noiseFloor: number;
  fullScale: number;
  residualScale: number;
  minimumReferenceLuma: number;
}
export const SAMPLE_LABELS = ["paper", "shadow", "skin", "nail", "ink", "boundary", "ambiguous"] as const;
export const SAMPLE_PHASES = ["unspecified", "hover", "approach", "touch", "hold", "release"] as const;
export type SampleLabel = typeof SAMPLE_LABELS[number];
export type SamplePhase = typeof SAMPLE_PHASES[number];
const finite = (n: number) => Number.isFinite(n) ? n : null;

/** Store small raw patches so both methods can be re-evaluated without reloading media. */
export function captureShadowSample(
  difference: ShadowDifference, current: ImageData, reference: ImageData,
  context: ShadowSampleContext, settings: ShadowSampleSettings,
  selection: { x: number; y: number; size: number; label: SampleLabel; phase: SamplePhase; note: string },
) {
  const { width, height } = difference;
  if (current.width !== width || current.height !== height || reference.width !== width || reference.height !== height ||
    !Number.isInteger(selection.x) || !Number.isInteger(selection.y) || selection.x < 0 || selection.y < 0 ||
    selection.x >= width || selection.y >= height || ![1, 3, 5, 9].includes(selection.size)) return null;
  const radius = Math.floor(selection.size / 2);
  const bounds = { x: Math.max(0, selection.x - radius), y: Math.max(0, selection.y - radius),
    right: Math.min(width, selection.x + radius + 1), bottom: Math.min(height, selection.y + radius + 1) };
  const pixels = [];
  for (let y = bounds.y; y < bounds.bottom; y += 1) for (let x = bounds.x; x < bounds.right; x += 1) {
    const i = y * width + x; const offset = i * 4;
    const valid = !!difference.valid[i];
    const projectionValid = !!difference.projectionValid[i];
    const colorKnown = valid && Number.isFinite(difference.colorShift[i]);
    const projectionKnown = projectionValid && Number.isFinite(difference.residualCurrent[i]);
    const darkened = valid && difference.lumaDrop[i] > settings.noiseFloor;
    pixels.push({ x, y, currentRgb: Array.from(current.data.slice(offset, offset + 3)), referenceRgb: Array.from(reference.data.slice(offset, offset + 3)),
      currentAlpha: current.data[offset + 3], referenceAlpha: reference.data[offset + 3], valid, projectionValid,
      lumaDrop: valid ? finite(difference.lumaDrop[i]) : null, colorShift: colorKnown ? finite(difference.colorShift[i]) : null,
      multiplier: finite(difference.multiplier[i]), attenuation: finite(difference.attenuation[i]),
      residualReference: finite(difference.residualReference[i]), residualCurrent: finite(difference.residualCurrent[i]),
      retainedByColor: colorKnown ? darkened && difference.colorShift[i] <= settings.maximumColorShift : null,
      retainedByProjection: projectionKnown ? darkened && difference.residualCurrent[i] <= settings.maximumResidual : null });
  }
  return { context: structuredClone(context), settings: { ...settings }, selection: { ...selection },
    analysis: { width, height, coordinateSpace: "downsampled-analysis-pixels" as const }, bounds, pixels,
    counts: { total: pixels.length, colorRetained: pixels.filter((p) => p.retainedByColor === true).length,
      projectionRetained: pixels.filter((p) => p.retainedByProjection === true).length,
      colorUnknown: pixels.filter((p) => p.retainedByColor === null).length,
      projectionUnknown: pixels.filter((p) => p.retainedByProjection === null).length } };
}
export type ShadowSample = NonNullable<ReturnType<typeof captureShadowSample>> & { id: string; savedAt: string };
export interface ShadowSampleFrame {
  difference: ShadowDifference;
  current: ImageData;
  reference: ImageData;
  context: ShadowSampleContext;
}
