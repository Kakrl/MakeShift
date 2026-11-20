import type { VisionResult } from "./visionCameraPipeline";
import { acquireResource } from "../diagnostics/performanceMetrics";

type Reply = { type: "ready" } | { type: "error"; message: string } |
  { type: "frame"; id: number; epoch: number; result: VisionResult; processMs: number };

/** Ordered offline replay through the production worker. One request at a time;
 * no live-camera freshness deadline, since every labeled source frame matters. */
export class VisionReplay {
  private worker: Worker;
  private release: () => void;
  private id = 0;
  private closed = false;
  private pending: {
    resolve: (reply: Reply) => void;
    reject: (error: Error) => void;
    timer: ReturnType<typeof setTimeout>;
  } | null = null;
  private ready: Promise<Reply>;

  constructor(createWorker = () => new Worker("/vision/vision.worker.mjs", { type: "module" })) {
    this.worker = createWorker();
    this.release = acquireResource("workers");
    this.ready = this.wait();
    // An early load failure must not become an unhandled rejection while video seeks.
    void this.ready.catch(() => {});
    this.worker.onmessage = ({ data }: MessageEvent<Reply>) => {
      const pending = this.pending;
      if (!pending || this.closed) return;
      if (data.type === "error") return this.fail(new Error(data.message));
      if ((this.id === 0 && data.type !== "ready") ||
          (this.id > 0 && (data.type !== "frame" || data.id !== this.id || data.epoch !== 0)))
        return this.fail(new Error("Unexpected Vision replay response"));
      clearTimeout(pending.timer);
      this.pending = null;
      pending.resolve(data);
    };
    this.worker.onerror = () => this.fail(new Error("Vision replay worker failed"));
    this.worker.onmessageerror = () => this.fail(new Error("Vision replay response could not be read"));
  }

  private wait() {
    return new Promise<Reply>((resolve, reject) => {
      this.pending = { resolve, reject,
        timer: setTimeout(() => this.fail(new Error("Vision replay timed out")), 30_000) };
    });
  }
  async process(rgba: Uint8ClampedArray, width: number, height: number, octaves: number, setReference: boolean) {
    await this.ready;
    if (this.closed) throw new Error("Vision replay is closed");
    if (this.pending) throw new Error("Vision replay already has a pending frame");
    const reply = this.wait();
    try {
      this.worker.postMessage({ type: "frame", id: ++this.id, epoch: 0,
        rgba, width, height, octaves, setReference }, [rgba.buffer]);
    } catch (error) {
      this.fail(error instanceof Error ? error : new Error("Vision replay submission failed"));
    }
    const data = await reply;
    if (data.type !== "frame") throw new Error("Vision replay returned no frame");
    if (!data.result || data.result.width !== width || data.result.height !== height ||
        !Array.isArray(data.result.pressedKeys) ||
        data.result.pressedKeys.some((key, index, keys) => !Number.isInteger(key) ||
          key < 0 || key > octaves * 12 || (index > 0 && key <= keys[index - 1]))) {
      this.dispose();
      throw new Error("Vision replay returned invalid keys");
    }
    return { result: data.result, processMs: data.processMs };
  }
  private fail(error: Error) {
    const pending = this.pending;
    this.pending = null;
    if (pending) { clearTimeout(pending.timer); pending.reject(error); }
    if (!this.closed) {
      this.closed = true;
      this.worker.terminate();
      this.release();
    }
  }
  dispose() { this.fail(new Error("Vision replay was cancelled")); }
}
