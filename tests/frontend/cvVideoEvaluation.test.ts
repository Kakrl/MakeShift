import { describe, expect, it } from "vitest";
import {
  annotationsToTransitions,
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

describe("CV video evaluation core", () => {
  it("requires an explicit empty reference and chromatic labels for Vision replay", () => {
    const input = { schemaVersion: 2, video: "clip.mp4", framesPerSecond: 30,
      timebase: "video-frame", annotation: { pressDefinition: "contact", releaseDefinition: "lift",
        fullyLabeledRange: { startFrame: 1, endFrame: 20 } },
      calibration: { keyboard: { octaves: 1, startingMidiNote: 60 }, referenceFrame: 0 },
      events: [event("a", 1, 5)] };
    expect(parseCvVideoCase(input).calibration.referenceFrame).toBe(0);
    expect(() => parseCvVideoCase({ ...input, schemaVersion: 1 })).toThrow("schemaVersion 2");
    expect(() => parseCvVideoCase({ ...input, calibration: { ...input.calibration, referenceFrame: 1 } })).toThrow("precede");
    expect(() => parseCvVideoCase({ ...input, events: [{ ...event("a", 1, 5), midiNote: 62 }] })).toThrow("event");
    expect(() => parseCvVideoCase({ ...input, calibration: { ...input.calibration, keyboard: { octaves: 4, startingMidiNote: 60 } } })).toThrow("layout");
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

});
