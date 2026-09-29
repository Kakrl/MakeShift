import { FINGERTIP_LANDMARK_INDICES } from "./collision";

export const DEPTH_CALIBRATION_POSITIONS = [
  "front",
  "middle",
  "back",
] as const;

export const DEPTH_CALIBRATION_STORAGE_KEY = "depthCalibrationLines";

export type DepthCalibrationPosition =
  (typeof DEPTH_CALIBRATION_POSITIONS)[number];

export const DEPTH_FINGERS = [
  "thumb",
  "index",
  "middle",
  "ring",
  "pinky",
] as const;

export type DepthFinger = (typeof DEPTH_FINGERS)[number];

export type DepthBoundarySide = "greater" | "less";

/** The prototype treats larger sheet Y as below the fitted boundary. */
export const DEPTH_BOUNDARY_SIDE: DepthBoundarySide = "greater";

const MCP_LANDMARK_INDICES = [5, 9, 13, 17] as const;

export interface DepthLandmark {
  x: number;
  y: number;
  z?: number;
}

export interface DepthObservation {
  handedness: "Right" | "Left" | "Unknown";
  sheetY: number;
  knuckleDistance: number;
  fingertipSheetYs: readonly number[];
  fingertipZs: readonly number[];
}

export interface DepthCalibrationSample extends DepthObservation {
  position: DepthCalibrationPosition;
}

export interface DepthLine {
  slope: number;
  intercept: number;
  predictSheetY: (depth: number) => number;
}

export type DepthLineCoefficients = Pick<DepthLine, "slope" | "intercept">;

export interface DepthCalibrationModel {
  hand: "Right";
  knuckleLines: Readonly<Record<DepthFinger, DepthLine>>;
  zLines: Readonly<Record<DepthFinger, DepthLine>>;
  samplesByPosition: Readonly<Record<DepthCalibrationPosition, DepthCalibrationSample>>;
}

export interface PersistedDepthCalibration {
  version: 1;
  hand: "Right";
  knuckleDistances: Readonly<
    Record<DepthCalibrationPosition, number>
  >;
  knuckleBoundaryYs: Readonly<
    Record<DepthCalibrationPosition, number>
  >;
  knuckleLines: Readonly<
    Record<DepthFinger, Pick<DepthLine, "slope" | "intercept">>
  >;
  zLines: Readonly<
    Record<DepthFinger, Pick<DepthLine, "slope" | "intercept">>
  >;
}

export interface CaptureResult {
  accepted: boolean;
  reason?: "right-hand-required" | "invalid-observation";
}

function isFiniteNumber(value: number): boolean {
  return Number.isFinite(value);
}

function distance(first: DepthLandmark, second: DepthLandmark): number {
  return Math.hypot(first.x - second.x, first.y - second.y);
}

function median(values: readonly number[]): number {
  const sorted = [...values].sort((first, second) => first - second);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0
    ? (sorted[middle - 1] + sorted[middle]) / 2
    : sorted[middle];
}

/**
 * Use the average distance between neighboring MCP landmarks as a hand-scale
 * measurement. It is intentionally separate from MediaPipe fingertip z.
 */
export function getKnuckleDistance(
  landmarks: readonly DepthLandmark[],
): number | null {
  const knuckles = MCP_LANDMARK_INDICES.map((index) => landmarks[index]);
  if (knuckles.some((landmark) => !landmark)) return null;

  const distances = knuckles.slice(1).map((knuckle, index) =>
    distance(knuckles[index], knuckle),
  );
  return distances.every(isFiniteNumber) ? median(distances) : null;
}

export function getFingertipZs(
  landmarks: readonly DepthLandmark[],
): number[] | null {
  const depths = FINGERTIP_LANDMARK_INDICES.map(
    (index) => landmarks[index]?.z,
  );
  return depths.every(
    (value): value is number => value !== undefined && isFiniteNumber(value),
  )
    ? depths
    : null;
}

/** Build a sample from one right-hand detection captured by the button. */
export function makeDepthObservation(
  landmarks: readonly DepthLandmark[],
  handedness: DepthObservation["handedness"],
  sheetY: number,
  fingertipSheetYs: readonly number[],
): DepthObservation | null {
  if (handedness !== "Right" || !isFiniteNumber(sheetY)) return null;

  const knuckleDistance = getKnuckleDistance(landmarks);
  const fingertipZs = getFingertipZs(landmarks);
  if (knuckleDistance === null || fingertipZs === null) return null;
  if (fingertipSheetYs.length !== DEPTH_FINGERS.length) return null;

  return {
    handedness,
    sheetY,
    knuckleDistance,
    fingertipSheetYs: [...fingertipSheetYs],
    fingertipZs,
  };
}

/** Return whether a fingertip is on the selected side of a calibrated line. */
export function isBeyondDepthBoundary(
  line: DepthLineCoefficients,
  depth: number,
  sheetY: number,
  side: DepthBoundarySide = "greater",
  tolerance = 0,
): boolean {
  const expectedY = line.slope * depth + line.intercept;
  return side === "greater"
    ? sheetY >= expectedY - tolerance
    : sheetY <= expectedY + tolerance;
}

/**
 * Interpolate the captured fingertip Y boundary for a knuckle distance.
 * Distances outside the captured front-to-back range are not contact evidence.
 */
export function getKnuckleBoundaryY(
  calibration: PersistedDepthCalibration,
  knuckleDistance: number,
  allowOutside = false,
): number | null {
  if (!Number.isFinite(knuckleDistance)) return null;

  const points = DEPTH_CALIBRATION_POSITIONS.map((position) => ({
    distance: calibration.knuckleDistances[position],
    y: calibration.knuckleBoundaryYs[position],
  })).sort((first, second) => first.distance - second.distance);

  if (points.some(({ distance, y }) => !Number.isFinite(distance) || !Number.isFinite(y))) {
    return null;
  }
  if (knuckleDistance < points[0].distance) {
    return allowOutside ? points[0].y : null;
  }
  if (knuckleDistance > points[points.length - 1].distance) {
    return allowOutside ? points[points.length - 1].y : null;
  }

  for (let index = 1; index < points.length; index += 1) {
    const previous = points[index - 1];
    const current = points[index];
    if (knuckleDistance > current.distance) continue;
    const distanceSpan = current.distance - previous.distance;
    if (distanceSpan === 0) return current.y;
    const fraction = (knuckleDistance - previous.distance) / distanceSpan;
    return previous.y + fraction * (current.y - previous.y);
  }

  return points[points.length - 1].y;
}

function fitLine(
  samples: readonly DepthCalibrationSample[],
  getDepth: (sample: DepthCalibrationSample) => number,
  getY: (sample: DepthCalibrationSample) => number = (sample) => sample.sheetY,
): DepthLine | null {
  if (samples.length < 2) return null;

  const meanDepth =
    samples.reduce((sum, sample) => sum + getDepth(sample), 0) / samples.length;
  const meanY =
    samples.reduce((sum, sample) => sum + getY(sample), 0) / samples.length;
  const numerator = samples.reduce(
    (sum, sample) =>
      sum + (getDepth(sample) - meanDepth) * (getY(sample) - meanY),
    0,
  );
  const denominator = samples.reduce(
    (sum, sample) => sum + (getDepth(sample) - meanDepth) ** 2,
    0,
  );
  if (denominator === 0) return null;

  const slope = numerator / denominator;
  const intercept = meanY - slope * meanDepth;
  return {
    slope,
    intercept,
    predictSheetY: (depth) => slope * depth + intercept,
  };
}

function summarizeSamples(
  position: DepthCalibrationPosition,
  samples: readonly DepthCalibrationSample[],
): DepthCalibrationSample {
  return {
    position,
    handedness: "Right",
    sheetY: median(samples.map((sample) => sample.sheetY)),
    knuckleDistance: median(samples.map((sample) => sample.knuckleDistance)),
    fingertipSheetYs: DEPTH_FINGERS.map((_, index) =>
      median(samples.map((sample) => sample.fingertipSheetYs[index])),
    ),
    fingertipZs: DEPTH_FINGERS.map((_, index) =>
      median(samples.map((sample) => sample.fingertipZs[index])),
    ),
  };
}

function fitFingerLines(
  samples: readonly DepthCalibrationSample[],
  getDepth: (sample: DepthCalibrationSample, fingerIndex: number) => number,
  getY: (sample: DepthCalibrationSample, fingerIndex: number) => number,
): Readonly<Record<DepthFinger, DepthLine>> | null {
  const lines = DEPTH_FINGERS.map((finger, fingerIndex) => [
    finger,
    fitLine(
      samples,
      (sample) => getDepth(sample, fingerIndex),
      (sample) => getY(sample, fingerIndex),
    ),
  ] as const);
  if (lines.some(([, line]) => line === null)) return null;

  return Object.fromEntries(lines) as Record<DepthFinger, DepthLine>;
}

/** Collects button-triggered right-hand samples for the three sheet positions. */
export class DepthCalibrationCollector {
  private readonly samples = new Map<
    DepthCalibrationPosition,
    DepthCalibrationSample[]
  >();

  capture(
    position: DepthCalibrationPosition,
    observation: DepthObservation,
  ): CaptureResult {
    if (observation.handedness !== "Right") {
      return { accepted: false, reason: "right-hand-required" };
    }

    const values = [
      observation.sheetY,
      observation.knuckleDistance,
      ...observation.fingertipSheetYs,
      ...observation.fingertipZs,
    ];
    if (values.some((value) => !isFiniteNumber(value))) {
      return { accepted: false, reason: "invalid-observation" };
    }

    const positionSamples = this.samples.get(position) ?? [];
    positionSamples.push({ ...observation, position });
    this.samples.set(position, positionSamples);
    return { accepted: true };
  }

  getSampleCount(position: DepthCalibrationPosition): number {
    return this.samples.get(position)?.length ?? 0;
  }

  isComplete(): boolean {
    return DEPTH_CALIBRATION_POSITIONS.every(
      (position) => this.getSampleCount(position) > 0,
    );
  }

  buildModel(): DepthCalibrationModel | null {
    if (!this.isComplete()) return null;

    const summaries = Object.fromEntries(
      DEPTH_CALIBRATION_POSITIONS.map((position) => [
        position,
        summarizeSamples(position, this.samples.get(position) ?? []),
      ]),
    ) as Record<DepthCalibrationPosition, DepthCalibrationSample>;
    const samples = DEPTH_CALIBRATION_POSITIONS.map(
      (position) => summaries[position],
    );
    const knuckleLines = fitFingerLines(
      samples,
      (sample) => sample.knuckleDistance,
      (sample, fingerIndex) => sample.fingertipSheetYs[fingerIndex],
    );
    const zLines = fitFingerLines(
      samples,
      (sample, fingerIndex) => sample.fingertipZs[fingerIndex],
      (sample, fingerIndex) => sample.fingertipSheetYs[fingerIndex],
    );
    if (!knuckleLines || !zLines) return null;

    return {
      hand: "Right",
      knuckleLines,
      zLines,
      samplesByPosition: summaries,
    };
  }
}

export function toPersistedDepthCalibration(
  model: DepthCalibrationModel,
): PersistedDepthCalibration {
  return {
    version: 1,
    hand: model.hand,
    knuckleDistances: Object.fromEntries(
      DEPTH_CALIBRATION_POSITIONS.map((position) => [
        position,
        model.samplesByPosition[position].knuckleDistance,
      ]),
    ) as PersistedDepthCalibration["knuckleDistances"],
    knuckleBoundaryYs: Object.fromEntries(
      DEPTH_CALIBRATION_POSITIONS.map((position) => [
        position,
        model.samplesByPosition[position].fingertipSheetYs[1],
      ]),
    ) as PersistedDepthCalibration["knuckleBoundaryYs"],
    knuckleLines: Object.fromEntries(
      DEPTH_FINGERS.map((finger) => [
        finger,
        {
          slope: model.knuckleLines[finger].slope,
          intercept: model.knuckleLines[finger].intercept,
        },
      ]),
    ) as PersistedDepthCalibration["knuckleLines"],
    zLines: Object.fromEntries(
      DEPTH_FINGERS.map((finger) => [
        finger,
        {
          slope: model.zLines[finger].slope,
          intercept: model.zLines[finger].intercept,
        },
      ]),
    ) as PersistedDepthCalibration["zLines"],
  };
}

function hasLine(value: unknown): value is DepthLineCoefficients {
  if (!value || typeof value !== "object") return false;
  const line = value as Record<string, unknown>;
  return (
    typeof line.slope === "number" &&
    Number.isFinite(line.slope) &&
    typeof line.intercept === "number" &&
    Number.isFinite(line.intercept)
  );
}

/** Parse saved calibration defensively so stale data cannot break live CV. */
export function parsePersistedDepthCalibration(
  raw: string | null,
): PersistedDepthCalibration | null {
  if (!raw) return null;

  try {
    const value: unknown = JSON.parse(raw);
    if (!value || typeof value !== "object") return null;
    const candidate = value as Record<string, unknown>;
    if (candidate.version !== 1 || candidate.hand !== "Right") return null;
    if (
      !candidate.knuckleDistances ||
      !candidate.knuckleBoundaryYs ||
      !candidate.knuckleLines ||
      !candidate.zLines
    ) {
      return null;
    }

    const knuckleDistances = candidate.knuckleDistances as Record<
      string,
      unknown
    >;
    const knuckleBoundaryYs = candidate.knuckleBoundaryYs as Record<
      string,
      unknown
    >;
    const knuckleLines = candidate.knuckleLines as Record<string, unknown>;
    const zLines = candidate.zLines as Record<string, unknown>;
    const hasAllKnuckleDistances = DEPTH_CALIBRATION_POSITIONS.every(
      (position) =>
        typeof knuckleDistances[position] === "number" &&
        Number.isFinite(knuckleDistances[position]),
    );
    const hasAllKnuckleBoundaryYs = DEPTH_CALIBRATION_POSITIONS.every(
      (position) =>
        typeof knuckleBoundaryYs[position] === "number" &&
        Number.isFinite(knuckleBoundaryYs[position]),
    );
    const hasAllLines = DEPTH_FINGERS.every(
      (finger) => hasLine(knuckleLines[finger]) && hasLine(zLines[finger]),
    );
    if (
      !hasAllKnuckleDistances ||
      !hasAllKnuckleBoundaryYs ||
      !hasAllLines
    ) {
      return null;
    }

    return value as PersistedDepthCalibration;
  } catch {
    return null;
  }
}
