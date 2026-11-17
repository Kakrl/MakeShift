import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  LiveContactPipeline,
  type ContactPipelineFrame,
} from "../../frontend/src/cv/liveContactPipeline";
import type { Fingertip, HandObservation } from "../../frontend/src/cv/collision";
import type { Point } from "../../frontend/src/cv/types";

const video = {
  readyState: 4,
  videoWidth: 200,
  videoHeight: 100,
} as HTMLVideoElement;

const whiteKeys: Point[][] = [
  [
    { x: 10, y: 10 },
    { x: 90, y: 10 },
    { x: 90, y: 90 },
    { x: 10, y: 90 },
  ],
  [
    { x: 110, y: 10 },
    { x: 190, y: 10 },
    { x: 190, y: 90 },
    { x: 110, y: 90 },
  ],
];

function makeFrame(x: number): ContactPipelineFrame {
  const landmarks = Array.from({ length: 21 }, () => ({ x: 0.5, y: 0.5 }));
  const hands: HandObservation[] = [{ landmarks, handedness: "Right" }];
  const fingertips: Fingertip[] = [{
    id: "finger-1",
    handIndex: 0,
    landmarkIndex: 8,
    point: { x, y: 50 },
  }];
  return {
    video,
    fingertips,
    hands,
    whiteKeys,
    calibration: null,
    previewFingerId: null,
  };
}

describe("LiveContactPipeline target ownership", () => {
  let now: number;
  let pipeline: LiveContactPipeline;

  beforeEach(() => {
    now = 100;
    vi.spyOn(performance, "now").mockImplementation(() => now);
    pipeline = new LiveContactPipeline(
      {
        onContactsChanged: () => {},
        onShadowCameraPreview: () => {},
        onShadowPreview: () => {},
        onError: () => {},
      },
      { knuckles: false, shadows: false },
    );
  });

  afterEach(() => {
    pipeline.dispose();
    vi.restoreAllMocks();
  });

  function observe(x: number) {
    now += 20;
    pipeline.processFrame(makeFrame(x));
  }

  it("ignores brief edge jitter and releases once the fingertip stays out", () => {
    observe(50);
    observe(50);
    expect(pipeline.fingers.get("finger-1")?.keyIndex).toBe(0);

    observe(91);
    observe(89);
    observe(91);
    observe(89);
    expect(pipeline.fingers.get("finger-1")?.keyIndex).toBe(0);
    expect(pipeline.contacts.get("finger-1")?.active).toBe(true);

    observe(91);
    observe(91);
    observe(91);
    expect(pipeline.contacts.get("finger-1")?.active).toBe(true);
    observe(91);
    expect(pipeline.fingers.get("finger-1")?.keyIndex).toBeNull();
    expect(pipeline.contacts.get("finger-1")?.active).toBe(false);
  });

  it("rejects a new onset just outside a square", () => {
    observe(109);
    observe(109);
    expect(pipeline.gates.get("finger-1")?.keyIndexes).toEqual([]);
    expect(pipeline.contacts.get("finger-1")?.active).toBe(false);

    observe(111);
    observe(111);
    expect(pipeline.fingers.get("finger-1")?.keyIndex).toBe(1);
  });

  it("releases the previous target before acquiring a different one", () => {
    observe(50);
    observe(50);
    observe(150);
    expect(pipeline.contacts.get("finger-1")?.active).toBe(false);
    expect(pipeline.fingers.get("finger-1")?.keyIndex).toBeNull();
    observe(150);
    expect(pipeline.fingers.get("finger-1")?.keyIndex).toBe(1);
  });
});
