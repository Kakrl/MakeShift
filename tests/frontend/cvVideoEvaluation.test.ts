import { describe, expect, it } from "vitest";
import { LiveContactPipeline } from "../../frontend/src/cv/liveContactPipeline";
import {
  annotationsToTransitions,
  buildDepthCalibrations,
  parseCvVideoCase,
  runOrderedFrameReplay,
  scoreTransitions,
  summarizeFramePerformance,
  transitionsFromFrames,
  type VideoEventAnnotation,
} from "../../frontend/src/cv/videoEvaluation";

function event(id: string, keyIndex: number, frame: number): VideoEventAnnotation {
  return {
    id, hand: "Right", finger: "index", keyIndex, midiNote: 60 + keyIndex,
    press: { frame, earliestFrame: frame - 1, latestFrame: frame + 1 },
    release: { frame: frame + 4, earliestFrame: frame + 3,
      latestFrame: frame + 5 },
  };
}

function landmarks(positionIndex: number) {
  const scale = 1 + positionIndex * 0.1;
  return Array.from({ length: 21 }, (_, index) => ({
    x: index * 0.01 * scale + positionIndex * 0.001,
    y: index * 0.008 * scale + positionIndex * 0.002,
    z: index * 0.003 + positionIndex * 0.004,
  }));
}

describe("CV video evaluation core", () => {
  it("validates sidecars and builds per-hand production depth calibrations", () => {
    const positions = ["top-left", "top-right", "bottom-left", "bottom-right", "center"];
    const sidecar = parseCvVideoCase({
      schemaVersion: 1, video: "clip.mp4", framesPerSecond: 30,
      timebase: "video-frame",
      annotation: { pressDefinition: "contact", releaseDefinition: "lift",
        fullyLabeledRange: { startFrame: 0, endFrame: 20 } },
      calibration: { keyboard: { layoutId: "starter-one-octave", startingMidiNote: 60 },
        depthCaptures: ["Right", "Left"].flatMap((hand) => positions.map(
          (position, index) => ({ position, hand, landmarks: landmarks(index) }),
        )) },
      events: [event("a", 0, 5)],
    });
    const models = buildDepthCalibrations(sidecar);
    expect(models.Right?.hand).toBe("Right");
    expect(models.Left?.hand).toBe("Left");
    expect(models.Right?.zLines.index.slope).toBeTypeOf("number");
    expect(() => parseCvVideoCase({ ...sidecar, schemaVersion: 2 })).toThrow();
    expect(() => buildDepthCalibrations({ ...sidecar,
      calibration: { ...sidecar.calibration, depthCaptures: [
        { ...sidecar.calibration.depthCaptures[0], landmarks: [] },
      ] },
    })).toThrow("needs 21 landmarks");
  });

  it("converts active key snapshots into independent press and release events", () => {
    const transitions = transitionsFromFrames([
      { frame: 0, mediaTimeMs: 0, activeKeyIndexes: [] },
      { frame: 1, mediaTimeMs: 33, activeKeyIndexes: [2, 4] },
      { frame: 2, mediaTimeMs: 66, activeKeyIndexes: [4] },
      { frame: 3, mediaTimeMs: 99, activeKeyIndexes: [2, 4] },
    ]);
    expect(transitions.map(({ kind, keyIndex, frame }) => [kind, keyIndex, frame]))
      .toEqual([["press", 2, 1], ["press", 4, 1], ["release", 2, 2],
        ["press", 2, 3]]);
    expect(annotationsToTransitions([event("a", 2, 1)])).toHaveLength(2);
  });

  it("matches one-to-one by transition kind and key, including chord ordering", () => {
    const events = [event("a", 1, 10), event("b", 2, 10), event("c", 1, 20)];
    const predictions = [
      { kind: "press" as const, keyIndex: 2, frame: 10, mediaTimeMs: 330 },
      { kind: "press" as const, keyIndex: 1, frame: 10, mediaTimeMs: 330 },
      { kind: "press" as const, keyIndex: 1, frame: 11, mediaTimeMs: 363 },
      { kind: "release" as const, keyIndex: 1, frame: 14, mediaTimeMs: 462 },
    ];
    const scores = scoreTransitions(events, predictions, 0);
    expect(scores.press.truePositive).toBe(2);
    expect(scores.press.falsePositive).toBe(1);
    expect(scores.press.falseNegative).toBe(1);
    expect(scores.release.truePositive).toBe(1);
    expect(scores.release.falseNegative).toBe(2);
    expect(scores.press.precision).toBeCloseTo(2 / 3);
  });

  it("replays frames in source order and reports processing throughput and skips", async () => {
    const source = async function* () {
      yield { frame: 0, mediaTimeMs: 0, presentedFrames: 1, data: "a" };
      yield { frame: 3, mediaTimeMs: 100, presentedFrames: 4, data: "b" };
    };
    let wall = 0;
    const replayed = await runOrderedFrameReplay(source(), (frame) => {
      wall += 5;
      return { result: frame.data, inferenceMs: 3 };
    }, () => wall);
    expect(replayed.map((frame) => frame.mediaTimeMs)).toEqual([0, 100]);
    expect(replayed.map((frame) => frame.processMs)).toEqual([5, 5]);
    expect(summarizeFramePerformance(replayed)).toMatchObject({
      processedFrames: 2, sourceDurationMs: 100, skippedPresentedFrames: 2,
      inferenceMs: { median: 3, p95: 3, max: 3 },
    });
    expect(summarizeFramePerformance(replayed).processedFps).toBe(200);
    await expect(runOrderedFrameReplay(source(), () => ({
      result: true, inferenceMs: null,
    }), () => 0)).resolves.toHaveLength(2);
  });

  it("uses replay media time for production contact state timestamps", () => {
    let mediaTimeMs = 333;
    const pipeline = new LiveContactPipeline({
      onContactsChanged: () => undefined,
      onShadowCameraPreview: () => undefined,
      onShadowPreview: () => undefined,
      onError: () => undefined,
    }, { knuckles: false, shadows: false }, () => mediaTimeMs);
    const hand = { handedness: "Right" as const,
      landmarks: Array.from({ length: 21 }, (_, index) => ({
        x: 0.1 + index * 0.001, y: 0.1 + index * 0.001, z: 0,
      })) };
    const video = { videoWidth: 100, videoHeight: 100,
      readyState: 2 } as HTMLVideoElement;
    const frame = {
      video, hands: [hand],
      fingertips: [{ id: "0-8", handIndex: 0, landmarkIndex: 8,
        point: { x: 10, y: 10 } }],
      whiteKeys: [[{ x: 0, y: 0 }, { x: 20, y: 0 },
        { x: 20, y: 20 }, { x: 0, y: 20 }]],
      calibration: null, previewFingerId: null,
    };
    pipeline.processFrame(frame);
    expect(pipeline.gates.get("0-8")?.frameAtMs).toBe(333);
    mediaTimeMs = 367;
    pipeline.processFrame(frame);
    expect(pipeline.gates.get("0-8")?.frameAtMs).toBe(367);
    pipeline.dispose();
  });
});
