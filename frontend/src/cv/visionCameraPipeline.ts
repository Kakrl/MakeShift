import {
  paperOctaves,
  usableLayout,
  type KeyboardLayout,
} from "./keyboardLayout";
import type { CameraSignature } from "./calibration";
import {
  acquireResource,
  pipelineMetrics,
  recordCameraFrame,
} from "../diagnostics/performanceMetrics";
import type { VisionResult } from "../../../backend/src/CV/wasm/dist/makeshift-vision.mjs";

export type { VisionResult };
export interface VisionFrame {
  result: VisionResult;
  camera: CameraSignature;
  timestampMs: number;
  sessionId: string | null;
}
export interface VisionCameraOptions {
  video: () => HTMLVideoElement | null;
  camera: () => CameraSignature | null;
  layout: KeyboardLayout;
  sessionId: () => string | null;
  onFrame: (frame: VisionFrame) => void;
  onUnavailable: () => void;
  onStatus: (message: string, failed: boolean) => void;
}
export const VISION_FRAME_TIMEOUT_MS = 500;
type Pending = {
  id: number;
  epoch: number;
  timestampMs: number;
  sessionId: string | null;
  camera: CameraSignature;
};
type WorkerReply =
  | { type: "ready" }
  | { type: "error"; message: string }
  | {
      type: "frame";
      id: number;
      epoch: number;
      result: VisionResult;
      processMs: number;
    };

/** One frame in flight, no queued camera frames. tick() always samples the latest video. */
export class VisionCameraPipeline {
  private worker: Worker | null = null;
  private releaseWorker: (() => void) | undefined;
  private canvas: HTMLCanvasElement | null = null;
  private ready = false;
  private disposed = false;
  private failed = false;
  private pending: Pending | null = null;
  private epoch = 0;
  private id = 0;
  private source = "";
  private lastVideoTime = -1;
  private referenceRequested = false;
  private unavailable = true;
  private startupTimer: ReturnType<typeof setTimeout> | undefined;

  constructor(
    private options: VisionCameraOptions,
    private now = () => performance.now(),
    private createWorker = () =>
      new Worker("/vision/vision.worker.mjs", { type: "module" }),
  ) {}

  start() {
    if (this.worker || this.disposed) return;
    if (
      !usableLayout(this.options.layout) ||
      paperOctaves(this.options.layout) !== this.options.layout.octaves
    ) {
      this.fail(
        "Vision requires matching paper and keyboard octave counts. Select matching counts in Calibration.",
      );
      return;
    }
    try {
      this.worker = this.createWorker();
      this.releaseWorker = acquireResource("workers");
      this.worker.onmessage = ({ data }: MessageEvent<WorkerReply>) =>
        this.receive(data);
      this.worker.onerror = () =>
        this.fail("Vision worker failed. Reload the tracker to retry.");
      this.worker.onmessageerror = () =>
        this.fail("Vision worker returned unreadable data.");
      this.startupTimer = setTimeout(
        () => this.fail("Vision could not load. Reload the tracker to retry."),
        60_000,
      );
    } catch (error) {
      this.fail(
        error instanceof Error ? error.message : "Unable to start Vision",
      );
    }
  }

  setReference() {
    if (this.disposed || this.failed) return;
    this.referenceRequested = true;
    this.options.onStatus(
      "Reference requested. Keep the keyboard empty and all four markers visible.",
      false,
    );
  }

  reset() {
    this.epoch++;
    this.referenceRequested = false;
    this.lastVideoTime = -1;
    if (this.ready) this.worker?.postMessage({ type: "reset" });
    this.options.onUnavailable();
  }

  tick() {
    if (this.disposed || this.failed) return;
    const video = this.options.video();
    const camera = this.options.camera();
    if (!camera || !video || video.readyState < 2 || document.hidden) {
      if (!this.unavailable) {
        this.unavailable = true;
        this.source = "";
        this.reset();
        this.options.onStatus(
          "Camera paused. Set reference again when the camera returns.",
          false,
        );
      }
      return;
    }
    const source = JSON.stringify(camera);
    if (source !== this.source) {
      // The first source is already empty; later changes invalidate reference/presses.
      if (this.source || !this.unavailable) this.reset();
      this.source = source;
      this.unavailable = false;
    }
    if (this.pending) {
      if (this.now() - this.pending.timestampMs >= VISION_FRAME_TIMEOUT_MS)
        this.fail(
          "Vision stopped returning fresh frames. Reload the tracker and set reference again.",
        );
      return;
    }
    if (!this.ready || video.currentTime === this.lastVideoTime) return;
    try {
      const canvas = (this.canvas ??= document.createElement("canvas"));
      if (canvas.width !== camera.width) canvas.width = camera.width;
      if (canvas.height !== camera.height) canvas.height = camera.height;
      const context = canvas.getContext("2d", { willReadFrequently: true });
      if (!context) throw new Error("Camera frame capture is unavailable");
      const timestampMs = this.now();
      context.drawImage(video, 0, 0, camera.width, camera.height);
      const { data: rgba } = context.getImageData(
        0,
        0,
        camera.width,
        camera.height,
      );
      this.lastVideoTime = video.currentTime;
      const pending = {
        id: ++this.id,
        epoch: this.epoch,
        timestampMs,
        sessionId: this.options.sessionId(),
        camera,
      };
      this.pending = pending;
      recordCameraFrame(timestampMs);
      this.worker!.postMessage(
        {
          type: "frame",
          id: pending.id,
          epoch: pending.epoch,
          width: camera.width,
          height: camera.height,
          rgba,
          octaves: this.options.layout.octaves,
          setReference: this.referenceRequested,
        },
        [rgba.buffer],
      );
      this.referenceRequested = false;
    } catch (error) {
      this.fail(
        error instanceof Error ? error.message : "Camera capture failed",
      );
    }
  }

  private receive(data: WorkerReply) {
    if (this.disposed || this.failed) return;
    if (data.type === "error") {
      this.fail(data.message);
      return;
    }
    if (data.type === "ready") {
      clearTimeout(this.startupTimer);
      this.ready = true;
      this.options.onStatus(
        "Vision ready. Clear the keyboard, show all four markers, then select Set reference.",
        false,
      );
      return;
    }
    const pending = this.pending;
    if (!pending || data.id !== pending.id || data.epoch !== pending.epoch) {
      this.fail("Vision returned an unexpected frame. Reload the tracker.");
      return;
    }
    this.pending = null;
    // Reset/camera/background changes may occur while the worker processes old pixels.
    if (
      pending.epoch !== this.epoch ||
      document.hidden ||
      JSON.stringify(this.options.camera()) !== JSON.stringify(pending.camera)
    )
      return;
    if (this.now() - pending.timestampMs >= VISION_FRAME_TIMEOUT_MS) {
      this.fail("Vision frame arrived too late. Reload the tracker.");
      return;
    }
    const result = data.result;
    if (
      !result ||
      result.width !== pending.camera.width ||
      result.height !== pending.camera.height ||
      !Array.isArray(result.pressedKeys) ||
      result.pressedKeys.some(
        (key, i, keys) =>
          !Number.isInteger(key) ||
          key < 0 ||
          key > 12 * this.options.layout.octaves ||
          (i > 0 && key <= keys[i - 1]),
      )
    ) {
      this.fail("Vision returned an invalid key snapshot. Reload the tracker.");
      return;
    }
    pipelineMetrics.record("detection", data.processMs);
    this.options.onFrame({ ...pending, result });
  }

  private fail(message: string) {
    if (this.failed || this.disposed) return;
    this.failed = true;
    this.closeWorker();
    this.options.onUnavailable();
    this.options.onStatus(message, true);
  }
  private closeWorker() {
    clearTimeout(this.startupTimer);
    this.worker?.terminate();
    this.worker = null;
    this.releaseWorker?.();
    this.releaseWorker = undefined;
  }
  dispose() {
    this.disposed = true;
    this.closeWorker();
    this.canvas = null;
    this.options.onUnavailable();
    pipelineMetrics.endFrameStream();
  }
}
