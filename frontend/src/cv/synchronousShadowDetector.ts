import type { Point } from "./types";

export interface ShadowRayMeasurement {
  label: "center" | "left 20°" | "right 20°";
  target: Point;
  values: number[];
  smoothedValues: number[];
  minimumIndex: number | null;
  reboundIndex: number | null;
  dipDepth: number | null;
  steepestRise: number | null;
  reboundWidth: number | null;
  sharpRebound: boolean;
}

export interface SynchronousShadowMeasurement {
  rays: ShadowRayMeasurement[];
  state: "press candidate" | "hover" | "unknown";
  backgroundAvailable: boolean;
  changedPixels: number | null;
  meanBackgroundDifference: number | null;
}

export interface SynchronousShadowOptions {
  minDip?: number;
  maxDip?: number;
  minRisePerPixel?: number;
  maxReboundWidth?: number;
  /** A difference below this luma value counts as unchanged background. */
  backgroundDifferenceThreshold?: number;
}

const SIDE_ANGLE = (20 * Math.PI) / 180;
const RAY_LENGTH = 45;
export const SYNCHRONOUS_SHADOW_CROP = {
  halfWidth: 24,
  aboveTip: 18,
  belowTip: 50,
} as const;
const MIN_DIP = 8;
const MAX_DIP = 50;
const MIN_RISE_PER_PIXEL = 20;
const MAX_REBOUND_WIDTH = 6;
const REBOUND_FRACTION = 0.8;
const BACKGROUND_DIFFERENCE_THRESHOLD = 12;

function lumaAt(pixels: Uint8ClampedArray, width: number, x: number, y: number) {
  const offset = (y * width + x) * 4;
  return (
    0.2126 * pixels[offset] +
    0.7152 * pixels[offset + 1] +
    0.0722 * pixels[offset + 2]
  );
}

function smooth(values: readonly number[]) {
  return values.map((value, index) => {
    const start = Math.max(0, index - 1);
    const end = Math.min(values.length - 1, index + 1);
    let sum = 0;
    for (let i = start; i <= end; i += 1) sum += values[i];
    return sum / (end - start + 1);
  });
}

function rebound(
  values: readonly number[],
  minRisePerPixel: number,
  maxReboundWidth: number,
) {
  if (values.length < 12)
    return {
      minimumIndex: null,
      reboundIndex: null,
      dipDepth: null,
      steepestRise: null,
      reboundWidth: null,
      sharpRebound: false,
    };
  const tailStart = values.length - 6;
  const paper = values.slice(tailStart).reduce((sum, value) => sum + value, 0) /
    (values.length - tailStart);
  let minimumIndex = 2;
  for (let i = 3; i < tailStart - 1; i += 1)
    if (values[i] < values[minimumIndex]) minimumIndex = i;
  const shoulderStart = Math.max(0, minimumIndex - 6);
  const shoulderEnd = Math.max(shoulderStart + 1, minimumIndex - 1);
  const shoulder = values.slice(shoulderStart, shoulderEnd).reduce(
    (sum, value) => sum + value,
    0,
  ) / (shoulderEnd - shoulderStart);
  const dipDepth = shoulder - values[minimumIndex];
  const rise = paper - values[minimumIndex];
  if (rise <= 0)
    return {
      minimumIndex,
      reboundIndex: null,
      dipDepth,
      steepestRise: null,
      reboundWidth: null,
      sharpRebound: false,
    };
  const target = values[minimumIndex] + rise * REBOUND_FRACTION;
  let reboundIndex: number | null = null;
  let steepestRise = 0;
  for (let i = minimumIndex + 1; i < values.length; i += 1) {
    steepestRise = Math.max(steepestRise, values[i] - values[i - 1]);
    if (values[i] >= target) {
      reboundIndex = i;
      break;
    }
  }
  const reboundWidth = reboundIndex === null ? null : reboundIndex - minimumIndex;
  return {
    minimumIndex,
    reboundIndex,
    dipDepth,
    steepestRise,
    reboundWidth,
    sharpRebound: steepestRise >= minRisePerPixel &&
      reboundWidth !== null && reboundWidth <= maxReboundWidth,
  };
}

/** Analyze a crop already sampled from the current camera frame. */
export function analyzeSynchronousShadow(
  image: ImageData,
  center: Point,
  background?: ImageData | null,
  options: SynchronousShadowOptions = {},
): SynchronousShadowMeasurement {
  const minRise = options.minRisePerPixel ?? MIN_RISE_PER_PIXEL;
  const maxWidth = options.maxReboundWidth ?? MAX_REBOUND_WIDTH;
  const rays = ([
    ["center", 0],
    ["left 20°", -SIDE_ANGLE],
    ["right 20°", SIDE_ANGLE],
  ] as const).map(([label, angle]) => {
    const values: number[] = [];
    for (let step = 0; step <= RAY_LENGTH; step += 1) {
      const x = Math.round(center.x + Math.sin(angle) * step);
      const y = Math.round(center.y + Math.cos(angle) * step);
      if (x < 0 || x >= image.width || y < 0 || y >= image.height) continue;
      values.push(lumaAt(image.data, image.width, x, y));
    }
    const smoothedValues = smooth(values);
    return {
      label,
      target: {
        x: center.x + Math.sin(angle) * RAY_LENGTH,
        y: center.y + Math.cos(angle) * RAY_LENGTH,
      },
      values,
      smoothedValues,
      ...rebound(smoothedValues, minRise, maxWidth),
    };
  });
  const centerRay = rays[0];
  const minDip = options.minDip ?? MIN_DIP;
  const maxDip = options.maxDip ?? MAX_DIP;
  const candidate = centerRay.sharpRebound &&
    centerRay.dipDepth !== null &&
    centerRay.dipDepth >= minDip &&
    centerRay.dipDepth <= maxDip &&
    (centerRay.steepestRise ?? 0) >= minRise &&
    (centerRay.reboundWidth ?? Infinity) <= maxWidth;

  let changedPixels: number | null = null;
  let meanBackgroundDifference: number | null = null;
  const backgroundAvailable = Boolean(
    background && background.width === image.width &&
      background.height === image.height,
  );
  if (backgroundAvailable && background) {
    let totalDifference = 0;
    let changed = 0;
    let total = 0;
    // Background comparison is diagnostic only. Reuse the detector's sparse
    // ray locations instead of scanning every pixel in the surrounding crop.
    for (const angle of [0, -SIDE_ANGLE, SIDE_ANGLE]) {
      for (let step = 0; step <= RAY_LENGTH; step += 1) {
        const x = Math.round(center.x + Math.sin(angle) * step);
        const y = Math.round(center.y + Math.cos(angle) * step);
        if (x < 0 || x >= image.width || y < 0 || y >= image.height) continue;
        const difference = Math.abs(
          lumaAt(image.data, image.width, x, y) -
            lumaAt(background.data, background.width, x, y),
        );
        totalDifference += difference;
        total += 1;
        if (difference >= (options.backgroundDifferenceThreshold ?? BACKGROUND_DIFFERENCE_THRESHOLD))
          changed += 1;
      }
    }
    changedPixels = changed;
    meanBackgroundDifference = total ? totalDifference / total : 0;
  }

  return {
    rays,
    state: centerRay.values.length < 12 ? "unknown" : candidate ? "press candidate" : "hover",
    backgroundAvailable,
    changedPixels,
    meanBackgroundDifference,
  };
}
