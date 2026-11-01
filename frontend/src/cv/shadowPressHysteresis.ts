export const LARGE_SHADOW_AREA_PX = 300;
export const SMALL_SHADOW_AREA_PX = 100;
export const MAX_COMPARISON_FRAME_GAP = 3;
export const MAX_LIVE_COMPARISON_GAP_MS = 120;

export type ShadowSizeTransition =
  | "large-to-small"
  | "small-to-large"
  | "no-threshold-crossing"
  | "unavailable";

export interface ShadowPressComparison {
  yDecreased: boolean | null;
  shadowTransition: ShadowSizeTransition;
  pressCandidate: boolean;
}

export function isComparableFrameGap(previousFrame: number, currentFrame: number) {
  const gap = currentFrame - previousFrame;
  return Number.isInteger(previousFrame) &&
    Number.isInteger(currentFrame) &&
    gap > 0 &&
    gap <= MAX_COMPARISON_FRAME_GAP;
}

export function compareTipY(previousY: number | null, currentY: number): boolean | null {
  if (previousY === null || !Number.isFinite(previousY) || !Number.isFinite(currentY)) {
    return null;
  }
  return currentY < previousY;
}

export function compareToPreviousShadowSize(
  previousArea: number | null,
  currentArea: number | null,
): ShadowSizeTransition {
  if (
    previousArea === null ||
    currentArea === null ||
    !Number.isFinite(previousArea) ||
    !Number.isFinite(currentArea)
  ) {
    return "unavailable";
  }
  if (previousArea >= LARGE_SHADOW_AREA_PX && currentArea <= SMALL_SHADOW_AREA_PX) {
    return "large-to-small";
  }
  if (previousArea <= SMALL_SHADOW_AREA_PX && currentArea >= LARGE_SHADOW_AREA_PX) {
    return "small-to-large";
  }
  return "no-threshold-crossing";
}

export function compareShadowPress(
  previousY: number | null,
  currentY: number,
  previousArea: number | null,
  currentArea: number | null,
): ShadowPressComparison {
  const yDecreased = compareTipY(previousY, currentY);
  const shadowTransition = compareToPreviousShadowSize(previousArea, currentArea);
  return {
    yDecreased,
    shadowTransition,
    pressCandidate: yDecreased === true && shadowTransition === "large-to-small",
  };
}

export interface ShadowPressTrackerObservation {
  state: "press candidate" | "hover" | "unknown";
  yDecreased: boolean | null;
  shadowTransition: ShadowSizeTransition;
  pressCandidate: boolean;
}

/** Stateful live press/release hysteresis for one fingertip. */
export class ShadowPressTracker {
  private previousY: number | null = null;
  private previousArea: number | null = null;
  private previousAtMs: number | null = null;
  private pressed = false;

  reset() {
    this.previousY = null;
    this.previousArea = null;
    this.previousAtMs = null;
    this.pressed = false;
  }

  observe(y: number, areaPx: number | null, atMs: number): ShadowPressTrackerObservation {
    if (!Number.isFinite(y) || !Number.isFinite(atMs) || areaPx === null || !Number.isFinite(areaPx)) {
      const stillFresh = this.previousAtMs !== null &&
        atMs >= this.previousAtMs &&
        atMs - this.previousAtMs <= MAX_LIVE_COMPARISON_GAP_MS;
      if (!stillFresh) this.pressed = false;
      return {
        state: stillFresh && this.pressed ? "press candidate" : "unknown",
        yDecreased: null,
        shadowTransition: "unavailable",
        pressCandidate: stillFresh && this.pressed,
      };
    }

    const continuous = this.previousAtMs !== null &&
      atMs > this.previousAtMs &&
      atMs - this.previousAtMs <= MAX_LIVE_COMPARISON_GAP_MS;
    const comparison = continuous
      ? compareShadowPress(this.previousY, y, this.previousArea, areaPx)
      : null;
    if (!continuous) this.pressed = false;
    if (comparison?.pressCandidate) this.pressed = true;
    if (
      this.pressed &&
      comparison?.shadowTransition === "small-to-large" &&
      this.previousY !== null &&
      y > this.previousY
    ) {
      this.pressed = false;
    }

    this.previousY = y;
    this.previousArea = areaPx;
    this.previousAtMs = atMs;
    return {
      state: this.pressed ? "press candidate" : "hover",
      yDecreased: comparison?.yDecreased ?? null,
      shadowTransition: comparison?.shadowTransition ?? "unavailable",
      pressCandidate: this.pressed,
    };
  }
}
