import type { ShadowDifference, CandidateFilter } from "./shadowHeatmap";

export interface BandPoint { x: number; y: number }
export interface ShadowBandSettings extends CandidateFilter { noiseFloor: number; maxDistance: number; halfWidth: number }
export type BandPixelState = "shadow-compatible" | "below-floor" | "color-change" | "unknown" | "outside";
/** A manually anchored profile, not a skin boundary or contact detector. Distances are analysis pixels. */
export function measureShadowBand(difference: ShadowDifference, tip: BandPoint, outward: BandPoint, settings: ShadowBandSettings) {
  const dx = outward.x - tip.x; const dy = outward.y - tip.y; const length = Math.hypot(dx, dy);
  const validPoint = (p: BandPoint) => Number.isFinite(p.x) && Number.isFinite(p.y) && p.x >= 0 && p.y >= 0 && p.x < difference.width && p.y < difference.height;
  if (!validPoint(tip) || !validPoint(outward) || length < 1 || !Number.isFinite(settings.noiseFloor) || settings.noiseFloor < 0 ||
    !Number.isFinite(settings.maximumColorShift) || settings.maximumColorShift < 0 || !Number.isFinite(settings.maximumResidual) || settings.maximumResidual < 0 ||
    !Number.isInteger(settings.maxDistance) || settings.maxDistance < 1 || settings.maxDistance > 64 ||
    !Number.isInteger(settings.halfWidth) || settings.halfWidth < 0 || settings.halfWidth > 4) return null;
  const ux = dx / length; const uy = dy / length;
  const rays = [];
  for (let offset = -settings.halfWidth; offset <= settings.halfWidth; offset += 1) {
    const origin = { x: tip.x - uy * offset, y: tip.y + ux * offset };
    const profile = [];
    for (let distance = 1; distance <= settings.maxDistance; distance += 1) {
      const x = Math.round(origin.x + ux * distance); const y = Math.round(origin.y + uy * distance);
      const i = y * difference.width + x;
      let state: BandPixelState;
      if (x < 0 || y < 0 || x >= difference.width || y >= difference.height) state = "outside";
      else if (!difference.valid[i] || !Number.isFinite(difference.lumaDrop[i])) state = "unknown";
      else if (difference.lumaDrop[i] <= settings.noiseFloor) state = "below-floor";
      else {
        const mismatch = settings.method === "color" ? difference.colorShift[i] : difference.residualCurrent[i];
        const signalValid = settings.method === "color" || !!difference.projectionValid[i];
        state = !signalValid || !Number.isFinite(mismatch) ? "unknown" :
          mismatch > (settings.method === "color" ? settings.maximumColorShift : settings.maximumResidual) ? "color-change" : "shadow-compatible";
      }
      const available = state !== "outside" && !!difference.valid[i];
      const finite = (value: number) => available && Number.isFinite(value) ? value : null;
      profile.push({ distance, x, y, state, lumaDrop: finite(difference.lumaDrop[i]), colorShift: finite(difference.colorShift[i]),
        residualCurrent: finite(difference.residualCurrent[i]) });
    }
    // Only a run starting within three sampled steps of the source tip is a local band.
    const start = profile.findIndex((p) => p.state === "shadow-compatible");
    const prefix = start < 0 ? profile : profile.slice(0, start);
    let status: "measured" | "insufficient-evidence" | "ambiguous-boundary" | "censored" = "insufficient-evidence";
    let width: number | null = null; let lowerBound: number | null = null;
    let endDistance: number | null = null;
    if (prefix.some((p) => p.state === "unknown" || p.state === "color-change")) status = "ambiguous-boundary";
    else if (prefix.some((p) => p.state === "outside")) status = "censored";
    else if (start >= 0 && start <= 2) {
      let end = start;
      while (end < profile.length && profile[end].state === "shadow-compatible") end += 1;
      const terminal = profile[end]?.state;
      endDistance = profile[end - 1].distance;
      if (terminal === "below-floor") { status = "measured"; width = end - start; }
      else if (!terminal || terminal === "outside") { status = "censored"; lowerBound = end - start; }
      else status = "ambiguous-boundary";
    }
    rays.push({ offset, origin, status, width, lowerBound, firstShadowDistance: start >= 0 ? profile[start].distance : null, endDistance, profile });
  }
  const widths = rays.flatMap((r) => r.status === "measured" && r.width !== null ? [r.width] : []).sort((a, b) => a - b);
  const middle = Math.floor(widths.length / 2);
  const medianWidth = widths.length ? widths.length % 2 ? widths[middle] : (widths[middle - 1] + widths[middle]) / 2 : null;
  const usable = widths.length >= Math.ceil(rays.length / 2);
  return { coordinateSpace: "analysis-pixels" as const, tip: { ...tip }, outward: { ...outward }, direction: { x: ux, y: uy }, settings: { ...settings },
    status: usable ? "measured" as const : "insufficient-evidence" as const, medianWidth: usable ? medianWidth : null,
    measuredRays: widths.length, totalRays: rays.length, rays };
}
