import { FINGERTIP_LANDMARK_INDICES } from "./collision";

export const DEPTH_CALIBRATION_POSITIONS = [
  "front",
  "middle",
  "back",
] as const;

export const DEPTH_CALIBRATION_STORAGE_KEY = "depthCalibrationLines";

export type DepthCalibrationPosition =
  (typeof DEPTH_CALIBRATION_POSITIONS)[number];

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
  fingertipZ: number;
  fingertipSheetYs: readonly number[];
}

export interface DepthCalibrationSample extends DepthObservation {
  position: DepthCalibrationPosition;
}

export interface DepthLine {
  slope: number;
  intercept: number;
  predictSheetY: (depth: number) => number;
}

export interface DepthCalibrationModel {
  hand: "Right";
  knuckleLine: DepthLine;
  zLine: DepthLine;
  samplesByPosition: Readonly<Record<DepthCalibrationPosition, DepthCalibrationSample>>;
}

export interface PersistedDepthCalibration {
  version: 1;
  hand: "Right";
  knuckleLine: Pick<DepthLine, "slope" | "intercept">;
  zLine: Pick<DepthLine, "slope" | "intercept">;
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

export function getMeanFingertipZ(
  landmarks: readonly DepthLandmark[],
): number | null {
  const depths = FINGERTIP_LANDMARK_INDICES
    .map((index) => landmarks[index]?.z)
    .filter((value): value is number => value !== undefined && isFiniteNumber(value));

  return depths.length === 0 ? null : median(depths);
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
  const fingertipZ = getMeanFingertipZ(landmarks);
  if (knuckleDistance === null || fingertipZ === null) return null;

  return {
    handedness,
    sheetY,
    knuckleDistance,
    fingertipZ,
    fingertipSheetYs: [...fingertipSheetYs],
  };
}

function fitLine(
  samples: readonly DepthCalibrationSample[],
  getDepth: (sample: DepthCalibrationSample) => number,
): DepthLine | null {
  if (samples.length < 2) return null;

  const meanDepth =
    samples.reduce((sum, sample) => sum + getDepth(sample), 0) / samples.length;
  const meanY =
    samples.reduce((sum, sample) => sum + sample.sheetY, 0) / samples.length;
  const numerator = samples.reduce(
    (sum, sample) =>
      sum +
      (getDepth(sample) - meanDepth) * (sample.sheetY - meanY),
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
    fingertipZ: median(samples.map((sample) => sample.fingertipZ)),
    fingertipSheetYs: samples[0].fingertipSheetYs,
  };
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
      observation.fingertipZ,
      ...observation.fingertipSheetYs,
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
    const knuckleLine = fitLine(samples, (sample) => sample.knuckleDistance);
    const zLine = fitLine(samples, (sample) => sample.fingertipZ);
    if (!knuckleLine || !zLine) return null;

    return {
      hand: "Right",
      knuckleLine,
      zLine,
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
    knuckleLine: {
      slope: model.knuckleLine.slope,
      intercept: model.knuckleLine.intercept,
    },
    zLine: {
      slope: model.zLine.slope,
      intercept: model.zLine.intercept,
    },
  };
}
