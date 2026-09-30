import type { Point } from "./types";

export type ShadowState =
  | "darkening"
  | "hover"
  | "stable"
  | "lifting"
  | "unknown";

export interface ShadowMeasurement {
  available: boolean;
  backgroundLuma: number;
  meanLuma: number;
  shadowStrength: number;
  darkness: number;
  darkArea: number;
  centroid: Point | null;
}

export interface ShadowClassifierOptions {
  shadowStrengthThreshold?: number;
  changeThreshold?: number;
  createMask?: boolean;
}

export interface ShadowObservation {
  measurement: ShadowMeasurement;
  state: ShadowState;
  lumaChange: number | null;
  mask: ImageData | null;
  contour: ShadowContour;
}

export interface ShadowContour {
  areaPixels: number;
  // Boundary pixels are flattened crop indices, supplied only for the preview.
  boundary: Uint16Array | null;
}

export type ShadowContactState = "hover" | "press candidate" | "unknown";

export interface ShadowContactEvaluation {
  state: ShadowContactState;
  peakArea: number | null;
  areaRatio: number | null;
  lastFrameAtMs: number;
  samples: { frameAtMs: number; areaPixels: number }[];
}

export const SHADOW_PRESS_AREA_RATIO = 0.3;
export const SHADOW_PRESS_ABSOLUTE_AREA_PIXELS = 300;
const SHADOW_PEAK_WINDOW_MS = 2000;

/** Use contraction or a small contour; retain the peak during a candidate. */
export function evaluateShadowContact(
  areaPixels: number,
  frameAtMs: number,
  previous: ShadowContactEvaluation | null,
  eligible: boolean,
): ShadowContactEvaluation {
  const empty: ShadowContactEvaluation = {
    state: "unknown",
    peakArea: null,
    areaRatio: null,
    lastFrameAtMs: Number.isFinite(frameAtMs) ? frameAtMs : 0,
    samples: [],
  };
  if (
    !eligible ||
    !Number.isFinite(areaPixels) ||
    areaPixels <= 0 ||
    !Number.isFinite(frameAtMs)
  )
    return empty;
  const continuous =
    previous &&
    frameAtMs > previous.lastFrameAtMs &&
    frameAtMs - previous.lastFrameAtMs <= SHADOW_PEAK_WINDOW_MS;
  const samples = continuous
    ? previous.samples.filter(
        (sample) => frameAtMs - sample.frameAtMs <= SHADOW_PEAK_WINDOW_MS,
      )
    : [];
  samples.push({ frameAtMs, areaPixels });
  const recentPeak = samples.reduce(
    (peak, sample) => Math.max(peak, sample.areaPixels),
    0,
  );
  const peakArea =
    continuous && previous.state === "press candidate"
      ? Math.max(recentPeak, previous.peakArea ?? recentPeak)
      : recentPeak;
  const areaRatio = areaPixels / peakArea;
  const pressCandidate =
    areaRatio <= SHADOW_PRESS_AREA_RATIO ||
    areaPixels < SHADOW_PRESS_ABSOLUTE_AREA_PIXELS;
  return {
    state: pressCandidate ? "press candidate" : "hover",
    peakArea,
    areaRatio,
    lastFrameAtMs: frameAtMs,
    samples,
  };
}

export interface ShadowWorkerRequest {
  imageData: ImageData;
  radius: number;
  previewFingerId: string | null;
  frameAtMs: number;
  fingers: {
    id: string;
    point: Point;
    previous: ShadowMeasurement | null;
    keyOverlap: boolean;
  }[];
}

export interface ShadowWorkerResponse {
  frameAtMs: number;
  observations: {
    id: string;
    observation: ShadowObservation;
    keyOverlap: boolean;
  }[];
}

// Bound work for the visual prototype: sparse training, full crop classification.
const CLUSTER_COUNT = 3;
const MAX_ITERATIONS = 8;
const TRAINING_STRIDE = 4;
const MIN_CLUSTER_LUMA_GAP = 12;
const MAX_CROP_RADIUS = 70;
export const SHADOW_CUTOFF_OFFSET_Y = 0;
const MIN_CONTOUR_PIXELS = 12;
const CONTOUR_NEAR_TIP_RADIUS = 45;

/** Largest 8-connected dark region with at least one pixel near the fingertip. */
function findNearbyContour(
  darkPixels: Uint8Array,
  size: number,
  tip: Point,
  includeBoundary: boolean,
): ShadowContour {
  const queue = new Uint16Array(darkPixels.length);
  let selected: Uint16Array = new Uint16Array(0);
  const nearRadiusSquared = CONTOUR_NEAR_TIP_RADIUS ** 2;
  for (let start = 0; start < darkPixels.length; start += 1) {
    if (darkPixels[start] === 0) continue;
    let head = 0;
    let tail = 1;
    let nearTip = false;
    queue[0] = start;
    darkPixels[start] = 0;
    while (head < tail) {
      const index = queue[head++];
      const x = index % size;
      const y = Math.floor(index / size);
      if ((x - tip.x) ** 2 + (y - tip.y) ** 2 <= nearRadiusSquared)
        nearTip = true;
      for (let dy = -1; dy <= 1; dy += 1) {
        for (let dx = -1; dx <= 1; dx += 1) {
          const nx = x + dx;
          const ny = y + dy;
          if (nx < 0 || nx >= size || ny < 0 || ny >= size) continue;
          const neighbor = ny * size + nx;
          if (darkPixels[neighbor] === 0) continue;
          darkPixels[neighbor] = 0;
          queue[tail++] = neighbor;
        }
      }
    }
    if (nearTip && tail >= MIN_CONTOUR_PIXELS && tail > selected.length) {
      selected = queue.slice(0, tail);
    }
  }
  if (!includeBoundary || selected.length === 0) {
    return { areaPixels: selected.length, boundary: null };
  }
  const membership = new Uint8Array(darkPixels.length);
  for (const index of selected) membership[index] = 1;
  const boundary: number[] = [];
  for (const index of selected) {
    const x = index % size;
    const y = Math.floor(index / size);
    if (
      x === 0 ||
      x === size - 1 ||
      y === 0 ||
      y === size - 1 ||
      membership[index - 1] === 0 ||
      membership[index + 1] === 0 ||
      membership[index - size] === 0 ||
      membership[index + size] === 0
    )
      boundary.push(index);
  }
  return { areaPixels: selected.length, boundary: new Uint16Array(boundary) };
}

function luma(red: number, green: number, blue: number): number {
  return 0.2126 * red + 0.7152 * green + 0.0722 * blue;
}

function colorDistance(
  red: number,
  green: number,
  blue: number,
  centers: Float64Array,
  cluster: number,
): number {
  const offset = cluster * 3;
  return (
    (red - centers[offset]) ** 2 +
    (green - centers[offset + 1]) ** 2 +
    (blue - centers[offset + 2]) ** 2
  );
}

function nearestCluster(
  red: number,
  green: number,
  blue: number,
  centers: Float64Array,
): number {
  let nearest = 0;
  let bestDistance = Infinity;
  for (let cluster = 0; cluster < CLUSTER_COUNT; cluster += 1) {
    const distance = colorDistance(red, green, blue, centers, cluster);
    if (distance < bestDistance) {
      bestDistance = distance;
      nearest = cluster;
    }
  }
  return nearest;
}

/** RGB k-means over the entire fingertip crop. Darkest does not prove shadow. */
export function segmentShadow(
  imageData: ImageData,
  center: Point,
  radius: number,
  createMask = false,
): {
  measurement: ShadowMeasurement;
  mask: ImageData | null;
  contour: ShadowContour;
} {
  const noContour: ShadowContour = { areaPixels: 0, boundary: null };
  const unavailable: ShadowMeasurement = {
    available: false,
    backgroundLuma: 0,
    meanLuma: 0,
    shadowStrength: 0,
    darkness: 0,
    darkArea: 0,
    centroid: null,
  };
  if (
    !Number.isFinite(center.x) ||
    !Number.isFinite(center.y) ||
    !Number.isFinite(radius) ||
    radius < 1 ||
    imageData.width <= 0 ||
    imageData.height <= 0
  ) {
    return { measurement: unavailable, mask: null, contour: noContour };
  }
  const halfSize = Math.min(MAX_CROP_RADIUS, Math.floor(radius));
  const originX = Math.round(center.x) - halfSize;
  const originY = Math.round(center.y) - halfSize;
  const size = halfSize * 2;
  const minX = Math.max(0, originX);
  const minY = Math.max(0, originY);
  const maxX = Math.min(imageData.width, originX + size);
  const maxY = Math.min(imageData.height, originY + size);
  if (minX >= maxX || minY >= maxY)
    return { measurement: unavailable, mask: null, contour: noContour };

  const samples = new Float64Array(
    Math.ceil((maxX - minX) / TRAINING_STRIDE) *
      Math.ceil((maxY - minY) / TRAINING_STRIDE) *
      3,
  );
  let sampleLength = 0;
  let darkestSample = 0;
  let brightestSample = 0;
  let minLuma = Infinity;
  let maxLuma = -Infinity;
  for (let y = minY; y < maxY; y += TRAINING_STRIDE) {
    for (let x = minX; x < maxX; x += TRAINING_STRIDE) {
      const offset = (y * imageData.width + x) * 4;
      const red = imageData.data[offset];
      const green = imageData.data[offset + 1];
      const blue = imageData.data[offset + 2];
      samples[sampleLength] = red;
      samples[sampleLength + 1] = green;
      samples[sampleLength + 2] = blue;
      const brightness = luma(red, green, blue);
      if (brightness < minLuma) {
        minLuma = brightness;
        darkestSample = sampleLength;
      }
      if (brightness > maxLuma) {
        maxLuma = brightness;
        brightestSample = sampleLength;
      }
      sampleLength += 3;
    }
  }

  // Deterministic seeds avoid random changes of the mask between frames.
  const centers = new Float64Array(CLUSTER_COUNT * 3);
  centers.set(samples.subarray(darkestSample, darkestSample + 3), 0);
  centers.set(samples.subarray(brightestSample, brightestSample + 3), 3);
  let thirdSample = darkestSample;
  let largestDistance = -1;
  for (let offset = 0; offset < sampleLength; offset += 3) {
    const distance = Math.min(
      colorDistance(
        samples[offset],
        samples[offset + 1],
        samples[offset + 2],
        centers,
        0,
      ),
      colorDistance(
        samples[offset],
        samples[offset + 1],
        samples[offset + 2],
        centers,
        1,
      ),
    );
    if (distance > largestDistance) {
      largestDistance = distance;
      thirdSample = offset;
    }
  }
  centers.set(samples.subarray(thirdSample, thirdSample + 3), 6);
  const sums = new Float64Array(CLUSTER_COUNT * 3);
  const counts = new Uint32Array(CLUSTER_COUNT);
  for (let iteration = 0; iteration < MAX_ITERATIONS; iteration += 1) {
    sums.fill(0);
    counts.fill(0);
    for (let offset = 0; offset < sampleLength; offset += 3) {
      const cluster = nearestCluster(
        samples[offset],
        samples[offset + 1],
        samples[offset + 2],
        centers,
      );
      counts[cluster] += 1;
      for (let channel = 0; channel < 3; channel += 1)
        sums[cluster * 3 + channel] += samples[offset + channel];
    }
    let movement = 0;
    for (let cluster = 0; cluster < CLUSTER_COUNT; cluster += 1) {
      if (counts[cluster] === 0) continue;
      for (let channel = 0; channel < 3; channel += 1) {
        const offset = cluster * 3 + channel;
        const updated = sums[offset] / counts[cluster];
        movement += (updated - centers[offset]) ** 2;
        centers[offset] = updated;
      }
    }
    if (movement < 1) break;
  }

  let darkestCluster = 0;
  let darkestLuma = Infinity;
  let brightestLuma = -Infinity;
  for (let cluster = 0; cluster < CLUSTER_COUNT; cluster += 1) {
    if (counts[cluster] === 0) continue;
    const offset = cluster * 3;
    const brightness = luma(
      centers[offset],
      centers[offset + 1],
      centers[offset + 2],
    );
    if (brightness < darkestLuma) {
      darkestLuma = brightness;
      darkestCluster = cluster;
    }
    brightestLuma = Math.max(brightestLuma, brightness);
  }
  // Nearly uniform paper should not acquire a black region just because K > 1.
  const hasDarkRegion = brightestLuma - darkestLuma >= MIN_CLUSTER_LUMA_GAP;
  const mask = createMask ? new ImageData(size, size) : null;
  const cutoffY = Math.round(center.y) + SHADOW_CUTOFF_OFFSET_Y;
  const darkPixels = new Uint8Array(size * size);
  let pixelCount = 0;
  let meanSum = 0;
  let darkSum = 0;
  let darkCount = 0;
  let centroidX = 0;
  let centroidY = 0;
  for (let y = minY; y < maxY; y += 1) {
    for (let x = minX; x < maxX; x += 1) {
      const offset = (y * imageData.width + x) * 4;
      const red = imageData.data[offset];
      const green = imageData.data[offset + 1];
      const blue = imageData.data[offset + 2];
      const brightness = luma(red, green, blue);
      const retained = y >= cutoffY;
      const isDark =
        retained &&
        hasDarkRegion &&
        nearestCluster(red, green, blue, centers) === darkestCluster;
      if (retained) {
        meanSum += brightness;
        pixelCount += 1;
      }
      const cropIndex = (y - originY) * size + x - originX;
      if (isDark) {
        darkPixels[cropIndex] = 1;
        darkSum += brightness;
        darkCount += 1;
        centroidX += x;
        centroidY += y;
      }
      if (mask) {
        const maskOffset = cropIndex * 4;
        const value = isDark ? 0 : 255;
        mask.data[maskOffset] = value;
        mask.data[maskOffset + 1] = value;
        mask.data[maskOffset + 2] = value;
        mask.data[maskOffset + 3] = 255;
      }
    }
  }
  const contour = findNearbyContour(
    darkPixels,
    size,
    { x: halfSize, y: halfSize },
    createMask,
  );
  const strength =
    darkCount === 0 ? 0 : Math.max(0, brightestLuma - darkSum / darkCount);
  return {
    measurement: {
      available: pixelCount > 0,
      backgroundLuma: brightestLuma,
      meanLuma: pixelCount === 0 ? 0 : meanSum / pixelCount,
      shadowStrength: strength,
      darkness: strength,
      darkArea: pixelCount === 0 ? 0 : darkCount / pixelCount,
      centroid:
        darkCount === 0
          ? null
          : { x: centroidX / darkCount, y: centroidY / darkCount },
    },
    mask,
    contour,
  };
}

/** Brightness transitions remain diagnostic; they do not establish contact. */
export function classifyShadow(
  current: ShadowMeasurement,
  previous: ShadowMeasurement | null,
  options: ShadowClassifierOptions = {},
): ShadowState {
  if (!current.available) return "unknown";
  const shadowStrengthThreshold = options.shadowStrengthThreshold ?? 4;
  const changeThreshold = options.changeThreshold ?? 2;
  if (previous?.available) {
    const lumaChange = previous.meanLuma - current.meanLuma;
    if (lumaChange >= changeThreshold) return "darkening";
    if (lumaChange <= -changeThreshold) return "lifting";
  }
  return current.shadowStrength <= shadowStrengthThreshold ? "hover" : "stable";
}

export function observeShadow(
  imageData: ImageData,
  center: Point,
  radius: number,
  previous: ShadowMeasurement | null,
  options: ShadowClassifierOptions = {},
): ShadowObservation {
  const { measurement, mask, contour } = segmentShadow(
    imageData,
    center,
    radius,
    options.createMask,
  );
  const lumaChange =
    measurement.available && previous?.available
      ? previous.meanLuma - measurement.meanLuma
      : null;
  return {
    measurement,
    state: classifyShadow(measurement, previous, options),
    lumaChange,
    mask,
    contour,
  };
}
