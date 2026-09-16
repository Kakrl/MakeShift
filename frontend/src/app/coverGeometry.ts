/**
 * The camera preview is drawn with object-cover, so the rendered box is not a
 * plain scale of the source frame: the source is scaled up until it covers the
 * box and the overflow is cropped evenly.
 *
 * Anything positioned on top of that frame, such as fingertip dots, has to
 * apply the same geometry, so it lives here once.
 */

export interface Size {
  width: number;
  height: number;
}

export interface Point {
  x: number;
  y: number;
}

export function coverGeometry(
  size: Size,
  frameWidth: number,
  frameHeight: number,
) {
  const scale = Math.max(size.width / frameWidth, size.height / frameHeight);
  return {
    scale,
    offsetX: (size.width - frameWidth * scale) / 2,
    offsetY: (size.height - frameHeight * scale) / 2,
  };
}

/** Source-frame pixels to CSS percentages of the rendered box. */
export function toDisplayStyle(
  point: Point,
  frameWidth: number,
  frameHeight: number,
  size: Size,
): { left: string; top: string } {
  if (size.width === 0 || size.height === 0 || !frameWidth || !frameHeight) {
    return { left: "-100%", top: "-100%" };
  }
  const { scale, offsetX, offsetY } = coverGeometry(size, frameWidth, frameHeight);
  return {
    left: `${((point.x * scale + offsetX) / size.width) * 100}%`,
    top: `${((point.y * scale + offsetY) / size.height) * 100}%`,
  };
}
