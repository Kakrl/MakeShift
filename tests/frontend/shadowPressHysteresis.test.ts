import { describe, expect, it } from "vitest";
import {
  compareShadowPress,
  compareTipY,
  compareToPreviousShadowSize,
  isComparableFrameGap,
  LARGE_SHADOW_AREA_PX,
  MAX_LIVE_COMPARISON_GAP_MS,
  ShadowPressTracker,
  SMALL_SHADOW_AREA_PX,
} from "../../frontend/src/cv/shadowPressHysteresis";

describe("static shadow press comparison", () => {
  it("requires decreasing fingertip y and a large-to-small oval area", () => {
    expect(
      compareShadowPress(120, 119, LARGE_SHADOW_AREA_PX, SMALL_SHADOW_AREA_PX),
    ).toMatchObject({
      yDecreased: true,
      shadowTransition: "large-to-small",
      pressCandidate: true,
    });
  });

  it("does not signal press when y is unchanged or increases", () => {
    expect(compareTipY(120, 120)).toBe(false);
    expect(
      compareShadowPress(120, 121, LARGE_SHADOW_AREA_PX, SMALL_SHADOW_AREA_PX)
        .pressCandidate,
    ).toBe(false);
  });

  it("uses absolute size bands and reports the reverse size transition", () => {
    expect(compareToPreviousShadowSize(299, 50)).toBe("no-threshold-crossing");
    expect(compareToPreviousShadowSize(50, 300)).toBe("small-to-large");
    expect(compareToPreviousShadowSize(null, 50)).toBe("unavailable");
  });

  it("compares only nearby forward frame pairs", () => {
    expect(isComparableFrameGap(10, 13)).toBe(true);
    expect(isComparableFrameGap(10, 14)).toBe(false);
    expect(isComparableFrameGap(10, 10)).toBe(false);
  });

  it("latches a live press on y decrease plus large-to-small shadow", () => {
    const tracker = new ShadowPressTracker();
    expect(tracker.observe(120, 340, 0).state).toBe("hover");
    expect(tracker.observe(119, 90, 30)).toMatchObject({
      state: "press candidate",
      yDecreased: true,
      shadowTransition: "large-to-small",
      pressCandidate: true,
    });
    expect(tracker.observe(119, 180, 60).state).toBe("press candidate");
  });

  it("clears a live press on y increase plus small-to-large shadow", () => {
    const tracker = new ShadowPressTracker();
    tracker.observe(120, 340, 0);
    tracker.observe(119, 90, 30);
    expect(tracker.observe(121, 320, 60)).toMatchObject({
      state: "hover",
      yDecreased: false,
      shadowTransition: "small-to-large",
      pressCandidate: false,
    });
  });

  it("clears stale history so nonadjacent live samples cannot combine", () => {
    const tracker = new ShadowPressTracker();
    tracker.observe(120, 340, 0);
    expect(tracker.observe(119, 90, MAX_LIVE_COMPARISON_GAP_MS + 1)).toMatchObject({
      state: "hover",
      pressCandidate: false,
    });
  });
});
