// @vitest-environment jsdom
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import {
  VisionCameraPipeline,
  type VisionCameraOptions,
  type VisionResult,
} from "../../frontend/src/cv/visionCameraPipeline";

let now: number;
let time: number;
let camera: {
  deviceId: string;
  width: number;
  height: number;
  facingMode: string;
} | null;
let video: HTMLVideoElement;
let sessionId: string | null;
let pipeline: VisionCameraPipeline;
let options: VisionCameraOptions;
let worker: {
  onmessage: ((event: { data: unknown }) => void) | null;
  onerror: (() => void) | null;
  onmessageerror: (() => void) | null;
  postMessage: ReturnType<typeof vi.fn>;
  terminate: ReturnType<typeof vi.fn>;
};
const frame = () =>
  worker.postMessage.mock.calls.filter(([m]) => m.type === "frame").at(-1)![0];
const reply = (result: Partial<VisionResult> = {}) => {
  const request = frame();
  worker.onmessage?.({
    data: {
      type: "frame",
      id: request.id,
      epoch: request.epoch,
      processMs: 20,
      result: { width: 2, height: 2, pressedKeys: [], ...result },
    },
  });
};

beforeEach(() => {
  vi.useFakeTimers();
  now = 100;
  time = 1;
  sessionId = "first";
  camera = { deviceId: "camera", width: 2, height: 2, facingMode: "" };
  video = {
    readyState: 4,
    get currentTime() {
      return time;
    },
  } as HTMLVideoElement;
  vi.spyOn(document, "hidden", "get").mockReturnValue(false);
  vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue({
    drawImage: vi.fn(),
    getImageData: vi.fn(() => ({ data: new Uint8ClampedArray(16) })),
  } as unknown as CanvasRenderingContext2D);
  worker = {
    onmessage: null,
    onerror: null,
    onmessageerror: null,
    postMessage: vi.fn(),
    terminate: vi.fn(),
  };
  options = {
    video: () => video,
    camera: () => camera,
    layout: { octaves: 1, startingMidi: 48, whiteKeys: 8 },
    sessionId: () => sessionId,
    onFrame: vi.fn(),
    onUnavailable: vi.fn(),
    onStatus: vi.fn(),
  };
  pipeline = new VisionCameraPipeline(
    options,
    () => now,
    () => worker as unknown as Worker,
  );
  pipeline.start();
  worker.onmessage?.({ data: { type: "ready" } });
});
afterEach(() => {
  pipeline.dispose();
  vi.restoreAllMocks();
  vi.useRealTimers();
});

it("sends one transferable frame and samples the newest frame after completion without a backlog", () => {
  pipeline.tick();
  const first = frame();
  expect(first.rgba).toBeInstanceOf(Uint8ClampedArray);
  expect(worker.postMessage.mock.calls.at(-1)![1]).toEqual([first.rgba.buffer]);
  time = 2;
  pipeline.tick();
  time = 3;
  pipeline.tick();
  expect(worker.postMessage).toHaveBeenCalledTimes(1);
  reply({ pressedKeys: [0, 1, 12] });
  expect(options.onFrame).toHaveBeenCalledWith(
    expect.objectContaining({
      timestampMs: 100,
      sessionId: "first",
      result: expect.objectContaining({ pressedKeys: [0, 1, 12] }),
    }),
  );
  pipeline.tick();
  expect(worker.postMessage).toHaveBeenCalledTimes(2);
  reply();
  pipeline.tick();
  expect(worker.postMessage).toHaveBeenCalledTimes(2);
});
it("consumes the reference button request once on the next available frame", () => {
  pipeline.tick();
  pipeline.setReference();
  time++;
  reply();
  pipeline.tick();
  expect(frame().setReference).toBe(true);
  reply();
  time++;
  pipeline.tick();
  expect(frame().setReference).toBe(false);
});
it("drops a pending result after reset, releases immediately and waits for its completion before sending more pixels", () => {
  pipeline.tick();
  pipeline.reset();
  time++;
  pipeline.tick();
  expect(options.onUnavailable).toHaveBeenCalledTimes(1);
  expect(
    worker.postMessage.mock.calls.filter(([m]) => m.type === "frame"),
  ).toHaveLength(1);
  reply({ pressedKeys: [0] });
  expect(options.onFrame).not.toHaveBeenCalled();
  pipeline.tick();
  expect(frame().epoch).toBe(1);
  expect(frame().setReference).toBe(false);
});
it("rejects old camera pixels and resets before processing the new source", () => {
  pipeline.tick();
  camera = { ...camera!, deviceId: "replacement" };
  reply({ pressedKeys: [0] });
  expect(options.onFrame).not.toHaveBeenCalled();
  time++;
  pipeline.tick();
  expect(options.onUnavailable).toHaveBeenCalled();
  expect(worker.postMessage.mock.calls.some(([m]) => m.type === "reset")).toBe(
    true,
  );
  expect(frame().epoch).toBe(1);
});
it("keeps the session identity and observation time from submission, not delivery", () => {
  pipeline.tick();
  sessionId = "replacement";
  now += 50;
  reply();
  expect(options.onFrame).toHaveBeenCalledWith(
    expect.objectContaining({ sessionId: "first", timestampMs: 100 }),
  );
});
it("releases immediately on missing camera and discards a pending old result", () => {
  pipeline.tick();
  camera = null;
  pipeline.tick();
  reply({ pressedKeys: [0] });
  expect(options.onUnavailable).toHaveBeenCalledTimes(1);
  expect(options.onFrame).not.toHaveBeenCalled();
});
it.each([
  "timeout",
  "late-result",
  "error",
  "messageerror",
  "invalid-keys",
  "wrong-id",
])("fails closed on %s", (mode) => {
  pipeline.tick();
  if (mode === "timeout") {
    now += 500;
    pipeline.tick();
  }
  if (mode === "late-result") {
    now += 500;
    reply();
  }
  if (mode === "error") worker.onerror?.();
  if (mode === "messageerror") worker.onmessageerror?.();
  if (mode === "invalid-keys") reply({ pressedKeys: [1, 1] });
  if (mode === "wrong-id")
    worker.onmessage?.({ data: { type: "frame", id: 99, epoch: 0 } });
  expect(worker.terminate).toHaveBeenCalledTimes(1);
  expect(options.onUnavailable).toHaveBeenCalledTimes(1);
  expect(options.onFrame).not.toHaveBeenCalled();
  expect(options.onStatus).toHaveBeenLastCalledWith(expect.any(String), true);
  pipeline.tick();
  expect(worker.postMessage).toHaveBeenCalledTimes(1);
});
it("terminates on disposal and ignores delayed results", () => {
  pipeline.tick();
  pipeline.dispose();
  reply({ pressedKeys: [0] });
  expect(worker.terminate).toHaveBeenCalledTimes(1);
  expect(options.onFrame).not.toHaveBeenCalled();
});
it("rejects unsupported paper/layout combinations before starting a worker", () => {
  pipeline.dispose();
  const create = vi.fn();
  pipeline = new VisionCameraPipeline(
    { ...options, layout: { ...options.layout, paperOctaves: 2 } },
    () => now,
    create,
  );
  pipeline.start();
  expect(create).not.toHaveBeenCalled();
  expect(options.onStatus).toHaveBeenLastCalledWith(
    expect.stringContaining("matching paper"),
    true,
  );
});
