import { describe, expect, it } from "vitest";
import { measureShadowDifference } from "../../frontend/src/cv/shadowHeatmap";
import { captureShadowSample, type ShadowSampleContext, type ShadowSampleSettings } from "../../frontend/src/cv/shadowSamples";
function image(width: number, height: number, rgb: number[]): ImageData {
  return { width, height, data: new Uint8ClampedArray(Array.from({ length: width * height }, () => [...rgb, 255]).flat()) } as ImageData;
}
const context: ShadowSampleContext = {
  source: { id: "clip-one", name: "clip.mov", kind: "video", nativeWidth: 1920, nativeHeight: 1080, timeSeconds: 1.5, frame: 45, frameIdentity: "approximate", fps: 30 },
  reference: { id: "reference-one", name: "empty.png", timeSeconds: null },
};
const settings: ShadowSampleSettings = { method: "color", maximumColorShift: 10, maximumResidual: 0.15, noiseFloor: 5, fullScale: 120, residualScale: 0.3, minimumReferenceLuma: 40 };
const selection = { x: 0, y: 0, size: 1, label: "shadow" as const, phase: "hover" as const, note: "soft shadow" };

describe("labeled shadow samples", () => {
  it("captures raw RGB, coordinates, metadata and independent results for both methods", () => {
    const current = image(2, 1, [180, 125, 100]); const reference = image(2, 1, [240, 240, 240]);
    const diff = measureShadowDifference(current, reference)!;
    const sample = captureShadowSample(diff, current, reference, context, { ...settings, maximumColorShift: 255 }, selection)!;
    expect(sample.context).toEqual(context);
    expect(sample.analysis).toEqual({ width: 2, height: 1, coordinateSpace: "downsampled-analysis-pixels" });
    expect(sample.pixels[0].currentRgb).toEqual([180, 125, 100]);
    expect(sample.pixels[0].referenceRgb).toEqual([240, 240, 240]);
    expect(sample.pixels[0].multiplier).toBeCloseTo(0.5625);
    expect(sample.pixels[0].retainedByColor).toBe(true);
    expect(sample.pixels[0].retainedByProjection).toBe(false);
    expect(sample.selection).toEqual(selection);
  });

  it("clips patches at image edges and records all individual pixels", () => {
    const current = image(5, 5, [100, 100, 100]); const reference = image(5, 5, [200, 200, 200]);
    const diff = measureShadowDifference(current, reference)!;
    const edge = captureShadowSample(diff, current, reference, context, settings, { ...selection, size: 3 })!;
    expect(edge.bounds).toEqual({ x: 0, y: 0, right: 2, bottom: 2 });
    expect(edge.counts.total).toBe(4);
    expect(edge.pixels.map(({ x, y }) => [x, y])).toEqual([[0, 0], [1, 0], [0, 1], [1, 1]]);
    const center = captureShadowSample(diff, current, reference, context, settings, { ...selection, x: 2, y: 2, size: 3 })!;
    expect(center.counts).toEqual({ total: 9, colorRetained: 9, projectionRetained: 9, colorUnknown: 0, projectionUnknown: 0 });
  });

  it("exports invalid references and low-signal interpretation as explicit unknowns", () => {
    const current = image(2, 1, [0, 0, 0]); const reference = image(2, 1, [200, 200, 200]);
    reference.data.set([0, 0, 0, 255], 4);
    const diff = measureShadowDifference(current, reference)!;
    const sample = captureShadowSample(diff, current, reference, context, settings, { ...selection, size: 3 })!;
    expect(sample.pixels[0].multiplier).toBe(0);
    expect(sample.pixels[0].residualCurrent).toBeNull();
    expect(sample.pixels[0].retainedByColor).toBeNull();
    expect(sample.pixels[0].retainedByProjection).toBeNull();
    expect(sample.pixels[1].lumaDrop).toBeNull();
    expect(sample.pixels[1].multiplier).toBeNull();
    expect(sample.counts.colorUnknown).toBe(2);
    expect(JSON.stringify(sample)).not.toMatch(/NaN|Infinity/);
  });

  it("snapshots data independently of later frame, reference, label and settings changes", () => {
    const current = image(1, 1, [100, 100, 100]); const reference = image(1, 1, [200, 200, 200]);
    const sourceContext = structuredClone(context); const sourceSettings = { ...settings }; const label = { ...selection };
    const diff = measureShadowDifference(current, reference)!;
    const sample = captureShadowSample(diff, current, reference, sourceContext, sourceSettings, label)!;
    sourceContext.reference.id = "replacement"; sourceSettings.noiseFloor = 255; label.note = "changed";
    current.data[0] = 255; reference.data[0] = 0; diff.multiplier[0] = 999;
    expect(sample.context.reference.id).toBe("reference-one");
    expect(sample.settings.noiseFloor).toBe(5);
    expect(sample.selection.note).toBe("soft shadow");
    expect(sample.pixels[0].currentRgb[0]).toBe(100);
    expect(sample.pixels[0].referenceRgb[0]).toBe(200);
    expect(sample.pixels[0].multiplier).toBe(0.5);
  });

  it("does not retain unchanged, brightened or below-floor pixels, including threshold equality", () => {
    for (const value of [200, 220, 195]) {
      const current = image(1, 1, [value, value, value]); const reference = image(1, 1, [200, 200, 200]);
      const sample = captureShadowSample(measureShadowDifference(current, reference)!, current, reference, context, settings, selection)!;
      expect(sample.pixels[0].retainedByColor).toBe(false);
      expect(sample.pixels[0].retainedByProjection).toBe(false);
    }
  });

  it("rejects out-of-bounds selections, unsupported sizes and incompatible images", () => {
    const current = image(1, 1, [100, 100, 100]); const reference = image(1, 1, [200, 200, 200]);
    const diff = measureShadowDifference(current, reference)!;
    for (const update of [{ x: -1 }, { x: 1 }, { y: 1 }, { x: 0.5 }, { x: NaN }, { size: 2 }, { size: 1000 }]) {
      expect(captureShadowSample(diff, current, reference, context, settings, { ...selection, ...update })).toBeNull();
    }
    expect(captureShadowSample(diff, image(2, 1, [100, 100, 100]), reference, context, settings, selection)).toBeNull();
  });
});
