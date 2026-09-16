import type { Point } from "./types";

export const PIANO_CORNERS: [Point, Point, Point, Point] = [
  { x: -0.05, y: 0.1 },
  { x: 1.05, y: 0.1 },
  { x: 1.05, y: 0.9 },
  { x: -0.05, y: 0.9 },
];

export const WHITE_KEY_COUNT = 8;

function pointOnPiano(u: number, v: number): Point {
  const [topLeft, topRight, bottomRight, bottomLeft] = PIANO_CORNERS;
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

export function getWhiteKeyPolygons(): Point[][] {
  return Array.from({ length: WHITE_KEY_COUNT }, (_, index) => {
    const left = index / WHITE_KEY_COUNT;
    const right = (index + 1) / WHITE_KEY_COUNT;

    return [
      pointOnPiano(left, 0),
      pointOnPiano(right, 0),
      pointOnPiano(right, 1),
      pointOnPiano(left, 1),
    ];
  });
}

function drawWhiteKey(
  context: CanvasRenderingContext2D,
  key: Point[],
  fillStyle: string,
): void {
  context.beginPath();
  key.forEach((corner, index) => {
    if (index === 0) context.moveTo(corner.x, corner.y);
    else context.lineTo(corner.x, corner.y);
  });
  context.closePath();
  context.fillStyle = fillStyle;
  context.fill();
  context.stroke();
}

export function pressWhiteKey(
  context: CanvasRenderingContext2D,
  key: Point[],
): void {
  drawWhiteKey(context, key, "rgba(255, 80, 80, 0.75)");
}

export function releaseWhiteKey(
  context: CanvasRenderingContext2D,
  key: Point[],
): void {
  drawWhiteKey(context, key, "rgba(255, 255, 255, 0.35)");
}
