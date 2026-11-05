import { expect, it } from "vitest";
import { checkReferenceHands } from "../../frontend/src/cv/sheetReferenceGuard";
import { computeHomography } from "../../frontend/src/cv/homography";
import { PAGE_CORNERS } from "../../frontend/src/cv/calibration";
import { DEFAULT_LAYOUT } from "../../frontend/src/cv/keyboardLayout";

const transform = (left: number) => computeHomography([
  { x: left, y: 100 }, { x: left + 200, y: 100 },
  { x: left + 200, y: 300 }, { x: left, y: 300 },
], PAGE_CORNERS)!;
const hand = (x: number, y: number) => Array.from({ length: 21 }, () => ({ x: x / 1000, y: y / 600 }));
const current = transform(100), proposed = transform(600);
const check = (hands: Parameters<typeof checkReferenceHands>[0], old = current) =>
  checkReferenceHands(hands, old, proposed, DEFAULT_LAYOUT, 1000, 600);

it("allows an empty frame and a hand well outside both keyboard vicinities", () => {
  expect(check([])).toBe("clear");
  expect(check([hand(450, 500)])).toBe("clear");
});

it("rejects hovering hands near either the old or proposed keyboard, including the margin", () => {
  expect(check([hand(200, 200)])).toBe("hands-near-keyboard");
  expect(check([hand(700, 200)])).toBe("hands-near-keyboard");
  // Keyboard top is 120px; the one-key margin extends above it.
  expect(check([hand(700, 100)])).toBe("hands-near-keyboard");
  expect(check([hand(450, 500), hand(200, 200)])).toBe("hands-near-keyboard");
});

it("checks full hand bounds even when every landmark lies outside the keyboard", () => {
  const spanning = hand(500, 200);
  spanning[0] = { x: 0.9, y: 200 / 600 };
  expect(check([spanning])).toBe("hands-near-keyboard");
});

it("gates first acquisition against the proposed keyboard without needing a reference", () => {
  expect(checkReferenceHands([hand(700, 200)], null, proposed, DEFAULT_LAYOUT, 1000, 600)).toBe("hands-near-keyboard");
  expect(checkReferenceHands([], null, proposed, DEFAULT_LAYOUT, 1000, 600)).toBe("clear");
});

it("rejects unavailable or malformed hand results and unusable geometry", () => {
  expect(check(null)).toBe("unavailable");
  expect(check([[]])).toBe("unavailable");
  const invalid = hand(450, 500); invalid[0].x = NaN;
  expect(check([invalid])).toBe("unavailable");
  expect(checkReferenceHands([], null, [0, 0, 0, 0, 0, 0, 0, 0, 0], DEFAULT_LAYOUT, 1000, 600)).toBe("unavailable");
  expect(checkReferenceHands([], null, proposed, DEFAULT_LAYOUT, 0, 600)).toBe("unavailable");
});
