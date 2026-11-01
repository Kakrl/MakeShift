import { describe, expect, it } from "vitest";
import {
  analyzeDarkShadowRegion,
  measureShadowEvidence,
  compareShadowEvidence,
  DEFAULT_DARK_SHADOW_FILTER,
  darkShadowRuns,
  DARK_SHADOW_MAX_RGB_CHANNEL,
  DARK_SHADOW_THRESHOLD_LUMA,
  isDarkShadowPixel,
  findDarkShadowSize,
  SKIN_RED_GREEN_DIFFERENCE,
} from "../../frontend/src/cv/darkShadowRegion";

function frame(width: number, height: number, value: number): ImageData {
  const data = new Uint8ClampedArray(width * height * 4);
  for (let offset = 0; offset < data.length; offset += 4) {
    data[offset] = value;
    data[offset + 1] = value;
    data[offset + 2] = value;
    data[offset + 3] = 255;
  }
  return { width, height, data, colorSpace: "srgb" } as ImageData;
}

describe("static dark-shadow region", () => {
  it("classifies individual pixels and fails closed outside the frame", () => {
    const background = frame(4, 4, 180);
    const image = frame(4, 4, 180);
    const offset = (2 * image.width + 2) * 4;
    image.data[offset] = 90;
    image.data[offset + 1] = 90;
    image.data[offset + 2] = 90;

    expect(isDarkShadowPixel(image, background, 2, 2)).toBe(true);
    expect(isDarkShadowPixel(image, background, -1, 2)).toBe(false);
    expect(isDarkShadowPixel(image, null, 2, 2)).toBe(false);
  });

  it("counts black-ish pixels after a strong background-relative darkening", () => {
    const background = frame(100, 100, 170);
    const image = frame(100, 100, 180);
    const x = 50;
    const y = 62;
    const offset = (y * image.width + x) * 4;
    image.data[offset] = 100;
    image.data[offset + 1] = 100;
    image.data[offset + 2] = 100;

    const result = analyzeDarkShadowRegion(image, background, { x: 50, y: 60 });

    expect(result?.area).toBe(1);
    expect(result?.meanLumaDrop).toBeGreaterThanOrEqual(DARK_SHADOW_THRESHOLD_LUMA);
  });

  it("rejects skin-like RGB values even when they are darker than the reference", () => {
    const background = frame(100, 100, 220);
    const image = frame(100, 100, 180);
    const offset = (62 * image.width + 50) * 4;
    image.data[offset] = 130;
    image.data[offset + 1] = 90;
    image.data[offset + 2] = 85;

    expect(DARK_SHADOW_MAX_RGB_CHANNEL).toBe(120);
    expect(analyzeDarkShadowRegion(image, background, { x: 50, y: 60 })?.area).toBe(0);
  });

  it("rejects pixels whose red channel exceeds green by more than 20", () => {
    const background = frame(4, 4, 200);
    const image = frame(4, 4, 90);
    const offset = (2 * image.width + 2) * 4;
    image.data[offset] = 115;
    image.data[offset + 1] = 90;
    image.data[offset + 2] = 85;

    expect(SKIN_RED_GREEN_DIFFERENCE).toBe(20);
    expect(isDarkShadowPixel(image, background, 2, 2)).toBe(false);

    image.data[offset] = 110;
    expect(isDarkShadowPixel(image, background, 2, 2)).toBe(true);
  });

  it("returns unavailable for a mismatched or missing reference", () => {
    const image = frame(100, 100, 150);

    expect(analyzeDarkShadowRegion(image, frame(99, 100, 100), { x: 50, y: 50 })).toBeNull();
    expect(analyzeDarkShadowRegion(image, null, { x: 50, y: 50 })).toBeNull();
  });

  it("clips the region at frame edges", () => {
    const image = frame(20, 20, 0);
    const background = frame(20, 20, 100);

    const result = analyzeDarkShadowRegion(image, background, { x: 0, y: 0 });

    expect(result).toMatchObject({ left: 0, top: 2, width: 20, height: 18, area: 360 });
  });

  it("fits an oval to dark pixels found along the five probes", () => {
    const image = frame(100, 100, 180);
    const background = frame(100, 100, 180);
    for (let y = 55; y <= 72; y += 1) {
      for (let x = 40; x <= 60; x += 1) {
        const offset = (y * image.width + x) * 4;
        image.data[offset] = 30;
        image.data[offset + 1] = 30;
        image.data[offset + 2] = 30;
      }
    }
    const result = findDarkShadowSize(image, background, { x: 50, y: 50 });
    expect(result).not.toBeNull();
    expect(result?.runs.length).toBeGreaterThanOrEqual(2);
    expect(result?.areaPx).toBeGreaterThan(0);
  });

  it("maps crop pixels to the matching full-frame background coordinates", () => {
    const image = frame(20, 20, 180);
    const background = frame(100, 100, 180);
    for (let y = 5; y <= 18; y += 1) {
      for (let x = 5; x <= 15; x += 1) {
        const offset = (y * image.width + x) * 4;
        image.data[offset] = 20;
        image.data[offset + 1] = 20;
        image.data[offset + 2] = 20;
      }
    }
    const result = findDarkShadowSize(
      image,
      background,
      { x: 10, y: 5 },
      { x: 40, y: 40 },
    );
    expect(result).not.toBeNull();
  });
});


describe("shadow evidence comparison", () => {
  it("separates a darkening near band from a shrinking forward shadow", () => {
    const background = frame(100, 100, 200);
    const before = frame(100, 100, 200);
    const after = frame(100, 100, 200);
    for (let y = 0; y < 100; y += 1) {
      for (let x = 0; x < 100; x += 1) {
        for (let channel = 0; channel < 3; channel += 1) {
          if (y >= 22 && y <= 30) after.data[(y * 100 + x) * 4 + channel] = 40;
          if (y >= 31 && y <= 65) before.data[(y * 100 + x) * 4 + channel] = 80;
        }
      }
    }
    const a = measureShadowEvidence(before, background, { x: 50, y: 20 })!;
    const b = measureShadowEvidence(after, background, { x: 50, y: 20 })!;
    expect(a.near?.darkPixels).toBe(0);
    expect(a.forward?.darkFraction).toBe(1);
    expect(b.near?.darkFraction).toBe(1);
    expect(b.near?.darknessPerPixel).toBeCloseTo(160);
    expect(b.forward?.darkPixels).toBe(0);
    expect(b.maxSpatialGradient).toBeCloseTo(160);
    expect(compareShadowEvidence(a, b)).toMatchObject({
      nearDarknessDelta: expect.closeTo(160),
      forwardDarknessDelta: expect.closeTo(-120),
    });
  });

  it("distinguishes a valid empty mask from unavailable or clipped-away bands", () => {
    const image = frame(100, 100, 200);
    const empty = measureShadowEvidence(image, image, { x: 50, y: 20 })!;
    expect(empty.near?.darknessPerPixel).toBe(0);
    expect(empty.maxSpatialGradient).toBe(0);
    expect(measureShadowEvidence(image, null, { x: 50, y: 20 })).toBeNull();
    expect(measureShadowEvidence(image, image, { x: NaN, y: 20 })).toBeNull();
    expect(measureShadowEvidence(image, image, { x: 50, y: 99 })).toBeNull();
    const clipped = measureShadowEvidence(image, image, { x: 0, y: 95 })!;
    expect(clipped.near?.sampledPixels).toBe(41 * 3);
    expect(clipped.forward).toBeNull();
    expect(clipped.rowDarkness.filter((row) => row !== null)).toHaveLength(3);
    expect(compareShadowEvidence(empty, clipped).forwardDarknessDelta).toBeNull();
  });
});


describe("tunable dark-pixel diagnostics", () => {
  it("applies each adjustable bound independently without changing defaults", () => {
    const image = frame(4, 4, 110);
    const background = frame(4, 4, 200);
    const origin = { x: 0, y: 0 };
    expect(isDarkShadowPixel(image, background, 1, 1)).toBe(false);
    expect(isDarkShadowPixel(image, background, 1, 1, origin, { ...DEFAULT_DARK_SHADOW_FILTER, maxLuma: 120 })).toBe(true);
    const grey = frame(4, 4, 130);
    expect(isDarkShadowPixel(grey, background, 1, 1, origin, { ...DEFAULT_DARK_SHADOW_FILTER, maxLuma: 150 })).toBe(false);
    expect(isDarkShadowPixel(grey, background, 1, 1, origin, { ...DEFAULT_DARK_SHADOW_FILTER, maxLuma: 150, maxRgbChannel: 150 })).toBe(true);
    const dimPaper = frame(4, 4, 120);
    const dark = frame(4, 4, 90);
    expect(isDarkShadowPixel(dark, dimPaper, 1, 1)).toBe(false);
    expect(isDarkShadowPixel(dark, dimPaper, 1, 1, origin, { ...DEFAULT_DARK_SHADOW_FILTER, minLumaDrop: 20 })).toBe(true);
    dark.data[20] = 115;
    dark.data[22] = 85;
    expect(isDarkShadowPixel(dark, background, 1, 1)).toBe(false);
    expect(isDarkShadowPixel(dark, background, 1, 1, origin, { ...DEFAULT_DARK_SHADOW_FILTER, maxRedGreenDifference: 30 })).toBe(true);
    expect(DEFAULT_DARK_SHADOW_FILTER.maxLuma).toBe(100);
  });

  it("uses the selected filter in region measurements and overlays", () => {
    const image = frame(100, 100, 110);
    const background = frame(100, 100, 200);
    const filter = { ...DEFAULT_DARK_SHADOW_FILTER, maxLuma: 120 };
    const region = analyzeDarkShadowRegion(image, background, { x: 50, y: 20 }, filter)!;
    const runs = darkShadowRuns(region);
    expect(region.area).toBe(81 * 44);
    expect(runs).toHaveLength(44);
    expect(runs.reduce((count, run) => count + run[2], 0)).toBe(region.area);
    expect(measureShadowEvidence(image, background, { x: 50, y: 20 }, filter)?.near?.darknessPerPixel).toBeCloseTo(90);
    expect(findDarkShadowSize(image, background, { x: 50, y: 20 }, { x: 0, y: 0 }, filter)).not.toBeNull();
    expect(darkShadowRuns(null)).toEqual([]);
    expect(measureShadowEvidence(image, background, { x: 50, y: 20 })?.near?.darkPixels).toBe(0);
  });
});
