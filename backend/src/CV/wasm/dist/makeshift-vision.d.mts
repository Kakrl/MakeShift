export type Point = { x: number; y: number };
export type Quad = [Point, Point, Point, Point];
export type Homography = [number, number, number, number, number, number, number, number, number];
export interface FrameInput {
  rgba: Uint8Array | Uint8ClampedArray;
  width: number;
  height: number;
  octaves: 1 | 2 | 3;
}
export interface VisionResult {
  width: number;
  height: number;
  referenceReady: boolean;
  referenceRevision: number;
  homographyReady: boolean;
  referenceScan: {
    status: 'idle' | 'captured' | 'blocked';
    reason: null | 'markers-missing-or-invalid' | 'active-presses' | 'fingertips-in-piano';
  };
  fingertips: Array<{ id: number; point: Point; pressed: boolean; state: 'unknown' | 'released' | 'pressed' }>;
  geometry: null | {
    frameToSheet: Homography;
    sheetToFrame: Homography;
    markerCenters: Quad;
    keyboardOutline: Quad;
    whiteKeyPolygons: Quad[];
  };
  pressRanges: Array<{ anchor: Point; outline: Point[] }>;
}
export interface Diagnostics {
  width: number; height: number;
  fingerMask: Uint8Array; valid: Uint8Array;
  rawDrop: Float32Array; score: Float32Array;
}
export interface Vision {
  setReference(): void;
  processFrame(frame: FrameInput): VisionResult;
  getDiagnostics(): Diagnostics | null;
  reset(): void;
  destroy(): void;
}
export default function loadVision(options?: {
  wasmURL?: string | URL;
  wasmBinary?: Uint8Array | ArrayBuffer;
}): Promise<{ createVision(): Vision }>;
