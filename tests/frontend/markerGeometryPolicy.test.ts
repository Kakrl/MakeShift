import { expect, it } from "vitest";
import {
  MARKER_ACQUIRE_INTERVAL_MS,
  MARKER_CHECK_INTERVAL_MS,
} from "../../frontend/src/cv/calibration";
import { MarkerGeometryPolicy } from "../../frontend/src/cv/markerGeometryPolicy";

it("searches quickly until its first usable geometry, then latches the slower cadence", () => {
  const policy = new MarkerGeometryPolicy<{ revision: number }>();

  expect(policy.checkIntervalMs).toBe(MARKER_ACQUIRE_INTERVAL_MS);
  policy.observe({ revision: 1 });
  expect(policy.checkIntervalMs).toBe(MARKER_CHECK_INTERVAL_MS);
});

it("keeps the last usable geometry through misses and replaces it on a later success", () => {
  const policy = new MarkerGeometryPolicy<{ revision: number }>();
  const first = { revision: 1 };
  const next = { revision: 2 };
  policy.observe(first);

  expect(policy.observe(null)).toBe(first);
  expect(policy.lastGoodGeometry).toBe(first);
  expect(policy.checkIntervalMs).toBe(MARKER_CHECK_INTERVAL_MS);

  policy.observe(next);
  expect(policy.lastGoodGeometry).toBe(next);
  expect(policy.checkIntervalMs).toBe(MARKER_CHECK_INTERVAL_MS);
});

it("starts acquisition over only when the camera session resets", () => {
  const policy = new MarkerGeometryPolicy<{ revision: number }>();
  policy.observe({ revision: 1 });
  policy.reset();

  expect(policy.lastGoodGeometry).toBeNull();
  expect(policy.checkIntervalMs).toBe(MARKER_ACQUIRE_INTERVAL_MS);
});
