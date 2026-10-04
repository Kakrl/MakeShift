import {
  evaluateFingerContact,
  type FingerContactEvaluation,
  type FingerContactGate,
} from "./combinedContact";
import type { ShadowContactState } from "./shadowHeuristics";

/** Owns the contact state for one tracked fingertip. */
export class Finger {
  contact: FingerContactEvaluation | null = null;
  gate: FingerContactGate | null = null;

  constructor(readonly id: string) {}

  /** Update inputs for this frame and follow the flow for the current state. */
  checkState(
    gate: FingerContactGate,
    nowMs: number,
    observation?: { state: ShadowContactState; frameAtMs: number },
    options: { shadowsEnabled?: boolean } = {},
  ): FingerContactEvaluation {
    this.gate = gate;

    switch (this.contact?.state) {
      case "pressed":
        return this.handlePressed(gate, nowMs, observation, options);
      case "releasing":
        return this.handleReleasing(gate, nowMs, observation, options);
      case "ready":
        return this.handleReady(gate, nowMs, observation, options);
      case "hover":
        return this.handleHover(gate, nowMs, observation, options);
      case "unavailable":
        return this.handleUnavailable(gate, nowMs, observation, options);
      case undefined:
        return this.handleUnavailable(gate, nowMs, observation, options);
    }
  }

  handlePressed(
    gate: FingerContactGate,
    nowMs: number,
    observation?: { state: ShadowContactState; frameAtMs: number },
    options: { shadowsEnabled?: boolean } = {},
  ): FingerContactEvaluation {
    return this.evaluate(gate, nowMs, observation, options);
  }

  handleReleasing(
    gate: FingerContactGate,
    nowMs: number,
    observation?: { state: ShadowContactState; frameAtMs: number },
    options: { shadowsEnabled?: boolean } = {},
  ): FingerContactEvaluation {
    return this.evaluate(gate, nowMs, observation, options);
  }

  handleReady(
    gate: FingerContactGate,
    nowMs: number,
    observation?: { state: ShadowContactState; frameAtMs: number },
    options: { shadowsEnabled?: boolean } = {},
  ): FingerContactEvaluation {
    return this.evaluate(gate, nowMs, observation, options);
  }

  handleHover(
    gate: FingerContactGate,
    nowMs: number,
    observation?: { state: ShadowContactState; frameAtMs: number },
    options: { shadowsEnabled?: boolean } = {},
  ): FingerContactEvaluation {
    return this.evaluate(gate, nowMs, observation, options);
  }

  handleUnavailable(
    gate: FingerContactGate,
    nowMs: number,
    observation?: { state: ShadowContactState; frameAtMs: number },
    options: { shadowsEnabled?: boolean } = {},
  ): FingerContactEvaluation {
    return this.evaluate(gate, nowMs, observation, options);
  }

  private evaluate(
    gate: FingerContactGate,
    nowMs: number,
    observation?: { state: ShadowContactState; frameAtMs: number },
    options: { shadowsEnabled?: boolean } = {},
  ): FingerContactEvaluation {
    this.contact = evaluateFingerContact(
      this.contact,
      gate,
      nowMs,
      observation,
      options,
    );
    return this.contact;
  }

  reset() {
    this.contact = null;
    this.gate = null;
  }
}
