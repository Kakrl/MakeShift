import { describe, expect, it } from "vitest";
import { DEFAULT_LAYOUT, keyboardWidthMm, MARKER_INSET_MM, paperFits, startingNotes, usableLayout, validLayout } from "../../frontend/src/cv/keyboardLayout";
import { getBlackKeyPolygons, getKeyTargets, getPianoCorners, getWhiteKeyPolygons, projectKeyRegions } from "../../frontend/src/cv/keyboardGeometry";
import { computeHomography, projectPoint } from "../../frontend/src/cv/homography";
import { PAGE_CORNERS } from "../../frontend/src/cv/calibration";
import { checkKeyOverlap } from "../../frontend/src/cv/contactPipeline";
import type { Point } from "../../frontend/src/cv/types";
import { blackKeyIndexToMidi, keyIndexToMidi, pianoKeyIndexToMidi } from "../../frontend/src/cv/noteMap";
import { getKeyCollisions, getPianoKeyCollisions } from "../../frontend/src/cv/collision";

describe("actual-size octave layouts", () => {
  it.each([1, 2, 3])("matches printed target edges and angled hit testing for %i octaves", (octaves) => {
    const layout = { octaves, startingMidi: 48, whiteKeys: 7 * octaves + 1 };
    const markerInset = 188 / 22;
    const markerSpan = 188 + (octaves - 1) * 164.5 - 2 * markerInset;
    const homography = computeHomography(PAGE_CORNERS, [
      { x: 180, y: 150 }, { x: 900, y: 110 },
      { x: 1010, y: 750 }, { x: 70, y: 820 },
    ])!;
    const sheetPoint = (x: number, y: number) => ({
      x: (x - markerInset) / markerSpan, y: 0.1 + y / 187.5,
    });
    const regions = getKeyTargets(layout);
    const projected = projectKeyRegions(homography, regions)!;
    const hit = (point: Point) => checkKeyOverlap(
      { id: "tip", handIndex: 0, landmarkIndex: 8, point },
      projected.white, projected.black,
    );
    const verify = (polygon: Point[], center: number, length: number, size: number, index: number) => {
      const left = center - size / 2;
      const right = center + size / 2;
      const bottom = length - 2;
      const top = bottom - size;
      const expectedCorners = [
        sheetPoint(left, top), sheetPoint(right, top),
        sheetPoint(right, bottom), sheetPoint(left, bottom),
      ];
      const actual = index < layout.whiteKeys
        ? projected.white[index] : projected.black[index - layout.whiteKeys];
      expectedCorners.forEach((point, i) => {
        expect(polygon[i].x).toBeCloseTo(point.x, 10);
        expect(polygon[i].y).toBeCloseTo(point.y, 10);
        const expected = projectPoint(homography, point)!;
        expect(actual[i].x).toBeCloseTo(expected.x, 8);
        expect(actual[i].y).toBeCloseTo(expected.y, 8);
      });
      expect(hit(projectPoint(homography, sheetPoint(center, bottom - size / 2))!)).toEqual([index]);
      expect(hit(projectPoint(homography, sheetPoint(center, top - 1))!)).toEqual([]);
    };
    expect(regions.white).toHaveLength(layout.whiteKeys);
    expect(regions.black).toHaveLength(octaves * 5);
    regions.white.forEach((key, i) => verify(key, (i + 0.5) * 23.5, 150, 16, i));
    regions.black.forEach((key, i) => verify(key,
      (Math.floor(i / 5) * 7 + [1, 2, 4, 5, 6][i % 5]) * 23.5, 90, 10, layout.whiteKeys + i));
  });

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
      for (let index = 0; index < octaves * 5; index++) {
        const expected = startingMidi + Math.floor(index / 5) * 12 +
          [1, 3, 6, 8, 10][index % 5];
        expect(blackKeyIndexToMidi(index, layout)).toBe(expected);
        expect(pianoKeyIndexToMidi(layout.whiteKeys + index, layout)).toBe(expected);
        expect(expected).toBeLessThanOrEqual(127);
      }
      expect(pianoKeyIndexToMidi(layout.whiteKeys + octaves * 5, layout)).toBeNull();
    }
  });

  it("prefers black-key collisions over the white keys beneath them", () => {
    const layout = { octaves: 1, startingMidi: 48, whiteKeys: 8 };
    const blackKey = getBlackKeyPolygons(layout)[0];
    const whiteKeys = getWhiteKeyPolygons(layout);
    const center = {
      x: (blackKey[0].x + blackKey[1].x) / 2,
      y: (blackKey[0].y + blackKey[2].y) / 2,
    };
    const collisions = getPianoKeyCollisions(
      [{ id: "finger", handIndex: 0, landmarkIndex: 8, point: center }],
      whiteKeys,
      getBlackKeyPolygons(layout),
    );

    expect(collisions.map(({ keyIndex }) => keyIndex)).toEqual([layout.whiteKeys]);
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
