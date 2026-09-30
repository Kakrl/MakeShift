import { describe, expect, it } from "vitest";
import {
  CALIBRATION_KEY,
  CURRENT_LAYOUT,
  SHEET_ID,
  compatibleCalibration,
  loadCalibration,
  markerCorners,
  saveCalibration,
  validateCalibration,
  validSamples,
  type CalibrationResult,
} from "../../frontend/src/cv/calibration";
import {
  computeHomography,
  projectPoint,
} from "../../frontend/src/cv/homography";
import { getWhiteKeyPolygons } from "../../frontend/src/cv/keyboardGeometry";

export function calibrationFixture(): CalibrationResult {
  return {
    version: 1,
    coordinates: "unmirrored-frame-pixels/marker-unit-square",
    sheet: SHEET_ID,
    camera: { deviceId: "camera-1", width: 1000, height: 1000, facingMode: "" },
    layout: { ...CURRENT_LAYOUT },
    corners: [
      { x: 100, y: 100 },
      { x: 900, y: 100 },
      { x: 900, y: 900 },
      { x: 100, y: 900 },
    ],
    contact: {
      model: "landmark-reference-v1",
      hover: [Array.from({ length: 21 }, () => ({ x: 0.5, y: 0.4, z: -0.1 }))],
      rest: [Array.from({ length: 21 }, () => ({ x: 0.5, y: 0.5, z: 0 }))],
    },
  };
}

describe("versioned calibration", () => {
  it("copies validated results and rejects legacy flags and unsupported versions", () => {
    const input = calibrationFixture();
    const result = validateCalibration(input)!;
    input.corners[0].x = 700;
    expect(result.corners[0].x).toBe(100);
    for (const value of [
      true,
      null,
      {},
      { ...result, version: 2 },
      { ...result, coordinates: "mirrored" },
    ])
      expect(validateCalibration(value)).toBeNull();
  });
  it.each(["missing", "crossed", "collinear", "tiny", "nonfinite", "outside"])(
    "rejects %s marker geometry",
    (kind) => {
      const value = calibrationFixture();
      if (kind === "missing") value.corners.pop();
      if (kind === "crossed")
        [value.corners[1], value.corners[2]] = [
          value.corners[2],
          value.corners[1],
        ];
      if (kind === "collinear")
        value.corners.forEach((p) => {
          p.y = 100;
        });
      if (kind === "tiny")
        value.corners.forEach((p) => {
          p.x /= 100;
          p.y /= 100;
        });
      if (kind === "nonfinite") value.corners[0].x = NaN;
      if (kind === "outside") value.corners[0].x = -1;
      expect(validateCalibration(value)).toBeNull();
    },
  );
  it("rejects incomplete, duplicate or wrong marker IDs", () => {
    const value = calibrationFixture();
    const observations = value.corners.map((center, id) => ({
      id,
      center,
      corners: [center, center, center, center] as [
        typeof center,
        typeof center,
        typeof center,
        typeof center,
      ],
    }));
    expect(
      markerCorners({ observations, missingIds: [] }, value.camera),
    ).toEqual(value.corners);
    observations[3].id = 2;
    expect(
      markerCorners({ observations, missingIds: [] }, value.camera),
    ).toBeNull();
  });
  it("requires complete finite hover/rest samples and valid MIDI layout", () => {
    for (const samples of [
      [],
      [[{ x: 0, y: 0, z: 0 }]],
      [Array(21).fill({ x: 0.5, y: 0.5, z: NaN })],
    ])
      expect(validSamples(samples)).toBe(false);
    const value = calibrationFixture();
    value.contact.rest = [];
    expect(validateCalibration(value)).toBeNull();
    value.contact.rest = value.contact.hover;
    value.layout.startingMidi = 120;
    expect(validateCalibration(value)).toBeNull();
  });
  it("maps perspective observations to canonical keyboard positions", () => {
    const page = [
      { x: 0, y: 0 },
      { x: 1, y: 0 },
      { x: 1, y: 1 },
      { x: 0, y: 1 },
    ];
    const corners = [
      { x: 150, y: 100 },
      { x: 850, y: 180 },
      { x: 950, y: 850 },
      { x: 50, y: 900 },
    ];
    const toFrame = computeHomography(page, corners)!;
    const toPage = computeHomography(corners, page)!;
    for (const polygon of getWhiteKeyPolygons())
      for (const p of polygon) {
        const mapped = projectPoint(toPage, projectPoint(toFrame, p)!)!;
        expect(mapped.x).toBeCloseTo(p.x, 8);
        expect(mapped.y).toBeCloseTo(p.y, 8);
      }
    expect(
      projectPoint(computeHomography(page, calibrationFixture().corners)!, {
        x: 0.5,
        y: 0.5,
      }),
    ).toEqual({ x: 500, y: 500 });
    expect(computeHomography(page, Array(4).fill({ x: 0, y: 0 }))).toBeNull();
  });
  it("persists and reloads only validated results, recovering from corrupt or denied storage", () => {
    const data = new Map<string, string>();
    const storage = () => ({
      getItem: (key: string) => data.get(key) ?? null,
      setItem: (key: string, v: string) => {
        data.set(key, v);
      },
      removeItem: (key: string) => {
        data.delete(key);
      },
    });
    expect(saveCalibration(calibrationFixture(), storage)).toBe(true);
    expect(loadCalibration(storage)).toEqual(calibrationFixture());
    data.set(CALIBRATION_KEY, "{broken");
    expect(loadCalibration(storage)).toBeNull();
    const denied = () => {
      throw new Error("denied");
    };
    expect(loadCalibration(denied)).toBeNull();
    expect(saveCalibration(calibrationFixture(), denied)).toBe(false);
    expect(saveCalibration(true, storage)).toBe(false);
  });
  it("checks camera, sheet, layout and movement before reuse", () => {
    const v = calibrationFixture();
    expect(compatibleCalibration(v, v.camera, v.corners)).toBe(true);
    for (const patch of [
      { deviceId: "other" },
      { width: 2000 },
      { height: 1200 },
      { facingMode: "user" },
    ])
      expect(
        compatibleCalibration(v, { ...v.camera, ...patch }, v.corners),
      ).toBe(false);
    expect(
      compatibleCalibration(v, v.camera, v.corners, {
        ...v.layout,
        octaves: 2,
      }),
    ).toBe(false);
    expect(
      compatibleCalibration(v, v.camera, v.corners, v.layout, "other-sheet"),
    ).toBe(false);
    expect(
      compatibleCalibration(
        v,
        v.camera,
        v.corners.map((p) => ({ ...p, x: p.x + 25 })),
      ),
    ).toBe(false);
    expect(
      compatibleCalibration(
        v,
        v.camera,
        v.corners.map((p) => ({ ...p, x: p.x + 1 })),
      ),
    ).toBe(true);
  });
});
