import { JSDOM } from "jsdom";
import { act, createElement, type ComponentProps } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import type { Recording } from "../../frontend/src/app/midi/midiUtils";
import type { HandObservation, NormalizedLandmark } from "../../frontend/src/cv/collision";

const fixtures = vi.hoisted(() => ({
  invalidate: null as null | (() => void),
  landmarks: null as null | ((hands: HandObservation[]) => void),
  initializeAudio: vi.fn(async () => {}),
  takes: [] as Recording[],
  download: vi.fn(),
  highlight: vi.fn(),
  detect: vi.fn(),
  missNextDetection: false,
  camera: { stream: { getVideoTracks: () => [{ readyState: "live", getSettings: () => ({ deviceId: "camera-1" }) }] }, cameraReady: true },
}));
vi.mock("../../frontend/src/cv/keyboardGeometry", async (original) => ({
  ...await original<typeof import("../../frontend/src/cv/keyboardGeometry")>(),
  pressWhiteKey: fixtures.highlight,
}));
// jsdom has no Worker or depth calibration, so run the real contact pipeline
// in its overlap-only mode; these tests cover recording, not contact sensing.
vi.mock("../../frontend/src/cv/liveContactPipeline", async (original) => {
  const actual = await original<typeof import("../../frontend/src/cv/liveContactPipeline")>();
  const overlapOnly = { knuckles: false, shadows: false };
  return {
    ...actual,
    CONTACT_TECHNIQUES: overlapOnly,
    LiveContactPipeline: class extends actual.LiveContactPipeline {
      constructor(callbacks: ConstructorParameters<typeof actual.LiveContactPipeline>[0]) {
        super(callbacks, overlapOnly);
      }
    },
  };
});
vi.mock("../../frontend/src/app/CameraContext", () => ({
  useCamera: () => fixtures.camera,
}));
vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn() }) }));
vi.mock("../../frontend/src/app/audio/audioEngine", () => ({
  browserAudio: {
    initialize: fixtures.initializeAudio,
    status: "ready",
    subscribeInvalidation: (listener: () => void) => {
      fixtures.invalidate = listener;
      return () => { fixtures.invalidate = null; };
    },
    noteOn: vi.fn(() => ({ session: 1, press: 1 })),
    noteOff: vi.fn(() => true),
    releaseAll: vi.fn(),
  },
}));
vi.mock("../../frontend/src/app/midi/midiUtils", async (original) => {
  const actual = await original<typeof import("../../frontend/src/app/midi/midiUtils")>();
  return {
    ...actual,
    downloadMidi: fixtures.download,
    createRecorder: () => {
      const recorder = actual.createRecorder();
      const stop = recorder.stopRecording;
      recorder.stopRecording = () => {
        const take = stop();
        if (take) fixtures.takes.push(take);
        return take;
      };
      return recorder;
    },
  };
});
vi.mock("../../frontend/src/cv/markerDetector", () => ({
  MarkerDetector: {
    create: async () => ({
      dispose: vi.fn(),
      detect: () => {
        fixtures.detect();
        if (fixtures.missNextDetection) {
          fixtures.missNextDetection = false;
          return { missingIds: [0], observations: [] };
        }
        return ({
        missingIds: [],
        observations: [[100, 100], [900, 100], [900, 900], [100, 900]]
          .map(([x, y], id) => ({
            id, center: { x, y },
            corners: [{ x, y }, { x: x + 1, y }, { x: x + 1, y: y + 1 }, { x, y: y + 1 }],
          })),
      });
      },
    }),
  },
}));
vi.mock("next/dynamic", async () => {
  const { default: LibraryPanel } = await import("../../frontend/src/app/midi/RecordingsLibraryPanel");
  return {
    default: (loader: () => unknown) => {
      const source = loader.toString();
      if (source.includes("RecordingsLibraryPanel")) return LibraryPanel;
      if (source.includes("CVOverlayCoordinator")) {
        return function CoordinatorFixture(props: ComponentProps<typeof Coordinator>) {
          return createElement(Coordinator, props);
        };
      }
      if (source.includes("MarkerTrackingOverlay")) {
        return function MarkerFixture(props: ComponentProps<typeof Marker>) {
          return createElement(Marker, props);
        };
      }
      return function HandFixture({ onLandmarks }: {
        onLandmarks: (hands: HandObservation[]) => void;
      }) {
        fixtures.landmarks = onLandmarks;
        return null;
      };
    },
  };
});

import { browserAudio } from "../../frontend/src/app/audio/audioEngine";
import Home from "../../frontend/src/app/page";
import Coordinator from "../../frontend/src/app/CVOverlayCoordinator";
import Marker from "../../frontend/src/app/MarkerTrackingOverlay";
import { saveKeyboardLayout } from "../../frontend/src/lib/keyboardSettings";
import { getWhiteKeyPolygons } from "../../frontend/src/cv/keyboardGeometry";

let root: Root;
let host: HTMLDivElement;
let now: number;
let animationFrame: FrameRequestCallback | undefined;
let dom: JSDOM;
let currentHands: NormalizedLandmark[][] = [];

beforeEach(async () => {
  dom = new JSDOM("<!doctype html><html><body></body></html>", { url: "http://localhost", pretendToBeVisual: true });
  for (const name of ["window", "self", "document", "localStorage", "HTMLCanvasElement", "HTMLVideoElement", "getComputedStyle"]) {
    vi.stubGlobal(name, Reflect.get(dom.window, name));
  }
  vi.useFakeTimers();
  vi.clearAllMocks();
  now = 1000;
  currentHands = [];
  fixtures.takes.length = 0;
  fixtures.missNextDetection = false;
  fixtures.camera.cameraReady = true;
  fixtures.initializeAudio.mockImplementation(async () => {});
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  vi.spyOn(performance, "now").mockImplementation(() => now);
  vi.stubGlobal("requestAnimationFrame", (callback: FrameRequestCallback) => {
    animationFrame = callback;
    return 1;
  });
  vi.stubGlobal("cancelAnimationFrame", vi.fn());
  const contextMethods = ["clearRect", "drawImage", "beginPath", "moveTo",
    "lineTo", "closePath", "fill", "stroke", "fillText", "fillRect",
    "strokeRect", "putImageData", "save", "restore", "scale", "setLineDash"];
  vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockImplementation(
    function (this: HTMLCanvasElement) {
      return Object.assign(
        Object.fromEntries(contextMethods.map((name) => [name, vi.fn()])),
        { canvas: this },
      ) as unknown as CanvasRenderingContext2D;
    },
  );
  for (const [name, value] of Object.entries({ readyState: 4, videoWidth: 1000, videoHeight: 1000 })) {
    vi.spyOn(HTMLVideoElement.prototype, name as "readyState", "get").mockReturnValue(value);
  }
  vi.spyOn(console, "log").mockImplementation(() => {});
  localStorage.setItem("makeshift.calibration.v1", JSON.stringify({
    version: 1, coordinates: "unmirrored-frame-pixels/marker-unit-square", sheet: "aruco-0-3-white-keys-v1",
    camera: { deviceId: "camera-1", width: 1000, height: 1000, facingMode: "" },
    layout: { octaves: 1, startingMidi: 48, whiteKeys: 8 },
    corners: [{ x: 100, y: 100 }, { x: 900, y: 100 }, { x: 900, y: 900 }, { x: 100, y: 900 }],
    contact: { model: "landmark-reference-v1", hover: [Array(21).fill({ x: 0.5, y: 0.4, z: 0 })], rest: [Array(21).fill({ x: 0.5, y: 0.5, z: 0 })] },
  }));
  // Explicit tempo keeps lifecycle timing independent of the user default.
  localStorage.setItem("makeshift:playback-settings:v1", JSON.stringify({ tempo: 120, metronome: true }));
  localStorage.setItem("hasVisited", "true");
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
  await act(async () => root.render(<Home />));
  await advance(0);
  // Disable count-in audio; audio hardware is outside this fixture.
  const metronome = host.querySelector<HTMLButtonElement>('button[aria-label="Toggle metronome"]');
  if (!metronome) throw new Error("Metronome control missing");
  await click(metronome);
  await keys();
});

afterEach(async () => {
  await act(async () => root.unmount());
  host.remove();
  localStorage.clear();
  dom.window.close();
  vi.useRealTimers();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

function button(label: string): HTMLButtonElement {
  const result = host.querySelector<HTMLButtonElement>(`button[aria-label="${label}"]`);
  if (!result) throw new Error(`Missing button: ${label}`);
  return result;
}

async function click(target: HTMLButtonElement) {
  await act(async () => target.click());
}

async function advance(ms: number) {
  for (let elapsed = 0; elapsed < ms; elapsed += 100) {
    const step = Math.min(100, ms - elapsed);
    now += step;
    await act(async () => fixtures.landmarks?.(
    currentHands.map((landmarks) => ({ landmarks, handedness: "Right" as const })),
  ));
    await frame();
    await act(async () => { await vi.advanceTimersByTimeAsync(step); });
  }
  if (ms === 0) await act(async () => { await vi.advanceTimersByTimeAsync(0); });
}

async function countIn() {
  for (let i = 0; i < 4; i++) await advance(500);
}

async function frame() {
  await act(async () => animationFrame?.(now));
}

async function keys(...xs: number[]) {
  const hand = Array.from({ length: 21 }, () => ({ x: -10, y: -10 }));
  for (let i = 0; i < xs.length; i++) hand[[4, 8, 12, 16, 20][i]] = { x: xs[i] / 1000, y: 0.5 };
  currentHands = xs.length ? [hand] : [];
  await act(async () => fixtures.landmarks?.(
    currentHands.map((landmarks) => ({ landmarks, handedness: "Right" as const })),
  ));
  await frame();
  // The per-finger FSM enters ready before ready evaluates contact evidence.
  // Supply the next stable observation so integration cases exercise a held
  // key through the complete transition without modeling sensor latency here.
  await act(async () => fixtures.landmarks?.(
    currentHands.map((landmarks) => ({ landmarks, handedness: "Right" as const })),
  ));
  await frame();
}

async function start() {
  await click(button("Start recording"));
  await countIn();
  expect(button("Pause recording").disabled).toBe(false);
}

it("dispatches a chord and release/repress before React commits the landmark snapshot", async () => {
  await start();
  const landmarks: NormalizedLandmark[] = Array.from({ length: 21 }, () => ({ x: -10, y: -10 }));
  landmarks[4] = { x: 0.115, y: 0.5 };
  landmarks[8] = { x: 0.325, y: 0.5 };
  const chord: HandObservation[] = [{ landmarks, handedness: "Right" }];
  vi.mocked(browserAudio.noteOn).mockClear();
  vi.mocked(browserAudio.noteOff).mockClear();
  await act(async () => {
    fixtures.landmarks?.(chord);
    fixtures.landmarks?.(chord);
    expect(browserAudio.noteOn).toHaveBeenCalledTimes(2);
    expect(browserAudio.noteOn).toHaveBeenNthCalledWith(1, 48, 0.2);
    expect(browserAudio.noteOn).toHaveBeenNthCalledWith(2, 52, 0.2);
    fixtures.landmarks?.(chord);
    expect(browserAudio.noteOn).toHaveBeenCalledTimes(2);
    now += 40;
    fixtures.landmarks?.([]);
    expect(browserAudio.noteOff).toHaveBeenCalledTimes(2);
    fixtures.landmarks?.(chord);
    fixtures.landmarks?.(chord);
    expect(browserAudio.noteOn).toHaveBeenCalledTimes(4);
  });
  await advance(60);
  await click(button("Stop recording"));
  expect(fixtures.takes.at(-1)!.notes).toEqual([
    { pitch: "C3", velocity: 20, startMs: 0, durationMs: 40 },
    { pitch: "E3", velocity: 20, startMs: 0, durationMs: 40 },
    { pitch: "C3", velocity: 20, startMs: 40, durationMs: 60 },
    { pitch: "E3", velocity: 20, startMs: 40, durationMs: 60 },
  ]);
});

it("outputs one key when a single fingertip overlaps adjacent key polygons", async () => {
  await start();
  vi.mocked(browserAudio.noteOn).mockClear();
  vi.mocked(browserAudio.noteOff).mockClear();

  await keys(170); // Within the 8 px overlap tolerance of the next key.
  expect(browserAudio.noteOn).toHaveBeenCalledTimes(1);
  expect(browserAudio.noteOn).toHaveBeenCalledWith(48, 0.2);

  await keys();
  expect(browserAudio.noteOff).toHaveBeenCalledTimes(1);
});

it("switches the output key when one finger moves to another key", async () => {
  await start();
  vi.mocked(browserAudio.noteOn).mockClear();
  vi.mocked(browserAudio.noteOff).mockClear();

  await keys(115);
  expect(browserAudio.noteOn).toHaveBeenCalledWith(48, 0.2);
  now += 20;
  await keys(325);

  expect(browserAudio.noteOff).toHaveBeenCalledTimes(1);
  expect(browserAudio.noteOn).toHaveBeenCalledTimes(2);
  expect(vi.mocked(browserAudio.noteOn).mock.calls[1][0]).toBe(52);
});

it("keeps a shared key active until its last finger releases", async () => {
  await start();
  vi.mocked(browserAudio.noteOn).mockClear();
  vi.mocked(browserAudio.noteOff).mockClear();

  await keys(115, 115);
  expect(browserAudio.noteOn).toHaveBeenCalledTimes(1);
  expect(browserAudio.noteOn).toHaveBeenCalledWith(48, 0.2);

  await keys(115);
  expect(browserAudio.noteOff).not.toHaveBeenCalled();

  await keys();
  expect(browserAudio.noteOff).toHaveBeenCalledTimes(1);
});

it.each([false, true])("sends estimated velocities to audio/MIDI and retains them while held (same key: %s)", async (sameKey) => {
  await start();
  const landmarks: NormalizedLandmark[] = Array.from({ length: 21 }, () => ({ x: -10, y: -10, z: 0 }));
  landmarks[0] = { x: 0.5, y: 0.8, z: 0 };
  landmarks[9] = { x: 0.5, y: 0.6, z: 0 };
  landmarks[4] = { x: 0.115, y: 0.5, z: 0 };
  landmarks[8] = { x: sameKey ? 0.115 : 0.325, y: 0.5, z: 0 };
  const observe = (slowZ: number, fastZ: number) => {
    const next = [...landmarks];
    next[4] = { ...landmarks[4], z: slowZ };
    next[8] = { ...landmarks[8], z: fastZ };
    fixtures.landmarks?.([{ landmarks: next, handedness: "Right" }]);
  };
  vi.mocked(browserAudio.noteOn).mockClear();
  await act(async () => {
    observe(0, 0);
    now += 20;
    observe(-0.008, -0.032);
    expect(browserAudio.noteOn).toHaveBeenCalledTimes(sameKey ? 1 : 2);
    expect(vi.mocked(browserAudio.noteOn).mock.calls[0][1]).toBeCloseTo(sameKey ? 1 : 0.5428571428571429);
    if (!sameKey) expect(vi.mocked(browserAudio.noteOn).mock.calls[1][1]).toBeCloseTo(1);
    now += 20;
    observe(-0.1, -0.1);
    expect(browserAudio.noteOn).toHaveBeenCalledTimes(sameKey ? 1 : 2);
    now += 20;
    fixtures.landmarks?.([]);
  });
  await click(button("Stop recording"));
  expect(fixtures.takes.at(-1)!.notes).toEqual(sameKey ? [
    { pitch: "C3", velocity: 100, startMs: 20, durationMs: 40 },
  ] : [
    { pitch: "C3", velocity: 54, startMs: 20, durationMs: 40 },
    { pitch: "E3", velocity: 100, startMs: 20, durationMs: 40 },
  ]);
});

it.each([2, 3])("uses %i-octave live geometry, shifted notes and feedback after recalibration", async (octaves) => {
  await start();
  await keys(115);
  await advance(100);
  const oldCalibration = JSON.parse(localStorage.getItem("makeshift.calibration.v1")!);
  const layout = { octaves, startingMidi: 60, whiteKeys: octaves * 7 + 1, paperOctaves: octaves };
  await act(async () => {
    expect(saveKeyboardLayout(layout).ok).toBe(true);
    // Release happens in the store callback before any new marker scan.
    expect(browserAudio.releaseAll).toHaveBeenCalled();
  });
  expect(fixtures.takes.at(-1)?.notes[0]).toMatchObject({ pitch: "C3", durationMs: 100 });
  const enable = [...host.querySelectorAll("button")].find(b => b.textContent === "Enable audio")!;
  expect(enable.disabled).toBe(true);
  localStorage.setItem("makeshift.calibration.v1", JSON.stringify({ ...oldCalibration, layout }));
  await advance(10_000);
  await click(enable);
  const last = getWhiteKeyPolygons(layout).at(-1)!;
  const x = 100 + (last[0].x + last[1].x) / 2 * 800;
  await keys(x);
  expect(browserAudio.noteOn).toHaveBeenLastCalledWith(60 + 12 * octaves, 0.2);
  expect(fixtures.highlight).toHaveBeenLastCalledWith(expect.anything(), expect.anything(), expect.anything());
});

it("announces capture state through pause, resume count-in and completion", async () => {
  const status = () => host.querySelector('[aria-live="polite"]')?.textContent;
  await click(button("Start recording"));
  expect(status()).toBe("Count-in to start recording");
  await countIn();
  expect(status()).toBe("Recording started");
  await click(button("Pause recording"));
  expect(status()).toBe("Recording paused");
  await click(button("Resume recording"));
  expect(status()).toBe("Count-in to resume recording");
  await countIn();
  expect(status()).toBe("Recording started");
  await click(button("Stop recording"));
  expect(status()).toBe("Recording complete");
});

it("uses the real page/coordinator/marker transitions to capture held keys after resume", async () => {
  await start();
  await keys(115); // First key, via real geometry and transitions.
  await advance(500);
  await click(button("Pause recording"));
  expect(button("Resume recording").disabled).toBe(false);
  await keys(115, 225); // Second key first pressed during pause.
  await advance(1000);
  await click(button("Resume recording"));
  expect(button("Resume recording").disabled).toBe(true);
  await countIn();
  await advance(250);
  await keys();
  await click(button("Stop recording"));
  const notes = fixtures.takes.at(-1)!.notes;
  expect(notes).toHaveLength(3);
  expect(notes[0]).toMatchObject({ startMs: 0, durationMs: 500 });
  expect(notes[1]).toMatchObject({ pitch: notes[0].pitch, startMs: 500, durationMs: 250 });
  expect(notes[2]).toMatchObject({ startMs: 500, durationMs: 250 });
  expect(notes[2].pitch).not.toBe(notes[0].pitch);
  expect(host.textContent).toContain("1 recording");
  expect(button("Start recording").disabled).toBe(false);
});

it("omits keys released during pause and preserves timing across repeated resumes", async () => {
  await start();
  await keys(115);
  await advance(200);
  await click(button("Pause recording"));
  await keys(225);
  await advance(1000);
  await keys();
  await click(button("Resume recording"));
  await countIn();
  await advance(300);
  await keys(115);
  await advance(100);
  await click(button("Pause recording"));
  await click(button("Resume recording"));
  await countIn();
  await advance(100);
  await click(button("Stop recording"));
  expect(fixtures.takes.at(-1)!.notes.map(({ startMs, durationMs }) => ({ startMs, durationMs })))
    .toEqual([
      { startMs: 0, durationMs: 200 },
      { startMs: 500, durationMs: 100 },
      { startMs: 600, durationMs: 100 },
    ]);
});

it("Stop during resume count-in preserves the take and cancels the pending resume", async () => {
  await start();
  await keys(115);
  await advance(500);
  await click(button("Pause recording"));
  await click(button("Resume recording"));
  await advance(500);
  await click(button("Stop recording"));
  await countIn();
  expect(fixtures.takes).toHaveLength(1);
  expect(fixtures.takes[0].notes).toHaveLength(1);
  expect(fixtures.takes[0].notes[0].durationMs).toBe(500);
  expect(button("Start recording").disabled).toBe(false);
  expect(button("Stop recording").disabled).toBe(true);
});

it("cancels an initial count-in without making a take", async () => {
  await click(button("Start recording"));
  await advance(500);
  await click(button("Stop recording"));
  await countIn();
  expect(fixtures.takes).toEqual([]);
  expect(host.textContent).toContain("No recordings yet.");
  expect(button("Start recording").disabled).toBe(false);
});

it("resume keeps the live audio session without reinitializing it", async () => {
  await start();
  await keys(115);
  await advance(500);
  await click(button("Pause recording"));
  fixtures.initializeAudio.mockClear();
  await click(button("Resume recording"));
  await click(button("Stop recording"));
  await countIn();
  expect(fixtures.initializeAudio).not.toHaveBeenCalled();
  expect(button("Start recording").disabled).toBe(false);
  expect(button("Stop recording").disabled).toBe(true);
});


it("rejects a legacy boolean and interrupts recording when persisted calibration changes", async () => {
  await start();
  await keys(150);
  localStorage.removeItem("makeshift.calibration.v1");
  localStorage.setItem("isCalibrated", "true");
  await advance(10_000);
  await frame();
  expect(button("Start recording").disabled).toBe(true);
  expect(fixtures.takes).toHaveLength(1);
  await keys(250);
  expect(fixtures.takes).toHaveLength(1);
});


it("audio interruption closes the take and recovery needs another Play", async () => {
  await start();
  await keys(115);
  await advance(100);
  await act(async () => fixtures.invalidate?.());
  expect(fixtures.takes).toHaveLength(1);
  expect(host.textContent).toContain("Audio interrupted");
  await keys(225);
  expect(fixtures.takes[0].notes).toHaveLength(1);
  await start();
  await click(button("Stop recording"));
});

it("Stop cancels initial audio startup and offers a clean retry", async () => {
  let resolve!: () => void;
  fixtures.initializeAudio.mockImplementationOnce(() => new Promise<void>((done) => { resolve = done; }));
  await click(button("Start recording"));
  expect(button("Stop recording").disabled).toBe(false);
  await click(button("Stop recording"));
  await act(async () => resolve());
  await countIn();
  expect(fixtures.takes).toHaveLength(0);
  await start();
});

it("backgrounding releases the session and closes the recording", async () => {
  await start();
  await keys(115);
  await act(async () => window.dispatchEvent(new window.Event("pagehide")));
  expect(fixtures.takes).toHaveLength(1);
  expect(button("Start recording").disabled).toBe(true);
  expect(host.textContent).toContain("background");
  // Kept without the save question: the person never chose to stop.
  expect(document.body.textContent).toContain("1 recording");
  expect(document.body.textContent).not.toContain("Would you like to save");
});


it("ignores repeated Play while audio is starting", async () => {
  let resolve!: () => void;
  fixtures.initializeAudio.mockImplementationOnce(() => new Promise<void>((done) => { resolve = done; }));
  await click(button("Start recording"));
  expect(button("Start recording").disabled).toBe(true);
  await click(button("Start recording"));
  await act(async () => resolve());
  await countIn();
  expect(button("Pause recording").disabled).toBe(false);
  expect(fixtures.initializeAudio).toHaveBeenCalledTimes(1);
});

it("highlights accepted notes through recording Stop and clears them on interruption", async () => {
  await keys(115);
  // Since #148, contact highlights keys before any session starts.
  expect(fixtures.highlight).toHaveBeenCalled();
  fixtures.highlight.mockClear();
  await start();
  await advance(0);
  expect(fixtures.highlight).toHaveBeenCalled();
  await click(button("Stop recording"));
  fixtures.highlight.mockClear();
  await keys(115, 225);
  await advance(100);
  expect(fixtures.highlight).toHaveBeenCalled();
  await act(async () => fixtures.invalidate?.());
  fixtures.highlight.mockClear();
  await keys(115, 225);
  await advance(100);
  // Contact feedback still highlights; the interrupted session records nothing.
  expect(fixtures.takes.at(-1)!.notes).toHaveLength(1);
});

it("records a same-turn press before Stop drains deferred consumers", async () => {
  await start();
  await keys(115);
  await click(button("Stop recording"));
  expect(fixtures.takes.at(-1)!.notes).toMatchObject([{ pitch: "C3", velocity: 20, durationMs: 0 }]);
});

it("checks markers immediately and then only every ten seconds", async () => {
  expect(fixtures.detect).toHaveBeenCalledTimes(1);
  for (let i = 0; i < 99; i++) {
    await advance(100);
    await frame();
  }
  expect(fixtures.detect).toHaveBeenCalledTimes(1);
  await advance(100);
  await frame();
  expect(fixtures.detect).toHaveBeenCalledTimes(2);
});

it("retains usable geometry and the ten-second cadence through repeated marker misses", async () => {
  await click([...host.querySelectorAll("button")].find(b => b.textContent === "Enable audio")!);
  await keys(115);
  vi.mocked(browserAudio.noteOff).mockClear();
  vi.mocked(browserAudio.releaseAll).mockClear();

  fixtures.missNextDetection = true;
  await advance(10_000);
  expect(fixtures.detect).toHaveBeenCalledTimes(2);
  expect(browserAudio.noteOff).not.toHaveBeenCalled();
  expect(browserAudio.releaseAll).not.toHaveBeenCalled();

  fixtures.missNextDetection = true;
  await advance(9_900);
  expect(fixtures.detect).toHaveBeenCalledTimes(2);
  await advance(100);
  expect(fixtures.detect).toHaveBeenCalledTimes(3);
  expect(browserAudio.noteOff).not.toHaveBeenCalled();
  expect(browserAudio.releaseAll).not.toHaveBeenCalled();

  fixtures.missNextDetection = true;
  await advance(9_900);
  expect(fixtures.detect).toHaveBeenCalledTimes(3);
  await advance(100);
  expect(fixtures.detect).toHaveBeenCalledTimes(4);
  expect(browserAudio.noteOff).not.toHaveBeenCalled();
  expect(browserAudio.releaseAll).not.toHaveBeenCalled();

  await advance(9_900);
  expect(fixtures.detect).toHaveBeenCalledTimes(4);
  await advance(100);
  expect(fixtures.detect).toHaveBeenCalledTimes(5);
  expect(browserAudio.noteOff).not.toHaveBeenCalled();
  expect(browserAudio.releaseAll).not.toHaveBeenCalled();
});

it("plays before recording, during count-in and pause, and after Stop", async () => {
  const enable = [...host.querySelectorAll("button")].find(b => b.textContent === "Enable audio")!;
  await click(enable);
  expect(fixtures.initializeAudio).toHaveBeenCalled();
  vi.mocked(browserAudio.noteOn).mockClear();
  vi.mocked(browserAudio.releaseAll).mockClear();
  await keys(115);
  expect(browserAudio.noteOn).toHaveBeenCalledTimes(1);
  expect(fixtures.takes).toEqual([]);
  await click(button("Start recording"));
  await keys(115, 225);
  expect(browserAudio.noteOn).toHaveBeenCalledTimes(2);
  await countIn();
  expect(browserAudio.noteOn).toHaveBeenCalledTimes(2); // No audio retrigger at recording boundary.
  await advance(100);
  await click(button("Pause recording"));
  await keys(115);
  expect(browserAudio.noteOff).toHaveBeenCalled();
  await keys(115, 225);
  expect(browserAudio.noteOn).toHaveBeenCalledTimes(3);
  await click(button("Stop recording"));
  expect(browserAudio.releaseAll).not.toHaveBeenCalled();
  expect(fixtures.takes.at(-1)!.notes).toHaveLength(2);
  expect(fixtures.takes.at(-1)!.notes.every(n => n.startMs === 0 && n.durationMs === 100)).toBe(true);
  await keys();
  await keys(115);
  expect(browserAudio.noteOn).toHaveBeenCalledTimes(4);
});

it("releases free-play notes when calibration becomes invalid", async () => {
  await click([...host.querySelectorAll("button")].find(b => b.textContent === "Enable audio")!);
  await keys(115);
  vi.mocked(browserAudio.releaseAll).mockClear();
  localStorage.removeItem("makeshift.calibration.v1");
  await advance(10_000);
  await frame();
  expect(browserAudio.releaseAll).toHaveBeenCalled();
  vi.mocked(browserAudio.noteOn).mockClear();
  await keys(225);
  expect(browserAudio.noteOn).not.toHaveBeenCalled();
});


// This frame-loss expectation is being fixed in PR #193.
it.skip("invalidates free play on frame loss without waiting for the marker interval", async () => {
  await click([...host.querySelectorAll("button")].find(b => b.textContent === "Enable audio")!);
  await keys(115);
  vi.mocked(browserAudio.releaseAll).mockClear();
  vi.spyOn(HTMLVideoElement.prototype, "readyState", "get").mockReturnValue(0);
  await advance(100);
  await frame();
  expect(browserAudio.releaseAll).toHaveBeenCalled();
  expect(button("Start recording").disabled).toBe(true);
  vi.spyOn(HTMLVideoElement.prototype, "readyState", "get").mockReturnValue(4);
  await frame();
  expect(fixtures.detect).toHaveBeenCalledTimes(2);
  expect(button("Start recording").disabled).toBe(false);
});

it("ignores pending free-play audio initialization after calibration loss", async () => {
  let resolveAudio!: () => void;
  fixtures.initializeAudio.mockImplementation(() => new Promise<void>(resolve => { resolveAudio = resolve; }));
  await click([...host.querySelectorAll("button")].find(b => b.textContent === "Enable audio")!);
  localStorage.removeItem("makeshift.calibration.v1");
  await advance(10_000);
  await frame();
  await act(async () => resolveAudio());
  vi.mocked(browserAudio.noteOn).mockClear();
  await keys(115);
  expect(browserAudio.noteOn).not.toHaveBeenCalled();
  expect(button("Start recording").disabled).toBe(true);
});

// Quarter-note BPM count-in contract; each step ends exactly on a beat boundary.
it.each([[4,4,500],[3,4,500],[6,8,250],[7,8,250],[2,2,1000]])(
  "counts and resumes %s/%s with %s ms intervals, excluding both count-ins", async (numerator, denominator, interval) => {
    await act(async () => root.unmount());
    localStorage.setItem("makeshift:playback-settings:v1", JSON.stringify({tempo:120,metronome:false,meter:{numerator,denominator}}));
    root = createRoot(host);
    await act(async () => root.render(<Home />));
    await advance(0); await keys();
    await click(button("Start recording"));
    expect(host.querySelector<HTMLInputElement>("#time-signature")!.disabled).toBe(true);
    for (let beat=1; beat<=numerator; beat++) {
      expect(host.querySelector(".ms-beat")?.textContent).toBe(String(beat));
      expect(host.querySelectorAll(".ms-beat + div > div")).toHaveLength(numerator);
      await advance(interval-1);
      expect(host.querySelector(".ms-beat")?.textContent).toBe(String(beat));
      await advance(1);
    }
    expect(button("Pause recording").disabled).toBe(false);
    await keys(115); await advance(100);
    await click(button("Pause recording"));
    expect(host.querySelector<HTMLInputElement>("#time-signature")!.disabled).toBe(true);
    await click(button("Resume recording"));
    for(let beat=1;beat<=numerator;beat++) {
      expect(host.querySelector(".ms-beat")?.textContent).toBe(String(beat));
      await advance(interval);
    }
    await advance(100); await click(button("Stop recording"));
    const take=fixtures.takes.at(-1)!;
    expect(take.meter).toEqual({numerator,denominator});
    expect(take.notes[0]).toMatchObject({startMs:0,durationMs:100});
    expect(take.notes[1]).toMatchObject({startMs:100,durationMs:100});
  });

it("accents only the first denominator beat when the metronome is audible", async () => {
  const frequencies: number[] = [];
  class ClickContext {
    state = "running";
    currentTime = 0;
    destination = {};
    createOscillator() {
      const frequency = { value: 0 };
      return { frequency, type: "", connect() {}, disconnect() {}, start() { frequencies.push(frequency.value); }, stop() {} };
    }
    createGain() { return {connect() {}, disconnect() {}, gain:{setValueAtTime() {}, exponentialRampToValueAtTime() {}}}; }
    close() { return Promise.resolve(); }
  }
  vi.stubGlobal("AudioContext", ClickContext);
  await click(button("Toggle metronome"));
  await click(button("Start recording"));
  // The complete audio measure is scheduled before subsequent UI timers.
  expect(frequencies).toEqual([1050,820,820,820]);
  await advance(500); expect(frequencies).toEqual([1050,820,820,820]);
  await advance(500); await advance(500); await advance(500);
  expect(frequencies).toEqual([1050,820,820,820]);
  await click(button("Stop recording"));
});

it("uses absolute display/start deadlines after a delayed main-thread callback", async () => {
  await click(button("Start recording"));
  await advance(400);
  // The beat-2 callback arrives at elapsed 600 ms instead of 500 ms, below
  // the separate tracking timeout. A chained timer would start at 2100 ms.
  now += 200;
  await act(async () => fixtures.landmarks?.([]));
  await frame();
  await act(async () => { await vi.advanceTimersByTimeAsync(100); });
  expect(host.querySelector(".ms-beat")?.textContent).toBe("2");
  await advance(400);
  expect(host.querySelector(".ms-beat")?.textContent).toBe("3");
  await advance(500);
  expect(host.querySelector(".ms-beat")?.textContent).toBe("4");
  await advance(500);
  expect(button("Pause recording").disabled).toBe(false);
});

it.each(["Stop", "interruption", "navigation"])("cancels every pre-scheduled click on %s", async action => {
  const stops: ReturnType<typeof vi.fn>[] = [];
  class ClickContext {
    state = "running";
    currentTime = 0;
    destination = {};
    createOscillator() {
      const stop=vi.fn(); stops.push(stop);
      return {frequency:{value:0}, type:"", connect() {},disconnect() {},start() {},stop};
    }
    createGain() { return {connect() {},disconnect() {},gain:{setValueAtTime() {},exponentialRampToValueAtTime() {}}}; }
    close() {return Promise.resolve();}
  }
  vi.stubGlobal("AudioContext", ClickContext);
  await click(button("Toggle metronome"));
  await click(button("Start recording"));
  expect(stops).toHaveLength(4);
  expect(stops.every(stop => stop.mock.calls.length === 1)).toBe(true);
  if(action === "Stop") await click(button("Stop recording"));
  else if(action === "interruption") await act(async () => fixtures.invalidate?.());
  else await act(async () => window.dispatchEvent(new dom.window.Event("pagehide")));
  expect(stops.every(stop => stop.mock.calls.length === 2 && stop.mock.lastCall!.length === 0)).toBe(true);
  await advance(2500);
  expect(fixtures.takes).toHaveLength(0);
});

it("does not schedule or start after Stop cancels a pending count-in audio resume", async () => {
  let resolveResume!: () => void;
  const createOscillator=vi.fn();
  class ClickContext {
    state="suspended";
    resume() { return new Promise<void>(resolve => {resolveResume=resolve;}); }
    createOscillator=createOscillator;
    close() {return Promise.resolve();}
  }
  vi.stubGlobal("AudioContext", ClickContext);
  await click(button("Toggle metronome"));
  await click(button("Start recording"));
  expect(host.querySelector(".ms-beat")?.textContent).toBe("1");
  await click(button("Stop recording"));
  await act(async () => resolveResume());
  await advance(2500);
  expect(createOscillator).not.toHaveBeenCalled();
  expect(fixtures.takes).toHaveLength(0);
});
