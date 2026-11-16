import { JSDOM } from "jsdom";
import { act, createElement, StrictMode, type ComponentProps } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import type { Recording } from "../../frontend/src/app/midi/midiUtils";
import type { HandObservation, NormalizedLandmark } from "../../frontend/src/cv/collision";

// These cases advance tens of seconds of simulated video/React updates. Allow
// enough wall time on busy machines without changing any simulated deadlines.
vi.setConfig({ testTimeout: 20_000 });

const fixtures = vi.hoisted(() => ({
  invalidate: null as null | (() => void),
  landmarks: null as null | ((hands: HandObservation[]) => void),
  initializeAudio: vi.fn(async () => {}),
  prepareClicks: vi.fn(async () => true),
  interruptClicks: null as null | (() => void),
  resetClicks: null as null | (() => void),
  clicks: vi.fn(), silenceClicks: vi.fn(), closeClicks: vi.fn(),
  takes: [] as Recording[],
  download: vi.fn(),
  missNextDetection: false,
  markerShift: 0,
  cameraDevice: "camera-1",
  camera: { stream: { getVideoTracks: () => [{ readyState: "live", getSettings: () => ({ deviceId: fixtures.cameraDevice }) }] }, cameraReady: true },
}));
vi.mock("../../frontend/src/app/audio/metronome", async original => {
  const actual = await original<typeof import("../../frontend/src/app/audio/metronome")>();
  const { createSimulatedMetronome } = await import("./simulatedMetronome");
  return { ...actual, createMetronome: () => {
    const controller = createSimulatedMetronome({
      prepare: fixtures.prepareClicks, click: fixtures.clicks,
      silence: fixtures.silenceClicks, close: fixtures.closeClicks,
    }, actual.createMetronome);
    fixtures.resetClicks = controller.close;
    return { ...controller, configure(...args: Parameters<typeof controller.configure>) {
      fixtures.interruptClicks = () => {
        controller.stop();
        args[1].onUnavailable();
      };
      controller.configure(...args);
    } };
  } };
});
// Supply complete synthetic Vision snapshots; sensing and scheduling have separate tests.
vi.mock("../../frontend/src/cv/visionCameraPipeline", async () => {
  const { recordingVisionFixture } = await import("./visionFrameFixture");
  return { VisionCameraPipeline: recordingVisionFixture(fixtures) };
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
    pauseInput: vi.fn(),
    resumeInput: vi.fn(),
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
      return function UnusedOverlay() { return null; };
    },
  };
});

import { browserAudio } from "../../frontend/src/app/audio/audioEngine";
import Home from "../../frontend/src/app/page";
import Coordinator from "../../frontend/src/app/CVOverlayCoordinator";
import { saveKeyboardLayout } from "../../frontend/src/lib/keyboardSettings";
import { getWhiteKeyPolygons } from "../../frontend/src/cv/keyboardGeometry";
import { getPlayAlong } from "../../frontend/src/app/midi/playAlong";

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
  fixtures.markerShift = 0;
  fixtures.cameraDevice = "camera-1";
  fixtures.camera.cameraReady = true;
  fixtures.initializeAudio.mockImplementation(async () => {});
  fixtures.prepareClicks.mockResolvedValue(true);
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
  // Click audio starts off; individual metronome cases explicitly enable it.
  const metronome = host.querySelector<HTMLButtonElement>('button[aria-label="Toggle metronome"]');
  if (!metronome) throw new Error("Metronome control missing");
  expect(metronome.getAttribute("aria-pressed")).toBe("false");
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
  const result = host.querySelector<HTMLButtonElement>(`button[aria-label="${label}"]`)
    ?? [...host.querySelectorAll("button")].find(button => button.textContent?.trim() === label);
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
  // Repeated identical snapshots must hold keys without retriggering.
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

it("uses one recovery announcement and preserves calibrated/current alignment through displacement, misses and restoration", async () => {
  const enable = [...host.querySelectorAll("button")].find(b => b.textContent === "Enable audio")!;
  await click(enable);
  await keys(115);
  const saved = localStorage.getItem("makeshift.calibration.v1");
  fixtures.markerShift = 20;
  await advance(10_000);
  const status = host.querySelector('[role="status"]')!;
  expect(status.textContent).toContain("sheet or camera may have moved");
  expect(host.textContent).not.toContain("Saved data is checked before playing");
  expect(enable.disabled).toBe(true);
  expect(host.querySelector('a[href="/calibration"]')?.textContent).toBe("Calibrate");
  expect(host.textContent).toContain("Calibrated position (solid)");
  expect(host.textContent).toContain("Current position unavailable");
  expect(browserAudio.releaseAll).toHaveBeenCalled();
  expect(localStorage.getItem("makeshift.calibration.v1")).toBe(saved);
  fixtures.missNextDetection = true;
  await advance(10_000);
  expect(host.textContent).toContain("Current position unavailable");
  fixtures.markerShift = 0;
  await advance(10_000);
  expect(status.textContent).toContain("Select Enable audio");
  expect(status.textContent).not.toMatch(/calibrat/i);
  expect(enable.disabled).toBe(false);
  expect(host.querySelector('a[href="/calibration"]')).toBeNull();
});

it("offers audio recovery without recalibration and names camera changes without alleging sheet movement", async () => {
  const enable = [...host.querySelectorAll("button")].find(b => b.textContent === "Enable audio")!;
  await click(enable);
  await act(async () => fixtures.invalidate?.());
  expect(host.querySelector('[role="status"]')?.textContent).toContain("Audio interrupted");
  expect(host.querySelector('a[href="/calibration"]')).toBeNull();
  expect(enable.disabled).toBe(false);
  fixtures.cameraDevice = "camera-2";
  await frame();
  expect(host.querySelector('[role="status"]')?.textContent).toContain("camera changed");
  expect(host.querySelector('[role="status"]')?.textContent).not.toContain("moved");
  expect(host.textContent).not.toContain("Sheet-reference alignment");
  expect(enable.disabled).toBe(true);
});

it("announces temporary tracking pause and explicit audio recovery without calibration advice", async () => {
  const enable = [...host.querySelectorAll("button")].find(b => b.textContent === "Enable audio")!;
  await click(enable);
  await keys(115);
  await act(async () => { now += 600; await vi.advanceTimersByTimeAsync(600); });
  expect(host.querySelector('[role="status"]')?.textContent).toContain("Tracking paused");
  expect(host.querySelector('a[href="/calibration"]')).toBeNull();
  expect(enable.disabled).toBe(true);
  const calls = vi.mocked(browserAudio.noteOn).mock.calls.length;
  await keys(115);
  expect(host.querySelector('[role="status"]')?.textContent).toContain("Select Enable audio");
  expect(host.querySelector('a[href="/calibration"]')).toBeNull();
  expect(enable.disabled).toBe(false);
  expect(browserAudio.noteOn).toHaveBeenCalledTimes(calls);
});

it("dispatches a chord and release/repress before React commits the Vision snapshot", async () => {
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

it("accepts a black-key offset from the Vision snapshot", async () => {
  await start();
  vi.mocked(browserAudio.noteOn).mockClear();
  vi.mocked(browserAudio.noteOff).mockClear();

  await keys(170); // Synthetic C# region.
  expect(browserAudio.noteOn).toHaveBeenCalledTimes(1);
  expect(browserAudio.noteOn).toHaveBeenCalledWith(49, 0.2);
  await advance(0);
  expect(host.querySelector('[data-key-midi="49"][data-key-active="true"]')?.getAttribute("fill"))
    .toBe("var(--color-blue)");
  expect(host.querySelector('[data-key-kind="white"][data-key-active="true"]')).toBeNull();

  await keys(); await advance(0);
  expect(browserAudio.noteOff).toHaveBeenCalledTimes(1);
  expect(host.querySelector('[data-key-active="true"]')).toBeNull();
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

it("uses the fixed Vision onset velocity for audio and MIDI", async () => {
  await start();
  await keys(115, 325);
  expect(browserAudio.noteOn).toHaveBeenCalledWith(48, 0.2);
  expect(browserAudio.noteOn).toHaveBeenCalledWith(52, 0.2);
  await advance(40); await keys(); await click(button("Stop recording"));
  expect(fixtures.takes.at(-1)!.notes.map(note => note.velocity)).toEqual([20, 20]);
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
  await advance(0);
  expect(host.querySelector('[aria-label="Sounding notes"]')?.textContent).toContain(`C${4 + octaves}`);
});

it("announces capture state through pause, resume count-in and completion", async () => {
  const status = () => host.querySelector('[aria-live="polite"]')?.textContent;
  await click(button("Start recording"));
  expect(status()).toBe("Count-in started. Piano paused. Select Stop to cancel.");
  const mutations: MutationRecord[] = [];
  const observer = new window.MutationObserver(records => mutations.push(...records));
  observer.observe(host.querySelector('[aria-live="polite"]')!, {
    childList: true, characterData: true, subtree: true,
  });
  for (let beat = 2; beat <= 4; beat++) {
    await advance(500);
    expect(status()).toBe("Count-in started. Piano paused. Select Stop to cancel.");
  }
  expect(mutations).toHaveLength(0);
  observer.disconnect();
  await advance(500);
  expect(status()).toBe("Recording started");
  await click(button("Pause recording"));
  expect(status()).toBe("Recording paused");
  await click(button("Resume recording"));
  expect(status()).toBe("Count-in started. Piano paused. Select Stop to cancel.");
  await countIn();
  expect(status()).toBe("Recording started");
  await click(button("Stop recording"));
  expect(status()).toBe("Recording complete");
});

it("requires release and a fresh press for keys held across resume", async () => {
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
  await keys(115, 225);
  await advance(100);
  await click(button("Stop recording"));
  const notes = fixtures.takes.at(-1)!.notes;
  expect(notes).toHaveLength(3);
  expect(notes[0]).toMatchObject({ startMs: 0, durationMs: 500 });
  expect(notes[1]).toMatchObject({ pitch: notes[0].pitch, startMs: 750, durationMs: 100 });
  expect(notes[2]).toMatchObject({ startMs: 750, durationMs: 100 });
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

it("No, delete it removes the stopped take from the library and storage after both confirmations", async () => {
  const confirm = vi.fn(() => true);
  dom.window.confirm = confirm;
  const stored = () => JSON.parse(localStorage.getItem("makeshift:recordings:v1") ?? "[]") as Recording[];
  const discard = () => [...document.querySelectorAll("button")].find(item => item.textContent?.trim() === "No, delete it")!;
  await start();
  await keys(115);
  await advance(200);
  await click(button("Stop recording"));
  await countIn();
  expect(stored()).toHaveLength(1);

  await act(async () => discard().click());

  expect(confirm).toHaveBeenCalledTimes(1);
  expect(document.querySelector('[role="dialog"]')).toBeNull();
  expect(stored()).toEqual([]);
  expect(host.textContent).toContain("No recordings yet.");
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

it("shows accepted sounding notes and clears them on interruption", async () => {
  await start(); await keys(115); await advance(0);
  expect(host.querySelector('[aria-label="Sounding notes"]')?.textContent).toContain("C3");
  expect(host.querySelector('[data-key-midi="48"][data-key-active="true"]')?.getAttribute("fill"))
    .toBe("var(--color-red)");
  await click(button("Stop recording")); await keys(115, 225); await advance(100);
  expect(host.querySelector('[aria-label="Sounding notes"]')?.textContent).toContain("D3");
  await act(async () => window.dispatchEvent(new window.Event("pagehide"))); await advance(0);
  expect(host.querySelector('[aria-label="Sounding notes"]')).toBeNull();
  expect(host.querySelector('[data-key-active="true"]')).toBeNull();
});

it("keeps recording through an accepted empty reference refresh", async () => {
  await start(); await keys(115); await advance(20); await keys();
  await click(button("Set reference")); await frame();
  expect(button("Pause recording").disabled).toBe(false);
  expect(fixtures.takes).toHaveLength(0);
  await keys(325); await advance(20); await keys(); await click(button("Stop recording"));
  expect(fixtures.takes.at(-1)!.notes.map(note => note.pitch)).toEqual(["C3", "E3"]);
});

it("records a same-turn press before Stop drains deferred consumers", async () => {
  await start();
  await keys(115);
  await click(button("Stop recording"));
  expect(fixtures.takes.at(-1)!.notes).toMatchObject([{ pitch: "C3", velocity: 20, durationMs: 0 }]);
});

it("requests a reference using the temporary control without changing saved calibration", async () => {
  const saved = localStorage.getItem("makeshift.calibration.v1");
  await click(button("Set reference")); await frame();
  expect(host.querySelector('[data-vision-status]')?.textContent).toContain("Reference captured");
  expect(localStorage.getItem("makeshift.calibration.v1")).toBe(saved);
});

it.each([0, 500, 1000, 1500, 1999])("cancels start/resume at %i ms without replaying gated contacts", async elapsed => {
  for (const resume of [false, true]) {
    if (resume) { await keys(); await start(); await keys(115); await advance(100); await click(button("Pause recording")); }
    await click(button(resume ? "Resume recording" : "Start recording"));
    await keys(225);
    await advance(elapsed);
    const calls = vi.mocked(browserAudio.noteOn).mock.calls.length;
    await click(button("Stop recording"));
    await countIn();
    expect(button("Start recording").disabled).toBe(false);
    expect(browserAudio.noteOn).toHaveBeenCalledTimes(calls);
    if (!resume) expect(fixtures.takes).toHaveLength(0);
    else expect(fixtures.takes.at(-1)!.notes).toHaveLength(1);
    await keys(); await keys(225);
    expect(browserAudio.noteOn).toHaveBeenCalledTimes(calls + 1);
    await keys();
  }
});

it("discards count-in notes and preserves free play before, during pause and after Stop", async () => {
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
  expect(browserAudio.pauseInput).toHaveBeenCalledTimes(1);
  expect(browserAudio.noteOn).toHaveBeenCalledTimes(1);
  await countIn();
  expect(browserAudio.noteOn).toHaveBeenCalledTimes(1);
  await advance(100);
  await click(button("Pause recording"));
  await keys(115);
  await keys(115, 225);
  expect(browserAudio.noteOn).toHaveBeenCalledTimes(2);
  await click(button("Stop recording"));
  expect(browserAudio.releaseAll).not.toHaveBeenCalled();
  expect(fixtures.takes.at(-1)!.notes).toHaveLength(0);
  await keys();
  await keys(115);
  expect(browserAudio.noteOn).toHaveBeenCalledTimes(3);
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


it("invalidates free play on frame loss without waiting for the marker interval", async () => {
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
    const audioCalls = vi.mocked(browserAudio.noteOn).mock.calls.length;
    expect(host.querySelector<HTMLInputElement>("#time-signature")!.disabled).toBe(true);
    for (let beat=1; beat<=numerator; beat++) {
      expect(host.querySelector(".ms-beat")?.textContent).toBe(String(beat));
      expect(host.querySelectorAll(".ms-beat + div > div")).toHaveLength(numerator);
      await keys(225); await keys(); // Complete taps inside each full interval.
      expect(browserAudio.noteOn).toHaveBeenCalledTimes(audioCalls);
      await advance(interval-1);
      expect(host.querySelector(".ms-beat")?.textContent).toBe(String(beat));
      await advance(1);
    }
    expect(button("Pause recording").disabled).toBe(false);
    await keys(115); await advance(100);
    await click(button("Pause recording"));
    expect(host.querySelector<HTMLInputElement>("#time-signature")!.disabled).toBe(true);
    await click(button("Resume recording"));
    const resumeCalls = vi.mocked(browserAudio.noteOn).mock.calls.length;
    for(let beat=1;beat<=numerator;beat++) {
      expect(host.querySelector(".ms-beat")?.textContent).toBe(String(beat));
      await advance(interval);
      expect(browserAudio.noteOn).toHaveBeenCalledTimes(resumeCalls);
    }
    await advance(100); await click(button("Stop recording"));
    const take=fixtures.takes.at(-1)!;
    expect(take.meter).toEqual({numerator,denominator});
    expect(take.notes[0]).toMatchObject({startMs:0,durationMs:100});
    expect(take.notes).toHaveLength(1); // Held through resume: no fabricated note.
  });

it("accompanies live playing and recording, silences pause, resumes and keeps clicks out of the take", async () => {
  await click(button("Toggle metronome"));
  await click(button("Enable audio"));
  await advance(1000);
  expect(fixtures.clicks).toHaveBeenCalled();
  expect(fixtures.takes).toHaveLength(0);
  await start();
  await keys(115);
  await advance(200);
  await keys();
  await click(button("Pause recording"));
  const pausedClicks = fixtures.clicks.mock.calls.length;
  await advance(1000);
  expect(fixtures.clicks).toHaveBeenCalledTimes(pausedClicks);
  await click(button("Resume recording"));
  await countIn();
  expect(fixtures.clicks.mock.calls.length).toBeGreaterThan(pausedClicks);
  await click(button("Stop recording"));
  const stoppedClicks = fixtures.clicks.mock.calls.length;
  await advance(600);
  expect(fixtures.clicks.mock.calls.length).toBeGreaterThan(stoppedClicks);
  expect(fixtures.takes).toHaveLength(1);
  expect(fixtures.takes[0].notes).toHaveLength(1);
  // Export through the real writer as well: numerous clicks must add no notes.
  const actual = await vi.importActual<typeof import("../../frontend/src/app/midi/midiUtils")>("../../frontend/src/app/midi/midiUtils");
  let uri = "";
  vi.spyOn(dom.window.HTMLAnchorElement.prototype, "click").mockImplementation(function (this: HTMLAnchorElement) { uri = this.href; });
  actual.downloadMidi(fixtures.takes[0]);
  const bytes = Buffer.from(uri.split(",")[1], "base64");
  let offset = 22;
  let noteEvents = 0;
  const readLength = () => {
    let value = 0, byte: number;
    do { byte = bytes[offset++]; value = value * 128 + (byte & 127); } while (byte & 128);
    return value;
  };
  while (offset < bytes.length) {
    readLength();
    const status = bytes[offset++];
    if (status === 255) { offset++; const length = readLength(); offset += length; }
    else { expect([128, 144]).toContain(status); offset += 2; noteEvents++; }
  }
  expect(noteEvents).toBe(2); // one piano note-on and its note-off only
  await click(button("Toggle metronome"));
  const mutedClicks = fixtures.clicks.mock.calls.length;
  await advance(1000);
  expect(fixtures.clicks).toHaveBeenCalledTimes(mutedClicks);
});

it("keeps standalone clicks running when only piano readiness is interrupted", async () => {
  await click(button("Toggle metronome"));
  await click(button("Enable audio"));
  await advance(500);
  await act(async () => fixtures.invalidate?.());
  const count = fixtures.clicks.mock.calls.length;
  await advance(1000);
  expect(fixtures.clicks.mock.calls.length).toBeGreaterThan(count);
});

it("can enable metronome after StrictMode effect cleanup and setup", async () => {
  await act(async () => root.unmount());
  root = createRoot(host);
  await act(async () => root.render(createElement(StrictMode, null, createElement(Home))));
  await advance(0);
  await keys();
  await click(button("Toggle metronome"));
  await click(button("Enable audio"));
  const before = fixtures.clicks.mock.calls.length;
  await advance(600);
  expect(fixtures.clicks.mock.calls.length).toBeGreaterThan(before);
});

it("Stop rejects click-audio preparation that finishes after the pending recording request", async () => {
  let resolve!: (ready: boolean) => void;
  fixtures.prepareClicks.mockImplementationOnce(() => new Promise<boolean>(done => { resolve = done; }));
  await click(button("Start recording"));
  await click(button("Stop recording"));
  const before = fixtures.clicks.mock.calls.length;
  await act(async () => resolve(true));
  await advance(3000);
  expect(fixtures.clicks).toHaveBeenCalledTimes(before);
  expect(fixtures.takes).toHaveLength(0);
  expect(button("Start recording").disabled).toBe(false);
});

it("runs metronome without calibration, camera readiness or enabling piano audio", async () => {
  localStorage.removeItem("makeshift.calibration.v1");
  await advance(10000); await frame();
  expect(button("Enable audio").disabled).toBe(true);
  expect(button("Start recording").disabled).toBe(true);
  fixtures.initializeAudio.mockClear();
  await click(button("Toggle metronome"));
  await advance(1200);
  expect(fixtures.clicks.mock.calls.length).toBeGreaterThanOrEqual(2);
  expect(fixtures.initializeAudio).not.toHaveBeenCalled();
  await click(button("Toggle metronome"));
  const count = fixtures.clicks.mock.calls.length;
  await advance(1000); expect(fixtures.clicks).toHaveBeenCalledTimes(count);
});

it("turning off while standalone audio is preparing cancels late playback", async () => {
  let resolve!: (ready: boolean) => void;
  fixtures.prepareClicks.mockImplementationOnce(() => new Promise<boolean>(done => { resolve = done; }));
  await click(button("Toggle metronome"));
  expect(button("Toggle metronome").getAttribute("aria-pressed")).toBe("true");
  await click(button("Toggle metronome"));
  await act(async () => resolve(true));
  await advance(1200);
  expect(button("Toggle metronome").getAttribute("aria-pressed")).toBe("false");
  expect(fixtures.clicks).not.toHaveBeenCalled();
});

it("stops standalone clicks on backgrounding without restarting them on return", async () => {
  await click(button("Toggle metronome")); await advance(500);
  const hidden = vi.spyOn(document, "hidden", "get").mockReturnValue(true);
  await act(async () => document.dispatchEvent(new dom.window.Event("visibilitychange")));
  const count = fixtures.clicks.mock.calls.length;
  await advance(1000); expect(fixtures.clicks).toHaveBeenCalledTimes(count);
  hidden.mockReturnValue(false);
  await act(async () => document.dispatchEvent(new dom.window.Event("visibilitychange")));
  await advance(1000); expect(fixtures.clicks).toHaveBeenCalledTimes(count);
  expect(button("Toggle metronome").getAttribute("aria-pressed")).toBe("false");
});

it("enables piano without preparing clicks and keeps playing after failed count-in preparation", async () => {
  fixtures.prepareClicks.mockResolvedValue(false);
  await click(button("Enable audio"));
  expect(fixtures.prepareClicks).not.toHaveBeenCalled();
  await click(button("Start recording"));
  expect(host.textContent).toContain("Count-in audio could not start");
  expect(button("Start recording").disabled).toBe(false);
  vi.mocked(browserAudio.noteOn).mockClear();
  await keys(115);
  expect(browserAudio.noteOn).toHaveBeenCalled();
  expect(fixtures.takes).toHaveLength(0);
});

it("failed resume preparation leaves the take paused and piano available", async () => {
  await start();
  await keys(115);
  await advance(200);
  await click(button("Pause recording"));
  // Require fresh click preparation for the resume attempt.
  await act(async () => fixtures.resetClicks?.());
  fixtures.prepareClicks.mockResolvedValue(false);
  await click(button("Resume recording"));
  expect(host.textContent).toContain("Count-in audio could not start");
  expect(button("Resume recording").disabled).toBe(false);
  await click(button("Stop recording"));
  expect(fixtures.takes).toHaveLength(1);
  expect(fixtures.takes[0].notes).toHaveLength(1);
});

it("cancels an interrupted count-in without interrupting piano playback", async () => {
  await click(button("Start recording"));
  await advance(500);
  await act(async () => fixtures.interruptClicks?.());
  expect(host.textContent).toContain("Count-in audio interrupted");
  await advance(2500);
  expect(button("Start recording").disabled).toBe(false);
  expect(fixtures.takes).toHaveLength(0);
  vi.mocked(browserAudio.noteOn).mockClear();
  await keys(115);
  expect(browserAudio.noteOn).toHaveBeenCalled();
});

it("continues piano recording when metronome audio is interrupted", async () => {
  await start();
  await keys(115);
  await advance(200);
  await act(async () => fixtures.interruptClicks?.());
  expect(host.textContent).toContain("Metronome audio interrupted");
  expect(button("Pause recording").disabled).toBe(false);
  await advance(200);
  await keys();
  await keys(215);
  await advance(200);
  await click(button("Stop recording"));
  expect(fixtures.takes).toHaveLength(1);
  expect(fixtures.takes[0].notes).toHaveLength(2);
});

it("retires the gated request when count-in audio preparation fails", async () => {
  fixtures.prepareClicks.mockResolvedValueOnce(false);
  await click(button("Start recording"));
  expect(host.querySelector(".ms-beat")).toBeNull();
  expect(host.textContent).toContain("Count-in audio could not start");
  await advance(2500);
  expect(fixtures.takes).toHaveLength(0);
  expect(browserAudio.resumeInput).toHaveBeenCalled();
  await keys(115); expect(browserAudio.noteOn).toHaveBeenCalled();
  await keys();
  await start();
  await click(button("Stop recording"));
  expect(fixtures.takes).toHaveLength(1);
});

it.each([[20, 1, 1], [300, 32, 32]])("gates the full measure at %i BPM and %i/%i", async (tempo, numerator, denominator) => {
  await act(async () => root.unmount());
  localStorage.setItem("makeshift:playback-settings:v1", JSON.stringify({ tempo, metronome: false, meter: { numerator, denominator } }));
  root = createRoot(host); await act(async () => root.render(<Home />));
  await advance(0); await keys();
  const duration = numerator * 60000 / tempo * 4 / denominator;
  for (const resume of [false, true]) {
    await click(button(resume ? "Resume recording" : "Start recording"));
    const onsets = vi.mocked(browserAudio.noteOn).mock.calls.length;
    await keys(115); await advance(duration - 1);
    expect(host.querySelector(".ms-beat")).not.toBeNull();
    expect(browserAudio.noteOn).toHaveBeenCalledTimes(onsets);
    await advance(1); expect(host.querySelector(".ms-beat")).toBeNull();
    expect(browserAudio.noteOn).toHaveBeenCalledTimes(onsets);
    await keys(); await keys(115); await advance(10);
    expect(browserAudio.noteOn).toHaveBeenCalledTimes(onsets + 1);
    await click(button(resume ? "Stop recording" : "Pause recording"));
  }
  expect(fixtures.takes.at(-1)!.notes).toHaveLength(2);
});


it.each([false, true])("keeps audible clicks while piano is gated (resume: %s)", async resume => {
  await click(button("Toggle metronome"));
  if (resume) { await start(); await click(button("Pause recording")); }
  const clicks = fixtures.clicks.mock.calls.length;
  await click(button(resume ? "Resume recording" : "Start recording"));
  const onsets = vi.mocked(browserAudio.noteOn).mock.calls.length;
  await keys(115); await keys();
  await advance(500);
  expect(fixtures.clicks.mock.calls.length).toBeGreaterThan(clicks);
  expect(browserAudio.noteOn).toHaveBeenCalledTimes(onsets);
  await advance(1500);
  expect(host.querySelector(".ms-beat")).toBeNull();
  await click(button("Stop recording"));
});

async function remountWithSong() {
  await act(async () => root.unmount());
  localStorage.setItem("makeshift:recordings:v1", JSON.stringify([{
    id: "song", name: "Song", bpm: 120, createdAt: "2026-10-31T00:00:00Z",
    notes: [{ pitch: "C4", velocity: 80, startMs: 0, durationMs: 500 }],
  }]));
  root = createRoot(host);
  await act(async () => root.render(<Home />));
  await advance(0);
  await keys();
}

// The songs dialog renders in a portal outside the page host.
function dialogButton(label: RegExp) {
  const result = [...document.querySelectorAll<HTMLButtonElement>('[role="dialog"] button')]
    .find(button => label.test(button.textContent?.trim() ?? ""));
  if (!result) throw new Error(`Missing dialog button: ${label}`);
  return result;
}

async function openPlayAlong() {
  await click(button("My recordings"));
  await click(dialogButton(/^Song/));
  return dialogButton(/^Play along$/);
}

it("prepares piano audio from the Play along click and starts the song only once playing (#131)", async () => {
  await remountWithSong();
  let finish!: () => void;
  fixtures.initializeAudio.mockImplementation(() => new Promise<void>(resolve => { finish = resolve; }));
  const calls = fixtures.initializeAudio.mock.calls.length;
  await click(await openPlayAlong());
  expect(fixtures.initializeAudio.mock.calls.length).toBe(calls + 1);
  expect(getPlayAlong()).toBeNull();
  expect(document.querySelector('[role="dialog"]')).not.toBeNull();

  await act(async () => finish());
  await advance(0);
  expect(getPlayAlong()?.title).toBe("Song");
  expect(document.querySelector('[role="dialog"]')).toBeNull();
  expect(button("Enable audio").disabled).toBe(true);

  // Leaving the page (e.g. for Tutorial) ends the song.
  const song = getPlayAlong()!;
  await act(async () => root.unmount());
  root = createRoot(host);
  expect(getPlayAlong()).toBeNull();
  expect(song.timeline.getSnapshot().state).toBe("disposed");
});

it("keeps the songs dialog open with the reason when Play along cannot start audio (#131)", async () => {
  await remountWithSong();
  fixtures.initializeAudio.mockRejectedValue(new Error("blocked"));
  await click(await openPlayAlong());
  await advance(0);
  expect(getPlayAlong()).toBeNull();
  expect(document.querySelector('[role="dialog"] [role="alert"]')?.textContent).toContain("Play along could not start");
  expect(dialogButton(/^Play along$/).disabled).toBe(false);
});
