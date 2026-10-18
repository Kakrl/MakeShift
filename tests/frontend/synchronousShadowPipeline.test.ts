// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { LiveContactPipeline } from "../../frontend/src/cv/liveContactPipeline";

function profileImage(): ImageData {
  const width = 140;
  const height = 140;
  const data = new Uint8ClampedArray(width * height * 4);
  for (let y = 0; y < height; y += 1) {
    const value = y === 83 ? 130 : 210;
    for (let x = 0; x < width; x += 1) {
      const offset = (y * width + x) * 4;
      data[offset] = value;
      data[offset + 1] = value;
      data[offset + 2] = value;
      data[offset + 3] = 255;
    }
  }
  return { width, height, data, colorSpace: "srgb" } as ImageData;
}

describe("synchronous shadow pipeline", () => {
  afterEach(() => vi.restoreAllMocks());

  it("uses same-frame profile evidence for contact with the legacy worker off", () => {
    const image = profileImage();
    vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockImplementation(
      () => ({
        drawImage: vi.fn(),
        getImageData: () => image,
      }) as unknown as CanvasRenderingContext2D,
    );
    let frameAtMs = 100;
    const pipeline = new LiveContactPipeline({
      onContactsChanged: () => undefined,
      onShadowCameraPreview: () => undefined,
      onShadowPreview: () => undefined,
      onError: (message) => { throw new Error(message); },
    }, { knuckles: false, shadows: false, synchronousShadows: true }, () => frameAtMs);
    const frame = {
      video: { videoWidth: 140, videoHeight: 140, readyState: 2 } as HTMLVideoElement,
      hands: [{
        handedness: "Right" as const,
        landmarks: Array.from({ length: 21 }, () => ({ x: 0.5, y: 0.5, z: 0 })),
      }],
      fingertips: [{ id: "right-index", handIndex: 0, landmarkIndex: 8,
        point: { x: 70, y: 70 } }],
      whiteKeys: [[{ x: 0, y: 0 }, { x: 140, y: 0 },
        { x: 140, y: 140 }, { x: 0, y: 140 }]],
      calibration: null,
      previewFingerId: null,
    };

    pipeline.processFrame(frame);
    expect(pipeline.synchronousMeasurements.get("right-index")?.state)
      .toBe("press candidate");
    expect(pipeline.contacts.get("right-index")?.active).toBe(false);
    frameAtMs += 33;
    pipeline.processFrame(frame);
    expect(pipeline.contacts.get("right-index")?.active).toBe(true);
    expect(pipeline.techniques.shadows).toBe(false);
    expect(pipeline.techniques.synchronousShadows).toBe(true);
    pipeline.dispose();
  });

  it("does not analyze a fingertip outside the keyboard", () => {
    vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockImplementation(
      () => ({ drawImage: vi.fn(), getImageData: profileImage }) as unknown as CanvasRenderingContext2D,
    );
    const pipeline = new LiveContactPipeline({
      onContactsChanged: () => undefined,
      onShadowCameraPreview: () => undefined,
      onShadowPreview: () => undefined,
      onError: (message) => { throw new Error(message); },
    }, { knuckles: false, shadows: false, synchronousShadows: true }, () => 100);
    pipeline.processFrame({
      video: { videoWidth: 140, videoHeight: 140, readyState: 2 } as HTMLVideoElement,
      hands: [{ handedness: "Right", landmarks: Array.from({ length: 21 }, () => ({ x: 0.5, y: 0.5, z: 0 })) }],
      fingertips: [{ id: "right-index", handIndex: 0, landmarkIndex: 8,
        point: { x: 130, y: 130 } }],
      whiteKeys: [[{ x: 0, y: 0 }, { x: 40, y: 0 }, { x: 40, y: 40 }, { x: 0, y: 40 }]],
      calibration: null,
      previewFingerId: null,
    });
    expect(pipeline.synchronousMeasurements.has("right-index")).toBe(false);
    pipeline.dispose();
  });
});
