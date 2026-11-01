// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";

const measurement = vi.hoisted(() => ({ areaPx: 350 }));
vi.mock("../../frontend/src/cv/darkShadowRegion", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../frontend/src/cv/darkShadowRegion")>();
  return {
    ...actual,
    findDarkShadowSize: vi.fn(() => ({
      center: { x: 30, y: 35 },
      majorRadius: 10,
      minorRadius: 5,
      rotation: 0,
      areaPx: measurement.areaPx,
      runs: [],
    })),
  };
});

import { LiveContactPipeline } from "../../frontend/src/cv/liveContactPipeline";

function image(width: number, height: number): ImageData {
  return {
    width,
    height,
    data: new Uint8ClampedArray(width * height * 4),
    colorSpace: "srgb",
  } as ImageData;
}

describe("live Y/shadow contact pipeline", () => {
  afterEach(() => vi.restoreAllMocks());

  it("turns contact on for the paired press evidence and releases after grace", () => {
    let now = 100;
    const cropped = image(60, 56);
    vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockImplementation(
      () => ({
        drawImage: vi.fn(),
        getImageData: () => cropped,
      }) as unknown as CanvasRenderingContext2D,
    );
    const pipeline = new LiveContactPipeline({
      onContactsChanged: () => undefined,
      onShadowCameraPreview: () => undefined,
      onShadowPreview: () => undefined,
      onError: (message) => { throw new Error(message); },
    }, {
      knuckles: false,
      shadows: false,
      synchronousShadows: false,
      shadowPressHysteresis: true,
    }, () => now);
    const frame = (y: number) => pipeline.processFrame({
      video: { videoWidth: 140, videoHeight: 140, readyState: 2 } as HTMLVideoElement,
      background: image(140, 140),
      hands: [{
        handedness: "Right",
        landmarks: Array.from({ length: 21 }, () => ({ x: 0.5, y: 0.5, z: 0 })),
      }],
      fingertips: [{ id: "right-index", handIndex: 0, landmarkIndex: 8, point: { x: 70, y } }],
      whiteKeys: [[{ x: 0, y: 0 }, { x: 140, y: 0 }, { x: 140, y: 140 }, { x: 0, y: 140 }]],
      calibration: null,
      previewFingerId: null,
    });

    frame(70);
    expect(pipeline.contacts.get("right-index")?.active).toBe(false);
    now = 130;
    measurement.areaPx = 90;
    frame(69);
    expect(pipeline.shadowPressComparisons.get("right-index")).toMatchObject({
      state: "press candidate",
      yDecreased: true,
      shadowTransition: "large-to-small",
    });
    expect(pipeline.contacts.get("right-index")?.active).toBe(true);

    now = 140;
    measurement.areaPx = 350;
    frame(71);
    expect(pipeline.shadowPressComparisons.get("right-index")?.state).toBe("hover");
    expect(pipeline.contacts.get("right-index")?.active).toBe(true);
    now = 210;
    frame(72);
    expect(pipeline.contacts.get("right-index")?.active).toBe(false);
    pipeline.dispose();
  });
});
