import type { CandidateFilter, ShadowDifference } from "./shadowHeatmap";

export const TIP_EVIDENCE_SETTINGS = {
  scanDistance: 24, attachmentDistance: 3, nearDistance: 6,
  thresholds: [5, 20, 40, 60] as readonly number[],
  filter: { method: "projection", maximumColorShift: 10, maximumResidual: 0.12 } as CandidateFilter,
};

interface Tip { x: number; y: number; width: number }
interface Sample {
  x: number; y: number; distance: number;
  state: "compatible" | "color-change" | "finger" | "unknown" | "outside";
  drop: number | null;
}
interface Level {
  threshold: number; status: "no-boundary" | "clear" | "measured" | "ambiguous" | "censored";
  extent: number | null; runWidth: number | null; lowerBound: number | null;
  startDistance: number | null; detachedStrongEvidence: boolean;
}

/** Static local diagnostic, with the same downward-facing assumption as the tip pilot.
 * Zero means three known clear samples at a fixed intensity cutoff; null is unavailable.
 * Side/back pixels are context, not proof of shadow ownership or contact.
 */
export function measureTipShadowEvidence(difference: ShadowDifference, mask: Uint8Array, tip: Tip,
  filter: CandidateFilter = TIP_EVIDENCE_SETTINGS.filter) {
  const { width, height } = difference;
  if (mask.length !== width * height || !Number.isInteger(tip.x) || !Number.isInteger(tip.y) ||
    tip.x < 0 || tip.x >= width || tip.y < 0 || tip.y >= height ||
    !Number.isFinite(tip.width) || tip.width < 1 || tip.width > 128 ||
    !["color", "projection"].includes(filter.method) ||
    !Number.isFinite(filter.maximumColorShift) || filter.maximumColorShift < 0 ||
    !Number.isFinite(filter.maximumResidual) || filter.maximumResidual < 0) return null;
  const sample = (x: number, y: number, distance: number): Sample => {
    const i = y * width + x;
    if (x < 0 || x >= width || y < 0 || y >= height) return { x, y, distance, state: "outside", drop: null };
    const drop = Number.isFinite(difference.lumaDrop[i]) && difference.valid[i] ? difference.lumaDrop[i] : null;
    const mismatch = filter.method === "color" ? difference.colorShift[i] : difference.residualCurrent[i];
    const state = drop === null || !Number.isFinite(mismatch) || (filter.method === "projection" && !difference.projectionValid[i]) ? "unknown" :
      mask[i] ? "finger" : mismatch > (filter.method === "color" ? filter.maximumColorShift : filter.maximumResidual) ? "color-change" : "compatible";
    return { x, y, distance, state, drop };
  };
  const summarizeIntensity = (samples: Sample[]) => {
    const known = samples.filter((p) => p.state === "compatible");
    return { sampled: samples.length, compatible: known.length, unavailable: samples.length - known.length,
      meanDrop: known.length ? known.reduce((sum, p) => sum + p.drop!, 0) / known.length : null,
      fractions: TIP_EVIDENCE_SETTINGS.thresholds.map((threshold) => ({ threshold,
        fraction: known.length ? known.filter((p) => p.drop! > threshold).length / known.length : null })) };
  };
  const radius = Math.max(2, Math.min(8, Math.floor(tip.width / 4)));
  const rays: Array<{ x: number; boundary: number | null; boundaryOffset: number | null; samples: Sample[]; levels: Level[] }> = [];
  for (let x = tip.x - radius; x <= tip.x + radius; x += 1) {
    let boundary: number | null = null;
    if (x >= 0 && x < width) for (let y = Math.min(height - 1, tip.y + 6); y >= Math.max(2, tip.y - 8); y -= 1) {
      const i = y * width + x;
      if (mask[i] && mask[i - width] && mask[i - width * 2]) { boundary = y; break; }
    }
    const samples = boundary === null ? [] : Array.from({ length: TIP_EVIDENCE_SETTINGS.scanDistance }, (_, i) => sample(x, boundary + i + 1, i + 1));
    const levels = TIP_EVIDENCE_SETTINGS.thresholds.map((threshold) => {
      let status: "no-boundary" | "clear" | "measured" | "ambiguous" | "censored" = "no-boundary";
      let extent: number | null = null; let runWidth: number | null = null; let lowerBound: number | null = null;
      let start = -1;
      if (boundary !== null) {
        status = "clear"; extent = 0; runWidth = 0;
        for (let j = 0; j < TIP_EVIDENCE_SETTINGS.attachmentDistance; j += 1) {
          const p = samples[j];
          if (p.state !== "compatible") { status = p.state === "outside" ? "censored" : "ambiguous"; extent = null; runWidth = null; break; }
          if (p.drop! > threshold) { start = j; break; }
        }
        if (start >= 0) {
          let end = start;
          while (end < samples.length && samples[end].state === "compatible" && samples[end].drop! > threshold) end += 1;
          const terminal = samples[end];
          if (terminal?.state === "compatible") { status = "measured"; extent = end; runWidth = end - start; }
          else { status = !terminal || terminal.state === "outside" ? "censored" : "ambiguous";
            extent = null; runWidth = null; lowerBound = end; }
        }
      }
      return { threshold, status, extent, runWidth, lowerBound,
        startDistance: start >= 0 ? start + 1 : null,
        detachedStrongEvidence: start < 0 && samples.slice(TIP_EVIDENCE_SETTINGS.attachmentDistance).some((p) => p.state === "compatible" && p.drop! > threshold) };
    });
    rays.push({ x, boundary, boundaryOffset: boundary === null ? null : boundary - tip.y, samples, levels });
  }
  const levels = TIP_EVIDENCE_SETTINGS.thresholds.map((threshold, level) => {
    const measurements = rays.map((r) => r.levels[level]);
    const complete = measurements.filter((m) => m.extent !== null).map((m) => m.extent!).sort((a, b) => a - b);
    const adequate = complete.length >= Math.ceil(rays.length / 2);
    const middle = Math.floor(complete.length / 2);
    return { threshold, medianExtent: adequate ? (complete.length % 2 ? complete[middle] : (complete[middle - 1] + complete[middle]) / 2) : null,
      completeRays: complete.length, totalRays: rays.length, clearRays: measurements.filter((m) => m.status === "clear").length,
      censoredRays: measurements.filter((m) => m.status === "censored").length,
      ambiguousRays: measurements.filter((m) => m.status === "ambiguous" || m.status === "no-boundary").length };
  });
  const sideSamples: Sample[] = []; let sideRows = 0;
  for (let distance = 1; distance <= TIP_EVIDENCE_SETTINGS.scanDistance; distance += 1) {
    const y = tip.y - distance;
    if (y < 0 || !mask[y * width + tip.x]) continue;
    let left = tip.x; let right = tip.x;
    const bound = Math.ceil(tip.width / 2) + 8;
    while (left > 0 && tip.x - left < bound && mask[y * width + left - 1]) left -= 1;
    while (right < width - 1 && right - tip.x < bound && mask[y * width + right + 1]) right += 1;
    // A run that continues beyond the local window has no observed side boundary.
    if ((left > 0 && mask[y * width + left - 1]) || (right < width - 1 && mask[y * width + right + 1])) continue;
    sideRows += 1;
    for (let offset = 1; offset <= 6; offset += 1) sideSamples.push(sample(left - offset, y, distance), sample(right + offset, y, distance));
  }
  const tipDrops: number[] = [];
  for (let y = Math.max(0, tip.y - 3); y <= tip.y; y += 1) for (let x = Math.max(0, tip.x - 2); x <= Math.min(width - 1, tip.x + 2); x += 1) {
    const i = y * width + x;
    if (mask[i] && difference.valid[i] && Number.isFinite(difference.lumaDrop[i])) tipDrops.push(difference.lumaDrop[i]);
  }
  return { coordinateSpace: "analysis-pixels" as const, tip: { ...tip }, filter: { ...filter },
    settings: { scanDistance: 24, attachmentDistance: 3, nearDistance: 6, thresholds: [...TIP_EVIDENCE_SETTINGS.thresholds] },
    tipMeanDrop: tipDrops.length ? tipDrops.reduce((a, b) => a + b, 0) / tipDrops.length : null,
    forwardNear: summarizeIntensity(rays.flatMap((r) => r.samples.slice(0, TIP_EVIDENCE_SETTINGS.nearDistance))), levels, rays,
    sideBack: { ...summarizeIntensity(sideSamples), rowsWithBoundary: sideRows, totalRows: 24,
      reachesBackLimit: sideSamples.some((p) => p.distance === 24 && p.state === "compatible" && p.drop! > 5), samples: sideSamples } };
}

export const DIRECTIONAL_SHADOW_SETTINGS = {
  anglesDegrees: [-60, -40, -20, 0, 20, 40, 60],
  scanDistance: 24, rimAllowance: 2, attachmentDistance: 3,
  upwardMinimumRows: 3, upwardMinimumCoverage: 0.5,
};

/** Offline test of thin distal rim + upward context + clear forward fan.
 * Angles are relative to image-down, not calibrated paper-space directions.
 * Every cutoff is reported; a matching pattern is not a validated press.
 */
export function measureDirectionalShadowPattern(difference: ShadowDifference, mask: Uint8Array, tip: Tip,
  filter: CandidateFilter = TIP_EVIDENCE_SETTINGS.filter) {
  const central = measureTipShadowEvidence(difference, mask, tip, filter);
  if (!central) return null;
  const { width, height } = difference;
  const settings = DIRECTIONAL_SHADOW_SETTINGS;
  const sample = (x: number, y: number, distance: number): Sample => {
    if (x < 0 || x >= width || y < 0 || y >= height) return { x, y, distance, state: "outside", drop: null };
    const i = y * width + x;
    const mismatch = filter.method === "color" ? difference.colorShift[i] : difference.residualCurrent[i];
    const known = difference.valid[i] && Number.isFinite(difference.lumaDrop[i]) && Number.isFinite(mismatch) &&
      (filter.method !== "projection" || difference.projectionValid[i]);
    return { x, y, distance, drop: known ? difference.lumaDrop[i] : null,
      state: !known ? "unknown" : mask[i] ? "finger" :
        mismatch > (filter.method === "color" ? filter.maximumColorShift : filter.maximumResidual) ? "color-change" : "compatible" };
  };
  const rays = settings.anglesDegrees.map((angleDegrees) => {
    const angle = angleDegrees * Math.PI / 180;
    const x = tip.x + Math.round(Math.sin(angle) * tip.width * 0.4);
    let boundary: number | null = null;
    if (x >= 0 && x < width) for (let y = Math.min(height - 1, tip.y + 6); y >= Math.max(2, tip.y - 8); y -= 1) {
      if (mask[y * width + x] && mask[(y - 1) * width + x] && mask[(y - 2) * width + x]) { boundary = y; break; }
    }
    const samples = boundary === null ? [] : Array.from({ length: settings.scanDistance }, (_, i) => {
      const distance = i + 1;
      return sample(x + Math.round(Math.sin(angle) * distance), boundary! + Math.round(Math.cos(angle) * distance), distance);
    });
    return { angleDegrees, x, boundary, samples };
  });
  // Visible strips beside the finger, behind the distal rim. These can contain
  // a neighboring finger's shadow; they do not establish caster ownership.
  const upwardSamples = central.sideBack.samples.filter((p) => p.distance > settings.rimAllowance);
  const upwardKnown = upwardSamples.filter((p) => p.state === "compatible");
  const upwardCoverage = upwardSamples.length ? upwardKnown.length / upwardSamples.length : 0;
  const conjunction = (values: (boolean | null)[]) => values.includes(false) ? false : values.includes(null) ? null : true;
  const levels = TIP_EVIDENCE_SETTINGS.thresholds.map((threshold) => {
    const rayLevels = rays.map((ray) => {
      const samples = ray.samples;
      let extent: number | null = null;
      let status = "no-boundary";
      if (samples.length) {
        const start = samples.slice(0, settings.attachmentDistance).findIndex((p) => p.state !== "compatible" || p.drop! > threshold);
        if (start < 0) { extent = 0; status = "clear"; }
        else if (samples[start].state !== "compatible") status = "ambiguous";
        else {
          let end = start;
          while (end < samples.length && samples[end].state === "compatible" && samples[end].drop! > threshold) end += 1;
          if (samples[end]?.state === "compatible") { extent = end; status = "measured"; }
          else status = !samples[end] || samples[end].state === "outside" ? "censored" : "ambiguous";
        }
      }
      const beyondRim = samples.filter((p) => p.distance > settings.rimAllowance);
      const strongBeyondRim = beyondRim.filter((p) => p.state === "compatible" && p.drop! > threshold).length;
      const clearBeyondRim = strongBeyondRim ? false : !beyondRim.length || beyondRim.some((p) => p.state !== "compatible") ? null : true;
      return { angleDegrees: ray.angleDegrees, extent, status, strongBeyondRim, clearBeyondRim };
    });
    const upwardStrong = upwardKnown.filter((p) => p.drop! > threshold);
    const upwardStrongRows = new Set(upwardStrong.map((p) => p.y)).size;
    const upwardPresent = upwardStrongRows >= settings.upwardMinimumRows ? true :
      upwardCoverage < settings.upwardMinimumCoverage || new Set(upwardKnown.map((p) => p.y)).size < settings.upwardMinimumRows ? null : false;
    const thinBand = conjunction(rayLevels.map((r) => r.extent === null ? null : r.extent <= settings.rimAllowance));
    const downwardClear = conjunction(rayLevels.map((r) => r.clearBeyondRim));
    return { threshold, upwardStrongPixels: upwardStrong.length, upwardStrongRows, upwardPresent,
      thinBand, downwardClear, patternMatch: conjunction([upwardPresent, thinBand, downwardClear]), rayLevels };
  });
  return { coordinateSpace: "analysis-pixels" as const, tip: { ...tip }, filter: { ...filter }, settings: { ...settings },
    rays, upwardSamples, upwardCoverage, levels };
}

export const EDGE_SHADOW_SETTINGS = {
  maximumDownwardExtent: 8, scanDistance: 24, sideMargin: 8,
  distalEdgeRows: 8, upwardMinimumRows: 3, upwardMinimumWidth: 2,
};

/** At least one distal-edge-connected shadow must satisfy both shape conditions.
 * Bounded local components preserve connected upward/downward evidence. No ray veto.
 * Limits are exploratory analysis pixels, not calibrated contact measurements.
 */
export function measureEdgeShadowRegions(difference: ShadowDifference, mask: Uint8Array, tip: Tip,
  filter: CandidateFilter = TIP_EVIDENCE_SETTINGS.filter) {
  const central = measureTipShadowEvidence(difference, mask, tip, filter);
  if (!central) return null;
  const { width, height } = difference; const settings = EDGE_SHADOW_SETTINGS;
  const radius = Math.ceil(tip.width / 2) + settings.sideMargin;
  const bounds = { left: Math.max(0, tip.x - radius), right: Math.min(width - 1, tip.x + radius),
    top: Math.max(0, tip.y - settings.scanDistance), bottom: Math.min(height - 1, tip.y + settings.scanDistance) };
  const state = (x: number, y: number) => {
    if (x < 0 || x >= width || y < 0 || y >= height) return { known: false, drop: null };
    const i = y * width + x;
    const mismatch = filter.method === "color" ? difference.colorShift[i] : difference.residualCurrent[i];
    const known = !!difference.valid[i] && Number.isFinite(difference.lumaDrop[i]) && Number.isFinite(mismatch) &&
      (filter.method !== "projection" || !!difference.projectionValid[i]) &&
      mismatch <= (filter.method === "color" ? filter.maximumColorShift : filter.maximumResidual);
    return { known, drop: known ? difference.lumaDrop[i] : null };
  };
  const inside = (x: number, y: number) => x >= bounds.left && x <= bounds.right && y >= bounds.top && y <= bounds.bottom;
  const offsets = [-1, 0, 1].flatMap((dy) => [-1, 0, 1].filter((dx) => dx || dy).map((dx) => [dx, dy]));
  // Only the mask component containing the saved tip's local interior supplies
  // edges; a disconnected neighboring finger must not seed target evidence.
  const finger = new Set<number>(); const pending: number[] = [];
  for (let y = tip.y; y >= Math.max(bounds.top, tip.y - 8); y -= 1) {
    const i = y * width + tip.x;
    if (mask[i]) { pending.push(i); finger.add(i); break; }
  }
  for (let k = 0; k < pending.length; k += 1) {
    const i = pending[k]; const x = i % width; const y = Math.floor(i / width);
    for (const [dx, dy] of offsets) {
      const nx = x + dx; const ny = y + dy; const j = ny * width + nx;
      if (inside(nx, ny) && mask[j] && !finger.has(j)) { finger.add(j); pending.push(j); }
    }
  }
  const edgeSamples = new Set<number>();
  for (const i of finger) {
    const x = i % width; const y = Math.floor(i / width);
    if (y < tip.y - settings.distalEdgeRows || y > tip.y + 6 || Math.abs(x - tip.x) > Math.ceil(tip.width / 2)) continue;
    for (const [dx, dy] of offsets) {
      const nx = x + dx; const ny = y + dy; const j = ny * width + nx;
      if (inside(nx, ny) && !mask[j]) edgeSamples.add(j);
    }
  }
  const upwardIndices = new Set(central.sideBack.samples.filter((p) => p.distance > 2).map((p) => p.y * width + p.x));
  const levels = TIP_EVIDENCE_SETTINGS.thresholds.map((threshold) => {
    const visited = new Set<number>();
    const regions = [];
    let uncertainEdge = !edgeSamples.size;
    for (const i of edgeSamples) if (!state(i % width, Math.floor(i / width)).known) uncertainEdge = true;
    for (const seed of edgeSamples) {
      const first = state(seed % width, Math.floor(seed / width));
      if (visited.has(seed) || !first.known || first.drop! <= threshold) continue;
      const pixels = [seed]; visited.add(seed);
      let bottom = Math.floor(seed / width); let totalDrop = 0;
      let unknownDownwardBoundary = false; let unknownUpwardBoundary = false; let reachesSideLimit = false;
      const upwardRows = new Map<number, number[]>();
      for (let k = 0; k < pixels.length; k += 1) {
        const i = pixels[k]; const x = i % width; const y = Math.floor(i / width);
        bottom = Math.max(bottom, y); totalDrop += state(x, y).drop!;
        if (upwardIndices.has(i)) { const row = upwardRows.get(y) ?? []; row.push(x); upwardRows.set(y, row); }
        if (x === bounds.left || x === bounds.right) reachesSideLimit = true;
        for (const [dx, dy] of offsets) {
          const nx = x + dx; const ny = y + dy; const j = ny * width + nx;
          if (nx < 0 || nx >= width || ny < 0 || ny >= height) {
            if (ny >= tip.y) unknownDownwardBoundary = true;
            continue;
          }
          if (mask[j]) continue;
          const next = state(nx, ny);
          if (!next.known && ny >= tip.y) unknownDownwardBoundary = true;
          if (!next.known && ny < tip.y) unknownUpwardBoundary = true;
          if (inside(nx, ny) && next.known && next.drop! > threshold && !visited.has(j)) { visited.add(j); pixels.push(j); }
        }
      }
      const rowWidths = [...upwardRows].map(([y, xs]) => {
        xs.sort((a, b) => a - b); let maximum = 0; let run = 0; let previous = -2;
        for (const x of xs) { run = x === previous + 1 ? run + 1 : 1; maximum = Math.max(maximum, run); previous = x; }
        return { y, width: maximum };
      });
      const upwardWideRows = rowWidths.filter((r) => r.width >= settings.upwardMinimumWidth).length;
      const upwardPresent = upwardWideRows >= settings.upwardMinimumRows ? true : unknownUpwardBoundary ? null : false;
      const downwardExtent = Math.max(0, bottom - tip.y);
      const reachesDownwardLimit = bottom === bounds.bottom;
      const downwardShort = downwardExtent > settings.maximumDownwardExtent ? false :
        unknownDownwardBoundary || reachesDownwardLimit || reachesSideLimit ? null : true;
      const patternMatch = upwardPresent === false || downwardShort === false ? false :
        upwardPresent === null || downwardShort === null ? null : true;
      regions.push({ id: regions.length + 1, pixels: pixels.map((i) => ({ x: i % width, y: Math.floor(i / width) })),
        edgeSeeds: pixels.filter((i) => edgeSamples.has(i)).map((i) => ({ x: i % width, y: Math.floor(i / width) })),
        meanDrop: totalDrop / pixels.length, downwardExtent, upwardWideRows, upwardRowWidths: rowWidths,
        upwardPresent, downwardShort, unknownDownwardBoundary, unknownUpwardBoundary, reachesDownwardLimit, reachesSideLimit, patternMatch });
    }
    // Positive evidence wins even when another local region is too long or unknown.
    const patternMatch = regions.some((r) => r.patternMatch === true) ? true :
      uncertainEdge || regions.some((r) => r.patternMatch === null) ? null : false;
    return { threshold, patternMatch, uncertainEdge, qualifyingRegions: regions.filter((r) => r.patternMatch === true).map((r) => r.id), regions };
  });
  return { coordinateSpace: "analysis-pixels" as const, tip: { ...tip }, filter: { ...filter }, settings: { ...settings }, bounds,
    edgeSamples: [...edgeSamples].map((i) => ({ x: i % width, y: Math.floor(i / width) })),
    upwardSamples: central.sideBack.samples.filter((p) => p.distance > 2), levels };
}

export const MONOTONE_SHADOW_SETTINGS = { c: 4, d: 4, e: 4, searchWidth: null as number | null,
  downwardThreshold: null as number | null, corridorRadius: null as number | null };

export { filteredDarkeningBoundaryMask } from "./shadowHeatmap";

/** User's bounded directional DFS: any downward reach vetoes, one upward path supports.
 * Horizontal budget is a local rule, not an unknown endpoint. Colors failing the
 * chosen shadow filter stop traversal; only unavailable measurements are unknown.
 */
export function measureMonotoneShadowPaths(difference: ShadowDifference, mask: Uint8Array, tip: Tip,
  filter: CandidateFilter = TIP_EVIDENCE_SETTINGS.filter,
  options: Partial<typeof MONOTONE_SHADOW_SETTINGS> = {}) {
  if (!measureTipShadowEvidence(difference, mask, tip, filter)) return null;
  const settings = { ...MONOTONE_SHADOW_SETTINGS, ...options };
  const searchWidth = settings.searchWidth ?? Math.round(tip.width);
  if (![settings.c, settings.d, settings.e].every((v) => Number.isInteger(v) && v >= 1 && v <= 24) ||
    !Number.isInteger(searchWidth) || searchWidth < 1 || searchWidth > 128 ||
    (settings.downwardThreshold !== null && (!Number.isFinite(settings.downwardThreshold) ||
      settings.downwardThreshold < 0 || settings.downwardThreshold > 255)) ||
    (settings.corridorRadius !== null && (!Number.isInteger(settings.corridorRadius) ||
      settings.corridorRadius < Math.max(settings.d, settings.e) || settings.corridorRadius > 24))) return null;
  const { width, height } = difference;
  const aY = tip.y - settings.c; const downwardY = tip.y + settings.d; const upwardY = aY - settings.e;
  const state = (x: number, y: number, threshold: number) => {
    if (x < 0 || x >= width || y < 0 || y >= height) return "unknown";
    const i = y * width + x;
    if (mask[i]) return "clear";
    const mismatch = filter.method === "color" ? difference.colorShift[i] : difference.residualCurrent[i];
    if (!difference.valid[i] || !Number.isFinite(difference.lumaDrop[i]) || !Number.isFinite(mismatch) ||
      (filter.method === "projection" && !difference.projectionValid[i])) return "unknown";
    return difference.lumaDrop[i] > threshold && mismatch <= (filter.method === "color" ? filter.maximumColorShift : filter.maximumResidual) ? "shadow" : "clear";
  };
  let left = tip.x; let right = tip.x;
  const geometryReady = aY >= 0 && !!mask[aY * width + tip.x];
  if (geometryReady) {
    while (left > 0 && tip.x - left < Math.ceil(tip.width) && mask[aY * width + left - 1]) left -= 1;
    while (right < width - 1 && right - tip.x < Math.ceil(tip.width) && mask[aY * width + right + 1]) right += 1;
  }
  const crossSectionComplete = geometryReady && left > 0 && right < width - 1 &&
    !mask[aY * width + left - 1] && !mask[aY * width + right + 1];
  const contour = new Map<number, { x: number; y: number }>();
  let incompleteArc = !crossSectionComplete;
  if (crossSectionComplete) {
    const interior = new Set<number>(); const pending: number[] = [];
    for (let x = left; x <= right; x += 1) { const i = aY * width + x; interior.add(i); pending.push(i); }
    for (let k = 0; k < pending.length; k += 1) {
      const i = pending[k]; const x = i % width; const y = Math.floor(i / width);
      if (y >= tip.y + 6 || y === height - 1) incompleteArc = true;
      for (let dy = -1; dy <= 1; dy += 1) for (let dx = -1; dx <= 1; dx += 1) {
        const nx = x + dx; const ny = y + dy; const j = ny * width + nx;
        if (nx >= left && nx <= right && ny >= aY && ny <= tip.y + 6 && ny < height && mask[j] && !interior.has(j)) {
          interior.add(j); pending.push(j);
        }
      }
    }
    // External lower envelope plus both side envelopes below a. Interior holes
    // do not seed shadows, and the artificial horizontal cut at a is excluded.
    for (let x = left; x <= right; x += 1) {
      let y = aY;
      for (let row = aY; row <= Math.min(height - 1, tip.y + 6); row += 1) if (interior.has(row * width + x)) y = row;
      contour.set(y * width + x, { x, y });
    }
    for (let y = aY; y <= Math.min(height - 1, tip.y + 6); y += 1) {
      let first = -1; let last = -1;
      for (let x = left; x <= right; x += 1) if (interior.has(y * width + x)) { if (first < 0) first = x; last = x; }
      if (first >= 0) { contour.set(y * width + first, { x: first, y }); contour.set(y * width + last, { x: last, y }); }
    }
  }
  const arc = [...contour.values()];
  // Eight-neighbor (Chebyshev) distance to the selected curved arc. The band
  // radius must permit the existing d/e rows; a cap is a local stop, not unknown.
  const corridor = new Set<number>();
  if (settings.corridorRadius !== null) for (const p of arc) {
    for (let dy = -settings.corridorRadius; dy <= settings.corridorRadius; dy += 1) {
      for (let dx = -settings.corridorRadius; dx <= settings.corridorRadius; dx += 1) {
        const x = p.x + dx; const y = p.y + dy;
        if (x >= 0 && x < width && y >= 0 && y < height && !mask[y * width + x]) corridor.add(y * width + x);
      }
    }
  }
  // Locality limits sideways travel, not forward depth. Extend the distal cap
  // straight down to the saved veto row, even when the saved tip is a pixel
  // below the recomputed boundary. Do not extend the wider upper side arc.
  if (settings.corridorRadius !== null && arc.length) {
    const distalY = Math.max(...arc.map((p) => p.y));
    for (const p of arc) if (p.y === distalY) {
      for (let x = Math.max(0, p.x - settings.corridorRadius); x <= Math.min(width - 1, p.x + settings.corridorRadius); x += 1) {
        for (let y = distalY; y <= Math.min(height - 1, downwardY); y += 1) {
          if (!mask[y * width + x]) corridor.add(y * width + x);
        }
      }
    }
  }
  const corridorReachesDownwardRow = settings.corridorRadius === null ||
    [...corridor].some((i) => Math.floor(i / width) === downwardY);
  const edge = new Map<number, { x: number; y: number }>();
  for (const p of arc) for (let dy = -1; dy <= 1; dy += 1) for (let dx = -1; dx <= 1; dx += 1) {
    const x = p.x + dx; const y = p.y + dy;
    if (y >= aY && x >= 0 && x < width && y < height && !mask[y * width + x]) edge.set(y * width + x, { x, y });
  }
  const search = (seed: { x: number; y: number }, threshold: number, direction: 1 | -1) => {
    const minimumX = seed.x - Math.floor(searchWidth / 2); const maximumX = minimumX + searchWidth - 1;
    const targetY = direction === 1 ? downwardY : upwardY;
    const stack = [seed.y * width + seed.x]; const parents = new Map<number, number | null>([[stack[0], null]]);
    let reached: number | null = null; let unavailable = false; let hitWidthLimit = false; let hitCorridorLimit = false;
    for (; stack.length;) {
      const i = stack.pop()!; const x = i % width; const y = Math.floor(i / width);
      if (direction === 1 ? y >= targetY : y <= targetY) { reached = i; break; }
      for (const dy of [0, direction]) for (const dx of [-1, 0, 1]) {
        if (!dx && !dy) continue;
        const nx = x + dx; const ny = y + dy;
        if (nx < minimumX || nx > maximumX) { hitWidthLimit = true; continue; }
        if (nx < 0 || nx >= width || ny < 0 || ny >= height) { unavailable = true; continue; }
        if (settings.corridorRadius !== null && !mask[ny * width + nx] && !corridor.has(ny * width + nx)) {
          hitCorridorLimit = true; continue;
        }
        const next = state(nx, ny, threshold);
        if (next === "unknown") { unavailable = true; continue; }
        const j = ny * width + nx;
        if (next === "shadow" && !parents.has(j)) { parents.set(j, i); stack.push(j); }
      }
    }
    const path = [];
    for (let i = reached; i !== null; i = parents.get(i) ?? null) path.push({ x: i % width, y: Math.floor(i / width) });
    path.reverse();
    return { seed, minimumX, maximumX, targetY, reached: reached !== null,
      endpoint: reached === null ? null : { x: reached % width, y: Math.floor(reached / width) }, path,
      visited: [...parents.keys()].map((i) => ({ x: i % width, y: Math.floor(i / width) })), unavailable, hitWidthLimit, hitCorridorLimit };
  };
  const levels = TIP_EVIDENCE_SETTINGS.thresholds.map((threshold) => {
    const attachments = [...edge.values()].filter((p) => state(p.x, p.y, threshold) === "shadow");
    const downwardThreshold = settings.downwardThreshold ?? threshold;
    const downwardAttachments = [...edge.values()].filter((p) => state(p.x, p.y, downwardThreshold) === "shadow");
    const unknownEdge = incompleteArc || [...edge.values()].some((p) => state(p.x, p.y, threshold) === "unknown");
    const downwardSearches = []; const upwardSearches = [];
    // Complete the veto before considering upward acceptance; a later edge can reject.
    for (const seed of downwardAttachments) { const result = search(seed, downwardThreshold, 1); downwardSearches.push(result); if (result.reached) break; }
    for (const seed of attachments) { const result = search(seed, threshold, -1); upwardSearches.push(result); if (result.reached) break; }
    const downwardVeto = downwardSearches.some((r) => r.reached);
    const upwardReached = upwardSearches.some((r) => r.reached);
    const downwardUnknown = unknownEdge || downwardSearches.some((r) => r.unavailable);
    const upwardUnknown = unknownEdge || upwardSearches.some((r) => r.unavailable);
    const patternMatch = downwardVeto ? false : !upwardReached && !upwardUnknown ? false :
      downwardUnknown || !upwardReached ? null : true;
    return { threshold, downwardThreshold, attachments, downwardAttachments, downwardVeto, upwardReached, downwardUnknown, upwardUnknown,
      patternMatch, downwardSearches, upwardSearches,
      rejectionPixel: downwardSearches.find((r) => r.reached)?.endpoint ?? null,
      supportingPixel: upwardSearches.find((r) => r.reached)?.endpoint ?? null };
  });
  return { coordinateSpace: "analysis-pixels" as const, tip: { ...tip }, filter: { ...filter },
    settings: { ...settings, searchWidth }, aY, downwardY, upwardY, crossSection: { left, right, complete: crossSectionComplete }, arc,
    corridorReachesDownwardRow, corridor: [...corridor].map((i) => ({ x: i % width, y: Math.floor(i / width) })),
    edgeSamples: [...edge.values()], levels };
}
