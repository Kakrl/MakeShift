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
    { x: 0, y: 0 },
    { x: 100, y: 0 },
    { x: 100, y: 100 },
    { x: 0, y: 100 },
  ],
  [
    { x: 100, y: 0 },
    { x: 200, y: 0 },
    { x: 200, y: 100 },
    { x: 100, y: 100 },
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

describe("LiveContactPipeline finger key boundary", () => {
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

  it("keeps the current key through the gray band and switches in the next interior", () => {
    observe(50);
    expect(pipeline.contacts.get("finger-1")?.active).toBe(false);
    observe(50);
    expect(pipeline.contacts.get("finger-1")?.active).toBe(true);
    expect(pipeline.fingers.get("finger-1")?.keyIndex).toBe(0);

    observe(105);
    expect(pipeline.fingers.get("finger-1")?.keyIndex).toBe(0);
    observe(90);
    expect(pipeline.fingers.get("finger-1")?.keyIndex).toBe(0);
    observe(110);
    expect(pipeline.fingers.get("finger-1")?.keyIndex).toBe(0);
    expect(pipeline.contacts.get("finger-1")?.active).toBe(true);

    observe(116);
    expect(pipeline.fingers.get("finger-1")?.keyIndex).toBe(1);
    expect(pipeline.contacts.get("finger-1")?.active).toBe(true);
  });

  it("does not lock a key while hovering and presses the key under the finger", () => {
    observe(50);
    expect(pipeline.contacts.get("finger-1")?.active).toBe(false);
    expect(pipeline.fingers.get("finger-1")?.keyIndex).toBeNull();

    observe(116);
    expect(pipeline.contacts.get("finger-1")?.active).toBe(false);
    expect(pipeline.fingers.get("finger-1")?.keyIndex).toBeNull();

    observe(116);
    expect(pipeline.contacts.get("finger-1")?.active).toBe(true);
    expect(pipeline.fingers.get("finger-1")?.keyIndex).toBe(1);
  });
});
