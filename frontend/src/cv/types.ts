export interface Point {
  x: number;
  y: number;
}

export interface MarkerObservation {
  id: number;
  corners: [Point, Point, Point, Point];
  center: Point;
}

export interface MarkerDetectionResult {
  observations: MarkerObservation[];
  missingIds: number[];
}
