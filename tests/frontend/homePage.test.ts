// @vitest-environment jsdom
import { createElement } from "react";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// Regression coverage for #112: merge 30706c4 dropped the home page modals and
// overlays while leaving the state that opens them, so the controls did nothing.

import type { LiveSession } from "../../frontend/src/events/liveSession";
import { storageKey } from "../../frontend/src/lib/storage";
import {
  CALIBRATION_KEY,
  CURRENT_LAYOUT,
  SHEET_ID,
} from "../../frontend/src/cv/calibration";

function validCalibration() {
  return {
    version: 1,
    coordinates: "unmirrored-frame-pixels/marker-unit-square",
    sheet: SHEET_ID,
    camera: { deviceId: "camera", width: 1000, height: 1000, facingMode: "" },
    layout: { ...CURRENT_LAYOUT },
    corners: [
      { x: 100, y: 100 },
      { x: 900, y: 100 },
      { x: 900, y: 900 },
      { x: 100, y: 900 },
    ],
    contact: {
      model: "landmark-reference-v1",
      hover: [Array(21).fill({ x: 0.5, y: 0.4, z: 0 })],
      rest: [Array(21).fill({ x: 0.5, y: 0.5, z: 0 })],
    },
  };
}

const push = vi.fn();
const camera = vi.hoisted(() => ({
  value: {
    stream: null,
    cameraReady: true,
    status: "ready" as "requesting" | "ready" | "error",
    error: null as null | { kind: string; title: string; detail: string },
    retry: () => {},
  },
}));

vi.mock("next/navigation", () => ({ useRouter: () => ({ push, back: vi.fn() }) }));
// The dynamic CVOverlayCoordinator feeds calibration and tracking to the live
// session; this stub keeps a valid session fresh when `calibration.valid` is
// set instead of running CV.
const calibration = vi.hoisted(() => ({ valid: false }));
vi.mock("next/dynamic", async () => {
  const { useEffect } = await import("react");
  return {
    default: () =>
      function CoordinatorStub({ session }: { session: LiveSession }) {
        useEffect(() => {
          if (!calibration.valid) return;
          const saved = validCalibration();
          const observe = () => {
            session.observeCalibration(saved, saved.camera, saved.corners);
            session.observeTracking();
          };
          // Child effects run before the page subscribes to the session.
          const first = setTimeout(observe, 0);
          const timer = setInterval(observe, 100);
          return () => {
            clearTimeout(first);
            clearInterval(timer);
          };
        }, [session]);
        return null;
      },
  };
});
vi.mock("../../frontend/src/app/CameraContext", () => ({ useCamera: () => camera.value }));
vi.mock("../../frontend/src/app/audio/audioEngine", () => ({
  browserAudio: {
    initialize: vi.fn(async () => {}),
    status: "ready",
    subscribeInvalidation: () => () => {},
    noteOn: vi.fn(() => ({ session: 1, press: 1 })),
    noteOff: vi.fn(() => true),
    releaseAll: vi.fn(),
  },
}));
vi.mock("../../frontend/src/app/midi/midiUtils", async (original) => ({
  ...(await original<typeof import("../../frontend/src/app/midi/midiUtils")>()),
  downloadMidi: vi.fn(),
}));

// Node 25+ defines its own global localStorage that shadows jsdom's and is
// undefined without --localstorage-file, so provide an in-memory one.
const store = new Map<string, string>();
vi.stubGlobal("localStorage", {
  getItem: (key: string) => store.get(key) ?? null,
  setItem: (key: string, value: string) => void store.set(key, String(value)),
  removeItem: (key: string) => void store.delete(key),
  clear: () => store.clear(),
});

const { default: Home } = await import("../../frontend/src/app/page");

function renderHome() {
  render(createElement(Home));
  // The page reads localStorage in a zero-delay timeout after mount.
  act(() => vi.advanceTimersByTime(0));
}

describe("home page", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    localStorage.clear();
    push.mockClear();
    calibration.valid = false;
    camera.value = { ...camera.value, cameraReady: true, status: "ready", error: null };
  });

  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
    vi.useRealTimers();
  });

  it("restores saved preferences without overwriting them on initial render", () => {
    const key = storageKey("playback-settings", 1);
    localStorage.setItem(key, JSON.stringify({ tempo: 180, metronome: false }));
    render(createElement(Home));
    expect(JSON.parse(localStorage.getItem(key)!)).toEqual({ tempo: 180, metronome: false });
    act(() => vi.advanceTimersByTime(0));
    expect((screen.getByLabelText("Set Tempo") as HTMLInputElement).value).toBe("180");
    expect(screen.getByLabelText("Toggle metronome").getAttribute("aria-pressed")).toBe("false");
  });

  it("persists edited tempo and metronome across a remount", () => {
    renderHome();
    expect((screen.getByLabelText("Set Tempo") as HTMLInputElement).value).toBe("120");
    expect(screen.getByLabelText("Toggle metronome").getAttribute("aria-pressed")).toBe("true");
    fireEvent.change(screen.getByLabelText("Set Tempo"), { target: { value: "175" } });
    fireEvent.click(screen.getByLabelText("Toggle metronome"));
    cleanup();
    renderHome();
    expect((screen.getByLabelText("Set Tempo") as HTMLInputElement).value).toBe("175");
    expect(screen.getByLabelText("Toggle metronome").getAttribute("aria-pressed")).toBe("false");
  });

  it.each([
    "broken JSON", "null", "[]",
    JSON.stringify({ tempo: 19, metronome: false }),
    JSON.stringify({ tempo: 301, metronome: false }),
    JSON.stringify({ tempo: 120.5, metronome: false }),
    JSON.stringify({ tempo: "120", metronome: false }),
    JSON.stringify({ tempo: 120, metronome: "false" }),
    JSON.stringify({ tempo: 120 }),
  ])("uses defaults for invalid stored settings: %s", (raw) => {
    localStorage.setItem(storageKey("playback-settings", 1), raw);
    renderHome();
    expect((screen.getByLabelText("Set Tempo") as HTMLInputElement).value).toBe("120");
    expect(screen.getByLabelText("Toggle metronome").getAttribute("aria-pressed")).toBe("true");
  });

  it.each([20, 300])("restores valid boundary tempo %s", (tempo) => {
    localStorage.setItem(storageKey("playback-settings", 1), JSON.stringify({ tempo, metronome: true }));
    renderHome();
    expect((screen.getByLabelText("Set Tempo") as HTMLInputElement).value).toBe(String(tempo));
  });

  it("clamps input and keeps controls usable when storage fails", () => {
    vi.spyOn(window.localStorage, "getItem").mockImplementation(() => { throw new Error("blocked"); });
    vi.spyOn(window.localStorage, "setItem").mockImplementation(() => { throw new DOMException("full", "QuotaExceededError"); });
    renderHome();
    const input = screen.getByLabelText("Set Tempo") as HTMLInputElement;
    fireEvent.change(input, { target: { value: "350" } });
    expect(input.value).toBe("300");
    fireEvent.change(input, { target: { value: "10" } });
    expect(input.value).toBe("20");
    fireEvent.click(screen.getByLabelText("Toggle metronome"));
    expect(screen.getByLabelText("Toggle metronome").getAttribute("aria-pressed")).toBe("false");
  });

  it("shows the welcome modal on the first visit only", () => {
    renderHome();
    expect(screen.getByText("Welcome to MakeShift")).toBeTruthy();
    fireEvent.click(screen.getByText("Skip for now"));
    expect(screen.queryByText("Welcome to MakeShift")).toBeNull();

    cleanup();
    renderHome();
    expect(screen.queryByText("Welcome to MakeShift")).toBeNull();
  });

  it("opens the calibration intro from the Calibration tab and navigates", () => {
    localStorage.setItem("hasVisited", "true");
    renderHome();
    fireEvent.click(screen.getByRole("button", { name: "Calibration" }));
    expect(screen.getByText("Before You Begin: Calibration")).toBeTruthy();
    fireEvent.click(screen.getByText("Begin Calibration"));
    expect(push).toHaveBeenCalledWith("/calibration");
  });

  it("prompts for calibration over a ready, uncalibrated camera", () => {
    localStorage.setItem("hasVisited", "true");
    renderHome();
    expect(screen.getByText(/to Begin/)).toBeTruthy();
  });

  it("shows camera error feedback", () => {
    localStorage.setItem("hasVisited", "true");
    camera.value = {
      ...camera.value,
      cameraReady: false,
      status: "error",
      error: { kind: "denied", title: "Camera access blocked", detail: "Allow access." },
    };
    renderHome();
    expect(screen.getByText("Camera access blocked")).toBeTruthy();
  });

  it("shows the count-in, completion banner, and delete confirmation", async () => {
    localStorage.setItem("hasVisited", "true");
    calibration.valid = true;
    localStorage.setItem(CALIBRATION_KEY, JSON.stringify(validCalibration()));
    renderHome();
    // The metronome click needs Web Audio, which jsdom lacks.
    fireEvent.click(screen.getByLabelText("Toggle metronome"));

    // Play awaits audio initialization before starting the count-in.
    await act(async () => {
      fireEvent.click(screen.getByLabelText("Start recording"));
    });
    expect(screen.getByText("1")).toBeTruthy();
    // One 4/4 measure at 120 BPM. Each beat schedules the next after a render.
    for (let beat = 0; beat < 4; beat++) act(() => vi.advanceTimersByTime(500));
    expect(screen.getByText("Recording started")).toBeTruthy();

    fireEvent.click(screen.getByLabelText("Stop recording"));
    expect(screen.getByText("Recording Complete!")).toBeTruthy();
    fireEvent.click(screen.getByText("Dismiss"));

    fireEvent.click(screen.getByText("Delete .MIDI Recording"));
    expect(screen.getByText("Delete this MIDI recording?")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Delete" }));
    expect(screen.queryByText("Delete .MIDI Recording")).toBeNull();
  });
});
