import {
  calibrationReason,
  type CalibrationReason,
  validateCalibration,
  type CameraSignature,
} from "../cv/calibration";
import type { Point } from "../cv/types";
import type { BrowserAudio } from "../app/audio/audioEngine";
import { createAudioSink } from "./audioSession";
import { NoteSession, type DispatchResult, type Delivery } from "./noteSession";
import { DEFAULT_LAYOUT, sameLayout, usableLayout, type KeyboardLayout } from "../cv/keyboardLayout";
import { loadKeyboardLayout, subscribeKeyboardLayout } from "../lib/keyboardSettings";

export type LiveState =
  | "stopped"
  | "starting"
  | "ready"
  | "playing"
  | "interrupted"
  | "error";
export const TRACKING_TIMEOUT_MS = 500;
export type ReadinessReason = CalibrationReason | "backgrounded" | "tracking-paused" | "tracking-failed" |
  "audio-interrupted" | "audio-error" | "count-in-audio" | "audio-required" | "starting" | "ready" | "playing";
export const RECOVERY_COPY: Record<ReadinessReason, string> = {
  "calibration-missing": "Calibrate your piano sheet before playing.",
  "calibration-invalid": "Saved calibration could not be read. Calibrate your piano sheet again.",
  "camera-unavailable": "Camera unavailable. Reconnect or enable the camera to continue.",
  "camera-device": "The camera changed. Restore the calibrated camera or calibrate this camera.",
  "camera-dimensions": "Camera resolution changed. Restore the calibrated resolution or calibrate again.",
  "camera-facing": "Camera direction changed. Restore the calibrated direction or calibrate again.",
  "layout-changed": "Keyboard layout changed. Calibrate the selected layout before playing.",
  "markers-unavailable": "Show all four sheet markers so alignment can be checked.",
  "geometry-mismatch": "The last complete scan did not match the calibrated position. The sheet or camera may have moved. Align the sheet-reference outlines, or calibrate the new position.",
  "backgrounded": "Playing stopped in the background. Return and wait for tracking, then select Enable audio.",
  "tracking-paused": "Tracking paused. Keep the camera view clear while tracking reconnects.",
  "tracking-failed": "Tracking could not reconnect. Reload the tracker, then select Enable audio when tracking is ready.",
  "audio-interrupted": "Audio interrupted. Select Enable audio to continue.",
  "audio-error": "Audio could not start. Select Enable audio to retry; check browser audio permissions.",
  "count-in-audio": "Count-in audio could not start. Select Enable audio to retry.",
  "audio-required": "Tracking ready. Select Enable audio to continue.",
  "starting": "Enabling audio…", "ready": "Audio ready.", "playing": "Playing",
};
export type LiveStatus = Readonly<{
  state: LiveState;
  reason: ReadinessReason;
  action: "calibrate" | "enable-audio" | "reload" | "wait" | "none";
  message: string;
  canStart: boolean;
}>;

/** Readiness owner. Only receive() can deliver detected events to audio. */
export class LiveSession {
  private state: LiveState = "stopped";
  private calibrationAt = -Infinity;
  private trackingAt = -Infinity;
  private calibrationKey = "";
  private generation = 0;
  private sequence = 0;
  private timer: ReturnType<typeof setTimeout> | undefined;
  private listeners = new Set<() => void>();
  private notes: NoteSession;
  private sink: ReturnType<typeof createAudioSink>;
  private hidden = false;
  private detectorFailed = false;
  private calibrationIssue: CalibrationReason | null = "calibration-missing";
  private audioIssue: "audio-interrupted" | "audio-error" | "count-in-audio" | null = null;
  private configuredLayout: Readonly<KeyboardLayout> = DEFAULT_LAYOUT;

  get layout() { return this.configuredLayout; }
  setLayout(layout: KeyboardLayout) {
    if (sameLayout(this.configuredLayout, layout)) return;
    this.configuredLayout = Object.freeze({ ...layout });
    this.invalidateLayout();
  }
  private invalidateLayout() {
    this.calibrationAt = -Infinity;
    this.calibrationIssue = "layout-changed";
    this.interrupt();
  }

  constructor(
    private audio: BrowserAudio,
    private now = () => performance.now(),
  ) {
    this.sink = createAudioSink(audio);
    this.notes = new NoteSession(this.sink, now);
  }

  /** Attach in an effect; construction has no browser resources or subscriptions. */
  attach() {
    this.setLayout(loadKeyboardLayout());
    const unsubscribeLayout = subscribeKeyboardLayout(() => {
      this.setLayout(loadKeyboardLayout());
      // Storage failure or a remote calibration removal also fails closed.
      this.invalidateLayout();
    });
    const unsubscribe = this.audio.subscribeInvalidation(() => {
      // initialize() resets its transport before reporting ready.
      if (this.state === "playing" || this.state === "ready") {
        this.audioIssue = "audio-interrupted";
        this.interrupt();
      }
    });
    return () => {
      this.stop();
      clearTimeout(this.timer);
      unsubscribe();
      unsubscribeLayout();
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
      Number.isFinite(this.calibrationAt) &&
      this.now() - this.trackingAt < TRACKING_TIMEOUT_MS
    );
  }
  get status(): LiveStatus {
    // Precedence: background, calibration/camera/layout, tracking, audio, lifecycle.
    const reason: ReadinessReason = this.hidden ? "backgrounded" :
      this.calibrationIssue ?? (this.detectorFailed ? "tracking-failed" : !this.fresh() ? "tracking-paused" :
        this.state === "starting" ? "starting" : this.audioIssue ??
        (this.state === "playing" ? "playing" : this.state === "ready" ? "ready" : "audio-required"));
    const calibrate = ["calibration-missing", "calibration-invalid", "camera-device",
      "camera-dimensions", "camera-facing", "layout-changed", "geometry-mismatch"].includes(reason);
    return Object.freeze({
      state: this.state, reason,
      action: calibrate ? "calibrate" : reason === "tracking-failed" ? "reload" : this.fresh() && !["starting", "playing", "ready"].includes(reason)
        ? "enable-audio" : ["playing", "ready"].includes(reason) ? "none" : "wait",
      message: RECOVERY_COPY[reason],
      canStart: this.fresh(),
    });
  }
  get sessionId() {
    return this.notes.sessionId;
  }

  subscribeNotes(listener: (delivery: Delivery) => void) {
    return this.notes.subscribe(listener);
  }

  flushNotes() {
    this.notes.flushObservers();
  }

  pauseInput() {
    this.notes.pauseInput();
    this.sink.pauseInput();
  }
  resumeInput() {
    this.notes.resumeInput();
    this.audio.resumeInput();
  }

  private expireBeforeRefresh() {
    if (["starting", "ready", "playing"].includes(this.state) && !this.fresh())
      this.interrupt();
  }

  observeCalibration(
    value: unknown,
    camera: CameraSignature | null,
    corners: Point[] | null,
  ) {
    this.expireBeforeRefresh();
    const valid = validateCalibration(value);
    this.calibrationIssue = calibrationReason(value, camera, corners, this.layout);
    if (this.calibrationIssue || !valid) {
      this.calibrationAt = -Infinity;
      this.interrupt();
      return false;
    }
    return this.acceptCalibration(JSON.stringify(valid));
  }
  /** Dev mode only: a complete live marker scan stands in for saved calibration. */
  observeUncalibratedSheet(
    camera: CameraSignature | null,
    corners: Point[] | null,
  ) {
    this.expireBeforeRefresh();
    if (!camera || !corners || !usableLayout(this.layout)) {
      this.calibrationAt = -Infinity;
      this.calibrationIssue = !camera ? "camera-unavailable" :
        !usableLayout(this.layout) ? "layout-changed" : "markers-unavailable";
      this.interrupt();
      return false;
    }
    this.calibrationIssue = null;
    return this.acceptCalibration(`dev:${JSON.stringify(this.layout)}`);
  }
  private acceptCalibration(key: string) {
    if (this.calibrationKey && key !== this.calibrationKey)
      this.interrupt();
    this.calibrationKey = key;
    const wasFresh = this.fresh();
    this.calibrationAt = this.now();
    this.watch(wasFresh);
    return true;
  }
  /** Successful inference, including an empty frame, is usable tracking. */
  observeTracking() {
    this.expireBeforeRefresh();
    this.detectorFailed = false;
    const wasFresh = this.fresh();
    this.trackingAt = this.now();
    this.watch(wasFresh);
  }
  trackingFailed() {
    this.detectorFailed = true;
    this.trackingAt = -Infinity;
    this.interrupt();
  }
  private watch(wasFresh: boolean) {
    clearTimeout(this.timer);
    const remaining = this.trackingAt + TRACKING_TIMEOUT_MS - this.now();
    if (Number.isFinite(this.calibrationAt) && remaining > 0)
      this.timer = setTimeout(() => {
        this.interrupt();
      }, remaining);
    if (wasFresh !== this.fresh()) {
      this.emit();
    }
  }
  setHidden(hidden: boolean) {
    this.hidden = hidden;
    if (hidden) {
      this.calibrationAt = this.trackingAt = -Infinity;
      this.interrupt();
    } else this.emit();
  }
  async prepare(): Promise<boolean> {
    if (!this.fresh() || this.state === "starting" || this.state === "playing")
      return false;
    const request = ++this.generation;
    this.audioIssue = null;
    this.state = "starting";
    this.emit();
    try {
      await this.audio.initialize();
      if (request !== this.generation) return false;
      if (!this.fresh() || this.audio.status !== "ready") {
        this.interrupt();
        return false;
      }
      this.state = "ready";
      this.emit();
      return true;
    } catch {
      if (request !== this.generation) return false;
      this.audioIssue = "audio-error";
      this.state = "error";
      this.resumeInput();
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
    this.emit();
    return id;
  }
  /** Local CV producer API; retain the captured identity to reject obsolete input.
   * Use either these methods or receive() for a session, never mixed producers.
   */
  noteOn(sessionId: string, pressId: number, pitch: number, velocity: number, timestampMs = this.now()): DispatchResult {
    if (sessionId !== this.sessionId) return "stale";
    return this.receive({
      version: 1, sessionId, sequence: ++this.sequence,
      timestampMs, type: "note-on", pressId, pitch, velocity,
    });
  }
  noteOff(sessionId: string, pressId: number, pitch: number, timestampMs = this.now()): DispatchResult {
    if (sessionId !== this.sessionId) return "stale";
    return this.receive({
      version: 1, sessionId, sequence: ++this.sequence,
      timestampMs, type: "note-off", pressId, pitch,
    });
  }
  receive(
    value: unknown,
    clock?: { sourceOriginMs: number; mainOriginMs: number },
  ): DispatchResult {
    if (this.state !== "playing") return "stale";
    if (!this.fresh() || this.audio.status !== "ready") {
      this.interrupt();
      return "interrupted";
    }
    const result = this.notes.receive(value, clock);
    if (!this.notes.sessionId)
      this.interrupt();
    return result;
  }
  stop() {
    this.end("stopped");
  }
  interrupt(reason?: "count-in-audio") {
    if (reason) this.audioIssue = reason;
    if (["starting", "ready", "playing"].includes(this.state)) {
      this.end("interrupted");
    } else {
      // Readiness can change while idle without ending another session or take.
      this.emit();
    }
  }
  private end(state: LiveState) {
    this.generation++;
    const changed = this.state !== state;
    this.state = state; // Retire before audio invalidation can reenter.
    this.notes.stop();
    this.resumeInput();
    if (changed) this.emit();
  }
}
