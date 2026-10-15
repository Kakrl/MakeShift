/**
 * Test-only helpers for labeled CV video evaluation. The application runtime
 * does not import this module; the Playwright replay page and Vitest suite do.
 * See docs/cv_video_tests.md for the workflow.
 */
import {
  DEPTH_CALIBRATION_POSITIONS,
  DEPTH_FINGERS,
  DepthCalibrationCollector,
  makeDepthObservation,
  toPersistedDepthCalibration,
  type DepthCalibrationPosition,
  type DepthCalibrationModel,
  type DepthLandmark,
  type PersistedDepthCalibration,
} from "./depthCalibration";

export type TransitionKind = "press" | "release";
export type CalibrationHand = "Right" | "Left";

export interface VideoEventAnnotation {
  id: string;
  hand: CalibrationHand;
  finger: (typeof DEPTH_FINGERS)[number];
  keyIndex: number;
  midiNote: number;
  press: { frame: number; earliestFrame: number; latestFrame: number };
  release: { frame: number; earliestFrame: number; latestFrame: number };
}

export interface RawDepthCapture {
  position: DepthCalibrationPosition;
  hand: CalibrationHand;
  landmarks: readonly DepthLandmark[];
}

export interface CvVideoCase {
  schemaVersion: 1;
  video: string;
  framesPerSecond: number;
  timebase: "video-frame";
  annotation: {
    pressDefinition: string;
    releaseDefinition: string;
    fullyLabeledRange: { startFrame: number; endFrame: number };
  };
  calibration: {
    keyboard: { layoutId: string; startingMidiNote: number };
    depthCaptures: readonly RawDepthCapture[];
  };
  events: readonly VideoEventAnnotation[];
}

export interface PredictedTransition {
  kind: TransitionKind;
  keyIndex: number;
  frame: number;
  mediaTimeMs: number;
  emittedAtWallMs?: number;
}

export interface ActiveKeyFrame {
  frame: number;
  mediaTimeMs: number;
  activeKeyIndexes: readonly number[];
}

export interface ReplayFrame<T> {
  frame: number;
  mediaTimeMs: number;
  presentedFrames?: number;
  data: T;
}

export interface TimedFrameResult<T> {
  frame: number;
  mediaTimeMs: number;
  presentedFrames?: number;
  wallStartMs: number;
  wallEndMs: number;
  processMs: number;
  inferenceMs: number | null;
  result: T;
}

export interface MatchedTransition {
  expected: {
    id: string;
    kind: TransitionKind;
    keyIndex: number;
    frame: number;
    earliestFrame: number;
    latestFrame: number;
  };
  predicted: PredictedTransition;
  timingErrorFrames: number;
}

export interface TransitionScore {
  kind: TransitionKind;
  truePositive: number;
  falsePositive: number;
  falseNegative: number;
  precision: number;
  recall: number;
  matches: readonly MatchedTransition[];
  unmatchedExpected: readonly MatchedTransition["expected"][];
  unmatchedPredicted: readonly PredictedTransition[];
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);
const finite = (value: unknown): value is number =>
  typeof value === "number" && Number.isFinite(value);
const nonNegativeInteger = (value: unknown): value is number =>
  Number.isInteger(value) && Number(value) >= 0;

function requireFrameLabel(value: unknown, description: string) {
  if (!isRecord(value) ||
      !nonNegativeInteger(value.frame) ||
      !nonNegativeInteger(value.earliestFrame) ||
      !nonNegativeInteger(value.latestFrame) ||
      value.earliestFrame > value.frame || value.frame > value.latestFrame) {
    throw new Error(`${description} must contain ordered non-negative frame labels`);
  }
  return {
    frame: value.frame,
    earliestFrame: value.earliestFrame,
    latestFrame: value.latestFrame,
  };
}

/** Validate one sidecar JSON object while allowing blank template captures. */
export function parseCvVideoCase(value: unknown): CvVideoCase {
  if (!isRecord(value) || value.schemaVersion !== 1 ||
      typeof value.video !== "string" || !value.video ||
      !finite(value.framesPerSecond) || value.framesPerSecond <= 0 ||
      value.timebase !== "video-frame" || !isRecord(value.annotation) ||
      !isRecord(value.annotation.fullyLabeledRange) ||
      !isRecord(value.calibration) ||
      !isRecord(value.calibration.keyboard) ||
      !Array.isArray(value.calibration.depthCaptures) ||
      !Array.isArray(value.events)) {
    throw new Error("Invalid CV video sidecar: missing required sections");
  }

  const { fullyLabeledRange } = value.annotation;
  if (!nonNegativeInteger(fullyLabeledRange.startFrame) ||
      !nonNegativeInteger(fullyLabeledRange.endFrame) ||
      fullyLabeledRange.endFrame <= fullyLabeledRange.startFrame ||
      typeof value.annotation.pressDefinition !== "string" ||
      typeof value.annotation.releaseDefinition !== "string") {
    throw new Error("Invalid CV video annotation range or event definitions");
  }
  const labeledStart = fullyLabeledRange.startFrame as number;
  const labeledEnd = fullyLabeledRange.endFrame as number;

  const keyboard = value.calibration.keyboard;
  if (typeof keyboard.layoutId !== "string" ||
      !nonNegativeInteger(keyboard.startingMidiNote)) {
    throw new Error("Invalid keyboard layout annotation");
  }

  const depthCaptures = value.calibration.depthCaptures.map((capture, index) => {
    if (!isRecord(capture) ||
        !DEPTH_CALIBRATION_POSITIONS.includes(capture.position as DepthCalibrationPosition) ||
        (capture.hand !== "Right" && capture.hand !== "Left") ||
        !Array.isArray(capture.landmarks)) {
      throw new Error(`Invalid depth calibration capture ${index}`);
    }
    const landmarks = capture.landmarks;
    if (landmarks.length !== 0 &&
        (landmarks.length !== 21 || landmarks.some((point) =>
          !isRecord(point) || !finite(point.x) || !finite(point.y) ||
          !finite(point.z)))) {
      throw new Error(`Capture ${index} must have zero or 21 finite XYZ landmarks`);
    }
    return {
      position: capture.position as DepthCalibrationPosition,
      hand: capture.hand as CalibrationHand,
      landmarks: landmarks as DepthLandmark[],
    };
  });

  const events = value.events.map((event, index) => {
    if (!isRecord(event) || typeof event.id !== "string" || !event.id ||
        (event.hand !== "Right" && event.hand !== "Left") ||
        !DEPTH_FINGERS.includes(event.finger as (typeof DEPTH_FINGERS)[number]) ||
        !nonNegativeInteger(event.keyIndex) ||
        !nonNegativeInteger(event.midiNote)) {
      throw new Error(`Invalid annotated event ${index}`);
    }
    const press = requireFrameLabel(event.press, `Event ${event.id} press`);
    const release = requireFrameLabel(event.release, `Event ${event.id} release`);
    if (press.frame > release.frame) {
      throw new Error(`Event ${event.id} releases before its press`);
    }
    if (press.earliestFrame < labeledStart ||
        release.latestFrame > labeledEnd) {
      throw new Error(`Event ${event.id} falls outside the fully labeled range`);
    }
    return { id: event.id, hand: event.hand as CalibrationHand,
      finger: event.finger as VideoEventAnnotation["finger"],
      keyIndex: event.keyIndex, midiNote: event.midiNote, press, release };
  });

  return {
    schemaVersion: 1,
    video: value.video,
    framesPerSecond: value.framesPerSecond,
    timebase: "video-frame",
    annotation: {
      pressDefinition: value.annotation.pressDefinition,
      releaseDefinition: value.annotation.releaseDefinition,
      fullyLabeledRange: {
        startFrame: labeledStart,
        endFrame: labeledEnd,
      },
    },
    calibration: {
      keyboard: {
        layoutId: keyboard.layoutId,
        startingMidiNote: keyboard.startingMidiNote,
      },
      depthCaptures,
    },
    events,
  };
}

/** Build one production calibration model for each hand with complete samples. */
export function buildDepthCalibrations(
  videoCase: CvVideoCase,
): PersistedDepthCalibration {
  const models: Record<"Right" | "Left", DepthCalibrationModel | null> = {
    Right: null,
    Left: null,
  };
  for (const hand of ["Right", "Left"] as const) {
    const captures = videoCase.calibration.depthCaptures.filter(
      (capture) => capture.hand === hand,
    );
    if (captures.length === 0) continue;
    const collector = new DepthCalibrationCollector(hand);
    const positions = new Set<DepthCalibrationPosition>();
    for (const capture of captures) {
      if (capture.landmarks.length !== 21) {
        throw new Error(`${hand} ${capture.position} capture needs 21 landmarks`);
      }
      const fingertipSheetYs = [4, 8, 12, 16, 20].map(
        (index) => capture.landmarks[index].y,
      );
      const sheetY = fingertipSheetYs.reduce((sum, y) => sum + y, 0) /
        fingertipSheetYs.length;
      const observation = makeDepthObservation(
        capture.landmarks,
        hand,
        sheetY,
        fingertipSheetYs,
        hand,
      );
      if (!observation || !collector.capture(capture.position, observation).accepted) {
        throw new Error(`${hand} ${capture.position} capture has invalid landmarks`);
      }
      positions.add(capture.position);
    }
    if (DEPTH_CALIBRATION_POSITIONS.some((position) => !positions.has(position))) {
      throw new Error(`${hand} calibration needs all five positions`);
    }
    const model = collector.buildModel();
    if (!model) {
      throw new Error(`${hand} calibration does not span enough knuckle and Z values`);
    }
    models[hand] = model;
  }
  return toPersistedDepthCalibration(models);
}

export function annotationsToTransitions(
  events: readonly VideoEventAnnotation[],
): MatchedTransition["expected"][] {
  return events.flatMap((event) => [
    { id: event.id, kind: "press" as const, keyIndex: event.keyIndex,
      ...event.press },
    { id: event.id, kind: "release" as const, keyIndex: event.keyIndex,
      ...event.release },
  ]);
}

/** Turn active-key snapshots into emitted note-on/note-off transitions. */
export function transitionsFromFrames(
  frames: readonly ActiveKeyFrame[],
): PredictedTransition[] {
  let previousFrame = -1;
  let previousMediaTime = -Infinity;
  let previousKeys = new Set<number>();
  const transitions: PredictedTransition[] = [];
  for (const frame of frames) {
    if (!nonNegativeInteger(frame.frame) || frame.frame <= previousFrame ||
        !finite(frame.mediaTimeMs) || frame.mediaTimeMs <= previousMediaTime) {
      throw new Error("Replay frames must have increasing frame and media times");
    }
    const currentKeys = new Set(frame.activeKeyIndexes);
    for (const keyIndex of currentKeys) {
      if (!nonNegativeInteger(keyIndex)) throw new Error("Invalid detected key index");
      if (!previousKeys.has(keyIndex)) transitions.push({
        kind: "press", keyIndex, frame: frame.frame,
        mediaTimeMs: frame.mediaTimeMs,
      });
    }
    for (const keyIndex of previousKeys) {
      if (!currentKeys.has(keyIndex)) transitions.push({
        kind: "release", keyIndex, frame: frame.frame,
        mediaTimeMs: frame.mediaTimeMs,
      });
    }
    previousFrame = frame.frame;
    previousMediaTime = frame.mediaTimeMs;
    previousKeys = currentKeys;
  }
  return transitions;
}

/** Sequentially measure a replay processor without changing source timestamps. */
export async function runOrderedFrameReplay<T, R>(
  frames: AsyncIterable<ReplayFrame<T>>,
  process: (frame: ReplayFrame<T>) => Promise<{ result: R; inferenceMs: number | null }> |
    { result: R; inferenceMs: number | null },
  wallNow: () => number,
): Promise<TimedFrameResult<R>[]> {
  const results: TimedFrameResult<R>[] = [];
  let previousFrame = -1;
  let previousMediaTime = -Infinity;
  for await (const frame of frames) {
    if (!nonNegativeInteger(frame.frame) || frame.frame <= previousFrame ||
        !finite(frame.mediaTimeMs) || frame.mediaTimeMs <= previousMediaTime) {
      throw new Error("Replay frames must have increasing frame and media times");
    }
    const wallStart = wallNow();
    const processed = await process(frame);
    const wallEnd = wallNow();
    results.push({
      frame: frame.frame,
      mediaTimeMs: frame.mediaTimeMs,
      presentedFrames: frame.presentedFrames,
      wallStartMs: wallStart,
      wallEndMs: wallEnd,
      processMs: Math.max(0, wallEnd - wallStart),
      inferenceMs: processed.inferenceMs,
      result: processed.result,
    });
    previousFrame = frame.frame;
    previousMediaTime = frame.mediaTimeMs;
  }
  return results;
}

function expectedAt(event: VideoEventAnnotation, kind: TransitionKind) {
  const timing = event[kind];
  return { id: event.id, kind, keyIndex: event.keyIndex, ...timing };
}

interface PathCell { count: number; cost: number; action: 0 | 1 | 2 }

function better(first: PathCell, second: PathCell): PathCell {
  if (first.count !== second.count) return first.count > second.count ? first : second;
  return first.cost <= second.cost ? first : second;
}

/** Maximum-cardinality, minimum-time-error one-to-one matching by kind/key. */
export function scoreTransitions(
  events: readonly VideoEventAnnotation[],
  predictions: readonly PredictedTransition[],
  toleranceFrames: number,
): Record<TransitionKind, TransitionScore> {
  if (!nonNegativeInteger(toleranceFrames)) {
    throw new Error("Matching tolerance must be a non-negative frame count");
  }
  const scoreKind = (kind: TransitionKind): TransitionScore => {
    const allExpected = events.map((event) => expectedAt(event, kind));
    const allPredicted = predictions.filter((prediction) => prediction.kind === kind);
    const matches: MatchedTransition[] = [];
    const unmatchedExpected: MatchedTransition["expected"][] = [];
    const unmatchedPredicted: PredictedTransition[] = [];
    // Match each key independently so a chord's arbitrary key ordering cannot
    // make otherwise valid simultaneous events cross in the timeline.
    const keys = new Set([
      ...allExpected.map((event) => event.keyIndex),
      ...allPredicted.map((event) => event.keyIndex),
    ]);
    for (const keyIndex of keys) {
      const expected = allExpected.filter((event) => event.keyIndex === keyIndex)
        .sort((a, b) => a.frame - b.frame);
      const predicted = allPredicted.filter((event) => event.keyIndex === keyIndex)
        .slice().sort((a, b) => a.frame - b.frame);
      const dp: PathCell[][] = Array.from({ length: expected.length + 1 }, () =>
        Array.from({ length: predicted.length + 1 }, () => ({
          count: 0, cost: 0, action: 0 as const,
        })),
      );
      for (let i = expected.length; i >= 0; i -= 1) {
        for (let j = predicted.length; j >= 0; j -= 1) {
          if (i === expected.length && j === predicted.length) continue;
          const choices: { cell: PathCell; action: 0 | 1 | 2 }[] = [];
          if (i < expected.length) choices.push({ cell: dp[i + 1][j], action: 0 });
          if (j < predicted.length) choices.push({ cell: dp[i][j + 1], action: 1 });
          if (i < expected.length && j < predicted.length) {
            const label = expected[i];
            const observation = predicted[j];
            const distanceFromRange = observation.frame < label.earliestFrame
              ? label.earliestFrame - observation.frame
              : observation.frame > label.latestFrame
                ? observation.frame - label.latestFrame : 0;
            if (distanceFromRange <= toleranceFrames) {
              const tail = dp[i + 1][j + 1];
              choices.push({ cell: { count: tail.count + 1,
                cost: tail.cost + Math.abs(observation.frame - label.frame),
                action: 2 }, action: 2 });
            }
          }
          let selected = choices[0];
          for (const choice of choices.slice(1)) {
            const winner = better(selected.cell, choice.cell);
            if (winner === choice.cell) selected = choice;
          }
          dp[i][j] = { ...selected.cell, action: selected.action };
        }
      }
      let i = 0;
      let j = 0;
      while (i < expected.length || j < predicted.length) {
        const action = dp[i]?.[j]?.action;
        if (i < expected.length && j < predicted.length && action === 2) {
          matches.push({ expected: expected[i], predicted: predicted[j],
            timingErrorFrames: predicted[j].frame - expected[i].frame });
          i += 1;
          j += 1;
        } else if (j < predicted.length && (i >= expected.length || action === 1)) {
          unmatchedPredicted.push(predicted[j++]);
        } else if (i < expected.length) unmatchedExpected.push(expected[i++]);
      }
    }
    matches.sort((a, b) => a.expected.frame - b.expected.frame);
    const truePositive = matches.length;
    const falsePositive = unmatchedPredicted.length;
    const falseNegative = unmatchedExpected.length;
    return {
      kind, truePositive, falsePositive, falseNegative,
      precision: truePositive + falsePositive === 0 ? 1 :
        truePositive / (truePositive + falsePositive),
      recall: truePositive + falseNegative === 0 ? 1 :
        truePositive / (truePositive + falseNegative),
      matches, unmatchedExpected, unmatchedPredicted,
    };
  };
  return { press: scoreKind("press"), release: scoreKind("release") };
}

export function summarizeFramePerformance<T>(
  frames: readonly TimedFrameResult<T>[],
): {
  processedFrames: number;
  sourceDurationMs: number;
  processedFps: number | null;
  skippedPresentedFrames: number;
  inferenceMs: { median: number | null; p95: number | null; max: number | null };
  processMs: { median: number | null; p95: number | null; max: number | null };
} {
  const distribution = (values: number[]) => {
    if (values.length === 0) return { median: null, p95: null, max: null };
    const sorted = values.slice().sort((a, b) => a - b);
    return {
      median: sorted[Math.floor((sorted.length - 1) * 0.5)],
      p95: sorted[Math.ceil(sorted.length * 0.95) - 1],
      max: sorted[sorted.length - 1],
    };
  };
  const durationMs = frames.length < 2 ? 0 :
    frames[frames.length - 1].mediaTimeMs - frames[0].mediaTimeMs;
  const wallDurationMs = frames.length < 2 ? 0 :
    frames[frames.length - 1].wallEndMs - frames[0].wallStartMs;
  let skippedPresentedFrames = 0;
  for (let index = 1; index < frames.length; index += 1) {
    const previous = frames[index - 1].presentedFrames;
    const current = frames[index].presentedFrames;
    if (previous !== undefined && current !== undefined && current > previous + 1) {
      skippedPresentedFrames += current - previous - 1;
    }
  }
  return {
    processedFrames: frames.length,
    sourceDurationMs: durationMs,
    processedFps: wallDurationMs > 0 ? frames.length * 1000 / wallDurationMs : null,
    skippedPresentedFrames,
    inferenceMs: distribution(frames.flatMap((frame) =>
      frame.inferenceMs === null ? [] : [frame.inferenceMs])),
    processMs: distribution(frames.map((frame) => frame.processMs)),
  };
}
