import type { Point } from "./types";
import { DEFAULT_LAYOUT, MARKER_INSET_MM, keyboardWidthMm, paperOctaves, validLayout, type KeyboardLayout } from "./keyboardLayout";

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

function drawWhiteKey(
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
  context.save();
  context.globalAlpha = fillOpacity;
  context.fillStyle = fillStyle;
  context.fill();
  context.restore();
  context.stroke();
}

export function pressWhiteKey(
  context: CanvasRenderingContext2D,
  key: Point[],
  fillStyle: string,
): void {
  drawWhiteKey(context, key, fillStyle, 0.78);
}

export function releaseWhiteKey(
  context: CanvasRenderingContext2D,
  key: Point[],
  fillStyle: string,
): void {
  drawWhiteKey(context, key, fillStyle, 0.3);
}

/** Draw the black-key caps over the white-key regions. */
export function drawBlackKey(
  context: CanvasRenderingContext2D,
  key: Point[],
  fillStyle: string,
): void {
  context.strokeStyle = fillStyle;
  drawWhiteKey(context, key, fillStyle, 0.92);
}
