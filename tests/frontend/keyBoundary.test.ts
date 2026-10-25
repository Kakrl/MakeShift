import { describe, expect, it } from "vitest";
import {
  classifyKeyRegion,
  KEY_GRAY_BOUNDARY_WIDTH_RATIO,
} from "../../frontend/src/cv/collision";
import { getWhiteKeyPolygons } from "../../frontend/src/cv/keyboardGeometry";

describe("key gray boundary geometry", () => {
  it("classifies interior, boundary, and outside points", () => {
    const rectangle = [
      { x: 0, y: 0 },
      { x: 100, y: 0 },
      { x: 100, y: 400 },
      { x: 0, y: 400 },
    ];

    expect(classifyKeyRegion({ x: 50, y: 200 }, rectangle)).toBe("interior");
    expect(classifyKeyRegion({ x: 10, y: 200 }, rectangle)).toBe("boundary");
    expect(classifyKeyRegion({ x: 50, y: 0 }, rectangle)).toBe("boundary");
    expect(classifyKeyRegion({ x: -1, y: 200 }, rectangle)).toBe("outside");
  });

  it("scales the boundary with projected key width", () => {
    const scale = 2;
    const rectangle = [
      { x: 0, y: 0 },
      { x: 100 * scale, y: 0 },
      { x: 100 * scale, y: 400 * scale },
      { x: 0, y: 400 * scale },
    ];
    const boundaryDepth = 100 * scale * KEY_GRAY_BOUNDARY_WIDTH_RATIO;

    expect(classifyKeyRegion({ x: boundaryDepth, y: 200 * scale }, rectangle))
      .toBe("boundary");
    expect(classifyKeyRegion({ x: boundaryDepth + 1, y: 200 * scale }, rectangle))
      .toBe("interior");
  });

  it.each([1, 2, 3])("leaves a usable interior across %i octave layouts", (octaves) => {
    const polygons = getWhiteKeyPolygons({
      octaves,
      startingMidi: 48,
      whiteKeys: 7 * octaves + 1,
    });

    expect(polygons).toHaveLength(7 * octaves + 1);
    for (const polygon of polygons) {
      const center = {
        x: (polygon[0].x + polygon[1].x) / 2,
        y: (polygon[0].y + polygon[2].y) / 2,
      };
      expect(classifyKeyRegion(center, polygon)).toBe("interior");
    }
  });

  it("leaves a neutral band at the shared edge of adjacent keys", () => {
    const left = [
      { x: 0, y: 0 },
      { x: 100, y: 0 },
      { x: 100, y: 400 },
      { x: 0, y: 400 },
    ];
    const right = [
      { x: 100, y: 0 },
      { x: 200, y: 0 },
      { x: 200, y: 400 },
      { x: 100, y: 400 },
    ];

    expect(classifyKeyRegion({ x: 100, y: 200 }, left)).toBe("boundary");
    expect(classifyKeyRegion({ x: 100, y: 200 }, right)).toBe("boundary");
    expect(classifyKeyRegion({ x: 90, y: 200 }, left)).toBe("boundary");
    expect(classifyKeyRegion({ x: 110, y: 200 }, right)).toBe("boundary");
  });

  it("rejects invalid polygons and non-finite points", () => {
    expect(classifyKeyRegion({ x: 1, y: 1 }, [])).toBe("outside");
    expect(
      classifyKeyRegion({ x: Number.NaN, y: 1 }, [
        { x: 0, y: 0 },
        { x: 100, y: 0 },
        { x: 100, y: 400 },
        { x: 0, y: 400 },
      ]),
    ).toBe("outside");
  });
});
