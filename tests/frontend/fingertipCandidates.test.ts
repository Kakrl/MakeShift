import { describe, expect, it } from "vitest";
import { DEFAULT_FINGERTIP_OPTIONS, estimateFingertips, identifyFilteredFingertips } from "../../frontend/src/cv/fingertipCandidates";
import { filteredDarkeningBoundaryMask, measureShadowDifference } from "../../frontend/src/cv/shadowHeatmap";

function fixture() {
  const width = 100; const height = 100;
  const data = new Uint8ClampedArray(width * height * 4).fill(230);
  for (let i = 3; i < data.length; i += 4) data[i] = 255;
  const reference = { width, height, data: data.slice() } as ImageData;
  const current = { width, height, data } as ImageData;
  const rectangle = (left: number, top: number, right: number, bottom: number, rgb = [150, 95, 75]) => {
    for (let y = top; y <= bottom; y += 1) for (let x = left; x <= right; x += 1) data.set([...rgb, 255], (y * width + x) * 4);
  };
  const run = () => estimateFingertips(current, measureShadowDifference(current, reference)!)!;
  return { current, reference, rectangle, run };
}

describe("offline color-based fingertip proposals", () => {
  it("finds the distal boundary of a long region rather than its centroid", () => {
    const f = fixture(); f.rectangle(40, 20, 55, 70);
    const r = f.run();
    expect(r.candidates).toHaveLength(1);
    expect(r.candidates[0]).toMatchObject({ x: 48, y: 70, width: 16 });
    expect(r.candidates[0].neighborhood.forwardExtent).toBeNull();
    expect(r.candidates[0].forwardBand?.medianWidth).toBeNull();
    expect(r.candidates[0].forwardBand?.status).toBe("insufficient-evidence");
  });

  it("splits three distal lobes even when they share a single palm component", () => {
    const f = fixture(); f.rectangle(20, 15, 80, 35);
    f.rectangle(20, 35, 31, 65); f.rectangle(42, 35, 53, 75); f.rectangle(64, 35, 75, 60);
    const r = f.run();
    expect(r.components).toHaveLength(1);
    expect(r.candidates.map(({ x, y }) => ({ x, y }))).toEqual([{ x: 26, y: 65 }, { x: 48, y: 75 }, { x: 70, y: 60 }]);
  });

  it("rejects empty reference, neutral shadow, small speckles and a broad palm", () => {
    const f = fixture(); expect(f.run().candidates).toEqual([]);
    f.rectangle(10, 10, 15, 15); f.rectangle(30, 40, 80, 70, [120, 120, 120]);
    expect(f.run().candidates).toEqual([]);
    f.rectangle(20, 30, 80, 70);
    expect(f.run().candidates).toEqual([]);
  });

  it("reports forward shadow and side/back evidence separately, without zero for missing evidence", () => {
    const f = fixture(); f.rectangle(40, 20, 55, 70);
    f.rectangle(40, 71, 55, 75, [120, 120, 120]);
    f.rectangle(36, 55, 39, 70, [120, 120, 120]);
    const c = f.run().candidates[0];
    expect(c.forwardBand?.medianWidth).toBe(5);
    expect(c.neighborhood).toMatchObject({ forwardExtent: 5, behindExtent: 15, forwardCensored: false, behindCensored: false });
  });

  it("preserves censored scans and unknown reference evidence", () => {
    const f = fixture(); f.rectangle(40, 20, 55, 70);
    f.rectangle(40, 71, 55, 99, [120, 120, 120]);
    f.reference.data.fill(0, (60 * 100 + 35) * 4, (60 * 100 + 40) * 4);
    const c = f.run().candidates[0];
    expect(c.forwardBand?.medianWidth).toBeNull();
    expect(c.forwardBand?.rays.every((ray) => ray.status === "censored")).toBe(true);
    expect(c.neighborhood.forwardCensored).toBe(true);
    expect(c.neighborhood.unknownPixels).toBeGreaterThan(0);
  });

  it("does not invent multiple tips on a merged flat silhouette or accept an image-clipped tip", () => {
    const f = fixture(); f.rectangle(40, 20, 63, 70);
    expect(f.run().candidates).toHaveLength(1);
    f.rectangle(40, 70, 63, 99);
    expect(f.run().candidates).toEqual([]);
  });

  it("is deterministic and leaves input pixels and measurements unchanged", () => {
    const f = fixture(); f.rectangle(40, 20, 55, 70);
    const before = f.current.data.slice();
    const d = measureShadowDifference(f.current, f.reference)!;
    const luma = d.lumaDrop.slice();
    expect(estimateFingertips(f.current, d)).toEqual(estimateFingertips(f.current, d));
    expect(f.current.data).toEqual(before); expect(d.lumaDrop).toEqual(luma);
  });

  it("rejects incompatible dimensions and invalid/unbounded settings", () => {
    const f = fixture(); const d = measureShadowDifference(f.current, f.reference)!;
    expect(estimateFingertips({ ...f.current, width: 99 }, d)).toBeNull();
    for (const scanDistance of [0, 65, NaN, 1.5]) expect(estimateFingertips(f.current, d, { ...DEFAULT_FINGERTIP_OPTIONS, scanDistance })).toBeNull();
    expect(estimateFingertips(f.current, d, { ...DEFAULT_FINGERTIP_OPTIONS, minimumSeparation: 0 })).toBeNull();
  });
});


describe("automatic filtered-boundary fingertip proposals", () => {
  const run = (f: ReturnType<typeof fixture>) => identifyFilteredFingertips(measureShadowDifference(f.current, f.reference)!)!;
  it("finds a fingertip directly from filter-rejected geometry without saved anchors or reddish clusters", () => {
    const f = fixture(); f.rectangle(40, 20, 55, 70, [75, 95, 150]);
    expect(f.run().candidates).toHaveLength(0);
    const r = run(f);
    expect(r.candidates).toHaveLength(1);
    expect(r.candidates[0]).toMatchObject({ x: 48, y: 70, width: 16 });
    expect(r.segmentation).toBe("filtered-darkening"); expect(r.clusters).toEqual([]);
  });
  it("finds multiple anonymous tips sharing one component and numbers them spatially", () => {
    const f = fixture(); f.rectangle(20, 15, 80, 35);
    f.rectangle(20, 35, 31, 65); f.rectangle(42, 35, 53, 75); f.rectangle(64, 35, 75, 60);
    const r = run(f);
    expect(r.components).toHaveLength(1);
    expect(r.candidates.map(({ id, x, y }) => ({ id, x, y }))).toEqual([{ id: 1, x: 26, y: 65 }, { id: 2, x: 48, y: 75 }, { id: 3, x: 70, y: 60 }]);
  });
  it("rejects reference self-comparison, neutral shadow and small/broad/clipped proposals", () => {
    const f = fixture(); expect(run(f).candidates).toEqual([]);
    f.rectangle(30, 20, 70, 70, [120, 120, 120]);
    f.rectangle(10, 10, 15, 15);
    expect(run(f).candidates).toEqual([]);
    f.rectangle(20, 30, 80, 70); expect(run(f).candidates).toEqual([]);
    const clipped = fixture(); clipped.rectangle(40, 20, 55, 99);
    expect(run(clipped).candidates).toEqual([]);
  });
  it("uses exactly the DFS boundary mask and leaves neutral side shadow outside it", () => {
    const f = fixture(); f.rectangle(40, 20, 55, 70);
    f.rectangle(34, 50, 39, 70, [120, 120, 120]);
    const d = measureShadowDifference(f.current, f.reference)!;
    const r = identifyFilteredFingertips(d)!;
    expect(r.mask).toEqual(filteredDarkeningBoundaryMask(d));
    expect(r.candidates[0]).toMatchObject({ x: 48, y: 70, width: 16 });
    expect(r.mask[60 * 100 + 38]).toBe(0);
  });
  it("keeps invalid references, unknown color and near-black pixels out of geometry", () => {
    const f = fixture(); f.rectangle(40, 20, 55, 70);
    const d = measureShadowDifference(f.current, f.reference)!;
    for (let i = 0; i < d.valid.length; i += 1) {
      if (i % 3 === 0) d.valid[i] = 0;
      if (i % 3 === 1) d.projectionValid[i] = 0;
      if (i % 3 === 2) d.residualCurrent[i] = NaN;
    }
    expect(identifyFilteredFingertips(d)!.candidates).toEqual([]);
    expect(identifyFilteredFingertips(d)!.mask.some(Boolean)).toBe(false);
    const black = fixture(); black.rectangle(40, 20, 55, 70, [0, 0, 0]);
    expect(run(black).candidates).toEqual([]);
  });
  it("is deterministic, preserves inputs and supports either raw color filter", () => {
    const f = fixture(); f.rectangle(40, 20, 55, 70);
    const d = measureShadowDifference(f.current, f.reference)!; const before = d.lumaDrop.slice();
    expect(identifyFilteredFingertips(d)).toEqual(identifyFilteredFingertips(d));
    expect(d.lumaDrop).toEqual(before);
    expect(identifyFilteredFingertips(d, { filter: { method: "color", maximumColorShift: 10, maximumResidual: 0.12 } })!.candidates).toHaveLength(1);
  });
  it("rejects incompatible arrays and invalid bounded settings", () => {
    const f = fixture(); const d = measureShadowDifference(f.current, f.reference)!;
    expect(identifyFilteredFingertips({ ...d, width: 0 })).toBeNull();
    expect(identifyFilteredFingertips({ ...d, valid: new Uint8Array(1) })).toBeNull();
    for (const scanDistance of [0, 65, NaN, 1.5]) expect(identifyFilteredFingertips(d, { scanDistance })).toBeNull();
    expect(identifyFilteredFingertips(d, { minimumSeparation: 0 })).toBeNull();
    expect(identifyFilteredFingertips(d, { maximumFingerWidth: Infinity })).toBeNull();
  });
});


describe("strict plateau peaks and local finger lobes", () => {
  const run = (f: ReturnType<typeof fixture>) => identifyFilteredFingertips(measureShadowDifference(f.current, f.reference)!)!;
  const adjacent = (valley: number) => {
    const f = fixture(); f.rectangle(10, 15, 75, 35);
    f.rectangle(15, 35, 43, 80);
    f.rectangle(44, 35, 45, valley);
    f.rectangle(46, 35, 49, 61);
    f.rectangle(50, 35, 64, 62);
    f.rectangle(65, 35, 70, 55);
    return f;
  };
  it("does not treat rising and descending plateau shoulders as additional tips", () => {
    const f = fixture();
    for (let x = 30; x <= 59; x += 1) {
      const bottom = x <= 37 ? 50 : x <= 41 ? 50 + (x - 37) * 5 : x <= 47 ? 72 : 72 - (x - 47);
      f.rectangle(x, 15, x, bottom);
    }
    const r = run(f);
    expect(r.candidates).toHaveLength(1);
    expect(r.candidates[0].y).toBe(72);
    expect(r.candidates[0].x).toBeGreaterThanOrEqual(42);
    expect(r.candidates[0].x).toBeLessThanOrEqual(47);
  });
  it("retains a shorter touching finger with a two-pixel raw valley and measures its own lobe", () => {
    const f = adjacent(60); const r = run(f);
    expect(r.candidates).toHaveLength(2);
    const shorter = r.candidates.find((c) => c.y === 62)!;
    expect(shorter).toBeDefined();
    expect(shorter.prominence).toBe(2);
    expect(shorter.width).toBeLessThanOrEqual(30);
    expect(shorter.lobeBounds!.left).toBeGreaterThanOrEqual(44);
    expect(r.mask).toEqual(filteredDarkeningBoundaryMask(measureShadowDifference(f.current, f.reference)!));
  });
  it("still rejects a shorter shoulder with less than the fixed two-pixel prominence", () => {
    const r = run(adjacent(61));
    expect(r.candidates).toHaveLength(1);
    expect(r.candidates[0].y).toBe(80);
  });
  it("retains distinct narrow fingertips fourteen pixels apart instead of enlarging duplicate suppression", () => {
    const f = fixture(); f.rectangle(25, 15, 46, 30);
    f.rectangle(25, 30, 32, 70); f.rectangle(39, 30, 46, 70);
    const r = run(f);
    expect(r.candidates).toHaveLength(2);
    expect(r.candidates[1].x-r.candidates[0].x).toBe(14);
  });
});
