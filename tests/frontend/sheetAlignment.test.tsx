// @vitest-environment jsdom
import { createElement } from "react";
import { act, cleanup, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import SheetAlignment from "../../frontend/src/app/SheetAlignment";
import { CURRENT_LAYOUT, MARKER_CHECK_INTERVAL_MS, SHEET_ID, type CalibrationResult } from "../../frontend/src/cv/calibration";

const saved: CalibrationResult = {
  version: 1, coordinates: "unmirrored-frame-pixels/marker-unit-square", sheet: SHEET_ID,
  camera: { deviceId: "camera", width: 1000, height: 1000, facingMode: "" },
  layout: CURRENT_LAYOUT,
  corners: [{ x: 100, y: 100 }, { x: 900, y: 100 }, { x: 900, y: 900 }, { x: 100, y: 900 }],
  contact: { model: "landmark-reference-v1", rest: [Array(21).fill({ x: 0.5, y: 0.5, z: 0 })] },
};
const scan = () => ({ camera: saved.camera, corners: saved.corners.map(p => ({ ...p, x: p.x + 20 })), at: Date.now() });
beforeEach(() => { vi.useFakeTimers(); vi.setSystemTime(10000); });
afterEach(() => { cleanup(); vi.useRealTimers(); });

it("preserves saved sheet-reference corners and distinguishes the current scan without color", () => {
  const original = structuredClone(saved);
  const { container } = render(createElement(SheetAlignment, { saved, camera: saved.camera, scan: scan() }));
  expect(screen.getByText(/Calibrated position \(solid\)/)).toBeTruthy();
  expect(screen.getByText(/Current position \(dashed; last complete scan\)/)).toBeTruthy();
  expect(screen.getByText(/After realigning, allow about 10 seconds/).classList.contains("sr-only")).toBe(false);
  const outlines = container.querySelectorAll("polygon");
  expect(outlines).toHaveLength(4);
  expect(outlines[0].getAttribute("points")).toBe("100,100 900,100 900,900 100,900");
  expect(outlines[2].getAttribute("points")).toBe("120,100 920,100 920,900 120,900");
  expect(outlines[2].getAttribute("stroke-dasharray")).toBe("8 5");
  expect(container.querySelector("svg")?.getAttribute("viewBox")).toBe("0 0 1000 1000");
  expect(container.querySelector("svg")?.classList.contains("scale-x-[-1]")).toBe(true);
  expect(container.querySelector("svg")?.getAttribute("aria-hidden")).toBe("true");
  expect(saved).toEqual(original);
  // Scan updates are ordinary text, not repeated screen-reader announcements.
  expect(screen.queryByRole("status")).toBeNull();
});

it("expires only the current outline, hides misses, and accepts a later realigned scan", () => {
  const { container, rerender } = render(createElement(SheetAlignment, { saved, camera: saved.camera, scan: scan() }));
  act(() => vi.advanceTimersByTime(MARKER_CHECK_INTERVAL_MS));
  expect(container.querySelectorAll("polygon")).toHaveLength(2);
  expect(screen.getByText(/Current position unavailable/)).toBeTruthy();
  rerender(createElement(SheetAlignment, { saved, camera: saved.camera, scan: { ...scan(), corners: saved.corners } }));
  expect(container.querySelectorAll("polygon")).toHaveLength(4);
  rerender(createElement(SheetAlignment, { saved, camera: saved.camera, scan: null }));
  expect(container.querySelectorAll("polygon")).toHaveLength(2);
});

it.each([
  { ...saved.camera, width: 800 }, { ...saved.camera, height: 800 },
  { ...saved.camera, deviceId: "other" }, { ...saved.camera, facingMode: "environment" }, null,
])("hides incomparable camera coordinates %j", camera => {
  const { container } = render(createElement(SheetAlignment, { saved, camera, scan: scan() }));
  expect(container.innerHTML).toBe("");
});

it("hides an old camera scan while retaining the comparable saved outline", () => {
  const { container } = render(createElement(SheetAlignment, { saved, camera: saved.camera,
    scan: { ...scan(), camera: { ...saved.camera, deviceId: "other" } } }));
  expect(container.querySelectorAll("polygon")).toHaveLength(2);
});

it("renders nothing without a validated saved calibration", () => {
  const { container } = render(createElement(SheetAlignment, { saved: null, camera: saved.camera, scan: scan() }));
  expect(container.innerHTML).toBe("");
});
