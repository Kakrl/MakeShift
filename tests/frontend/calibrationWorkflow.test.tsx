import { JSDOM } from "jsdom";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { beforeEach, afterEach, expect, it, vi } from "vitest";
import { loadCalibration } from "../../frontend/src/cv/calibration";
import { loadKeyboardLayout } from "../../frontend/src/lib/keyboardSettings";
import { listProfiles } from "../../frontend/src/lib/calibrationProfiles";
import type { VisionCameraOptions, VisionResult } from "../../frontend/src/cv/visionCameraPipeline";

const fixture = vi.hoisted(() => ({
  markers: true, validGeometry: true, failed: false, deferred: false,
  options: null as VisionCameraOptions | null, pending: null as (() => void) | null,
  disposed: vi.fn(), cameraDeviceId: "camera-1", push: vi.fn(),
  camera: { stream: { getVideoTracks: () => [
    { readyState: "live", getSettings: () => ({ deviceId: fixture.cameraDeviceId }) },
  ] }, cameraReady: true },
}));
vi.mock("next/navigation", () => ({ useRouter: () => ({ push: fixture.push }) }));
vi.mock("../../frontend/src/app/CameraContext", () => ({ useCamera: () => fixture.camera }));
vi.mock("../../frontend/src/app/CameraStatusOverlay", () => ({ default: () => null }));
vi.mock("../../frontend/src/app/lighting", () => ({
  MIN_BRIGHTNESS: 0.2, MAX_BRIGHTNESS: 0.8, LIGHTING_MESSAGES: { ok: "OK" },
  readFrameBrightness: () => ({ brightness: 0.5, verdict: "ok" }),
}));
vi.mock("../../frontend/src/cv/visionCameraPipeline", () => ({
  VisionCameraPipeline: class {
    constructor(private options: VisionCameraOptions) { fixture.options = options; }
    start() { this.options.onStatus(fixture.failed ? "Vision failed" : "Vision ready", fixture.failed); }
    tick() {}
    reset() { this.options.onUnavailable(); }
    dispose() { fixture.disposed(); this.options.onUnavailable(); }
    setReference() {
      const camera = this.options.camera()!;
      const send = () => this.options.onFrame({ camera, timestampMs: 0, sessionId: null,
        result: { width: 1000, height: 1000, pressedKeys: [], fingertips: [], pressRanges: [],
          referenceRevision: 1, referenceReady: fixture.markers, homographyReady: fixture.markers,
          referenceScan: fixture.markers ? { status: "captured", reason: null } :
            { status: "blocked", reason: "markers-missing-or-invalid" },
          geometry: fixture.markers ? { markerCenters: fixture.validGeometry ? [
            { x: 100, y: 100 }, { x: 900, y: 100 }, { x: 900, y: 900 }, { x: 100, y: 900 },
          ] as NonNullable<VisionResult["geometry"]>["markerCenters"] : Array(4).fill({ x: 100, y: 100 }) as NonNullable<VisionResult["geometry"]>["markerCenters"],
            sheetToFrame: [1,0,0,0,1,0,0,0,1], frameToSheet: [1,0,0,0,1,0,0,0,1],
            whiteKeyPolygons: [], keyboardOutline: [{x:100,y:100},{x:900,y:100},{x:900,y:900},{x:100,y:900}] } : null,
        },
      });
      if (fixture.deferred) fixture.pending = send; else send();
    }
  },
}));
import Calibration from "../../frontend/src/app/calibration/page";
let root: Root;
let host: HTMLDivElement;
let dom: JSDOM;
beforeEach(async () => {
  dom = new JSDOM("<html><body></body></html>", { url: "http://localhost" });
  for (const key of ["window", "self", "document", "localStorage", "HTMLCanvasElement",
    "HTMLVideoElement", "HTMLMediaElement", "getComputedStyle"])
    vi.stubGlobal(key, Reflect.get(dom.window, key));
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  vi.useFakeTimers();
  fixture.markers = true; fixture.validGeometry = true; fixture.failed = false;
  fixture.deferred = false; fixture.pending = null; fixture.cameraDeviceId = "camera-1";
  fixture.push.mockClear(); fixture.disposed.mockClear();
  // One callback per explicit timer advancement, matching a browser frame cadence.
  vi.stubGlobal("requestAnimationFrame", (fn: FrameRequestCallback) => setTimeout(() => fn(0), 16));
  vi.stubGlobal("cancelAnimationFrame", (id: number) => clearTimeout(id));
  for (const [key, value] of Object.entries({ readyState: 4, videoWidth: 1000, videoHeight: 1000 }))
    vi.spyOn(HTMLVideoElement.prototype, key as "readyState", "get").mockReturnValue(value);
  host = document.createElement("div"); document.body.append(host); root = createRoot(host);
  await act(async () => root.render(<Calibration />)); await tick(16);
});
afterEach(async () => {
  await act(async () => root.unmount()); dom.window.close(); vi.useRealTimers();
  vi.restoreAllMocks(); vi.unstubAllGlobals();
});
const find = (label: string) => Array.from(host.querySelectorAll("button")).find(b => b.textContent === label);
async function click(label: string) {
  const button = find(label); if (!button) throw new Error(`Missing ${label}`);
  await act(async () => button.click());
}
async function tick(ms: number) { await act(async () => { await vi.advanceTimersByTimeAsync(ms); }); }
async function paper() { await click("Next Step"); await tick(16); await click("Next Step"); await tick(0); }
async function complete() { await paper(); await click("Capture reference"); await click("Next Step"); await tick(0); }
async function select(id: string, value: number) {
  const element = host.querySelector<HTMLSelectElement>(`#${id}`)!;
  await act(async () => { element.value = String(value); element.dispatchEvent(new dom.window.Event("change", { bubbles: true })); });
}

it("requires an explicit reference capture, blocks missing markers, and retries", async () => {
  await paper(); expect(find("Next Step")).toBeUndefined();
  fixture.markers = false; await click("Capture reference");
  expect(host.textContent).toContain("Reference not captured"); expect(find("Next Step")).toBeUndefined();
  fixture.markers = true; await click("Capture reference");
  expect(host.textContent).toContain("Sheet geometry validated"); expect(find("Next Step")).toBeDefined();
});
it("rejects invalid geometry and requires recapture after going back", async () => {
  fixture.validGeometry = false; await paper(); await click("Capture reference");
  expect(find("Next Step")).toBeUndefined();
  fixture.validGeometry = true; await click("Capture reference");
  await click("Back"); await tick(16); await click("Next Step");
  expect(find("Next Step")).toBeUndefined();
});
it("saves only validated Vision setup at completion and explains Home recapture", async () => {
  await complete(); expect(loadCalibration()).toBeNull();
  expect(host.textContent).toContain("On Home"); expect(host.textContent).not.toContain("Calibration saved");
  await click("Start Playing"); expect(loadCalibration()).toMatchObject({ version: 2, detector: "vision-reference-v1" });
  expect(loadCalibration()).not.toHaveProperty("contact");
  expect(localStorage.getItem("depthCalibrationLines")).toBeNull();
  expect(fixture.push).toHaveBeenCalledExactlyOnceWith("/");
});
it("shows storage recovery without navigating or overwriting the old record", async () => {
  localStorage.setItem("makeshift.calibration.v1", "previous record");
  await complete();
  vi.spyOn(dom.window.Storage.prototype, "setItem").mockImplementation(() => { throw new Error("denied"); });
  await click("Start Playing"); expect(fixture.push).not.toHaveBeenCalled();
  expect(host.textContent).toContain("Enable browser storage");
  expect(localStorage.getItem("makeshift.calibration.v1")).toBe("previous record");
});
it.each([1, 2, 3])("saves a matching %i-octave setup", async octaves => {
  await select("paper-octaves", octaves); await select("octave-count", octaves); await select("starting-note", 60);
  await complete(); await click("Start Playing");
  expect(loadCalibration()?.layout).toMatchObject({ octaves, startingMidi: 60, paperOctaves: octaves });
});
it("explains unsupported mismatched paper instead of accepting its reference", async () => {
  await select("octave-count", 3); expect(find("Next Step")).toBeUndefined();
  await act(async () => host.querySelector<HTMLInputElement>('input[type="checkbox"]')!.click());
  await paper();
  // The real pipeline rejects this combination; emulate its reported failure.
  await act(async () => fixture.options!.onStatus("Vision requires matching paper and playable octave counts", true));
  expect(find("Capture reference")?.disabled).toBe(true);
});
it("rejects a changed camera at save and keeps a restart action", async () => {
  await complete(); fixture.cameraDeviceId = "camera-2"; await click("Start Playing");
  expect(fixture.push).not.toHaveBeenCalled(); expect(host.textContent).toContain("settings changed");
  expect(find("Restart calibration")).toBeDefined();
});
it("drops pending capture results when configuration changes", async () => {
  await paper(); fixture.deferred = true; await click("Capture reference");
  await act(async () => {
    window.dispatchEvent(new dom.window.StorageEvent("storage", { key: "makeshift:keyboard-layout:v1" }));
    fixture.pending?.();
  });
  expect(host.textContent).toContain("Step 1:"); expect(loadCalibration()).toBeNull();
});
it("discards captured setup on backgrounding", async () => {
  await complete(); vi.spyOn(document, "hidden", "get").mockReturnValue(true);
  await act(async () => document.dispatchEvent(new dom.window.Event("visibilitychange")));
  await click("Start Playing"); expect(fixture.push).not.toHaveBeenCalled();
});
it("recovers from a worker load failure by reloading the tracker", async () => {
  fixture.failed = true; await paper(); expect(find("Capture reference")?.disabled).toBe(true);
  fixture.failed = false; await click("Reload tracker"); await tick(0); expect(find("Capture reference")?.disabled).toBe(false);
  await click("Capture reference"); expect(find("Next Step")).toBeDefined();
});
it("keeps settings unchanged when storage is blocked", async () => {
  vi.spyOn(dom.window.Storage.prototype, "setItem").mockImplementation(() => { throw new Error("denied"); });
  await select("octave-count", 2); expect(loadKeyboardLayout().octaves).toBe(1);
  expect(host.textContent).toContain("Could not save keyboard settings");
});
async function chooseProfile(name: string) {
  const element = host.querySelector<HTMLSelectElement>("#calibration-profile")!;
  const option = Array.from(element.options).find((o) => o.textContent === name);
  if (!option) throw new Error(`Missing profile ${name}`);
  await act(async () => {
    element.value = option.value;
    element.dispatchEvent(new dom.window.Event("change", { bubbles: true }));
  });
}
async function nameProfile(name: string, submit: string) {
  const input = host.querySelector<HTMLInputElement>('input[aria-label="Profile name"]')!;
  input.value = name;
  await click(submit);
}
async function remount() {
  await act(async () => root.unmount());
  root = createRoot(host);
  await act(async () => root.render(<Calibration />));
  await tick(0);
}
const profileNames = () =>
  Array.from(host.querySelectorAll<HTMLOptionElement>("#calibration-profile option"))
    .filter((o) => o.value).map((o) => o.textContent);
async function openHelp() {
  await act(async () => host.querySelector<HTMLButtonElement>('button[aria-label="Show help"]')!.click());
  return host.querySelector('[role="dialog"]')!;
}


it("shows empty-keyboard sheet guidance", async () => {
  await paper(); const dialog = await openHelp(); expect(dialog.textContent).toContain("all four corner markers");
  expect(dialog.querySelector("img")).toBeNull();
});
it("saves, reloads, renames and deletes calibration profiles on step 1", async () => {
  await select("octave-count", 2);
  await select("starting-note", 36);
  await select("paper-octaves", 2);
  await click("Save profile");
  await nameProfile("Desk", "Save");
  expect(host.textContent).toContain('Saved "Desk".');
  await select("octave-count", 1);
  await click("Save profile");
  await nameProfile("Small", "Save");

  await remount();
  expect(profileNames()).toEqual(["Desk", "Small"]);
  await chooseProfile("Desk");
  expect(loadKeyboardLayout()).toMatchObject({ octaves: 2, startingMidi: 36, paperOctaves: 2 });
  expect(host.querySelector<HTMLSelectElement>("#octave-count")!.value).toBe("2");
  expect(host.querySelector<HTMLSelectElement>("#calibration-profile")!.selectedOptions[0].textContent).toBe("Desk");

  await click("Rename");
  await nameProfile("small", "Save name");
  expect(host.textContent).toContain("Another profile already uses that name.");
  await nameProfile("Studio", "Save name");
  expect(profileNames()).toEqual(["Studio", "Small"]);

  await chooseProfile("Small");
  dom.window.confirm = () => false;
  await click("Save profile");
  await nameProfile("studio", "Save");
  expect(listProfiles().find((p) => p.name === "Studio")).toMatchObject({ octaves: 2 });
  await click("Cancel");
  await chooseProfile("Studio");

  dom.window.confirm = () => true;
  await click("Delete");
  expect(profileNames()).toEqual(["Small"]);
  await remount();
  expect(profileNames()).toEqual(["Small"]);
});


it("loading a profile still requires an explicit live reference", async () => {
  await complete(); await click("Start Playing"); await click("Restart calibration");
  await click("Save profile"); await nameProfile("Desk", "Save");
  expect(listProfiles()[0].corners).toHaveLength(4);
  await select("octave-count", 2); await chooseProfile("Desk"); expect(loadCalibration()).toBeNull();
  await paper(); expect(find("Next Step")).toBeUndefined();
  await click("Capture reference"); expect(find("Next Step")).toBeDefined();
});
