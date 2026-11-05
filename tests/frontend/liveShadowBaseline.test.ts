import { expect, it } from "vitest";
import { detectShadowBaseline, ShadowKeyTransitions, shadowAnalysisSize } from "../../frontend/src/cv/liveShadowBaseline";
import { baselineSnapshot, explainShadowDecision, shadowPixelFingerprint } from "../../frontend/src/cv/shadowBaselineDiagnostics";
import { DEFAULT_LAYOUT } from "../../frontend/src/cv/keyboardLayout";
import { computeHomography } from "../../frontend/src/cv/homography";
import { PAGE_CORNERS, validateCalibration } from "../../frontend/src/cv/calibration";

function fixture() {
  const width = 80, height = 100;
  const data = new Uint8ClampedArray(width * height * 4).fill(230);
  for (let i = 3; i < data.length; i += 4) data[i] = 255;
  const reference = { width, height, data: data.slice() } as ImageData;
  const current = { width, height, data } as ImageData;
  const paint = (x: number, y: number, rgb = [150, 150, 150]) => data.set([...rgb, 255], (y * width + x) * 4);
  for (let x = 30; x <= 49; x++) for (let y = 10; y <= 60; y++) paint(x, y, [150, 95, 75]);
  for (let y = 48; y <= 60; y++) paint(29, y);
  for (let x = 25; x <= 29; x++) paint(x, 52);
  const transform = computeHomography([{ x: 0, y: 0 }, { x: width, y: 0 }, { x: width, y: height }, { x: 0, y: height }], PAGE_CORNERS)!;
  const run = (cutoff: 5 | 20 | 40 | 60 = 20) => detectShadowBaseline(current, reference, width, height, transform, DEFAULT_LAYOUT, cutoff);
  return { current, reference, transform, paint, run };
}

it("uses the reviewed automatic geometry and upward DFS support on an eligible key", () => {
  const f = fixture();
  const result = f.run();
  expect(result.candidates).toHaveLength(1);
  expect(result.candidates[0]).toMatchObject({ x: 40, y: 60, width: 20, accepted: true });
  expect([...result.pressedKeys]).toEqual([3]);
});

it("lets any downward witness veto upward support with matching configurable cutoffs", () => {
  const f = fixture();
  for (let y = 61; y <= 64; y++) f.paint(40, y, [200, 200, 200]);
  expect([...f.run(20).pressedKeys]).toEqual([]);
  expect([...f.run(40).pressedKeys]).toEqual([3]);
  expect([...f.run(60).pressedKeys]).toEqual([3]);
});

it("excludes off-keyboard proposals before DFS and rejects unavailable contact geometry", () => {
  const f = fixture();
  const outside = [...f.transform] as typeof f.transform;
  outside[2] = 10;
  const result = detectShadowBaseline(f.current, f.reference, 80, 100, outside, DEFAULT_LAYOUT);
  expect(result.candidates[0]).toMatchObject({ keyIndex: -1, accepted: false });
  expect(result.pressedKeys.size).toBe(0);
  // An unavailable reference is never zero-shadow press evidence.
  f.reference.data.fill(0);
  expect(f.run().pressedKeys.size).toBe(0);
});

it("holds accepted keys without retrigger, releases raw absence, and starts fresh after reset", () => {
  const transitions = new ShadowKeyTransitions();
  expect(transitions.update(new Set([2, 2, 4]))).toEqual({
    pressed: [{ keyIndex: 2, velocity: 1 }, { keyIndex: 4, velocity: 1 }], released: [],
  });
  expect(transitions.update(new Set([2, 4]))).toEqual({ pressed: [], released: [] });
  expect(transitions.update(new Set([4]))).toEqual({ pressed: [], released: [2] });
  expect(transitions.reset()).toEqual({ pressed: [], released: [4] });
  expect(transitions.update(new Set([4])).pressed).toEqual([{ keyIndex: 4, velocity: 1 }]);
});

it("bounds landscape/portrait analysis without stretching and rejects mismatched references", () => {
  expect(shadowAnalysisSize(1620, 1080)).toEqual({ width: 640, height: 427 });
  expect(shadowAnalysisSize(1080, 1920)).toEqual({ width: 360, height: 640 });
  const f = fixture();
  expect(() => detectShadowBaseline(f.current, { ...f.reference, width: 79 }, 80, 100, f.transform, DEFAULT_LAYOUT)).toThrow("dimensions");
});

it("validates the sheet-only calibration model without accepting fake landmark records", () => {
  const value = { version: 2, coordinates: "unmirrored-frame-pixels/marker-unit-square", sheet: "aruco-0-3-white-keys-v1",
    camera: { deviceId: "test", width: 100, height: 100, facingMode: "" }, layout: DEFAULT_LAYOUT,
    corners: [{ x: 10, y: 10 }, { x: 90, y: 10 }, { x: 90, y: 90 }, { x: 10, y: 90 }],
    contact: { model: "filtered-directional-shadow-v1" } };
  expect(validateCalibration(value)).toEqual(value);
  expect(validateCalibration({ ...value, version: 1 })).toBeNull();
  expect(validateCalibration({ ...value, version: 3 })).toBeNull();
  expect(validateCalibration({ ...value, contact: { model: "landmark-reference-v1" } })).toBeNull();
});


it("retains optional paths and mask without changing the baseline proposals or decisions", () => {
  const f = fixture();
  const plain = f.run();
  const detailed = detectShadowBaseline(f.current, f.reference, 80, 100, f.transform, DEFAULT_LAYOUT, 20, true);
  expect(plain.diagnostics).toBeNull();
  expect(plain.candidates.every(candidate => candidate.dfs === null)).toBe(true);
  expect(detailed.diagnostics?.mask.length).toBe(8000);
  expect(detailed.candidates[0].dfs?.settings).toMatchObject({ c: 4, d: 4, e: 4, corridorRadius: 9, minimumUpwardShadowWidth: 5 });
  expect(baselineSnapshot(detailed.candidates)).toEqual(baselineSnapshot(plain.candidates));
  expect(detailed.pressedKeys).toEqual(plain.pressedKeys);
});

it("explains actual downward veto priority even with upward support and exposes the successful witness", () => {
  const f = fixture();
  for (let y = 61; y <= 64; y++) f.paint(40, y, [200, 200, 200]);
  const candidate = detectShadowBaseline(f.current, f.reference, 80, 100, f.transform, DEFAULT_LAYOUT, 20, true).candidates[0];
  const dfs = candidate.dfs!;
  const veto = dfs.levels.find(level => level.threshold === 20)!;
  expect(veto.upwardReached).toBe(true);
  expect(veto.downwardVeto).toBe(true);
  expect(veto.downwardSearches.some(search => search.reached && search.path.at(-1)?.y === dfs.downwardY)).toBe(true);
  expect(explainShadowDecision(candidate.keyIndex, dfs, veto)).toMatchObject({ label: "NO PRESS", reason: expect.stringContaining("vetoes support from other points") });
  const support = dfs.levels.find(level => level.threshold === 40)!;
  expect(explainShadowDecision(candidate.keyIndex, dfs, support).label).toBe("PRESS");
  expect(candidate.decision).toBe(false); // Inspecting another cutoff does not change the scored result.
});

it("distinguishes known lack of support, incomplete geometry and keyboard exclusion", () => {
  const f = fixture();
  for (let y = 48; y <= 60; y++) f.paint(29, y, [230, 230, 230]);
  const candidate = detectShadowBaseline(f.current, f.reference, 80, 100, f.transform, DEFAULT_LAYOUT, 20, true).candidates[0];
  const dfs = candidate.dfs!;
  const level = dfs.levels.find(level => level.threshold === 20)!;
  expect(explainShadowDecision(candidate.keyIndex, dfs, level)).toMatchObject({ label: "NO PRESS", reason: expect.stringContaining("No usable upward path") });
  expect(explainShadowDecision(candidate.keyIndex, { ...dfs, crossSection: { ...dfs.crossSection, complete: false } },
    { ...level, downwardUnknown: true, upwardUnknown: true, patternMatch: null })).toMatchObject({ label: "UNKNOWN", reason: expect.stringContaining("incomplete or merged") });
  expect(explainShadowDecision(-1, null, undefined).label).toBe("EXCLUDED");
  expect(explainShadowDecision(3, null, undefined).label).toBe("UNKNOWN");
});

it("fingerprints exact paused pixels and coordinates without mutating image data", () => {
  const f = fixture();
  const copy = { ...f.current, data: f.current.data.slice() } as ImageData;
  const original = shadowPixelFingerprint(f.current);
  expect(shadowPixelFingerprint(copy)).toBe(original);
  copy.data[0] ^= 1;
  expect(shadowPixelFingerprint(copy)).not.toBe(original);
  expect(shadowPixelFingerprint({ ...f.current, width: 100, height: 80 } as ImageData)).not.toBe(original);
  expect(shadowPixelFingerprint(f.current)).toBe(original);
});
