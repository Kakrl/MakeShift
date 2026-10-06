import { JSDOM } from "jsdom";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { beforeEach, afterEach, expect, it, vi } from "vitest";
import { loadCalibration } from "../../frontend/src/cv/calibration";
import { parsePersistedDepthCalibration } from "../../frontend/src/cv/depthCalibration";
import { loadKeyboardLayout } from "../../frontend/src/lib/keyboardSettings";
const fixture = vi.hoisted(() => ({
  markers: true,
  hands: true,
  depthCapture: 0,
  push: vi.fn(),
  camera: {
    stream: {
      getVideoTracks: () => [
        { readyState: "live", getSettings: () => ({ deviceId: "camera-1" }) },
      ],
    },
    cameraReady: true,
  },
}));
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: fixture.push }),
}));
vi.mock("../../frontend/src/app/CameraContext", () => ({
  useCamera: () => fixture.camera,
}));
vi.mock("../../frontend/src/app/CameraStatusOverlay", () => ({
  default: () => null,
}));
vi.mock("../../frontend/src/app/lighting", () => ({
  MIN_BRIGHTNESS: 0.2,
  MAX_BRIGHTNESS: 0.8,
  LIGHTING_MESSAGES: { ok: "OK" },
  readFrameBrightness: () => ({ brightness: 0.5, verdict: "ok" }),
}));
vi.mock("../../frontend/src/app/useHandLandmarker", () => ({
  useHandLandmarker: () => ({
    status: "ready",
    reload: vi.fn(),
    detect: () => {
      const scale = 0.005 + fixture.depthCapture * 0.005;
      return {
        handednesses: [[{ categoryName: "Right" }]],
        landmarks: fixture.hands ? [Array.from({ length: 21 }, (_, index) => ({
          x: 0.2 + index * scale, y: 0.3 + fixture.depthCapture * 0.05,
          z: -0.01 - fixture.depthCapture * 0.015,
        }))] : [],
      };
    },
  }),
}));
vi.mock("../../frontend/src/cv/markerDetector", () => ({
  MarkerDetector: {
    create: async () => ({
      dispose: vi.fn(),
      detect: () => ({
        missingIds: fixture.markers ? [] : [3],
        observations: [
          [100, 100],
          [900, 100],
          [900, 900],
          [100, 900],
        ].map(([x, y], id) => ({ id, center: { x, y }, corners: [] })),
      }),
    }),
  },
}));
import Calibration from "../../frontend/src/app/calibration/page";
let root: Root;
let host: HTMLDivElement;
let dom: JSDOM;
beforeEach(async () => {
  dom = new JSDOM("<!doctype html><html><body></body></html>", {
    url: "http://localhost",
  });
  for (const key of [
    "window",
    "self",
    "document",
    "localStorage",
    "HTMLCanvasElement",
    "HTMLVideoElement",
    "HTMLMediaElement",
    "getComputedStyle",
  ])
    vi.stubGlobal(key, Reflect.get(dom.window, key));
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  vi.useFakeTimers();
  fixture.markers = true;
  fixture.hands = true;
  fixture.depthCapture = 0;
  fixture.push.mockClear();
  vi.stubGlobal("requestAnimationFrame", (fn: FrameRequestCallback) =>
    setTimeout(() => fn(0), 0),
  );
  vi.stubGlobal("cancelAnimationFrame", (id: number) => clearTimeout(id));
  vi.stubGlobal(
    "Image",
    class {
      onload?: () => void;
      set src(value: string) {
        if (value) this.onload?.();
      }
    },
  );
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
  vi.spyOn(HTMLCanvasElement.prototype, "toDataURL").mockReturnValue(
    "data:image/png;base64,fixture",
  );
  for (const [key, value] of Object.entries({
    readyState: 4,
    videoWidth: 1000,
    videoHeight: 1000,
  }))
    vi.spyOn(
      HTMLVideoElement.prototype,
      key as "readyState",
      "get",
    ).mockReturnValue(value);
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
  await act(async () => root.render(<Calibration />));
  await tick(0);
});
afterEach(async () => {
  await act(async () => root.unmount());
  dom.window.close();
  vi.useRealTimers();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});
const find = (label: string) =>
  Array.from(host.querySelectorAll("button")).find(
    (b) => b.textContent === label,
  );
async function click(label: string) {
  const b = find(label);
  if (!b) throw new Error(`Missing ${label}`);
  await act(async () => b.click());
}
async function tick(ms: number) {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(ms);
  });
}
async function paper() {
  await click("Next Step");
  await tick(0);
  await click("Next Step");
}
async function capture() {
  await click("Start");
  for (let i = 0; i < 3; i++) await tick(1000);
}
async function complete() {
  await paper();
  await click("Check paper");
  await click("Next Step");
  await capture();
  await click("Next Step");
  await depth();
  await click("Next Step");
}
async function depth() {
  for (const label of ["top-left corner", "top-right corner", "bottom-left corner", "bottom-right corner", "center"]) {
    fixture.depthCapture++;
    await click(`Capture ${label} position`);
  }
}
it("blocks paper acceptance without markers and recovers with real geometry", async () => {
  fixture.markers = false;
  await paper();
  expect(find("Next Step")).toBeUndefined();
  await click("Check paper");
  expect(find("Next Step")).toBeUndefined();
  fixture.markers = true;
  await click("Check paper");
  expect(find("Next Step")).toBeDefined();
});
it("does not treat elapsed time or missing hands as calibration success", async () => {
  await paper();
  await click("Check paper");
  await click("Next Step");
  fixture.hands = false;
  await capture();
  expect(find("Next Step")).toBeUndefined();
  expect(loadCalibration()).toBeNull();
});
it("captures both phases and persists a validated result only on completion", async () => {
  await complete();
  expect(loadCalibration()).toBeNull();
  await click("Start Playing");
  expect(loadCalibration()?.contact.rest[0]).toHaveLength(21);
  expect(parsePersistedDepthCalibration(localStorage.getItem("depthCalibrationLines"))).not.toBeNull();
  expect(fixture.push).toHaveBeenCalledExactlyOnceWith("/");
  expect(localStorage.getItem("isCalibrated")).toBeNull();
});
it("requires a real rest capture after hover", async () => {
  await paper();
  await click("Check paper");
  await click("Next Step");
  await capture();
  await click("Next Step");
  fixture.hands = false;
  await click("Capture top-left corner position");
  expect(find("Next Step")).toBeUndefined();
  expect(loadCalibration()).toBeNull();
});
it("shows storage recovery and does not navigate on a write failure", async () => {
  await complete();
  vi.spyOn(dom.window.Storage.prototype, "setItem").mockImplementation(() => {
    throw new Error("denied");
  });
  await click("Start Playing");
  expect(fixture.push).not.toHaveBeenCalled();
  expect(host.textContent).toContain("Enable browser storage");
});
it("checks the sheet again before saving", async () => {
  await complete();
  fixture.markers = false;
  await click("Start Playing");
  expect(fixture.push).not.toHaveBeenCalled();
  expect(loadCalibration()).toBeNull();
  await click("Restart calibration");
  expect(host.textContent).toContain("Step 1:");
});

async function select(id: string, value: number) {
  const element = host.querySelector<HTMLSelectElement>(`#${id}`)!;
  await act(async () => {
    element.value = String(value);
    element.dispatchEvent(new dom.window.Event("change", { bubbles: true }));
  });
}

it.each([1, 2, 3])("saves %i-octave configuration through the real calibration workflow", async (octaves) => {
  await select("paper-octaves", octaves);
  await select("octave-count", octaves);
  await select("starting-note", 60);
  await complete();
  await click("Start Playing");
  expect(loadCalibration()?.layout).toEqual({ octaves, startingMidi: 60,
    whiteKeys: octaves * 7 + 1, paperOctaves: octaves, paperFitOverride: false });
  expect(fixture.push).toHaveBeenCalledExactlyOnceWith("/");
});

it("blocks an undersized paper layout until explicitly overridden and retains the range", async () => {
  await select("octave-count", 3);
  expect(host.textContent).toContain("does not fit");
  expect(find("Next Step")).toBeUndefined();
  const checkbox = host.querySelector<HTMLInputElement>('input[type="checkbox"]')!;
  await act(async () => checkbox.click());
  expect(find("Next Step")).toBeDefined();
  await complete();
  await click("Start Playing");
  expect(loadCalibration()?.layout).toMatchObject({ octaves: 3, whiteKeys: 22,
    paperOctaves: 1, paperFitOverride: true });
});

it("clears saved calibration when settings change and bounds the highest starting note", async () => {
  await complete();
  await click("Start Playing");
  expect(loadCalibration()).not.toBeNull();
  await click("Restart calibration");
  await select("starting-note", 108);
  expect(loadCalibration()).toBeNull();
  expect(localStorage.getItem("depthCalibrationLines")).toBeNull();
  await select("octave-count", 3);
  expect(loadKeyboardLayout().startingMidi).toBe(84);
  expect(Array.from(host.querySelectorAll<HTMLOptionElement>('#starting-note option')).map(o => Number(o.value))).toEqual([0, 12, 24, 36, 48, 60, 72, 84]);
});

it("keeps settings unchanged when storage is blocked", async () => {
  vi.spyOn(dom.window.Storage.prototype, "setItem").mockImplementation(() => { throw new Error("denied"); });
  await select("octave-count", 2);
  expect(loadKeyboardLayout().octaves).toBe(1);
  expect(host.textContent).toContain("Could not save keyboard settings");
});

it("restores the companion depth model if the primary calibration write fails", async () => {
  await complete();
  localStorage.setItem("depthCalibrationLines", "previous model");
  const setItem = dom.window.Storage.prototype.setItem;
  vi.spyOn(dom.window.Storage.prototype, "setItem").mockImplementation(function (this: Storage, key, value) {
    if (key === "makeshift.calibration.v1") throw new Error("quota");
    setItem.call(this, key, value);
  });
  await click("Start Playing");
  expect(fixture.push).not.toHaveBeenCalled();
  expect(loadCalibration()).toBeNull();
  expect(localStorage.getItem("depthCalibrationLines")).toBe("previous model");
  expect(host.textContent).toContain("Enable browser storage");
});

it("discards in-progress hand captures when another tab changes configuration", async () => {
  await paper();
  await click("Check paper");
  await click("Next Step");
  await capture();
  await act(async () => {
    localStorage.setItem("makeshift:keyboard-layout:v1", JSON.stringify({ octaves: 2, startingMidi: 60, whiteKeys: 15 }));
    window.dispatchEvent(new dom.window.StorageEvent("storage", { key: "makeshift:keyboard-layout:v1" }));
  });
  expect(host.textContent).toContain("Step 1:");
  expect(host.querySelector<HTMLSelectElement>("#octave-count")?.value).toBe("2");
  expect(loadCalibration()).toBeNull();
  await paper();
  await click("Next Step");
  expect(find("Start")).toBeDefined();
});
