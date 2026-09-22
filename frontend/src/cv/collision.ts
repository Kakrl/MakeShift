import type { Point } from "./types";

export const FINGERTIP_LANDMARK_INDICES = [4, 8, 12, 16, 20] as const;

export interface NormalizedLandmark {
  x: number;
  y: number;
}

export interface Fingertip {
  id: string;
  handIndex: number;
  landmarkIndex: number;
  point: Point;
}

export interface KeyCollision {
  keyIndex: number;
  fingertips: string[];
}

export interface KeyTransitions {
  pressed: number[];
  released: number[];
  held: number[];
}

function distanceToSegment(point: Point, start: Point, end: Point): number {
  const segmentX = end.x - start.x;
  const segmentY = end.y - start.y;
  const segmentLengthSquared = segmentX * segmentX + segmentY * segmentY;

  if (segmentLengthSquared === 0) {
    return Math.hypot(point.x - start.x, point.y - start.y);
  }

  const projection =
    ((point.x - start.x) * segmentX + (point.y - start.y) * segmentY) /
    segmentLengthSquared;
  const clampedProjection = Math.max(0, Math.min(1, projection));
  const closestPoint = {
    x: start.x + clampedProjection * segmentX,
    y: start.y + clampedProjection * segmentY,
  };

  return Math.hypot(
    point.x - closestPoint.x,
    point.y - closestPoint.y,
  );
}

function isOnSegment(point: Point, start: Point, end: Point): boolean {
  const tolerance = 1e-6;
  return (
    distanceToSegment(point, start, end) <= tolerance &&
    point.x >= Math.min(start.x, end.x) - tolerance &&
    point.x <= Math.max(start.x, end.x) + tolerance &&
    point.y >= Math.min(start.y, end.y) - tolerance &&
    point.y <= Math.max(start.y, end.y) + tolerance
  );
}

/** Return whether a point is inside a polygon, including its boundary. */
export function pointInPolygon(point: Point, polygon: readonly Point[]): boolean {
  if (polygon.length < 3) return false;

  let inside = false;

  for (let index = 0, previous = polygon.length - 1; index < polygon.length; previous = index++) {
    const currentPoint = polygon[index];
    const previousPoint = polygon[previous];

    if (isOnSegment(point, previousPoint, currentPoint)) return true;

    const crossesScanline =
      currentPoint.y > point.y !== previousPoint.y > point.y;
    if (crossesScanline) {
      const intersectionX =
        ((previousPoint.x - currentPoint.x) * (point.y - currentPoint.y)) /
          (previousPoint.y - currentPoint.y) +
        currentPoint.x;

      if (point.x < intersectionX) inside = !inside;
    }
  }

  return inside;
}

/**
 * Return whether a point is inside a polygon or within a pixel tolerance of
 * its boundary. A tolerance is useful for fingertip landmark jitter.
 */
export function pointNearPolygon(
  point: Point,
  polygon: readonly Point[],
  tolerance = 0,
): boolean {
  if (pointInPolygon(point, polygon)) return true;
  if (tolerance <= 0 || polygon.length < 2) return false;

  return polygon.some((start, index) => {
    const end = polygon[(index + 1) % polygon.length];
    return distanceToSegment(point, start, end) <= tolerance;
  });
}

/** Convert MediaPipe's normalized fingertip landmarks into raw video pixels. */
export function getFingertips(
  hands: readonly (readonly NormalizedLandmark[])[],
  videoWidth: number,
  videoHeight: number,
): Fingertip[] {
  if (videoWidth <= 0 || videoHeight <= 0) return [];

  return hands.flatMap((hand, handIndex) =>
    FINGERTIP_LANDMARK_INDICES.flatMap((landmarkIndex) => {
      const landmark = hand[landmarkIndex];
      if (!landmark) return [];

      return [
        {
          id: `${handIndex}-${landmarkIndex}`,
          handIndex,
          landmarkIndex,
          point: {
            x: landmark.x * videoWidth,
            y: landmark.y * videoHeight,
          },
        },
      ];
    }),
  );
}

/** Find the projected key polygons currently touched by each fingertip. */
export function getKeyCollisions(
  fingertips: readonly Fingertip[],
  keyPolygons: readonly (readonly Point[])[],
  tolerance = 0,
): KeyCollision[] {
  return keyPolygons.flatMap((polygon, keyIndex) => {
    const collidingFingertips = fingertips
      .filter(({ point }) => pointNearPolygon(point, polygon, tolerance))
      .map(({ id }) => id);

    return collidingFingertips.length > 0
      ? [{ keyIndex, fingertips: collidingFingertips }]
      : [];
  });
}

export function getCollidedKeyIndexes(
  collisions: readonly KeyCollision[],
): Set<number> {
  return new Set(collisions.map(({ keyIndex }) => keyIndex));
}

/** Compare consecutive collision frames and identify key transitions. */
export function updateKeyTransitions(
  previousKeys: ReadonlySet<number>,
  currentKeys: ReadonlySet<number>,
): KeyTransitions {
  const pressed = [...currentKeys].filter((key) => !previousKeys.has(key));
  const released = [...previousKeys].filter((key) => !currentKeys.has(key));
  const held = [...currentKeys].filter((key) => previousKeys.has(key));

  return { pressed, released, held };
}
