import { describe, expect, it } from "vitest";
import { DEFAULT_LAYOUT, keyboardWidthMm, MARKER_INSET_MM, paperFits, startingNotes, usableLayout, validLayout } from "../../frontend/src/cv/keyboardLayout";
import { getPianoCorners, getWhiteKeyPolygons } from "../../frontend/src/cv/keyboardGeometry";
import { keyIndexToMidi } from "../../frontend/src/cv/noteMap";
import { getKeyCollisions } from "../../frontend/src/cv/collision";

describe("actual-size octave layouts", () => {
  it.each([1, 2, 3])("matches %i assembled octaves to millimeters and hit regions", (octaves) => {
    const layout = { octaves, startingMidi: 48, whiteKeys: 7 * octaves + 1, paperOctaves: octaves };
    const polygons = getWhiteKeyPolygons(layout);
    const markerSpan = keyboardWidthMm(octaves) - 2 * MARKER_INSET_MM;
    expect(polygons).toHaveLength(7 * octaves + 1);
    const corners = getPianoCorners(layout);
    expect((corners[1].x - corners[0].x) * markerSpan).toBeCloseTo(keyboardWidthMm(octaves));
    polygons.forEach((polygon, keyIndex) => {
      expect((polygon[1].x - polygon[0].x) * markerSpan).toBeCloseTo(23.5);
      const center = { x: (polygon[0].x + polygon[1].x) / 2, y: 0.7 };
      expect(getKeyCollisions([{ id: "finger", handIndex: 0, landmarkIndex: 8, point: center }], polygons).map(c => c.keyIndex)).toEqual([keyIndex]);
    });
    expect(keyIndexToMidi(layout.whiteKeys - 1, layout)).toBe(48 + 12 * octaves);
  });

  it.each([1, 2, 3])("bounds all starting C choices for %i octaves", (octaves) => {
    for (const startingMidi of startingNotes(octaves)) {
      const layout = { octaves, startingMidi, whiteKeys: 7 * octaves + 1 };
      expect(usableLayout(layout)).toBe(true);
      expect(keyIndexToMidi(0, layout)).toBe(startingMidi);
      for (let index = 0; index < layout.whiteKeys; index++) {
        const midi = keyIndexToMidi(index, layout)!;
        expect(midi).toBeGreaterThanOrEqual(0);
        expect(midi).toBeLessThanOrEqual(127);
      }
      expect(keyIndexToMidi(layout.whiteKeys, layout)).toBeNull();
    }
  });

  it.each([null, {}, { ...DEFAULT_LAYOUT, octaves: 4 },
    { ...DEFAULT_LAYOUT, startingMidi: -12 }, { ...DEFAULT_LAYOUT, startingMidi: 49 },
    { ...DEFAULT_LAYOUT, startingMidi: 120 }, { ...DEFAULT_LAYOUT, startingMidi: NaN },
    { ...DEFAULT_LAYOUT, whiteKeys: 15 }, { ...DEFAULT_LAYOUT, paperOctaves: 0 },
    { ...DEFAULT_LAYOUT, paperFitOverride: "yes" }])("rejects invalid layout %j", (layout) => {
    expect(validLayout(layout)).toBe(false);
    expect(keyIndexToMidi(0, layout as typeof DEFAULT_LAYOUT)).toBeNull();
    expect(getWhiteKeyPolygons(layout as typeof DEFAULT_LAYOUT)).toEqual([]);
  });

  it("requires an explicit paper-fit override and extends at physical key pitch", () => {
    const layout = { octaves: 3, startingMidi: 48, whiteKeys: 22, paperOctaves: 1 };
    expect(paperFits(layout)).toBe(false);
    expect(usableLayout(layout)).toBe(false);
    expect(keyIndexToMidi(0, layout)).toBeNull();
    const overridden = { ...layout, paperFitOverride: true };
    expect(usableLayout(overridden)).toBe(true);
    const corners = getPianoCorners(overridden);
    expect(corners[1].x).toBeGreaterThan(2.9);
    expect(getWhiteKeyPolygons(overridden)).toHaveLength(22);
    expect(keyIndexToMidi(21, overridden)).toBe(84);
  });
});
