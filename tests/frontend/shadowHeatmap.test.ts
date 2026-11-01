import { describe, expect, it } from "vitest";
import { colorizeShadowDifference, measureShadowDifference, type HeatmapPalette } from "../../frontend/src/cv/shadowHeatmap";

function image(...colors: Array<[number, number, number, number?]>): ImageData {
  return { width: colors.length, height: 1, data: new Uint8ClampedArray(colors.flatMap(([r, g, b, a = 255]) => [r, g, b, a])) } as ImageData;
}
const palette: HeatmapPalette = { stops: [[0, 0, 0], [0, 0, 120], [120, 120, 0], [255, 0, 0]], unavailable: [90, 90, 90] };

describe("finger-independent shadow heatmap", () => {
  it("keeps signed darkening, excludes brightening from darkness statistics", () => {
    const result = measureShadowDifference(image([100, 100, 100], [220, 220, 220], [200, 200, 200]), image([200, 200, 200], [200, 200, 200], [200, 200, 200]))!;
    expect([...result.lumaDrop]).toEqual([100, -20, 0]);
    expect(result.maxDarkening).toBeCloseTo(100);
    expect(result.meanDarkening).toBeCloseTo(100 / 3);
    expect([...result.colorShift]).toEqual([0, 0, 0]);
  });

  it("preserves proportional color under uniform attenuation but exposes color changes", () => {
    const result = measureShadowDifference(image([100, 80, 60], [120, 65, 45]), image([200, 160, 120], [200, 160, 120]))!;
    expect(result.colorShift[0]).toBeCloseTo(0);
    expect(result.colorShift[1]).toBeGreaterThan(20);
    expect(result.lumaDrop[0]).toBeGreaterThan(0);
    expect(result.lumaDrop[1]).toBeGreaterThan(0);
  });

  it("distinguishes ignored reference, transparent data and unknown near-black color", () => {
    const result = measureShadowDifference(image([0, 0, 0], [0, 0, 0], [100, 100, 100, 0]), image([200, 200, 200], [20, 20, 20], [200, 200, 200]))!;
    expect([...result.valid]).toEqual([1, 0, 0]);
    expect(result.sampledPixels).toBe(1);
    expect(result.maxDarkening).toBe(200);
    expect(Number.isNaN(result.colorShift[0])).toBe(true);
    const color = colorizeShadowDifference(result, "color", 0, 40, palette);
    expect([...color.slice(0, 4)]).toEqual([90, 90, 90, 255]);
  });

  it("rejects mismatched images and handles an entirely ignored reference", () => {
    expect(measureShadowDifference(image([100, 100, 100]), image([200, 200, 200], [200, 200, 200]))).toBeNull();
    const result = measureShadowDifference(image([0, 0, 0]), image([20, 20, 20]))!;
    expect(result.sampledPixels).toBe(0);
    expect(result.meanDarkening).toBe(0);
    expect([...colorizeShadowDifference(result, "darkening", 5, 120, palette)]).toEqual([90, 90, 90, 255]);
  });

  it("uses fixed display limits, clips saturation and does not map brightening to shadow", () => {
    const reference = image([200, 200, 200], [200, 200, 200], [200, 200, 200], [200, 200, 200]);
    const result = measureShadowDifference(image([220, 220, 220], [195, 195, 195], [150, 150, 150], [0, 0, 0]), reference)!;
    const output = colorizeShadowDifference(result, "darkening", 5, 95, palette);
    expect([...output.slice(0, 8)]).toEqual([0, 0, 0, 255, 0, 0, 0, 255]);
    expect([...output.slice(8, 12)]).toEqual([60, 60, 60, 255]);
    expect([...output.slice(12, 16)]).toEqual([255, 0, 0, 255]);
    const second = measureShadowDifference(image([150, 150, 150]), image([200, 200, 200]))!;
    expect([...colorizeShadowDifference(second, "darkening", 5, 95, palette)]).toEqual([...output.slice(8, 12)]);
  });
});


describe("brightness–chromaticity projection", () => {
  it("fits proportional dimming of a non-neutral reference without color residual", () => {
    const result = measureShadowDifference(image([100, 80, 60]), image([200, 160, 120]))!;
    expect(result.multiplier[0]).toBeCloseTo(0.5);
    expect(result.attenuation[0]).toBeCloseTo(0.5);
    expect(result.residualReference[0]).toBeCloseTo(0);
    expect(result.residualCurrent[0]).toBeCloseTo(0);
    expect(result.projectionValid[0]).toBe(1);
  });

  it("matches the neutral-paper examples and separates a colored occluder", () => {
    const result = measureShadowDifference(image([140, 140, 140], [180, 125, 100]), image([240, 240, 240], [240, 240, 240]))!;
    expect(result.multiplier[0]).toBeCloseTo(140 / 240);
    expect(result.residualReference[0]).toBe(0);
    expect(result.multiplier[1]).toBeCloseTo(0.5625);
    expect(result.residualReference[1]).toBeCloseTo(0.1392, 4);
    expect(result.residualCurrent[1]).toBeGreaterThan(0.2);
  });

  it("preserves unchanged and brighter raw values without treating brightening as attenuation", () => {
    const result = measureShadowDifference(image([100, 80, 60], [200, 160, 120]), image([100, 80, 60], [100, 80, 60]))!;
    expect([...result.multiplier]).toEqual([1, 2]);
    expect([...result.attenuation]).toEqual([0, -1]);
    expect([...colorizeShadowDifference(result, "attenuation", 0, 1, palette)]).toEqual([0, 0, 0, 255, 0, 0, 0, 255]);
  });

  it("retains raw low-signal measurements but renders their interpretation unknown", () => {
    const result = measureShadowDifference(image([0, 0, 0], [2, 1, 0], [10, 10, 10]), image([200, 200, 200], [200, 200, 200], [2, 2, 2]), 0)!;
    expect(result.multiplier[0]).toBe(0);
    expect(result.residualReference[0]).toBe(0);
    expect(Number.isNaN(result.residualCurrent[0])).toBe(true);
    expect([...result.projectionValid]).toEqual([0, 0, 0]);
    for (const mode of ["multiplier", "attenuation", "residualReference", "residualCurrent", "candidate"] as const) {
      expect([...colorizeShadowDifference(result, mode, 0, 1, palette)]).toEqual([90, 90, 90, 255, 90, 90, 90, 255, 90, 90, 90, 255]);
    }
  });

  it("keeps invalid, transparent and zero-reference projections unavailable even with a zero cutoff", () => {
    const result = measureShadowDifference(image([100, 100, 100], [100, 100, 100, 0], [100, 100, 100]), image([0, 0, 0], [200, 200, 200], [200, 200, 200, 0]), 0)!;
    for (const values of [result.multiplier, result.attenuation, result.residualReference, result.residualCurrent]) {
      expect([...values].every(Number.isNaN)).toBe(true);
    }
    expect([...result.projectionValid]).toEqual([0, 0, 0]);
  });

  it("shows why reference-relative residual shrinks as a colored pixel gets darker", () => {
    const result = measureShadowDifference(image([180, 120, 90], [60, 40, 30]), image([240, 240, 240], [240, 240, 240]))!;
    expect(result.residualReference[0]).toBeCloseTo(3 * result.residualReference[1]);
    expect(result.residualCurrent[0]).toBeCloseTo(result.residualCurrent[1]);
  });

  it("excludes high color mismatch while retaining proportional darkening with either filter", () => {
    const result = measureShadowDifference(image([140, 140, 140], [180, 125, 100], [0, 0, 0], [250, 250, 250]), image([240, 240, 240], [240, 240, 240], [240, 240, 240], [240, 240, 240]))!;
    for (const method of ["color", "projection"] as const) {
      const output = colorizeShadowDifference(result, "candidate", 5, 95, palette, { method, maximumColorShift: 10, maximumResidual: 0.15 });
      expect([...output]).toEqual([255, 0, 0, 255, 0, 0, 0, 255, 90, 90, 90, 255, 0, 0, 0, 255]);
    }
  });

  it("uses fractional fixed scales for residual maps without altering raw measurements", () => {
    const result = measureShadowDifference(image([180, 125, 100]), image([240, 240, 240]))!;
    const raw = result.residualReference[0];
    const saturated = colorizeShadowDifference(result, "residualReference", 0, 0.1, palette);
    expect([...saturated]).toEqual([255, 0, 0, 255]);
    expect([...colorizeShadowDifference(result, "residualReference", 0, 0.3, palette)]).not.toEqual([...saturated]);
    expect(result.residualReference[0]).toBe(raw);
  });
});
