import {
  MARKER_ACQUIRE_INTERVAL_MS,
  MARKER_CHECK_INTERVAL_MS,
} from "./calibration";

/** Retains the last usable projection and latches marker cadence after acquisition. */
export class MarkerGeometryPolicy<T> {
  private acquired = false;
  private geometry: T | null = null;

  get checkIntervalMs(): number {
    return this.acquired
      ? MARKER_CHECK_INTERVAL_MS
      : MARKER_ACQUIRE_INTERVAL_MS;
  }

  get lastGoodGeometry(): T | null {
    return this.geometry;
  }

  /** A miss preserves geometry; only a usable projection replaces it. */
  observe(geometry: T | null): T | null {
    if (geometry) {
      this.acquired = true;
      this.geometry = geometry;
    }
    return this.geometry;
  }

  /** Clear geometry on explicit invalidation while keeping cadence latched. */
  clearGeometry() {
    this.geometry = null;
  }

  /** A new camera session starts with a fresh search and no reusable projection. */
  reset() {
    this.acquired = false;
    this.geometry = null;
  }
}
