/** Diagnostic image subtraction only. No hand, region, or contact classification. */
export interface ShadowDifference {
  width: number;
  height: number;
  /** Signed background minus current luma; positive means darker now. */
  lumaDrop: Float32Array;
  /** Maximum change of normalized RGB channel proportions, scaled to 0–255. */
  colorShift: Float32Array;
  /** Raw projection values; NaN when the reference is invalid. */
  multiplier: Float32Array;
  attenuation: Float32Array;
  residualReference: Float32Array;
  residualCurrent: Float32Array;
  /** Adequate reference and current signal for color-model interpretation. */
  projectionValid: Uint8Array;
  valid: Uint8Array;
  sampledPixels: number;
  maxDarkening: number;
  meanDarkening: number;
}

export function measureShadowDifference(
  current: ImageData,
  reference: ImageData,
  minimumReferenceLuma = 40,
): ShadowDifference | null {
  if (current.width !== reference.width || current.height !== reference.height ||
    !current.width || !current.height) return null;
  const count = current.width * current.height;
  const lumaDrop = new Float32Array(count);
  const colorShift = new Float32Array(count);
  const valid = new Uint8Array(count);
  const multiplier = new Float32Array(count).fill(NaN);
  const attenuation = new Float32Array(count).fill(NaN);
  const residualReference = new Float32Array(count).fill(NaN);
  const residualCurrent = new Float32Array(count).fill(NaN);
  const projectionValid = new Uint8Array(count);
  let sampledPixels = 0;
  let maxDarkening = 0;
  let totalDarkening = 0;
  for (let pixel = 0; pixel < count; pixel += 1) {
    const i = pixel * 4;
    const r = current.data[i]; const g = current.data[i + 1]; const b = current.data[i + 2];
    const rr = reference.data[i]; const rg = reference.data[i + 1]; const rb = reference.data[i + 2];
    const referenceLuma = 0.2126 * rr + 0.7152 * rg + 0.0722 * rb;
    if (!current.data[i + 3] || !reference.data[i + 3] || referenceLuma < minimumReferenceLuma) continue;
    valid[pixel] = 1;
    sampledPixels += 1;
    const drop = referenceLuma - (0.2126 * r + 0.7152 * g + 0.0722 * b);
    lumaDrop[pixel] = drop;
    const darkness = Math.max(0, drop);
    totalDarkening += darkness;
    maxDarkening = Math.max(maxDarkening, darkness);
    const sum = r + g + b;
    const referenceSum = rr + rg + rb;
    const referenceSquared = rr * rr + rg * rg + rb * rb;
    if (referenceSquared > 0) {
      const a = (r * rr + g * rg + b * rb) / referenceSquared;
      const residual = Math.hypot(r - a * rr, g - a * rg, b - a * rb);
      const currentNorm = Math.hypot(r, g, b);
      multiplier[pixel] = a;
      attenuation[pixel] = 1 - a;
      residualReference[pixel] = residual / Math.sqrt(referenceSquared);
      // Keep raw values for inspection, but do not interpret near-black color.
      residualCurrent[pixel] = currentNorm > 0 ? residual / currentNorm : NaN;
      projectionValid[pixel] = sum >= 15 && referenceSum >= 15 ? 1 : 0;
    }
    // Near-black pixels carry too little color information to infer chromaticity.
    colorShift[pixel] = sum < 15 || referenceSum < 15 ? NaN : 255 * Math.max(
      Math.abs(r / sum - rr / referenceSum),
      Math.abs(g / sum - rg / referenceSum),
      Math.abs(b / sum - rb / referenceSum),
    );
  }
  return {
    width: current.width, height: current.height, lumaDrop, colorShift, valid,
    multiplier, attenuation, residualReference, residualCurrent, projectionValid,
    sampledPixels, maxDarkening, meanDarkening: sampledPixels ? totalDarkening / sampledPixels : 0,
  };
}

type Rgb = readonly [number, number, number];
export interface HeatmapPalette {
  stops: readonly [Rgb, Rgb, Rgb, Rgb];
  unavailable: Rgb;
}

export type ShadowMapMode = "darkening" | "color" | "multiplier" | "attenuation" |
  "residualReference" | "residualCurrent" | "candidate";
export interface CandidateFilter {
  method: "color" | "projection";
  maximumColorShift: number;
  maximumResidual: number;
}

export function colorizeShadowDifference(
  difference: ShadowDifference,
  mode: ShadowMapMode,
  noiseFloor: number,
  fullScale: number,
  palette: HeatmapPalette,
  filter: CandidateFilter = { method: "color", maximumColorShift: 10, maximumResidual: 0.15 },
): Uint8ClampedArray {
  const pixels = new Uint8ClampedArray(difference.width * difference.height * 4);
  const range = Math.max(Number.EPSILON, fullScale - noiseFloor);
  for (let i = 0; i < difference.valid.length; i += 1) {
    let value = mode === "darkening" || mode === "candidate" ? difference.lumaDrop[i] :
      mode === "color" ? difference.colorShift[i] : difference[mode][i];
    let eligible = !!difference.valid[i];
    if (mode === "candidate") {
      const mismatch = filter.method === "color" ? difference.colorShift[i] : difference.residualCurrent[i];
      eligible = eligible && Number.isFinite(mismatch) &&
        (filter.method === "color" || !!difference.projectionValid[i]);
      const limit = filter.method === "color" ? filter.maximumColorShift : filter.maximumResidual;
      if (mismatch > limit) value = 0;
    } else if (mode !== "darkening" && mode !== "color") {
      eligible = eligible && !!difference.projectionValid[i];
    }
    const offset = i * 4;
    if (eligible && Number.isFinite(value)) {
      const strength = Math.max(0, Math.min(1, (value - noiseFloor) / range));
      const position = strength * 3;
      const segment = Math.min(2, Math.floor(position));
      const t = position - segment;
      for (let channel = 0; channel < 3; channel += 1) {
        pixels[offset + channel] = palette.stops[segment][channel] +
          t * (palette.stops[segment + 1][channel] - palette.stops[segment][channel]);
      }
    } else {
      for (let channel = 0; channel < 3; channel += 1) pixels[offset + channel] = palette.unavailable[channel];
    }
    pixels[offset + 3] = 255;
  }
  return pixels;
}

/** Resolve the shared heatmap palette from the application's theme tokens. */
export function readHeatmapPalette(): HeatmapPalette {
  const style = getComputedStyle(document.documentElement);
  const canvas = document.createElement("canvas"); canvas.width = 1; canvas.height = 1;
  const context = canvas.getContext("2d")!;
  const rgb = (token: string): [number, number, number] => {
    context.fillStyle = style.getPropertyValue(token).trim(); context.fillRect(0, 0, 1, 1);
    const value = context.getImageData(0, 0, 1, 1).data;
    return [value[0], value[1], value[2]];
  };
  return { stops: [rgb("--color-surface-dark"), rgb("--color-blue"), rgb("--color-yellow"), rgb("--color-red")], unavailable: rgb("--color-control-inactive") };
}

/** Offline boundary proposal: valid darkened pixels rejected by the shadow
 * color filter. Do not invert the rendered black map: clear paper, ink and
 * unavailable pixels must not become finger geometry. Not a skin segmenter.
 */
export function filteredDarkeningBoundaryMask(difference: ShadowDifference,
  filter: CandidateFilter = { method: "projection", maximumColorShift: 10, maximumResidual: 0.12 }) {
  const mask = new Uint8Array(difference.width * difference.height);
  for (let i = 0; i < mask.length; i += 1) {
    const mismatch = filter.method === "color" ? difference.colorShift[i] : difference.residualCurrent[i];
    if (difference.valid[i] && Number.isFinite(difference.lumaDrop[i]) && difference.lumaDrop[i] > 5 &&
      Number.isFinite(mismatch) && (filter.method !== "projection" || difference.projectionValid[i]) &&
      mismatch > (filter.method === "color" ? filter.maximumColorShift : filter.maximumResidual)) mask[i] = 1;
  }
  return mask;
}

