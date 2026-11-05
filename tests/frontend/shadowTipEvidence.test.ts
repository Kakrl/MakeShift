import { describe, expect, it } from "vitest";
import { measureShadowDifference } from "../../frontend/src/cv/shadowHeatmap";
import { filteredDarkeningBoundaryMask, measureMonotoneShadowPaths, measureEdgeShadowRegions, measureDirectionalShadowPattern, measureTipShadowEvidence } from "../../frontend/src/cv/shadowTipEvidence";

function fixture() {
  const width = 80; const height = 100; const count = width * height;
  const data = new Uint8ClampedArray(count * 4).fill(230);
  for (let i = 3; i < data.length; i += 4) data[i] = 255;
  const reference = { width, height, data: data.slice() } as ImageData;
  const current = { width, height, data } as ImageData;
  const mask = new Uint8Array(count); const tip = { x: 40, y: 60, width: 20 };
  const paint = (x: number, y: number, rgb = [150, 150, 150]) => data.set([...rgb, 255], (y * width + x) * 4);
  const finger = (edge: (x: number) => number = () => 60) => {
    for (let x = 30; x <= 49; x += 1) for (let y = 10; y <= edge(x); y += 1) { mask[y * width + x] = 1; paint(x, y, [150, 95, 75]); }
  };
  const difference = () => measureShadowDifference(current, reference)!;
  const run = () => measureTipShadowEvidence(difference(), mask, tip)!;
  return { width, current, mask, tip, paint, finger, difference, run };
}

describe("static shadow evidence around an estimated finger boundary", () => {
  it("measures a known attached forward band independently of side/back shadow", () => {
    const f = fixture(); f.finger();
    for (let x = 30; x <= 49; x += 1) for (let y = 61; y <= 68; y += 1) f.paint(x, y);
    const before = f.run();
    for (let x = 24; x <= 29; x += 1) for (let y = 36; y <= 60; y += 1) f.paint(x, y);
    const after = f.run();
    expect(after.levels.map((l) => l.medianExtent)).toEqual([8, 8, 8, 8]);
    expect(after.levels).toEqual(before.levels);
    expect(after.sideBack.meanDrop).toBeGreaterThan(before.sideBack.meanDrop!);
    expect(after.sideBack.reachesBackLimit).toBe(true);
    expect(after.forwardNear.meanDrop).toBeCloseTo(80);
    expect(after.tipMeanDrop).toBeGreaterThan(80);
  });

  it("anchors every ray on its own curved boundary rather than a flat tip row", () => {
    const f = fixture(); const edge = (x: number) => 60 - Math.abs(x - 40);
    f.finger(edge);
    for (let x = 30; x <= 49; x += 1) for (let d = 1; d <= 4; d += 1) f.paint(x, edge(x) + d);
    const r = f.run();
    expect(r.rays.map((ray) => ray.boundary)).toEqual([55, 56, 57, 58, 59, 60, 59, 58, 57, 56, 55]);
    expect(r.levels.map((l) => l.medianExtent)).toEqual([4, 4, 4, 4]);
  });

  it("distinguishes known clear paper at each intensity cutoff from unavailable evidence", () => {
    const f = fixture(); f.finger();
    for (let x = 30; x <= 49; x += 1) for (let y = 61; y <= 70; y += 1) f.paint(x, y, [220, 220, 220]);
    expect(f.run().levels.map((l) => l.medianExtent)).toEqual([10, 0, 0, 0]);
    const d = f.difference();
    for (let x = 35; x <= 45; x += 1) d.valid[61 * f.width + x] = 0;
    const r = measureTipShadowEvidence(d, f.mask, f.tip)!;
    expect(r.levels.every((l) => l.medianExtent === null && l.ambiguousRays === l.totalRays)).toBe(true);
  });

  it("keeps color-mismatched/occluding and weak-signal boundaries ambiguous", () => {
    const f = fixture(); f.finger();
    for (let x = 35; x <= 45; x += 1) f.paint(x, 61, [150, 70, 50]);
    expect(f.run().levels.every((l) => l.medianExtent === null)).toBe(true);
    const d = f.difference();
    for (let x = 35; x <= 45; x += 1) d.projectionValid[61 * f.width + x] = 0;
    expect(measureTipShadowEvidence(d, f.mask, f.tip)!.levels.every((l) => l.medianExtent === null)).toBe(true);
  });

  it("retains scan-limit lower bounds rather than declaring a complete width", () => {
    const f = fixture(); f.finger();
    for (let x = 30; x <= 49; x += 1) for (let y = 61; y <= 90; y += 1) f.paint(x, y);
    const r = f.run();
    expect(r.levels.every((l) => l.medianExtent === null && l.censoredRays === l.totalRays)).toBe(true);
    expect(r.rays[0].levels.every((l) => l.lowerBound === 24)).toBe(true);
  });

  it("allows the fixed two-pixel attachment gap but separates distant strong evidence", () => {
    const f = fixture(); f.finger();
    for (let x = 30; x <= 49; x += 1) for (let y = 63; y <= 66; y += 1) f.paint(x, y);
    expect(f.run().levels.map((l) => l.medianExtent)).toEqual([6, 6, 6, 6]);
    for (let x = 30; x <= 49; x += 1) { f.paint(x, 63, [230, 230, 230]); f.paint(x, 64, [230, 230, 230]); }
    const r = f.run();
    expect(r.levels.map((l) => l.medianExtent)).toEqual([0, 0, 0, 0]);
    expect(r.rays.every((ray) => ray.levels.every((l) => l.detachedStrongEvidence))).toBe(true);
  });

  it("preserves missing boundaries and invalid inputs as unavailable", () => {
    const f = fixture(); const d = f.difference();
    const r = measureTipShadowEvidence(d, f.mask, f.tip)!;
    expect(r.tipMeanDrop).toBeNull(); expect(r.forwardNear.meanDrop).toBeNull();
    expect(r.levels.every((l) => l.medianExtent === null)).toBe(true);
    expect(measureTipShadowEvidence(d, new Uint8Array(1), f.tip)).toBeNull();
    for (const tip of [{ ...f.tip, x: -1 }, { ...f.tip, y: 1.5 }, { ...f.tip, width: Infinity }])
      expect(measureTipShadowEvidence(d, f.mask, tip)).toBeNull();
    expect(measureTipShadowEvidence(d, f.mask, f.tip, { method: "projection", maximumColorShift: 10, maximumResidual: NaN })).toBeNull();
  });

  it("requires majority ray availability and preserves image-edge censoring", () => {
    const f = fixture(); f.finger();
    const d = f.difference();
    for (let x = 35; x <= 36; x += 1) d.valid[61 * f.width + x] = 0;
    expect(measureTipShadowEvidence(d, f.mask, f.tip)!.levels[2]).toMatchObject({ medianExtent: 0, completeRays: 9, ambiguousRays: 2 });
    for (let x = 37; x <= 40; x += 1) d.valid[61 * f.width + x] = 0;
    expect(measureTipShadowEvidence(d, f.mask, f.tip)!.levels[2].medianExtent).toBeNull();
    f.mask.fill(0);
    for (let x = 30; x <= 49; x += 1) {
      for (let y = 70; y <= 95; y += 1) f.mask[y * f.width + x] = 1;
      for (let y = 96; y <= 99; y += 1) f.paint(x, y);
    }
    const edge = measureTipShadowEvidence(f.difference(), f.mask, { ...f.tip, y: 95 })!;
    expect(edge.levels.every((l) => l.medianExtent === null && l.censoredRays === l.totalRays)).toBe(true);
  });
});


describe("upward shadow and clear downward fan hypothesis", () => {
  const run = (f: ReturnType<typeof fixture>) => measureDirectionalShadowPattern(f.difference(), f.mask, f.tip)!;
  const upward = (f: ReturnType<typeof fixture>) => {
    for (let x = 24; x <= 29; x += 1) for (let y = 36; y <= 55; y += 1) f.paint(x, y);
  };
  it("matches a thin rim with upward evidence, but rejects clear paper alone", () => {
    const f = fixture(); f.finger();
    expect(run(f).levels.every((l) => l.patternMatch === false)).toBe(true);
    upward(f);
    for (let x = 30; x <= 49; x += 1) f.paint(x, 61);
    const r = run(f);
    expect(r.levels.every((l) => l.upwardPresent && l.thinBand && l.downwardClear && l.patternMatch)).toBe(true);
  });
  it("rejects a diagonal lobe missed by the central strip", () => {
    const f = fixture(); f.finger(); upward(f);
    // Far right of the original central x=35..45 strip, on the +60 degree ray.
    for (let x = 53; x <= 59; x += 1) for (let y = 64; y <= 69; y += 1) f.paint(x, y);
    expect(f.run().levels[2].medianExtent).toBe(0);
    const l = run(f).levels[2];
    expect(l.thinBand).toBe(true);
    expect(l.downwardClear).toBe(false);
    expect(l.patternMatch).toBe(false);
  });
  it("keeps unknown, occluded and censored forward evidence unavailable", () => {
    const f = fixture(); f.finger(); upward(f);
    const d = f.difference(); d.valid[70 * f.width + 40] = 0;
    expect(measureDirectionalShadowPattern(d, f.mask, f.tip)!.levels[2].patternMatch).toBeNull();
    f.paint(40, 70, [150, 70, 50]);
    expect(run(f).levels[2].downwardClear).toBeNull();
    expect(measureDirectionalShadowPattern(d, new Uint8Array(1), f.tip)).toBeNull();
    expect(measureDirectionalShadowPattern(d, f.mask, { ...f.tip, y: 95 })!.levels[2].downwardClear).toBeNull();
  });
  it("reports all cutoffs without treating weak forward shadow as absent at every cutoff", () => {
    const f = fixture(); f.finger(); upward(f);
    for (let x = 30; x <= 49; x += 1) for (let y = 61; y <= 68; y += 1) f.paint(x, y, [200, 200, 200]);
    const r = run(f);
    expect(r.levels.map((l) => l.patternMatch)).toEqual([false, false, true, true]);
    expect(r.levels[0].thinBand).toBe(false);
  });
  it("requires upward evidence on multiple rows and retains unavailable upward coverage", () => {
    const f = fixture(); f.finger();
    for (let x = 24; x <= 29; x += 1) f.paint(x, 50);
    expect(run(f).levels[2].upwardPresent).toBe(false);
    const d = f.difference();
    for (let y = 36; y <= 57; y += 1) for (let x = 24; x <= 55; x += 1) if (!f.mask[y * f.width + x]) d.valid[y * f.width + x] = 0;
    expect(measureDirectionalShadowPattern(d, f.mask, f.tip)!.levels[2].upwardPresent).toBeNull();
  });
});


describe("at least one connected distal shadow region", () => {
  const run = (f: ReturnType<typeof fixture>) => measureEdgeShadowRegions(f.difference(), f.mask, f.tip)!;
  const left = (f: ReturnType<typeof fixture>, bottom = 64, width = 2) => {
    for (let x = 30 - width; x <= 29; x += 1) for (let y = 50; y <= bottom; y += 1) f.paint(x, y);
    for (let x = 30; x <= 36; x += 1) for (let y = 61; y <= bottom; y += 1) f.paint(x, y);
  };
  it("accepts one short region with upward width even when another shadow is long", () => {
    const f = fixture(); f.finger(); left(f);
    for (let x = 50; x <= 52; x += 1) for (let y = 52; y <= 80; y += 1) f.paint(x, y);
    const l = run(f).levels[2];
    expect(l.regions).toHaveLength(2);
    expect(l.regions.some((r) => r.downwardExtent > 8 && r.patternMatch === false)).toBe(true);
    expect(l.qualifyingRegions).toHaveLength(1);
    expect(l.patternMatch).toBe(true);
  });
  it("requires actual attached shadow and never accepts clear paper alone", () => {
    const f = fixture(); f.finger();
    expect(run(f).levels.every((l) => l.patternMatch === false && !l.regions.length)).toBe(true);
    for (let x = 24; x <= 27; x += 1) for (let y = 48; y <= 60; y += 1) f.paint(x, y);
    expect(run(f).levels[2].patternMatch).toBe(false);
  });
  it("accepts eight downward pixels but rejects nine on the same connected region", () => {
    const f = fixture(); f.finger(); left(f, 68);
    expect(run(f).levels[2].patternMatch).toBe(true);
    left(f, 69);
    expect(run(f).levels[2].patternMatch).toBe(false);
  });
  it("requires contiguous upward width and upward evidence from the same component", () => {
    const f = fixture(); f.finger(); left(f, 64, 1);
    expect(run(f).levels[2].patternMatch).toBe(false);
    for (let x = 51; x <= 53; x += 1) for (let y = 40; y <= 48; y += 1) f.paint(x, y);
    expect(run(f).levels[2].patternMatch).toBe(false);
    left(f);
    expect(run(f).levels[2].patternMatch).toBe(true);
  });
  it("keeps an unknown downward endpoint unavailable without vetoing another valid region", () => {
    const f = fixture(); f.finger(); left(f);
    const d = f.difference(); d.valid[65 * f.width + 29] = 0;
    expect(measureEdgeShadowRegions(d, f.mask, f.tip)!.levels[2].patternMatch).toBeNull();
    for (let x = 50; x <= 51; x += 1) for (let y = 50; y <= 64; y += 1) f.paint(x, y);
    const other = f.difference(); other.valid[65 * f.width + 29] = 0;
    expect(measureEdgeShadowRegions(other, f.mask, f.tip)!.levels[2].patternMatch).toBe(true);
  });
  it("rejects a shared long component instead of cropping away its downward extension", () => {
    const f = fixture(); f.finger(); left(f);
    for (let x = 37; x <= 52; x += 1) for (let y = 61; y <= 64; y += 1) f.paint(x, y);
    for (let x = 50; x <= 52; x += 1) for (let y = 61; y <= 90; y += 1) f.paint(x, y);
    const l = run(f).levels[2];
    expect(l.regions).toHaveLength(1);
    expect(l.regions[0].reachesDownwardLimit).toBe(true);
    expect(l.patternMatch).toBe(false);
  });
  it("reports all fixed intensity cutoffs and preserves invalid/missing boundaries", () => {
    const f = fixture(); f.finger(); left(f);
    for (let x = 28; x <= 29; x += 1) for (let y = 50; y <= 64; y += 1) f.paint(x, y, [200, 200, 200]);
    for (let x = 30; x <= 36; x += 1) for (let y = 61; y <= 64; y += 1) f.paint(x, y, [200, 200, 200]);
    expect(run(f).levels.map((l) => l.patternMatch)).toEqual([true, true, false, false]);
    expect(measureEdgeShadowRegions(f.difference(), new Uint8Array(1), f.tip)).toBeNull();
    f.mask.fill(0);
    expect(run(f).levels.every((l) => l.patternMatch === null)).toBe(true);
  });
});


describe("bounded monotone DFS from the lower fingertip arc", () => {
  const left = (f: ReturnType<typeof fixture>, bottom = 62) => {
    for (let x = 28; x <= 29; x += 1) for (let y = 50; y <= bottom; y += 1) f.paint(x, y);
    for (let x = 30; x <= 36; x += 1) for (let y = 61; y <= bottom; y += 1) f.paint(x, y);
  };
  const run = (f: ReturnType<typeof fixture>) => measureMonotoneShadowPaths(f.difference(), f.mask, f.tip)!;
  it("requires real attached shadow with an upward path and no downward reach", () => {
    const f = fixture(); f.finger();
    expect(run(f).levels.every((l) => l.patternMatch === false)).toBe(true);
    left(f);
    const r = run(f);
    expect(r.settings).toMatchObject({ c: 4, d: 4, e: 4, searchWidth: 20 });
    expect(r.aY).toBe(56); expect(r.upwardY).toBe(52); expect(r.downwardY).toBe(64);
    expect(r.levels.every((l) => l.patternMatch === true && l.upwardReached && !l.downwardVeto)).toBe(true);
    expect(r.levels[2].upwardSearches.find((s) => s.reached)!.path.every((p, i, a) => !i || p.y <= a[i - 1].y)).toBe(true);
  });
  it("lets a later attachment veto an earlier upward success", () => {
    const f = fixture(); f.finger(); left(f);
    for (let x = 50; x <= 51; x += 1) for (let y = 54; y <= 68; y += 1) f.paint(x, y);
    const l = run(f).levels[2];
    expect(l.upwardReached).toBe(true); expect(l.downwardVeto).toBe(true); expect(l.patternMatch).toBe(false);
    expect(l.rejectionPixel!.y).toBeGreaterThanOrEqual(64);
    expect(l.downwardSearches.find((s) => s.reached)!.path.every((p, i, a) => !i || p.y >= a[i - 1].y)).toBe(true);
  });
  it("rejects exactly at d pixels below the tip, while a d-1 rim can pass", () => {
    const f = fixture(); f.finger(); left(f, 63);
    expect(run(f).levels[2].patternMatch).toBe(true);
    left(f, 64);
    expect(run(f).levels[2].patternMatch).toBe(false);
  });
  it("does not climb upward to find a downward lobe", () => {
    const f = fixture(); f.finger();
    for (const [x, y] of [[29, 60], [28, 60], [27, 59], [26, 58], [25, 59]]) f.paint(x, y);
    for (let y = 60; y <= 66; y += 1) f.paint(24, y);
    // The connected path to x24,y64 must first climb to y58.
    expect(run(f).levels[2].downwardVeto).toBe(false);
  });
  it("bounds sideways drift and stops at the width cap without UNKNOWN", () => {
    const f = fixture(); f.finger();
    for (let x = 24; x <= 29; x += 1) f.paint(x, 60);
    for (let y = 48; y <= 60; y += 1) f.paint(24, y);
    const d = f.difference();
    const narrow = measureMonotoneShadowPaths(d, f.mask, f.tip, undefined, { searchWidth: 2 })!;
    const wide = measureMonotoneShadowPaths(d, f.mask, f.tip, undefined, { searchWidth: 16 })!;
    expect(narrow.levels[2].patternMatch).toBe(false);
    expect(narrow.levels[2].upwardUnknown).toBe(false);
    expect(wide.levels[2].patternMatch).toBe(true);
    for (const s of wide.levels[2].upwardSearches) expect(s.visited.every((p) => p.x >= s.minimumX && p.x <= s.maximumX)).toBe(true);
  });
  it("uses c to exclude side attachments above the selected arc", () => {
    const f = fixture(); f.finger();
    for (let x = 28; x <= 29; x += 1) for (let y = 48; y <= 54; y += 1) f.paint(x, y);
    expect(run(f).levels[2].patternMatch).toBe(false);
    expect(measureMonotoneShadowPaths(f.difference(), f.mask, f.tip, undefined, { c: 8 })!.levels[2].patternMatch).toBe(true);
  });
  it("distinguishes unreadable pixels from known filter exclusions", () => {
    const f = fixture(); f.finger(); left(f);
    const d = f.difference(); d.valid[63 * f.width + 29] = 0;
    expect(measureMonotoneShadowPaths(d, f.mask, f.tip)!.levels[2].patternMatch).toBeNull();
    f.paint(29, 63, [150, 70, 50]);
    expect(run(f).levels[2].patternMatch).toBe(true);
  });
  it("keeps geometry/invalid settings unavailable and reports every cutoff", () => {
    const f = fixture(); f.finger(); left(f);
    for (let i = 0; i < f.current.data.length; i += 4) if (f.current.data[i] === 150 && f.current.data[i + 1] === 150) f.current.data.set([200, 200, 200], i);
    expect(run(f).levels.map((l) => l.patternMatch)).toEqual([true, true, false, false]);
    expect(measureMonotoneShadowPaths(f.difference(), f.mask, f.tip, undefined, { c: 0 })).toBeNull();
    expect(measureMonotoneShadowPaths(f.difference(), f.mask, f.tip, undefined, { searchWidth: 0 })).toBeNull();
    expect(measureMonotoneShadowPaths(f.difference(), new Uint8Array(1), f.tip)).toBeNull();
    f.mask.fill(0); expect(run(f).levels[2].patternMatch).toBeNull();
  });
});


describe("paired DFS starting points", () => {
  const setup = () => {
    const f = fixture(); f.finger();
    for (let y = 48; y <= 64; y++) f.paint(29, y);
    return f;
  };
  const run = (f: ReturnType<typeof fixture>) => measureMonotoneShadowPaths(
    f.difference(), f.mask, f.tip, undefined, { corridorRadius: 4 })!.levels[2];

  it("returns NO PRESS when every usable starting point reaches both lines", () => {
    const level = run(setup());
    expect(level.ignoredSeeds.length).toBeGreaterThan(0);
    expect(level.downwardSearches.every(s => s.reached && s.ignored)).toBe(true);
    expect(level.upwardSearches.every(s => s.reached && s.ignored)).toBe(true);
    expect(level.downwardVeto).toBe(false); expect(level.upwardReached).toBe(false);
    expect(level.downwardUnknown).toBe(false); expect(level.upwardUnknown).toBe(false);
    expect(level.patternMatch).toBe(false);
    expect(level.rejectionPixel).toBeNull(); expect(level.supportingPixel).toBeNull();
  });

  it("keeps upward-only support from another point after ignoring a both-target point", () => {
    const f = setup();
    for (let y = 48; y <= 62; y++) f.paint(50, y);
    const level = run(f);
    expect(level.ignoredSeeds.length).toBeGreaterThan(0);
    expect(level.upwardReached).toBe(true); expect(level.downwardVeto).toBe(false);
    expect(level.supportingPixel?.x).toBe(50); expect(level.patternMatch).toBe(true);
    const support = level.upwardSearches.find(s => !s.ignored && s.reached)!;
    expect(level.downwardSearches.find(s => s.seed.x === support.seed.x && s.seed.y === support.seed.y)?.reached).toBe(false);
  });

  it("retains a downward-only veto at another point in the same connected shadow", () => {
    const f = setup();
    for (let x = 30; x <= 40; x++) f.paint(x, 61);
    for (let y = 61; y <= 64; y++) f.paint(40, y);
    const level = run(f);
    expect(level.ignoredSeeds.length).toBeGreaterThan(0);
    expect(level.downwardVeto).toBe(true); expect(level.patternMatch).toBe(false);
    const veto = level.downwardSearches.find(s => !s.ignored && s.reached)!;
    expect(level.upwardSearches.find(s => s.seed.x === veto.seed.x && s.seed.y === veto.seed.y)?.reached).toBe(false);
    expect(veto.seed.x).toBeGreaterThanOrEqual(39);
  });
});

describe("five-pixel width on an upward support path", () => {
  const setup = () => {
    const f = fixture(); f.finger();
    for (let y = 52; y <= 60; y++) f.paint(29, y);
    return f;
  };
  const run = (f: ReturnType<typeof fixture>, options = {}) => measureMonotoneShadowPaths(
    f.difference(), f.mask, f.tip, undefined,
    { corridorRadius: 9, minimumUpwardShadowWidth: 5, ...options })!.levels[2];

  it("rejects thin growth even when it reaches the upward row", () => {
    const level = run(setup());
    expect(level.upwardSearches.some(s => s.targetReached)).toBe(true);
    expect(level.upwardReached).toBe(false); expect(level.patternMatch).toBe(false);
    expect(level.upwardUnknown).toBe(false);
  });

  it("requires at least five contiguous pixels and exports a width witness on the successful path", () => {
    const f = setup();
    for (let x = 26; x <= 29; x++) f.paint(x, 54);
    expect(run(f).upwardReached).toBe(false);
    f.paint(25, 54);
    const level = run(f);
    expect(level.upwardReached).toBe(true); expect(level.patternMatch).toBe(true);
    const search = level.upwardSearches.find(s => s.reached)!;
    expect(search.widthWitness).toEqual({ left: 25, right: 29, y: 54, width: 5 });
    expect(search.path.some(p => p.y === 54 && p.x >= 25 && p.x <= 29)).toBe(true);
  });

  it("does not count color-excluded, masked or out-of-window pixels toward the five", () => {
    const f = setup(); for (let x = 25; x <= 29; x++) f.paint(x, 54);
    expect(run(f, { searchWidth: 4 }).upwardReached).toBe(false);
    expect(run(f, { corridorRadius: 1 }).upwardReached).toBe(false);
    f.paint(27, 54, [150, 70, 50]);
    expect(run(f).upwardReached).toBe(false);
    f.paint(27, 54); f.mask[54 * f.width + 27] = 1;
    expect(run(f).upwardReached).toBe(false);
  });

  it("does not borrow width from above the support row or a disconnected patch", () => {
    const f = setup();
    for (let x = 25; x <= 29; x++) f.paint(x, 51);
    for (let x = 21; x <= 25; x++) f.paint(x, 56);
    const level = run(f);
    expect(level.upwardSearches.some(s => s.targetReached)).toBe(true);
    expect(level.upwardReached).toBe(false);
    expect(level.upwardSearches.every(s => s.visited.every(p => p.y >= 52))).toBe(true);
  });

  it("can revisit a thinly explored junction after a different route obtains width evidence", () => {
    const f = setup();
    for (const [x, y] of [[28, 59], [27, 58], [26, 57], [27, 56], [28, 55]]) f.paint(x, y);
    for (let x = 23; x <= 27; x++) f.paint(x, 57);
    const level = run(f);
    const search = level.upwardSearches.find(s => s.seed.x === 29 && s.seed.y === 60)!;
    expect(search.reached).toBe(true); expect(search.widthWitness?.y).toBe(57);
    expect(search.path.some(p => p.y === 57 && p.x <= 27)).toBe(true);
    expect(search.endpoint?.y).toBe(52);
  });

  it("keeps downward reach independent of upward width and validates width settings", () => {
    const f = setup(); for (let y = 58; y <= 64; y++) f.paint(50, y);
    const level = run(f);
    expect(level.downwardVeto).toBe(true); expect(level.upwardReached).toBe(false);
    expect(level.ignoredSeeds).toHaveLength(0);
    for (const minimumUpwardShadowWidth of [0, 1.5, 129, NaN]) {
      expect(measureMonotoneShadowPaths(f.difference(), f.mask, f.tip, undefined, { minimumUpwardShadowWidth })).toBeNull();
    }
  });
});

describe("filtered darkening boundary proposal", () => {
  it("excludes unchanged paper, neutral shadows and unavailable black pixels", () => {
    const f = fixture(); f.finger();
    f.paint(29, 60); // Neutral darkening remains exposed shadow, not geometry.
    const d = f.difference();
    d.valid[40 * f.width + 40] = 0;
    d.projectionValid[41 * f.width + 40] = 0;
    d.residualCurrent[42 * f.width + 40] = NaN;
    const mask = filteredDarkeningBoundaryMask(d);
    expect(mask[60 * f.width + 40]).toBe(1);
    expect(mask[60 * f.width + 29]).toBe(0);
    expect(mask[70 * f.width + 40]).toBe(0);
    for (const y of [40, 41, 42]) expect(mask[y * f.width + 40]).toBe(0);
    expect(d.valid[60 * f.width + 40]).toBe(1);
  });

  it("uses raw filter rejection and a fixed strict darkening floor", () => {
    const f = fixture(); const d = f.difference();
    const i = 60 * f.width + 40;
    d.lumaDrop[i] = 6; d.residualCurrent[i] = 0.2; d.colorShift[i] = 9;
    expect(filteredDarkeningBoundaryMask(d)[i]).toBe(1);
    expect(filteredDarkeningBoundaryMask(d, { method: "color", maximumColorShift: 10, maximumResidual: 0.12 })[i]).toBe(0);
    d.lumaDrop[i] = 5;
    expect(filteredDarkeningBoundaryMask(d)[i]).toBe(0);
  });

  it("removes a neutral side flare from geometry while preserving the saved anchor and width", () => {
    const f = fixture(); f.finger();
    for (let x = 24; x < 30; x += 1) for (let y = 54; y <= 58; y += 1) {
      f.mask[y * f.width + x] = 1; f.paint(x, y);
    }
    const d = f.difference(); const mask = filteredDarkeningBoundaryMask(d);
    const original = measureMonotoneShadowPaths(d, f.mask, f.tip)!;
    const proposed = measureMonotoneShadowPaths(d, mask, f.tip)!;
    expect(original.crossSection.left).toBe(24);
    expect(proposed.crossSection.left).toBe(30);
    expect(proposed.tip).toEqual(original.tip);
    expect(proposed.settings).toEqual(original.settings);
    expect(proposed.arc.every((p) => p.x >= 30 && p.x <= 49)).toBe(true);
  });
});


describe("independent downward shadow strength", () => {
  const setup = () => {
    const f = fixture(); f.finger();
    for (let y = 48; y <= 62; y += 1) f.paint(29, y);
    for (let y = 58; y <= 64; y += 1) f.paint(50, y);
    return f;
  };
  it("breaks a weaker downward path without changing upward support", () => {
    const f = setup(); const d = f.difference();
    const before = measureMonotoneShadowPaths(d, f.mask, f.tip)!;
    const after = measureMonotoneShadowPaths(d, f.mask, f.tip, undefined, { downwardThreshold: 80 })!;
    expect(before.levels[2].downwardVeto).toBe(true);
    expect(after.levels[2].downwardVeto).toBe(false);
    expect(after.levels[2].patternMatch).toBe(true);
    expect(after.levels.map((l) => l.upwardSearches)).toEqual(before.levels.map((l) => l.upwardSearches));
    expect(after.levels.every((l) => l.downwardAttachments.length === 0)).toBe(true);
  });
  it("requires the stronger threshold at seeds and every step, strictly above equality", () => {
    const f = setup(); const d = f.difference();
    for (let y = 58; y <= 64; y += 1) d.lumaDrop[y * f.width + 50] = 100;
    const run = () => measureMonotoneShadowPaths(d, f.mask, f.tip, undefined, { downwardThreshold: 80 })!;
    expect(run().levels.every((l) => l.downwardVeto)).toBe(true);
    d.lumaDrop[63 * f.width + 50] = 80;
    expect(run().levels.every((l) => !l.downwardVeto)).toBe(true);
  });
  it("preserves unknown measurements and rejects invalid downward thresholds", () => {
    const f = setup(); const d = f.difference();
    for (let y = 58; y <= 64; y += 1) d.lumaDrop[y * f.width + 50] = 100;
    d.valid[63 * f.width + 50] = 0;
    expect(measureMonotoneShadowPaths(d, f.mask, f.tip, undefined, { downwardThreshold: 80 })!.levels[2].patternMatch).toBeNull();
    for (const downwardThreshold of [-1, 256, NaN]) expect(measureMonotoneShadowPaths(d, f.mask, f.tip, undefined, { downwardThreshold })).toBeNull();
  });
});


describe("fingertip corridor with X limits only", () => {
  const setup = () => {
    const f = fixture(); f.finger();
    for (let y = 48; y <= 60; y += 1) f.paint(29, y);
    return f;
  };
  it("stops a side excursion without unknown while retaining local upward support", () => {
    const f = setup();
    for (let x = 24; x <= 29; x += 1) f.paint(x, 60);
    for (let y = 60; y <= 64; y += 1) f.paint(24, y);
    const d = f.difference(); d.valid[61 * f.width + 25] = 0; // Outside the band.
    const before = measureMonotoneShadowPaths(d, f.mask, f.tip)!;
    const after = measureMonotoneShadowPaths(d, f.mask, f.tip, undefined, { corridorRadius: 4 })!;
    expect(before.levels[2].downwardSearches.some(s => s.reached)).toBe(true);
    expect(before.levels[2].ignoredSeeds.length).toBeGreaterThan(0);
    expect(after.levels[2].patternMatch).toBe(true);
    expect(after.levels[2].downwardUnknown).toBe(false);
    expect(after.levels[2].downwardSearches.some((s) => s.hitCorridorLimit)).toBe(true);
    const allowed = new Set(after.corridor.map((p) => p.y * f.width + p.x));
    for (const level of after.levels) for (const search of [...level.downwardSearches, ...level.upwardSearches]) {
      expect(search.visited.every((p) => allowed.has(p.y * f.width + p.x))).toBe(true);
    }
  });
  it("still vetoes a real forward path at the inclusive d row without D80", () => {
    const f = setup();
    for (let y = 61; y <= 64; y += 1) f.paint(40, y, [180, 180, 180]);
    const r = measureMonotoneShadowPaths(f.difference(), f.mask, f.tip, undefined, { corridorRadius: 4 })!;
    expect(r.settings.downwardThreshold).toBeNull();
    expect(r.levels.map((l) => l.downwardThreshold)).toEqual([5, 20, 40, 60]);
    expect(r.levels[2].downwardVeto).toBe(true);
    expect(r.levels[2].rejectionPixel).toEqual({ x: 40, y: 64 });
    expect(r.levels[3].downwardVeto).toBe(false);
  });
  it("keeps the arc's horizontal bounds unchanged through the target rows", () => {
    const f = fixture(); f.finger((x) => 60 - Math.abs(x - 40));
    const r = measureMonotoneShadowPaths(f.difference(), f.mask, f.tip, undefined, { corridorRadius: 4 })!;
    expect(r.corridor.some((p) => p.x === 40 && p.y === 64)).toBe(true);
    expect(r.corridor.some((p) => p.x === 36 && p.y === 64)).toBe(true); // Diagonal distance4.
    expect(r.corridorMinimumX).toBe(32); expect(r.corridorMaximumX).toBe(48);
    expect(r.corridor.some((p) => p.x === 32 && p.y === 64)).toBe(true);
    expect(r.corridor.some((p) => p.x === 31 && p.y === 64)).toBe(false);
    expect(r.corridor.every((p) => !f.mask[p.y * f.width + p.x] && p.x >= 32 && p.x <= 48)).toBe(true);
  });
  it("reaches the veto row beside a sloping tip and never searches below it", () => {
    const f = fixture(); f.finger(x => 60 - Math.abs(x - 40));
    // This attached column used to leave the curved band before the veto row.
    for (let y = 56; y <= 68; y++) f.paint(45, y);
    const r = measureMonotoneShadowPaths(f.difference(), f.mask, f.tip, undefined, { corridorRadius: 4 })!;
    for (const level of r.levels) {
      expect(level.downwardVeto).toBe(true); expect(level.patternMatch).toBe(false);
      expect(level.rejectionPixel).toEqual({ x: 45, y: 64 });
      for (const search of level.downwardSearches) expect(search.visited.every(p => p.y <= 64)).toBe(true);
    }
  });
  it("allows upward support beyond the curved band and stops at the support row", () => {
    const f = fixture(); f.finger(x => 60 - Math.abs(x - 40));
    for (let y = 50; y <= 55; y++) f.mask[y * f.width + 35] = 0;
    for (let y = 50; y <= 60; y++) f.paint(35, y);
    for (let x = 35; x <= 39; x++) f.paint(x, 61);
    const r = measureMonotoneShadowPaths(f.difference(), f.mask, f.tip, undefined, { corridorRadius: 1 })!;
    expect(r.levels[2].upwardReached).toBe(true);
    for (const search of r.levels[2].upwardSearches) expect(search.visited.every(p => p.y >= r.upwardY)).toBe(true);
  });
  it("preserves a straight downward shadow to the saved veto row despite a boundary offset", () => {
    const f = setup(); const tip = { ...f.tip, y: f.tip.y + 1 };
    for (let y = 61; y <= 65; y += 1) f.paint(40, y);
    const r = measureMonotoneShadowPaths(f.difference(), f.mask, tip, undefined, { corridorRadius: 4 })!;
    expect(r.corridorReachesDownwardRow).toBe(true);
    expect(r.levels[2].upwardReached).toBe(true);
    expect(r.levels[2].downwardUnknown).toBe(false);
    expect(r.levels[2].downwardVeto).toBe(true);
    expect(r.levels[2].rejectionPixel).toEqual({ x: 40, y: 65 });
    expect(r.levels[2].patternMatch).toBe(false);
  });
  it("retains in-corridor unknowns and validates horizontal margins independently of d/e", () => {
    const f = setup();
    for (let y = 61; y <= 64; y += 1) f.paint(40, y);
    const d = f.difference(); d.valid[63 * f.width + 40] = 0;
    expect(measureMonotoneShadowPaths(d, f.mask, f.tip, undefined, { corridorRadius: 4 })!.levels[2].patternMatch).toBeNull();
    for (const corridorRadius of [1, 3]) expect(measureMonotoneShadowPaths(d, f.mask, f.tip, undefined, { corridorRadius })).not.toBeNull();
    for (const corridorRadius of [0, 4.5, 25, NaN]) expect(measureMonotoneShadowPaths(d, f.mask, f.tip, undefined, { corridorRadius })).toBeNull();
    f.mask.fill(0);
    expect(measureMonotoneShadowPaths(d, f.mask, f.tip, undefined, { corridorRadius: 4 })!.levels[2].patternMatch).toBeNull();
  });
});
