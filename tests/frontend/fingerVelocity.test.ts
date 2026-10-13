import { afterEach, expect, it, vi } from "vitest";
import { FingerVelocity, MIN_PRESS_VELOCITY, speedToVelocity } from "../../frontend/src/cv/fingerVelocity";
import { LiveContactPipeline } from "../../frontend/src/cv/liveContactPipeline";
import { getFingertips, type HandObservation } from "../../frontend/src/cv/collision";
import { Synth } from "../../frontend/public/audio/synth.js";
import type { ShadowWorkerRequest, ShadowWorkerResponse } from "../../frontend/src/cv/shadowHeuristics";

function hand(z = 0, x = 0.5, translation = 0, scale = 1): HandObservation {
  const landmarks = Array.from({ length: 21 }, () => ({ x: 0.5, y: 0.5, z: 0 }));
  landmarks[0] = { x: 0.5, y: 0.7, z: 0 };
  landmarks[9] = { x: 0.5, y: 0.5, z: 0 };
  landmarks[8] = { x, y: 0.4, z };
  return { handedness: "Right", landmarks: landmarks.map(point => ({
    x: point.x * scale + translation, y: point.y * scale + translation, z: point.z * scale,
  })) };
}
function observe(estimator: FingerVelocity, observation: HandObservation, at: number, source = "Right:1000:1000") {
  estimator.observe(observation, 8, 1000, 1000, at, source);
}
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); });

it("maps stationary/noisy, slow and fast motion monotonically into finite audible velocities", () => {
  const velocities = [0, 0.4, 0.5, 2, 8, 100].map(speedToVelocity);
  [0.2, 0.2, 0.2, 0.36, 1, 1].forEach((expected, index) =>
    expect(velocities[index]).toBeCloseTo(expected));
  for (const speed of [-1, NaN, Infinity]) expect(speedToVelocity(speed)).toBe(MIN_PRESS_VELOCITY);
});

it.each([10, 20, 40])("uses elapsed time for the same depth speed at %i ms frame intervals", (interval) => {
  const estimator = new FingerVelocity();
  observe(estimator, hand(), 100);
  observe(estimator, hand(-0.2 * 2 * interval / 1000), 100 + interval);
  expect(estimator.takeVelocity(100 + interval)).toBeCloseTo(0.36);
});

it("removes hand translation and normalizes hand scale", () => {
  const estimator = new FingerVelocity();
  observe(estimator, hand(), 100);
  observe(estimator, hand(0, 0.5, 0.1, 1.5), 120);
  expect(estimator.takeVelocity(120)).toBe(0.2);
  observe(estimator, hand(-0.008, 0.5, 0.1, 1.5), 140);
  expect(estimator.takeVelocity(140)).toBeCloseTo(0.36);
});

it.each([[640, 480], [1280, 960], [1920, 1080]])("corrects image aspect at %i by %i", (width, height) => {
  const estimator = new FingerVelocity();
  estimator.observe(hand(), 8, width, height, 100, "fixture");
  const observation = hand();
  const landmarks = [...observation.landmarks];
  landmarks[8] = { ...landmarks[8], y: 0.408 };
  estimator.observe({ ...observation, landmarks }, 8, width, height, 120, "fixture");
  expect(estimator.takeVelocity(120)).toBeCloseTo(0.36);
});

it("supports xy-only observations without introducing a spike when depth appears", () => {
  const estimator = new FingerVelocity();
  const flat = (x: number): HandObservation => ({ ...hand(0, x),
    landmarks: hand(0, x).landmarks.map(({ x, y }) => ({ x, y })) });
  observe(estimator, flat(0.5), 100);
  observe(estimator, flat(0.508), 120);
  expect(estimator.takeVelocity(120)).toBeCloseTo(0.36);
  observe(estimator, hand(-0.2, 0.508), 140);
  expect(estimator.takeVelocity(140)).toBe(0.2);
});

it("uses a bounded recent peak and consumes it once at onset", () => {
  const estimator = new FingerVelocity();
  observe(estimator, hand(), 100);
  observe(estimator, hand(-0.032), 120);
  observe(estimator, hand(-0.032), 140);
  expect(estimator.takeVelocity(150)).toBe(1);
  expect(estimator.takeVelocity(150)).toBe(0.2);
  for (let at = 160; at <= 1000; at += 10) observe(estimator, hand(-0.032), at);
  expect(estimator.takeVelocity(1000)).toBe(0.2);
});

it("ignores duplicate/sub-5ms frames and expires old motion", () => {
  const estimator = new FingerVelocity();
  observe(estimator, hand(), 100);
  observe(estimator, hand(-10), 100);
  observe(estimator, hand(-10), 101);
  expect(estimator.takeVelocity(101)).toBe(0.2);
  observe(estimator, hand(-0.032), 120);
  expect(estimator.takeVelocity(221)).toBe(0.2);
});

it.each(["gap", "backward", "source", "reset", "invalid", "palm"])("clears old motion after %s", (reason) => {
  const estimator = new FingerVelocity();
  observe(estimator, hand(), 100);
  observe(estimator, hand(-0.032), 120);
  if (reason === "gap") observe(estimator, hand(-2), 300);
  if (reason === "backward") observe(estimator, hand(-2), 119);
  if (reason === "source") observe(estimator, hand(-2), 140, "Left:1000:1000");
  if (reason === "reset") estimator.reset();
  if (reason === "invalid") observe(estimator, hand(NaN), 140);
  if (reason === "palm") {
    const invalid = hand();
    const landmarks = [...invalid.landmarks];
    landmarks[9] = landmarks[0];
    observe(estimator, { ...invalid, landmarks }, 140);
  }
  expect(estimator.takeVelocity(140)).toBe(0.2);
});

it("latches pipeline onset velocity through a hold and clears it on loss/reset", () => {
  let now = 100;
  vi.spyOn(performance, "now").mockImplementation(() => now);
  const changed = vi.fn();
  const pipeline = new LiveContactPipeline({ onContactsChanged: changed,
    onShadowCameraPreview: vi.fn(), onShadowPreview: vi.fn(), onError: vi.fn(),
  }, { shadows: false, knuckles: false });
  const video = { videoWidth: 1000, videoHeight: 1000, readyState: 2 } as HTMLVideoElement;
  const frame = (observation: HandObservation | null) => pipeline.processFrame({ video,
    hands: observation ? [observation] : [],
    fingertips: observation ? getFingertips([observation.landmarks], 1000, 1000).filter(f => f.landmarkIndex === 8) : [],
    whiteKeys: [[{ x: 400, y: 300 }, { x: 600, y: 300 }, { x: 600, y: 500 }, { x: 400, y: 500 }]],
    calibration: null, previewFingerId: null,
  });
  frame(hand());
  now = 120;
  frame(hand(-0.008));
  expect(pipeline.pressVelocities.get("0-8")).toBeCloseTo(0.36);
  now = 140;
  frame(hand(-0.1));
  expect(pipeline.pressVelocities.get("0-8")).toBeCloseTo(0.36);
  frame(null);
  expect(pipeline.pressVelocities.size).toBe(0);
  now = 160;
  frame(hand(-0.2));
  now = 180;
  frame(hand(-0.2));
  expect(pipeline.pressVelocities.get("0-8")).toBe(0.2);
  pipeline.reset();
  expect(pipeline.pressVelocities.size).toBe(0);
  frame(hand(-1));
  now = 200;
  frame(hand(-1));
  expect(pipeline.pressVelocities.get("0-8")).toBe(0.2);
  pipeline.dispose();
});

it("estimated fast motion produces a louder production DSP render than slow motion", () => {
  const rms = (z: number) => {
    const estimator = new FingerVelocity();
    observe(estimator, hand(), 100);
    observe(estimator, hand(z), 120);
    const synth = new Synth(48000);
    synth.handle({ type: "reset", session: 1 });
    synth.handle({ type: "note-on", session: 1, press: 1, note: 60,
      velocity: estimator.takeVelocity(120) });
    const samples = new Float32Array(48000);
    synth.render(samples);
    let sum = 0;
    for (let index = 24000; index < samples.length; index++) sum += samples[index] ** 2;
    return Math.sqrt(sum / 24000);
  };
  const slow = rms(-0.008);
  const fast = rms(-0.032);
  expect(slow).toBeGreaterThan(0);
  expect(slow / fast).toBeCloseTo(0.36, 5);
  expect(20 * Math.log10(fast / slow)).toBeGreaterThan(5);
});

it("retains pre-contact speed for delayed shadow confirmation and rejects results after reset", () => {
  let now = 100;
  vi.spyOn(performance, "now").mockImplementation(() => now);
  class WorkerFixture {
    onmessage: ((event: { data: ShadowWorkerResponse }) => void) | null = null;
    onerror = null;
    request!: ShadowWorkerRequest;
    postMessage(request: ShadowWorkerRequest) { this.request = request; }
    terminate() {}
  }
  const worker = new WorkerFixture();
  vi.stubGlobal("Worker", class { constructor() { return worker; } });
  vi.stubGlobal("document", { createElement: () => ({ width: 0, height: 0,
    getContext: () => ({ drawImage: vi.fn(), getImageData: () => ({ data: new Uint8ClampedArray(4) }) }),
  }) });
  const pipeline = new LiveContactPipeline({ onContactsChanged: vi.fn(),
    onShadowCameraPreview: vi.fn(), onShadowPreview: vi.fn(), onError: vi.fn(),
  }, { shadows: true, knuckles: false });
  const video = { videoWidth: 1000, videoHeight: 1000, readyState: 2 } as HTMLVideoElement;
  const frame = (z: number) => {
    const observation = hand(z);
    pipeline.processFrame({ video, hands: [observation],
      fingertips: getFingertips([observation.landmarks], 1000, 1000).filter(f => f.landmarkIndex === 8),
      whiteKeys: [[{ x: 400, y: 300 }, { x: 600, y: 300 }, { x: 600, y: 500 }, { x: 400, y: 500 }]],
      calibration: null, previewFingerId: null });
  };
  const confirm = (areaPixels: number) => worker.onmessage?.({ data: {
    frameAtMs: worker.request.frameAtMs,
    observations: worker.request.fingers.map(({ id, keyOverlap, contactRevision }) => ({
      id, keyOverlap, contactRevision, observation: { state: "unknown", lumaChange: null, mask: null,
        contour: { areaPixels, boundary: null }, measurement: { available: true, backgroundLuma: 200,
          meanLuma: 180, shadowStrength: 20, darkness: 20, darkArea: areaPixels, centroid: null } },
    })),
  } });
  pipeline.start();
  try {
    frame(0);
    confirm(600); // Hover evidence, not a press.
    now = 120;
    frame(-0.032);
    now = 160;
    frame(-0.032); // Landmark history refreshes while the worker is busy.
    now = 170;
    confirm(100);
    expect(pipeline.pressVelocities.get("0-8")).toBe(1);
    pipeline.reset();
    confirm(100);
    expect(pipeline.pressVelocities.size).toBe(0);
  } finally { pipeline.dispose(); }
});
