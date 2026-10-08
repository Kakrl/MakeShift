import type { HandObservation, NormalizedLandmark } from "./collision";

export const MIN_PRESS_VELOCITY = 0.2;
export const VELOCITY_WINDOW_MS = 100;
export const VELOCITY_MAX_GAP_MS = 150;
const MIN_SAMPLE_MS = 5;
const SPEED_NOISE_FLOOR = 0.5;
const FULL_VELOCITY_SPEED = 8;
const HISTORY_SIZE = 24;

/** Speed is in palm lengths/second, not physical metres/second. */
export function speedToVelocity(speed: number): number {
  if (!Number.isFinite(speed) || speed <= SPEED_NOISE_FLOOR)
    return MIN_PRESS_VELOCITY;
  const strength = Math.min(1, (speed - SPEED_NOISE_FLOOR) /
    (FULL_VELOCITY_SPEED - SPEED_NOISE_FLOOR));
  return MIN_PRESS_VELOCITY + (1 - MIN_PRESS_VELOCITY) * strength;
}

const finiteXY = (point: NormalizedLandmark | undefined) =>
  point && Number.isFinite(point.x) && Number.isFinite(point.y);

/** Bounded recent motion history for one tracked finger. */
export class FingerVelocity {
  private previous: { x: number; y: number; z: number; at: number; source: string } | null = null;
  private speeds = new Float64Array(HISTORY_SIZE);
  private times = new Float64Array(HISTORY_SIZE);
  private count = 0;
  private cursor = 0;

  reset() {
    this.previous = null;
    this.count = this.cursor = 0;
  }

  observe(hand: HandObservation, landmarkIndex: number,
    width: number, height: number, at: number, source: string) {
    const tip = hand.landmarks[landmarkIndex];
    const wrist = hand.landmarks[0];
    const knuckle = hand.landmarks[9];
    if (!finiteXY(tip) || !finiteXY(wrist) || !finiteXY(knuckle) ||
      !Number.isFinite(width) || !Number.isFinite(height) || width <= 0 || height <= 0 ||
      !Number.isFinite(at) || at < 0 ||
      [tip, wrist, knuckle].some(point => point.z !== undefined && !Number.isFinite(point.z))) {
      this.reset();
      return;
    }
    // y is height-normalized; x and MediaPipe z use the image-width scale.
    const aspect = height / width;
    const scale = Math.hypot(knuckle.x - wrist.x, (knuckle.y - wrist.y) * aspect);
    if (!Number.isFinite(scale) || scale < 0.01) { this.reset(); return; }
    const hasDepth = tip.z !== undefined && wrist.z !== undefined;
    const sample = {
      x: (tip.x - wrist.x) / scale,
      y: (tip.y - wrist.y) * aspect / scale,
      z: hasDepth ? (tip.z! - wrist.z!) / scale : 0,
      at, source: `${source}:${hasDepth ? "xyz" : "xy"}`,
    };
    if (![sample.x, sample.y, sample.z].every(Number.isFinite)) {
      this.reset();
      return;
    }
    const previous = this.previous;
    if (!previous || previous.source !== sample.source ||
      at < previous.at || at - previous.at > VELOCITY_MAX_GAP_MS) {
      this.reset();
      this.previous = sample;
      return;
    }
    // Duplicate/sub-5ms observations do not create artificial speed spikes.
    const elapsed = at - previous.at;
    if (elapsed < MIN_SAMPLE_MS) return;
    const speed = Math.hypot(sample.x - previous.x, sample.y - previous.y,
      sample.z - previous.z) * 1000 / elapsed;
    this.previous = sample;
    this.speeds[this.cursor] = speed;
    this.times[this.cursor] = at;
    this.cursor = (this.cursor + 1) % HISTORY_SIZE;
    this.count = Math.min(this.count + 1, HISTORY_SIZE);
  }

  /** Consume the recent peak when contact begins; held notes never rescale. */
  takeVelocity(at: number): number {
    let peak = 0;
    if (Number.isFinite(at)) for (let index = 0; index < this.count; index++) {
      const age = at - this.times[index];
      if (age >= 0 && age <= VELOCITY_WINDOW_MS) peak = Math.max(peak, this.speeds[index]);
    }
    this.count = this.cursor = 0;
    return speedToVelocity(peak);
  }
}
