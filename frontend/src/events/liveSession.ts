import {
  compatibleCalibration,
  MARKER_CHECK_INTERVAL_MS,
  MARKER_CHECK_SLACK_MS,
  validateCalibration,
  type CameraSignature,
} from "../cv/calibration";
import type { Point } from "../cv/types";
import type { BrowserAudio } from "../app/audio/audioEngine";
import { createAudioSink } from "./audioSession";
import { NoteSession, type DispatchResult } from "./noteSession";

export type LiveState =
  | "stopped"
  | "starting"
  | "ready"
  | "playing"
  | "interrupted"
  | "error";
export const TRACKING_TIMEOUT_MS = 500;
// Marker jitter has its own budget; hand freshness remains independent.
export const CALIBRATION_TIMEOUT_MS = MARKER_CHECK_INTERVAL_MS + MARKER_CHECK_SLACK_MS;
export type LiveStatus = Readonly<{
  state: LiveState;
  message: string;
  canStart: boolean;
}>;

/** Readiness owner. Only receive() can deliver detected events to audio. */
export class LiveSession {
  private state: LiveState = "stopped";
  private message =
    "Show the calibrated sheet and wait for tracking, then select Enable audio.";
  private calibrationAt = -Infinity;
  private trackingAt = -Infinity;
  private calibrationKey = "";
  private generation = 0;
  private sequence = 0;
  private timer: ReturnType<typeof setTimeout> | undefined;
  private listeners = new Set<() => void>();
  private notes: NoteSession;
  private hidden = false;

  constructor(
    private audio: BrowserAudio,
    private now = () => performance.now(),
  ) {
    this.notes = new NoteSession(createAudioSink(audio), now);
  }

  /** Attach in an effect; construction has no browser resources or subscriptions. */
  attach() {
    const unsubscribe = this.audio.subscribeInvalidation(() => {
      // initialize() resets its transport before reporting ready.
      if (this.state === "playing" || this.state === "ready")
        this.interrupt("Audio interrupted. Select Enable audio to resume playing.");
    });
    return () => {
      this.stop();
      clearTimeout(this.timer);
      unsubscribe();
    };
  }
  subscribe(listener: () => void) {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }
  private emit() {
    for (const listener of this.listeners) listener();
  }
  private fresh() {
    return (
      !this.hidden &&
      this.now() - this.calibrationAt < CALIBRATION_TIMEOUT_MS &&
      this.now() - this.trackingAt < TRACKING_TIMEOUT_MS
    );
  }
  get status(): LiveStatus {
    return Object.freeze({
      state: this.state,
      message: this.message,
      canStart: this.fresh(),
    });
  }
  get sessionId() {
    return this.notes.sessionId;
  }

  private expireBeforeRefresh() {
    if (["starting", "ready", "playing"].includes(this.state) && !this.fresh())
      this.interrupt(
        "Tracking timed out. Wait for fresh tracking, then select Enable audio again.",
      );
  }

  observeCalibration(
    value: unknown,
    camera: CameraSignature | null,
    corners: Point[] | null,
  ) {
    this.expireBeforeRefresh();
    const valid = validateCalibration(value);
    if (
      !valid ||
      !camera ||
      !corners ||
      !compatibleCalibration(valid, camera, corners)
    ) {
      this.calibrationAt = -Infinity;
      this.interrupt(
        "Calibration unavailable. Restore the original sheet/camera position or calibrate again.",
      );
      return false;
    }
    const key = JSON.stringify(valid);
    if (this.calibrationKey && key !== this.calibrationKey)
      this.interrupt(
        "Calibration changed. Select Enable audio to start a new session.",
      );
    this.calibrationKey = key;
    const wasFresh = this.fresh();
    this.calibrationAt = this.now();
    this.watch(wasFresh);
    return true;
  }
  /** Successful inference, including an empty frame, is usable tracking. */
  observeTracking() {
    this.expireBeforeRefresh();
    const wasFresh = this.fresh();
    this.trackingAt = this.now();
    this.watch(wasFresh);
  }
  trackingFailed() {
    this.trackingAt = -Infinity;
    this.interrupt(
      "Tracking failed. Reload to retry the detector, then select Enable audio.",
    );
  }
  private watch(wasFresh: boolean) {
    clearTimeout(this.timer);
    const remaining =
      Math.min(this.calibrationAt + CALIBRATION_TIMEOUT_MS,
        this.trackingAt + TRACKING_TIMEOUT_MS) -
      this.now();
    if (remaining > 0)
      this.timer = setTimeout(() => {
        this.interrupt(
          "Tracking timed out. Restore the camera and sheet, wait for tracking, then select Enable audio.",
        );
      }, remaining);
    if (wasFresh !== this.fresh()) this.emit();
  }
  setHidden(hidden: boolean) {
    this.hidden = hidden;
    if (hidden) {
      this.calibrationAt = this.trackingAt = -Infinity;
      this.interrupt(
        "Playing stopped in the background. Return, wait for tracking, then select Enable audio.",
      );
    }
  }
  async prepare(): Promise<boolean> {
    if (!this.fresh() || this.state === "starting" || this.state === "playing")
      return false;
    const request = ++this.generation;
    this.state = "starting";
    this.message = "Enabling audio…";
    this.emit();
    try {
      await this.audio.initialize();
      if (request !== this.generation) return false;
      if (!this.fresh() || this.audio.status !== "ready") {
        this.interrupt(
          "Readiness changed. Wait for tracking, then select Enable audio again.",
        );
        return false;
      }
      this.state = "ready";
      this.message = "Audio ready.";
      this.emit();
      return true;
    } catch {
      if (request !== this.generation) return false;
      this.state = "error";
      this.message =
        "Audio could not start. Select Enable audio to retry; check browser audio permissions.";
      this.emit();
      return false;
    }
  }
  play(): string | null {
    if (
      this.state !== "ready" ||
      !this.fresh() ||
      this.audio.status !== "ready"
    )
      return null;
    const id = this.notes.start();
    this.sequence = 0;
    this.state = "playing";
    this.message = "Playing";
    this.emit();
    return id;
  }
  /** Local CV producer API; retain the captured identity to reject obsolete input.
   * Use either these methods or receive() for a session, never mixed producers.
   */
  noteOn(sessionId: string, pressId: number, pitch: number, velocity: number): DispatchResult {
    if (sessionId !== this.sessionId) return "stale";
    return this.receive({
      version: 1, sessionId, sequence: ++this.sequence,
      timestampMs: this.now(), type: "note-on", pressId, pitch, velocity,
    });
  }
  noteOff(sessionId: string, pressId: number, pitch: number): DispatchResult {
    if (sessionId !== this.sessionId) return "stale";
    return this.receive({
      version: 1, sessionId, sequence: ++this.sequence,
      timestampMs: this.now(), type: "note-off", pressId, pitch,
    });
  }
  receive(
    value: unknown,
    clock?: { sourceOriginMs: number; mainOriginMs: number },
  ): DispatchResult {
    if (this.state !== "playing") return "stale";
    if (!this.fresh() || this.audio.status !== "ready") {
      this.interrupt(
        "Readiness lost. Wait for tracking, then select Enable audio again.",
      );
      return "interrupted";
    }
    const result = this.notes.receive(value, clock);
    if (!this.notes.sessionId)
      this.interrupt("Session ended. Select Enable audio to start a clean session.");
    return result;
  }
  stop() {
    this.end("stopped", "Stopped. Select Enable audio to start a new session.");
  }
  interrupt(message: string) {
    this.end("interrupted", message);
  }
  private end(state: LiveState, message: string) {
    this.generation++;
    const changed = this.state !== state || this.message !== message;
    this.state = state; // Retire before audio invalidation can reenter.
    this.message = message;
    this.notes.stop();
    if (changed) this.emit();
  }
}
