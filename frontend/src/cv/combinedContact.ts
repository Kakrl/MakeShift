import type { ShadowContactState } from "./shadowHeuristics";

export type FingerContactState =
  | "unavailable"
  | "hover"
  | "ready"
  | "pressed"
  | "releasing";

export const CONTACT_RELEASE_GRACE_MS = 60;
export const CONTACT_SHADOW_MAX_AGE_MS = 150;

export interface FingerContactEvaluation {
  state: FingerContactState;
  active: boolean;
  shadow: ShadowContactState;
  shadowFrameAtMs: number | null;
  releaseStartedAtMs: number | null;
}

export interface FingerContactGate {
  available: boolean;
  keyIndexes: readonly number[];
  knuckleEligible: boolean;
  sourceIdentity: string;
  revision: number;
  // Latest landmark frame, used when debugging without shadow confirmation.
  frameAtMs?: number;
}

/** Shadow mode requires fresh results; other debug modes use fresh landmarks. */
export function evaluateFingerContact(
  previous: FingerContactEvaluation | null,
  gate: FingerContactGate,
  nowMs: number,
  observation?: { state: ShadowContactState; frameAtMs: number },
  options: { shadowsEnabled?: boolean } = {},
): FingerContactEvaluation {
  const idle = (state: FingerContactState): FingerContactEvaluation => ({
    state,
    active: false,
    shadow: "unknown",
    shadowFrameAtMs: null,
    releaseStartedAtMs: null,
  });
  if (!gate.available) return idle("unavailable");
  if (gate.keyIndexes.length === 0 || !gate.knuckleEligible)
    return idle("hover");

  if (options.shadowsEnabled === false) {
    // Knuckle-only and overlap-only modes release when tracking frames go stale.
    const frameAtMs = gate.frameAtMs;
    if (
      frameAtMs === undefined ||
      !Number.isFinite(frameAtMs) ||
      frameAtMs > nowMs ||
      nowMs - frameAtMs > CONTACT_SHADOW_MAX_AGE_MS
    )
      return idle("unavailable");
    return { ...idle("pressed"), active: true };
  }

  const fresh =
    observation !== undefined &&
    Number.isFinite(observation.frameAtMs) &&
    observation.frameAtMs <= nowMs &&
    nowMs - observation.frameAtMs <= CONTACT_SHADOW_MAX_AGE_MS &&
    (previous?.shadowFrameAtMs == null ||
      observation.frameAtMs > previous.shadowFrameAtMs);
  const shadow = fresh ? observation.state : (previous?.shadow ?? "unknown");
  const shadowFrameAtMs = fresh
    ? observation.frameAtMs
    : (previous?.shadowFrameAtMs ?? null);
  if (shadowFrameAtMs === null) return idle("ready");
  if (nowMs - shadowFrameAtMs > CONTACT_SHADOW_MAX_AGE_MS)
    return { ...idle("unavailable"), shadowFrameAtMs };

  if (fresh && shadow === "press candidate") {
    return {
      state: "pressed",
      active: true,
      shadow,
      shadowFrameAtMs,
      releaseStartedAtMs: null,
    };
  }
  if (previous?.active) {
    if (shadow === "press candidate") {
      return { ...previous, shadow, shadowFrameAtMs };
    }
    const releaseStartedAtMs = previous.releaseStartedAtMs ?? nowMs;
    if (nowMs - releaseStartedAtMs < CONTACT_RELEASE_GRACE_MS) {
      return {
        state: "releasing",
        active: true,
        shadow,
        shadowFrameAtMs,
        releaseStartedAtMs,
      };
    }
  }
  return {
    state: shadow === "unknown" ? "unavailable" : "ready",
    active: false,
    shadow,
    shadowFrameAtMs,
    releaseStartedAtMs: null,
  };
}
