import { describe, expect, it } from "vitest";
import { measureShadowDifference } from "../../frontend/src/cv/shadowHeatmap";
import { measureShadowBand, type ShadowBandSettings } from "../../frontend/src/cv/shadowBand";
const settings: ShadowBandSettings = { method: "projection", maximumColorShift: 10, maximumResidual: 0.12, noiseFloor: 5, maxDistance: 10, halfWidth: 2 };
function fixture(edit: (data: Uint8ClampedArray, width: number) => void = () => {}) {
  const width = 21; const height = 20;
  const ref = new Uint8ClampedArray(width * height * 4).fill(200);
  for (let i = 3; i < ref.length; i += 4) ref[i] = 255;
  const data = ref.slice(); edit(data, width);
  return measureShadowDifference({ width, height, data } as ImageData, { width, height, data: ref } as ImageData)!;
}
function set(data: Uint8ClampedArray, width: number, x: number, y: number, rgb: number[]) { data.set([...rgb, 255], (y * width + x) * 4); }
const tip = { x: 10, y: 3 }; const outward = { x: 10, y: 15 };

describe("source-anchored fingertip shadow band", () => {
  it("measures a bounded contiguous band and preserves every raw ray sample", () => {
    const diff = fixture((data, width) => { for (let x = 8; x <= 12; x++) for (let y = 4; y <= 7; y++) set(data, width, x, y, [100, 100, 100]); });
    const result = measureShadowBand(diff, tip, outward, settings)!;
    expect(result.status).toBe("measured"); expect(result.medianWidth).toBe(4);
    expect(result.measuredRays).toBe(5);
    expect(result.rays[2].profile[0]).toMatchObject({ distance: 1, x: 10, y: 4, state: "shadow-compatible", lumaDrop: 100 });
    expect(result.rays[2].profile[4].state).toBe("below-floor");
    expect(result.rays[2].profile).toHaveLength(10);
  });
  it("keeps absent and weak/brightened shadows insufficient rather than reporting zero or press", () => {
    for (const rgb of [[200, 200, 200], [197, 197, 197], [230, 230, 230]]) {
      const result = measureShadowBand(fixture((data, width) => { for (let y = 4; y <= 13; y++) set(data, width, 10, y, rgb); }), tip, outward, { ...settings, halfWidth: 0 })!;
      expect(result.status).toBe("insufficient-evidence"); expect(result.medianWidth).toBeNull();
    }
  });
  it("keeps low-signal and color-rejected boundaries ambiguous", () => {
    for (const rgb of [[0, 0, 0], [130, 60, 40]]) {
      const diff = fixture((data, width) => { set(data, width, 10, 4, [100, 100, 100]); set(data, width, 10, 5, rgb); });
      const result = measureShadowBand(diff, tip, outward, { ...settings, halfWidth: 0 })!;
      expect(result.medianWidth).toBeNull(); expect(result.rays[0].status).toBe("ambiguous-boundary");
    }
  });
  it("does not skip color-rejected skin between the anchor and a shadow", () => {
    const diff = fixture((data, width) => { set(data, width, 10, 4, [150, 70, 50]); set(data, width, 10, 5, [100, 100, 100]); });
    expect(measureShadowBand(diff, tip, outward, { ...settings, halfWidth: 0 })!.rays[0].status).toBe("ambiguous-boundary");
  });
  it("allows a small sampled gap but does not attach distant regions or bridge separate runs", () => {
    const diff = fixture((data, width) => { for (const y of [6, 7, 10]) set(data, width, 10, y, [100, 100, 100]); });
    const ray = measureShadowBand(diff, tip, outward, { ...settings, halfWidth: 0 })!.rays[0];
    expect(ray.width).toBe(2); expect(ray.firstShadowDistance).toBe(3);
    const distant = measureShadowBand(diff, { x: 10, y: 2 }, outward, { ...settings, halfWidth: 0 })!;
    expect(distant.status).toBe("insufficient-evidence"); expect(distant.medianWidth).toBeNull();
  });
  it("records scan-limit and image-edge censoring as lower bounds, never complete widths", () => {
    const diff = fixture((data, width) => { for (let y = 4; y < 20; y++) set(data, width, 10, y, [100, 100, 100]); });
    const scan = measureShadowBand(diff, tip, outward, { ...settings, halfWidth: 0, maxDistance: 5 })!.rays[0];
    expect(scan.status).toBe("censored"); expect(scan.width).toBeNull(); expect(scan.lowerBound).toBe(5);
    const edge = measureShadowBand(diff, { x: 10, y: 17 }, { x: 10, y: 19 }, { ...settings, halfWidth: 0 })!.rays[0];
    expect(edge.status).toBe("censored"); expect(edge.lowerBound).toBe(2);
  });
  it("requires a majority of measured rays and reports their median", () => {
    const diff = fixture((data, width) => { for (let x = 8; x <= 10; x++) for (let y = 4; y < 4 + x - 6; y++) set(data, width, x, y, [100, 100, 100]); });
    const result = measureShadowBand(diff, tip, outward, settings)!;
    expect(result.measuredRays).toBe(3); expect(result.medianWidth).toBe(3);
    expect(measureShadowBand(diff, { x: 11, y: 3 }, { x: 11, y: 15 }, settings)!.medianWidth).toBeNull();
  });
  it("uses the selected mismatch method and retains threshold equality", () => {
    const diff = fixture((data, width) => set(data, width, 10, 4, [130, 90, 80]));
    const i = 4 * diff.width + 10;
    diff.residualCurrent[i] = 0.125; diff.colorShift[i] = 20;
    const projection = measureShadowBand(diff, tip, outward, { ...settings, maximumResidual: 0.125, halfWidth: 0 })!;
    expect(projection.medianWidth).toBe(1);
    expect(measureShadowBand(diff, tip, outward, { ...settings, method: "color", halfWidth: 0 })!.medianWidth).toBeNull();
  });
  it("supports nonvertical directions and rejects invalid geometry or unbounded settings", () => {
    const diff = fixture((data, width) => { for (let x = 5; x <= 7; x++) set(data, width, x, 10, [100, 100, 100]); });
    expect(measureShadowBand(diff, { x: 4, y: 10 }, { x: 15, y: 10 }, { ...settings, halfWidth: 0 })!.medianWidth).toBe(3);
    for (const p of [{ x: NaN, y: 2 }, { x: -1, y: 2 }, { x: 21, y: 2 }, outward]) expect(measureShadowBand(diff, p, outward, settings)).toBeNull();
    for (const update of [{ maxDistance: 1000 }, { maxDistance: 0 }, { halfWidth: 5 }, { halfWidth: -1 }, { noiseFloor: NaN }]) expect(measureShadowBand(diff, tip, outward, { ...settings, ...update })).toBeNull();
  });
});
