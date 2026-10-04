import { describe, expect, it } from "vitest";
import { Finger } from "../../frontend/src/cv/finger";
import {
  CONTACT_RELEASE_GRACE_MS,
  CONTACT_SHADOW_MAX_AGE_MS,
  type FingerContactGate,
} from "../../frontend/src/cv/combinedContact";

const eligibleGate = (
  updates: Partial<FingerContactGate> = {},
): FingerContactGate => ({
  available: true,
  keyIndexes: [2],
  knuckleEligible: true,
  sourceIdentity: "Right:640:480",
  revision: 1,
  frameAtMs: 100,
  ...updates,
});

describe("Finger contact state machine", () => {
  it("recovers from unavailable through ready before pressing", () => {
    const finger = new Finger("finger-1");
    const unavailable = finger.checkState(
      eligibleGate({ available: false }),
      100,
    );
    expect(unavailable.state).toBe("unavailable");

    const recovering = finger.checkState(eligibleGate(), 101, {
      state: "press candidate",
      frameAtMs: 101,
    });
    expect(recovering.state).toBe("ready");
    expect(recovering.active).toBe(false);

    const pressed = finger.checkState(eligibleGate({ frameAtMs: 102 }), 102);
    expect(pressed.state).toBe("pressed");
    expect(pressed.active).toBe(true);
  });

  it("stays ready when shadow evidence is unknown or stale", () => {
    const finger = new Finger("finger-1");
    finger.checkState(eligibleGate(), 100);

    const unknown = finger.checkState(eligibleGate(), 110, {
      state: "unknown",
      frameAtMs: 110,
    });
    expect(unknown.state).toBe("ready");
    expect(unknown.shadow).toBe("unknown");

    const stale = finger.checkState(
      eligibleGate({ frameAtMs: 110 + CONTACT_SHADOW_MAX_AGE_MS + 1 }),
      110 + CONTACT_SHADOW_MAX_AGE_MS + 1,
    );
    expect(stale.state).toBe("ready");
    expect(stale.active).toBe(false);
  });

  it("requires a shadow candidate to press and ignores it after eligibility is lost", () => {
    const finger = new Finger("finger-1");
    finger.checkState(eligibleGate(), 100);
    const pressed = finger.checkState(eligibleGate(), 110, {
      state: "press candidate",
      frameAtMs: 110,
    });
    expect(pressed.state).toBe("pressed");

    const hover = finger.checkState(
      eligibleGate({ keyIndexes: [], knuckleEligible: false }),
      120,
      { state: "press candidate", frameAtMs: 120 },
    );
    expect(hover.state).toBe("hover");
    expect(hover.active).toBe(false);
  });

  it("holds through release grace, recovers to pressed, then releases once grace expires", () => {
    const finger = new Finger("finger-1");
    finger.checkState(eligibleGate(), 100);
    finger.checkState(eligibleGate(), 110, {
      state: "press candidate",
      frameAtMs: 110,
    });

    const releasing = finger.checkState(eligibleGate(), 120, {
      state: "hover",
      frameAtMs: 120,
    });
    expect(releasing.state).toBe("releasing");
    expect(releasing.active).toBe(true);

    const recovered = finger.checkState(eligibleGate(), 130, {
      state: "press candidate",
      frameAtMs: 130,
    });
    expect(recovered.state).toBe("pressed");
    expect(recovered.active).toBe(true);
    expect(recovered.releaseStartedAtMs).toBeNull();

    finger.checkState(eligibleGate(), 140, {
      state: "hover",
      frameAtMs: 140,
    });
    const released = finger.checkState(
      eligibleGate(),
      140 + CONTACT_RELEASE_GRACE_MS,
    );
    expect(released.state).toBe("ready");
    expect(released.active).toBe(false);
  });

  it("starts release grace when pressed shadow evidence becomes stale", () => {
    const finger = new Finger("finger-1");
    finger.checkState(eligibleGate(), 100);
    finger.checkState(eligibleGate(), 110, {
      state: "press candidate",
      frameAtMs: 110,
    });

    const staleRelease = finger.checkState(
      eligibleGate({ frameAtMs: 110 + CONTACT_SHADOW_MAX_AGE_MS + 1 }),
      110 + CONTACT_SHADOW_MAX_AGE_MS + 1,
    );
    expect(staleRelease.state).toBe("releasing");
    expect(staleRelease.active).toBe(true);
    expect(staleRelease.shadow).toBe("unknown");
  });

  it("uses fresh landmarks when shadows are disabled and times out stale tracking", () => {
    const finger = new Finger("finger-1");
    const recovering = finger.checkState(
      eligibleGate(),
      100,
      undefined,
      { shadowsEnabled: false },
    );
    expect(recovering.state).toBe("ready");

    const pressed = finger.checkState(
      eligibleGate({ frameAtMs: 101 }),
      101,
      undefined,
      { shadowsEnabled: false },
    );
    expect(pressed.state).toBe("pressed");

    const unavailable = finger.checkState(
      eligibleGate({ frameAtMs: 101 }),
      101 + CONTACT_SHADOW_MAX_AGE_MS + 1,
      undefined,
      { shadowsEnabled: false },
    );
    expect(unavailable.state).toBe("unavailable");
    expect(unavailable.active).toBe(false);
  });
});
