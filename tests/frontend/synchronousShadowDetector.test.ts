import { describe, expect, it } from "vitest";
import { analyzeSynchronousShadow } from "../../frontend/src/cv/synchronousShadowDetector";

function imageFromRows(rows: number[], width = 140): ImageData {
  const height = rows.length;
  const data = new Uint8ClampedArray(width * height * 4);
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const offset = (y * width + x) * 4;
      data[offset] = rows[y];
      data[offset + 1] = rows[y];
      data[offset + 2] = rows[y];
      data[offset + 3] = 255;
    }
  }
  return { width, height, data, colorSpace: "srgb" } as ImageData;
}

describe("synchronous shadow detector", () => {
  it("reports a sharp bounded dip from the same sampled frame", () => {
    const rows = Array.from({ length: 140 }, () => 210);
    rows[83] = 130;
    const result = analyzeSynchronousShadow(imageFromRows(rows), {
      x: 70,
      y: 70,
    });

    expect(result.rays).toHaveLength(3);
    expect(result.state).toBe("press candidate");
    expect(result.backgroundAvailable).toBe(false);
    expect(result.changedPixels).toBeNull();
  });

  it("reports background subtraction measurements separately from contact", () => {
    const currentRows = Array.from({ length: 140 }, () => 180);
    const baselineRows = Array.from({ length: 140 }, () => 180);
    currentRows[80] = 130;
    baselineRows[80] = 180;
    const current = imageFromRows(currentRows);
    const baseline = imageFromRows(baselineRows);
    const result = analyzeSynchronousShadow(current, { x: 70, y: 70 }, baseline);

    expect(result.backgroundAvailable).toBe(true);
    expect(result.changedPixels).toBeGreaterThan(0);
    expect(result.meanBackgroundDifference).toBeGreaterThan(0);
    expect(result.state).toBe("hover");
  });

  it("marks an incompatible background unavailable", () => {
    const current = imageFromRows(Array.from({ length: 140 }, () => 180));
    const smaller = imageFromRows(Array.from({ length: 80 }, () => 180), 80);

    expect(analyzeSynchronousShadow(current, { x: 70, y: 70 }, smaller))
      .toMatchObject({
        backgroundAvailable: false,
        changedPixels: null,
        meanBackgroundDifference: null,
      });
  });
});
