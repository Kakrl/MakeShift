import type { Point } from "./types";

export const FINGERTIP_LANDMARK_INDICES = [4, 8, 12, 16, 20] as const;

export interface NormalizedLandmark {
  x: number;
  y: number;
  z?: number;
}

export interface HandObservation {
  landmarks: readonly NormalizedLandmark[];
  handedness: "Right" | "Left" | "Unknown";
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

export type KeyRegion = "interior" | "boundary" | "outside";

/** Gray-band thickness as a fraction of the projected key width. */
export const KEY_GRAY_BOUNDARY_WIDTH_RATIO = 0.15;

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

/** Return the projected thickness of the gray band for a white-key polygon. */
export function getKeyGrayBoundaryWidth(
  polygon: readonly Point[],
): number | null {
  if (
    polygon.length !== 4 ||
    polygon.some(({ x, y }) => !Number.isFinite(x) || !Number.isFinite(y))
  )
    return null;

  // getWhiteKeyPolygons orders corners top-left, top-right, bottom-right,
  // bottom-left. The first and third edges span the key's width.
  const keyWidth =
    (Math.hypot(polygon[1].x - polygon[0].x, polygon[1].y - polygon[0].y) +
      Math.hypot(polygon[2].x - polygon[3].x, polygon[2].y - polygon[3].y)) /
    2;
  return Number.isFinite(keyWidth) && keyWidth > 0
    ? keyWidth * KEY_GRAY_BOUNDARY_WIDTH_RATIO
    : null;
}

/**
 * Classify a point relative to a projected white-key polygon. The boundary
 * band is measured inward from every edge and scales with the key's projected
 * width, so it is independent of camera resolution and distance.
 */
export function classifyKeyRegion(
  point: Point,
  polygon: readonly Point[],
): KeyRegion {
  if (
    !Number.isFinite(point.x) ||
    !Number.isFinite(point.y) ||
    !pointInPolygon(point, polygon)
  )
    return "outside";

  const boundaryWidth = getKeyGrayBoundaryWidth(polygon);
  if (boundaryWidth === null) return "outside";
  let nearestEdgeDistance = Infinity;
  for (let index = 0; index < polygon.length; index++)
    nearestEdgeDistance = Math.min(
      nearestEdgeDistance,
      distanceToSegment(point, polygon[index], polygon[(index + 1) % polygon.length]),
    );
  return nearestEdgeDistance <= boundaryWidth ? "boundary" : "interior";
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

/** Select black keys before white keys for each fingertip. Black key indexes
 * follow the white-key indexes, giving every region a distinct live identity. */
export function getPianoKeyCollisions(
  fingertips: readonly Fingertip[],
  whiteKeys: readonly (readonly Point[])[],
  blackKeys: readonly (readonly Point[])[] = [],
  tolerance = 0,
): KeyCollision[] {
  const selected = new Map<number, string[]>();
  for (const fingertip of fingertips) {
    const blackHits = getKeyCollisions([fingertip], blackKeys, tolerance);
    const hits = blackHits.length
      ? blackHits.map(({ keyIndex }) => ({ keyIndex: whiteKeys.length + keyIndex }))
      : getKeyCollisions([fingertip], whiteKeys, tolerance);
    for (const { keyIndex } of hits) {
      const collidingFingertips = selected.get(keyIndex) ?? [];
      collidingFingertips.push(fingertip.id);
      selected.set(keyIndex, collidingFingertips);
    }
  }
  return [...selected].map(([keyIndex, collidingFingertips]) => ({
    keyIndex,
    fingertips: collidingFingertips,
  }));
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
