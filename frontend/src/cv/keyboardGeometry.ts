import type { Point } from "./types";
import { projectPoint, type Homography } from "./homography";
import { DEFAULT_LAYOUT, MARKER_INSET_MM, keyboardWidthMm, paperOctaves, validLayout, type KeyboardLayout } from "./keyboardLayout";
import keyTargets from "./keyTargets.json";

const BLACK_KEY_WIDTH_MM = 13.7;
const BLACK_KEY_LENGTH_MM = 90;
const WHITE_KEY_LENGTH_MM = 150;
const BLACK_KEY_BOUNDARIES = [1, 2, 4, 5, 6] as const;

export const PIANO_CORNERS = getPianoCorners(DEFAULT_LAYOUT);

export const WHITE_KEY_COUNT = DEFAULT_LAYOUT.whiteKeys;

export function getPianoCorners(layout: KeyboardLayout = DEFAULT_LAYOUT): Point[] {
  if (!validLayout(layout)) return [];
  const markerSpan = keyboardWidthMm(paperOctaves(layout)) - 2 * MARKER_INSET_MM;
  const left = -MARKER_INSET_MM / markerSpan;
  const right = left + keyboardWidthMm(layout.octaves) / markerSpan;
  return [{ x: left, y: 0.1 }, { x: right, y: 0.1 },
    { x: right, y: 0.9 }, { x: left, y: 0.9 }];
}

function pointOnPiano(u: number, v: number, corners: Point[]): Point {
  const [topLeft, topRight, bottomRight, bottomLeft] = corners;
  const top = {
    x: topLeft.x + (topRight.x - topLeft.x) * u,
    y: topLeft.y + (topRight.y - topLeft.y) * u,
  };
  const bottom = {
    x: bottomLeft.x + (bottomRight.x - bottomLeft.x) * u,
    y: bottomLeft.y + (bottomRight.y - bottomLeft.y) * u,
  };

  return {
    x: top.x + (bottom.x - top.x) * v,
    y: top.y + (bottom.y - top.y) * v,
  };
}

export function getWhiteKeyPolygons(layout: KeyboardLayout = DEFAULT_LAYOUT): Point[][] {
  const corners = getPianoCorners(layout);
  if (corners.length !== 4) return [];
  return Array.from({ length: layout.whiteKeys }, (_, index) => {
    const left = index / layout.whiteKeys;
    const right = (index + 1) / layout.whiteKeys;

    return [
      pointOnPiano(left, 0, corners),
      pointOnPiano(right, 0, corners),
      pointOnPiano(right, 1, corners),
      pointOnPiano(left, 1, corners),
    ];
  });
}

/** Black-key polygons in the same canonical space as the white-key regions. */
export function getBlackKeyPolygons(
  layout: KeyboardLayout = DEFAULT_LAYOUT,
): Point[][] {
  const corners = getPianoCorners(layout);
  if (corners.length !== 4) return [];

  const keyboardWidth = keyboardWidthMm(layout.octaves);
  const halfWidth = BLACK_KEY_WIDTH_MM / (2 * keyboardWidth);
  const blackKeyLength = BLACK_KEY_LENGTH_MM / WHITE_KEY_LENGTH_MM;
  return Array.from(
    { length: layout.octaves * BLACK_KEY_BOUNDARIES.length },
    (_, index) => {
      const octave = Math.floor(index / BLACK_KEY_BOUNDARIES.length);
      const boundary = BLACK_KEY_BOUNDARIES[
        index % BLACK_KEY_BOUNDARIES.length
      ];
      const center = (octave * 7 + boundary) / layout.whiteKeys;
      const left = center - halfWidth;
      const right = center + halfWidth;

      return [
        pointOnPiano(left, 0, corners),
        pointOnPiano(right, 0, corners),
        pointOnPiano(right, blackKeyLength, corners),
        pointOnPiano(left, blackKeyLength, corners),
      ];
    },
  );
}

/** Canonical targets, in the same pitch order as the corresponding outlines. */
export function getKeyTargets(layout: KeyboardLayout = DEFAULT_LAYOUT) {
  const corners = getPianoCorners(layout);
  if (corners.length !== 4) return { white: [], black: [] };

  function target(center: number, keyLength: number, { sizeMm, tipInsetMm }: typeof keyTargets.white) {
    const halfWidth = sizeMm / (2 * keyboardWidthMm(layout.octaves));
    const bottom = (keyLength - tipInsetMm) / WHITE_KEY_LENGTH_MM;
    const top = bottom - sizeMm / WHITE_KEY_LENGTH_MM;
    return [
      pointOnPiano(center - halfWidth, top, corners),
      pointOnPiano(center + halfWidth, top, corners),
      pointOnPiano(center + halfWidth, bottom, corners),
      pointOnPiano(center - halfWidth, bottom, corners),
    ];
  }

  return {
    white: Array.from({ length: layout.whiteKeys }, (_, index) =>
      target((index + 0.5) / layout.whiteKeys, WHITE_KEY_LENGTH_MM, keyTargets.white),
    ),
    black: Array.from({ length: layout.octaves }, (_, octave) =>
      BLACK_KEY_BOUNDARIES.map((boundary) =>
        target((octave * 7 + boundary) / layout.whiteKeys, BLACK_KEY_LENGTH_MM, keyTargets.black),
      ),
    ).flat(),
  };
}

export function projectKeyRegions(
  homography: Homography,
  { white, black }: ReturnType<typeof getKeyTargets>,
) {
  const project = (keys: Point[][]) => keys.map((key) =>
    key.map((point) => projectPoint(homography, point)),
  );
  const projectedWhite = project(white);
  const projectedBlack = project(black);
  const validPolygon = (key: (Point | null)[]): key is Point[] =>
    key.every((point) => point !== null && Number.isFinite(point.x) && Number.isFinite(point.y));
  return white.length && projectedWhite.every(validPolygon) && projectedBlack.every(validPolygon)
    ? { white: projectedWhite, black: projectedBlack }
    : null;
}

export function drawKeyPolygon(
  context: CanvasRenderingContext2D,
  key: Point[],
  fillStyle: string,
  fillOpacity: number,
): void {
  context.beginPath();
  key.forEach((corner, index) => {
    if (index === 0) context.moveTo(corner.x, corner.y);
    else context.lineTo(corner.x, corner.y);
  });
  context.closePath();
  if (fillOpacity > 0) {
    context.save();
    context.globalAlpha = fillOpacity;
    context.fillStyle = fillStyle;
    context.fill();
    context.restore();
  }
  context.stroke();
}

export function pressWhiteKey(
  context: CanvasRenderingContext2D,
  key: Point[],
  fillStyle: string,
): void {
  drawKeyPolygon(context, key, fillStyle, 0.78);
}

export function releaseWhiteKey(
  context: CanvasRenderingContext2D,
  key: Point[],
  fillStyle: string,
): void {
  drawKeyPolygon(context, key, fillStyle, 0.3);
}

/** Draw the black-key caps over the white-key regions. */
export function drawBlackKey(
  context: CanvasRenderingContext2D,
  key: Point[],
  fillStyle: string,
): void {
  context.strokeStyle = fillStyle;
  drawKeyPolygon(context, key, fillStyle, 0.68);
}
