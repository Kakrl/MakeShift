import type { Point } from "./types";

export const DARK_SHADOW_THRESHOLD_LUMA = 60;
export const DARK_SHADOW_MAX_LUMA = 100;
export const DARK_SHADOW_MAX_RGB_CHANNEL = 120;
export const SKIN_RED_GREEN_DIFFERENCE = 20;
export const DARK_SHADOW_REGION_HALF_WIDTH = 40;
export const DARK_SHADOW_REGION_DEPTH = 45;
export const SHADOW_PROBE_LENGTH_PX = 45;
export const SHADOW_PROBE_REGION_HALF_WIDTH = 30;
export const SHADOW_PROBE_ANGLES_DEGREES = [-35, -18, 0, 18, 35] as const;

export interface DarkShadowFilter {
  minLumaDrop: number;
  maxLuma: number;
  maxRgbChannel: number;
  maxRedGreenDifference: number;
}

export const DEFAULT_DARK_SHADOW_FILTER: Readonly<DarkShadowFilter> = {
  minLumaDrop: DARK_SHADOW_THRESHOLD_LUMA,
  maxLuma: DARK_SHADOW_MAX_LUMA,
  maxRgbChannel: DARK_SHADOW_MAX_RGB_CHANNEL,
  maxRedGreenDifference: SKIN_RED_GREEN_DIFFERENCE,
};

export interface ShadowProbeRun {
  angleDegrees: number;
  points: Point[];
}

export interface DarkShadowSize {
  center: Point;
  majorRadius: number;
  minorRadius: number;
  rotation: number;
  areaPx: number;
  runs: ShadowProbeRun[];
}

export interface DarkShadowRegion {
  left: number;
  top: number;
  width: number;
  height: number;
  mask: Uint8Array;
  area: number;
  meanLumaDrop: number | null;
}

export function isDarkShadowPixel(
  image: ImageData,
  background: ImageData | null,
  x: number,
  y: number,
  backgroundOrigin: Point = { x: 0, y: 0 },
  filter: Readonly<DarkShadowFilter> = DEFAULT_DARK_SHADOW_FILTER,
): boolean {
  const backgroundX = x + backgroundOrigin.x;
  const backgroundY = y + backgroundOrigin.y;
  if (
    !background ||
    x < 0 ||
    x >= image.width ||
    y < 0 ||
    y >= image.height ||
    backgroundX < 0 ||
    backgroundX >= background.width ||
    backgroundY < 0 ||
    backgroundY >= background.height
  ) {
    return false;
  }
  const offset = (y * image.width + x) * 4;
  const backgroundOffset = (backgroundY * background.width + backgroundX) * 4;
  const red = image.data[offset];
  const green = image.data[offset + 1];
  const blue = image.data[offset + 2];
  const luma = 0.2126 * red + 0.7152 * green + 0.0722 * blue;
  const backgroundLuma =
    0.2126 * background.data[backgroundOffset] +
    0.7152 * background.data[backgroundOffset + 1] +
    0.0722 * background.data[backgroundOffset + 2];
  return (
    backgroundLuma - luma >= filter.minLumaDrop &&
    luma <= filter.maxLuma &&
    Math.max(red, green, blue) <= filter.maxRgbChannel &&
    red - green <= filter.maxRedGreenDifference
  );
}

export function findDarkShadowSize(
  image: ImageData,
  background: ImageData | null,
  tip: Point,
  backgroundOrigin: Point = { x: 0, y: 0 },
  filter: Readonly<DarkShadowFilter> = DEFAULT_DARK_SHADOW_FILTER,
): DarkShadowSize | null {
  if (!background) return null;
  const runs: ShadowProbeRun[] = [];
  const samples: Point[] = [];
  for (const angleDegrees of SHADOW_PROBE_ANGLES_DEGREES) {
    const radians = (angleDegrees * Math.PI) / 180;
    const points: Point[] = [];
    let enteredDarkRun = false;
    for (let step = 1; step <= SHADOW_PROBE_LENGTH_PX; step += 1) {
      const point = {
        x: Math.round(tip.x + Math.sin(radians) * step),
        y: Math.round(tip.y + Math.cos(radians) * step),
      };
      if (isDarkShadowPixel(image, background, point.x, point.y, backgroundOrigin, filter)) {
        enteredDarkRun = true;
        points.push(point);
        continue;
      }
      if (enteredDarkRun) break;
    }
    if (points.length) {
      runs.push({ angleDegrees, points });
      samples.push(...points);
    }
  }
  if (runs.length < 2 || samples.length < 4) return null;
  return fitProbeEllipse(samples, runs);
}

function fitProbeEllipse(points: Point[], runs: ShadowProbeRun[]): DarkShadowSize {
  const mean = points.reduce(
    (sum, point) => ({ x: sum.x + point.x / points.length, y: sum.y + point.y / points.length }),
    { x: 0, y: 0 },
  );
  let xx = 0;
  let yy = 0;
  let xy = 0;
  for (const point of points) {
    const dx = point.x - mean.x;
    const dy = point.y - mean.y;
    xx += dx * dx;
    yy += dy * dy;
    xy += dx * dy;
  }
  const rotation = 0.5 * Math.atan2(2 * xy, xx - yy);
  const majorAxis = { x: Math.cos(rotation), y: Math.sin(rotation) };
  const minorAxis = { x: -majorAxis.y, y: majorAxis.x };
  const major = points.map((point) =>
    (point.x - mean.x) * majorAxis.x + (point.y - mean.y) * majorAxis.y,
  );
  const minor = points.map((point) =>
    (point.x - mean.x) * minorAxis.x + (point.y - mean.y) * minorAxis.y,
  );
  const minMajor = Math.min(...major);
  const maxMajor = Math.max(...major);
  const minMinor = Math.min(...minor);
  const maxMinor = Math.max(...minor);
  const centerMajor = (minMajor + maxMajor) / 2;
  const centerMinor = (minMinor + maxMinor) / 2;
  const majorRadius = Math.max(2, (maxMajor - minMajor) / 2);
  const minorRadius = Math.max(2, (maxMinor - minMinor) / 2);
  return {
    center: {
      x: mean.x + centerMajor * majorAxis.x + centerMinor * minorAxis.x,
      y: mean.y + centerMajor * majorAxis.y + centerMinor * minorAxis.y,
    },
    majorRadius,
    minorRadius,
    rotation,
    areaPx: Math.PI * majorRadius * minorRadius,
    runs,
  };
}

/** Static diagnostic only: find strongly darkened pixels below a fingertip. */
export function analyzeDarkShadowRegion(
  image: ImageData,
  background: ImageData | null,
  tip: Point,
  filter: Readonly<DarkShadowFilter> = DEFAULT_DARK_SHADOW_FILTER,
): DarkShadowRegion | null {
  if (!background || image.width !== background.width || image.height !== background.height) {
    return null;
  }
  const left = Math.max(0, Math.round(tip.x) - DARK_SHADOW_REGION_HALF_WIDTH);
  const right = Math.min(image.width - 1, Math.round(tip.x) + DARK_SHADOW_REGION_HALF_WIDTH);
  const top = Math.max(0, Math.round(tip.y) + 2);
  const bottom = Math.min(image.height - 1, Math.round(tip.y) + DARK_SHADOW_REGION_DEPTH);
  const width = Math.max(0, right - left + 1);
  const height = Math.max(0, bottom - top + 1);
  const mask = new Uint8Array(width * height);
  let area = 0;
  let totalDrop = 0;
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const imageX = left + x;
      const imageY = top + y;
      const offset = (imageY * image.width + imageX) * 4;
      const luma = 0.2126 * image.data[offset] +
        0.7152 * image.data[offset + 1] + 0.0722 * image.data[offset + 2];
      const backgroundLuma = 0.2126 * background.data[offset] +
        0.7152 * background.data[offset + 1] + 0.0722 * background.data[offset + 2];
      const drop = backgroundLuma - luma;
      if (isDarkShadowPixel(image, background, imageX, imageY, { x: 0, y: 0 }, filter)) {
        mask[y * width + x] = 1;
        area += 1;
        totalDrop += drop;
      }
    }
  }
  return { left, top, width, height, mask, area, meanLumaDrop: area ? totalDrop / area : null };
}

export interface ShadowBandMetrics {
  sampledPixels: number;
  darkPixels: number;
  darkFraction: number;
  /** Background-relative darkening, summed only over strict dark pixels. */
  darknessSum: number;
  /** Includes zero contributions from non-dark pixels. */
  darknessPerPixel: number;
}

export interface ShadowEvidence {
  near: ShadowBandMetrics | null;
  forward: ShadowBandMetrics | null;
  /** Row-mean strict darkness, 2–45 pixels below the landmark. */
  rowDarkness: Array<number | null>;
  maxSpatialGradient: number | null;
}

/** Diagnostic measurements only; the near band is not a located contact edge. */
export function measureShadowEvidence(
  image: ImageData,
  background: ImageData | null,
  tip: Point,
  filter: Readonly<DarkShadowFilter> = DEFAULT_DARK_SHADOW_FILTER,
): ShadowEvidence | null {
  if (!Number.isFinite(tip.x) || !Number.isFinite(tip.y)) return null;
  const region = analyzeDarkShadowRegion(image, background, tip, filter);
  if (!region || !background || !region.width || !region.height) return null;
  const totals = [
    { sampledPixels: 0, darkPixels: 0, darknessSum: 0 },
    { sampledPixels: 0, darkPixels: 0, darknessSum: 0 },
  ];
  const rowDarkness: Array<number | null> = Array(44).fill(null);
  for (let y = 0; y < region.height; y += 1) {
    const depth = region.top + y - Math.round(tip.y);
    if (depth < 2 || depth > 45) continue;
    const band = totals[depth <= 10 ? 0 : 1];
    let rowSum = 0;
    for (let x = 0; x < region.width; x += 1) {
      band.sampledPixels += 1;
      if (!region.mask[y * region.width + x]) continue;
      const offset = ((region.top + y) * image.width + region.left + x) * 4;
      const drop = 0.2126 * (background.data[offset] - image.data[offset]) +
        0.7152 * (background.data[offset + 1] - image.data[offset + 1]) +
        0.0722 * (background.data[offset + 2] - image.data[offset + 2]);
      band.darkPixels += 1;
      band.darknessSum += drop;
      rowSum += drop;
    }
    rowDarkness[depth - 2] = rowSum / region.width;
  }
  const bands = totals.map((band): ShadowBandMetrics | null => band.sampledPixels ? {
    ...band,
    darkFraction: band.darkPixels / band.sampledPixels,
    darknessPerPixel: band.darknessSum / band.sampledPixels,
  } : null);
  const gradients = rowDarkness.slice(1).flatMap((value, index) => {
    const previous = rowDarkness[index];
    return value === null || previous === null ? [] : [Math.abs(value - previous)];
  });
  return {
    near: bands[0],
    forward: bands[1],
    rowDarkness,
    maxSpatialGradient: gradients.length ? Math.max(...gradients) : null,
  };
}

export function compareShadowEvidence(previous: ShadowEvidence, current: ShadowEvidence) {
  return {
    nearDarknessDelta: previous.near && current.near
      ? current.near.darknessPerPixel - previous.near.darknessPerPixel : null,
    forwardDarknessDelta: previous.forward && current.forward
      ? current.forward.darknessPerPixel - previous.forward.darknessPerPixel : null,
    spatialGradientDelta: previous.maxSpatialGradient !== null && current.maxSpatialGradient !== null
      ? current.maxSpatialGradient - previous.maxSpatialGradient : null,
  };
}

/** Compact horizontal mask spans for diagnostic overlays and cached frames. */
export function darkShadowRuns(region: DarkShadowRegion | null): Array<[number, number, number]> {
  const runs: Array<[number, number, number]> = [];
  if (!region) return runs;
  for (let y = 0; y < region.height; y += 1) {
    let start = -1;
    for (let x = 0; x <= region.width; x += 1) {
      const dark = x < region.width && region.mask[y * region.width + x] === 1;
      if (dark && start < 0) start = x;
      if (!dark && start >= 0) {
        runs.push([region.left + start, region.top + y, x - start]);
        start = -1;
      }
    }
  }
  return runs;
}
