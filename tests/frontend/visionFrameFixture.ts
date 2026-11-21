// Synthetic Vision output for recording UI tests. These tests do not exercise CV.
import { getWhiteKeyPolygons } from "../../frontend/src/cv/keyboardGeometry";
import {
  computeHomography,
  invertHomography,
  projectPoint,
} from "../../frontend/src/cv/homography";
import type {
  VisionCameraOptions,
  VisionResult,
} from "../../frontend/src/cv/visionCameraPipeline";

export function recordingVisionFixture(fixtures: {
  keys: null | ((keys: number[]) => void);
  markerShift: number;
  missNextDetection: boolean;
}) {
  return class Fixture {
    private keys: number[] = [];
    private disposed = false;
    private geometry: VisionResult["geometry"] = null;
    private shift = NaN;
    private revision = 0;
    private requested = false;
    constructor(private options: VisionCameraOptions) {}
    start() {
      fixtures.keys = (keys) => {
        this.keys = keys;
        this.tick();
      };
      this.options.onStatus("Vision ready. Select Set reference.", false);
    }
    setReference() {
      this.requested = true;
    }
    reset() {
      this.options.onUnavailable();
    }
    dispose() {
      this.disposed = true;
      fixtures.keys = null;
      this.options.onUnavailable();
    }
    tick() {
      if (this.disposed) return;
      const camera = this.options.camera();
      if (!camera || this.options.video()!.readyState < 2) {
        this.options.onUnavailable();
        return;
      }
      const captured = this.requested;
      this.requested = false;
      const blocked = fixtures.missNextDetection;
      fixtures.missNextDetection = false;
      if (!blocked && (this.shift !== fixtures.markerShift || captured)) {
        this.shift = fixtures.markerShift;
        this.revision++;
        const centers = [
          { x: 100, y: 100 },
          { x: 900, y: 100 },
          { x: 900, y: 900 },
          { x: 100, y: 900 },
        ].map((p) => ({ x: p.x + this.shift, y: p.y })) as NonNullable<
          VisionResult["geometry"]
        >["markerCenters"];
        const sheet = [
          { x: 0, y: 0 },
          { x: 1, y: 0 },
          { x: 1, y: 1 },
          { x: 0, y: 1 },
        ];
        const sheetToFrame = computeHomography(sheet, centers)!;
        this.geometry = {
          sheetToFrame,
          frameToSheet: invertHomography(sheetToFrame)!,
          markerCenters: centers,
          keyboardOutline: centers,
          whiteKeyPolygons: getWhiteKeyPolygons(this.options.layout).map(
            (polygon) => polygon.map((p) => projectPoint(sheetToFrame, p)!),
          ) as NonNullable<VisionResult["geometry"]>["whiteKeyPolygons"],
        };
      }
      const result: VisionResult = {
        width: 1000,
        height: 1000,
        referenceReady: true,
        referenceRevision: this.revision,
        homographyReady: true,
        geometry: this.geometry,
        pressedKeys: captured ? [] : [...new Set(this.keys)].sort((a, b) => a - b),
        fingertips: [],
        pressRanges: [],
        referenceScan: blocked
          ? { status: "blocked", reason: "markers-missing-or-invalid" }
          : {
              status: captured || this.revision === 1 ? "captured" : "idle",
              reason: null,
            },
      };
      // Subsequent snapshots retain contacts; only explicit capture empties keys.
      if (!captured && !blocked)
        result.referenceScan = { status: "idle", reason: null };
      this.options.onFrame({
        result,
        camera,
        timestampMs: performance.now(),
        sessionId: this.options.sessionId(),
      });
    }
  };
}
