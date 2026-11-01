import { filteredDarkeningBoundaryMask, type ShadowDifference, type CandidateFilter } from "./shadowHeatmap";
import { measureShadowBand } from "./shadowBand";

export interface FingertipOptions {
  noiseFloor: number;
  minimumColorShift: number;
  minimumComponentArea: number;
  minimumProminence: number;
  minimumSeparation: number;
  maximumFingerWidth: number;
  scanDistance: number;
  filter: CandidateFilter;
}

export const DEFAULT_FINGERTIP_OPTIONS: FingertipOptions = {
  noiseFloor: 5, minimumColorShift: 10, minimumComponentArea: 80,
  minimumProminence: 4, minimumSeparation: 12, maximumFingerWidth: 44,
  scanDistance: 24,
  filter: { method: "projection", maximumColorShift: 10, maximumResidual: 0.12 },
};

/** Offline hypothesis: reddish changed regions, with fingers pointing down in the image.
 * This is neither a general skin segmenter nor anatomical finger identification.
 */
export function estimateFingertips(current: ImageData, difference: ShadowDifference,
  options: FingertipOptions = DEFAULT_FINGERTIP_OPTIONS) {
  const { width, height } = difference;
  const count = width * height;
  if (current.width !== width || current.height !== height || current.data.length !== count * 4 ||
    !Number.isInteger(width) || !Number.isInteger(height) || width < 1 || height < 1 || count > 640 * 640 ||
    ![options.noiseFloor, options.minimumColorShift, options.minimumComponentArea,
      options.minimumProminence, options.minimumSeparation, options.maximumFingerWidth,
      options.scanDistance, options.filter.maximumColorShift, options.filter.maximumResidual].every(Number.isFinite) ||
    options.noiseFloor < 0 || options.noiseFloor > 255 || options.minimumColorShift < 0 || options.minimumColorShift > 255 ||
    options.minimumComponentArea < 1 || options.minimumComponentArea > 640 * 640 ||
    options.minimumProminence < 1 || options.minimumProminence > 640 || options.minimumSeparation < 2 || options.minimumSeparation > 640 ||
    options.maximumFingerWidth < 3 || options.maximumFingerWidth > 128 || options.filter.maximumColorShift < 0 ||
    options.filter.maximumResidual < 0 || !["color", "projection"].includes(options.filter.method) ||
    !Number.isInteger(options.scanDistance) || options.scanDistance < 1 || options.scanDistance > 64) return null;
  const eligible = (i: number) => difference.valid[i] && difference.lumaDrop[i] > options.noiseFloor &&
    Number.isFinite(difference.colorShift[i]);
  const chroma = (i: number) => {
    const j = i * 4; const sum = current.data[j] + current.data[j + 1] + current.data[j + 2];
    return [current.data[j] / sum, current.data[j + 1] / sum];
  };
  // Bounded, deterministic training on raw measurements, never rendered heatmap RGB.
  const samples: number[][] = [];
  const stride = Math.max(1, Math.ceil(count / 8192));
  for (let i = 0; i < count; i += stride) if (eligible(i)) samples.push(chroma(i));
  const squared = (a: number[], b: number[]) => (a[0] - b[0]) ** 2 + (a[1] - b[1]) ** 2;
  const centers: number[][] = [];
  if (samples.length) {
    centers.push([...samples.reduce((best, p) => p[0] > best[0] ? p : best)]);
    while (centers.length < 4) {
      let distance = 0; let next: number[] | null = null;
      for (const p of samples) {
        const d = Math.min(...centers.map((c) => squared(p, c)));
        if (d > distance) { distance = d; next = p; }
      }
      if (!next || distance < 1e-8) break;
      centers.push([...next]);
    }
  }
  const nearest = (p: number[]) => {
    let best = 0;
    for (let c = 1; c < centers.length; c += 1) if (squared(p, centers[c]) < squared(p, centers[best])) best = c;
    return best;
  };
  for (let iteration = 0; iteration < 10 && centers.length; iteration += 1) {
    const sums = centers.map(() => [0, 0, 0]);
    for (const p of samples) { const s = sums[nearest(p)]; s[0] += p[0]; s[1] += p[1]; s[2] += 1; }
    for (let c = 0; c < centers.length; c += 1) if (sums[c][2]) centers[c] = [sums[c][0] / sums[c][2], sums[c][1] / sums[c][2]];
  }
  const reddish = centers.map(([r, g]) => r - (1 - r - g) > 0.08 && r > g);
  const raw = new Uint8Array(count);
  for (let i = 0; i < count; i += 1) if (centers.length && eligible(i) &&
    difference.colorShift[i] > options.minimumColorShift && reddish[nearest(chroma(i))]) raw[i] = 1;
  // Fill one-pixel cracks only where comparison evidence is valid; preserve unknown holes.
  const mask = raw.slice();
  for (let y = 1; y < height - 1; y += 1) for (let x = 1; x < width - 1; x += 1) {
    const i = y * width + x;
    if (raw[i] || !eligible(i) || difference.colorShift[i] <= options.minimumColorShift) continue;
    let neighbors = 0;
    for (let dy = -1; dy <= 1; dy += 1) for (let dx = -1; dx <= 1; dx += 1) neighbors += raw[i + dy * width + dx];
    if (neighbors >= 5) mask[i] = 1;
  }
  return { ...extractFingertips(mask, difference, options),
    clusters: centers.map(([r, g], i) => ({ r, g, b: 1 - r - g, selected: reddish[i] })) };
}

/** Extract spatial distal ends from a supplied mask. No anatomical labels,
 * saved anchors, per-finger image gates or temporal identity enter this step.
 */
function extractFingertips(inputMask: Uint8Array, difference: ShadowDifference, options: FingertipOptions, localLobes = false) {
  const { width, height } = difference; const count = width * height;
  const mask = inputMask.slice();
  const labels = new Int32Array(count);
  const queue = new Int32Array(count);
  const components: Array<{ id: number; area: number; left: number; right: number; top: number; bottom: number }> = [];
  let nextId = 0;
  for (let start = 0; start < count; start += 1) {
    if (!mask[start] || labels[start]) continue;
    const id = ++nextId; let head = 0; let tail = 1; queue[0] = start; labels[start] = id;
    let left = width; let right = 0; let top = height; let bottom = 0;
    while (head < tail) {
      const i = queue[head++]; const x = i % width; const y = Math.floor(i / width);
      left = Math.min(left, x); right = Math.max(right, x); top = Math.min(top, y); bottom = Math.max(bottom, y);
      for (let dy = -1; dy <= 1; dy += 1) for (let dx = -1; dx <= 1; dx += 1) {
        const nx = x + dx; const ny = y + dy; const j = ny * width + nx;
        if (nx < 0 || nx >= width || ny < 0 || ny >= height || !mask[j] || labels[j]) continue;
        labels[j] = id; queue[tail++] = j;
      }
    }
    if (tail >= options.minimumComponentArea && bottom - top >= 16) components.push({ id, area: tail, left, right, top, bottom });
    else for (let j = 0; j < tail; j += 1) mask[queue[j]] = 0;
  }
  const tips: Array<{ x: number; y: number; component: number; width: number; prominence: number; lobeBounds?: { left: number; right: number } }> = [];
  for (const component of components) {
    const envelope = new Float32Array(width).fill(-1);
    for (let x = component.left; x <= component.right; x += 1) {
      for (let y = component.bottom; y >= component.top + 2; y -= 1) {
        const i = y * width + x;
        if (labels[i] === component.id && labels[i - width] === component.id && labels[i - width * 2] === component.id) { envelope[x] = y; break; }
      }
    }
    const smooth = envelope.slice();
    for (let x = component.left; x <= component.right; x += 1) {
      const values = [];
      for (let dx = -2; dx <= 2; dx += 1) if (envelope[x + dx] >= 0) values.push(envelope[x + dx]);
      if (values.length) { values.sort((a, b) => a - b); smooth[x] = values[Math.floor(values.length / 2)]; }
    }
    const proposals = [];
    for (let x = component.left; x <= component.right; x += 1) {
      const start = x; const y = smooth[start];
      let end = start;
      while (end < component.right && smooth[end + 1] === y) end += 1;
      x = end; // Process the complete plateau once, including rejected shoulders.
      if (y < component.top + 8 || y >= height - 1 || start === 0 || end === width - 1) continue;
      if ((smooth[start - 1] ?? -1) >= y || (smooth[end + 1] ?? -1) >= y) continue;
      let center = Math.round((start + end) / 2);
      if (localLobes) {
        const lowest = Math.max(...envelope.slice(start, end + 1));
        const supported = [];
        for (let column = start; column <= end; column += 1) if (envelope[column] === lowest) supported.push(column);
        center = supported[Math.floor(supported.length / 2)];
      }
      const tipY = envelope[center];
      const peakY = localLobes ? tipY : y;
      const outline = localLobes ? envelope : smooth;
      const radius = Math.round(options.maximumFingerWidth / 2);
      let lowLeft = peakY; let lowRight = peakY;
      let leftValley = component.left; let rightValley = component.right;
      for (let dx = 1; dx <= radius; dx += 1) {
        const lx = start - dx; const rx = end + dx;
        const ly = outline[lx] >= 0 ? outline[lx] : component.top;
        const ry = outline[rx] >= 0 ? outline[rx] : component.top;
        if (ly < lowLeft) { lowLeft = ly; leftValley = Math.max(0, lx); }
        if (ry < lowRight) { lowRight = ry; rightValley = Math.min(width - 1, rx); }
      }
      const prominence = peakY - Math.max(lowLeft, lowRight);
      const row = Math.max(component.top, Math.round(tipY - 8));
      let left = center; let right = center;
      if (tipY < 0 || labels[row * width + center] !== component.id) continue;
      const minimumX = localLobes ? leftValley : 0;
      const maximumX = localLobes ? rightValley : width - 1;
      while (left > minimumX && labels[row * width + left - 1] === component.id) left -= 1;
      while (right < maximumX && labels[row * width + right + 1] === component.id) right += 1;
      const fingerWidth = right - left + 1;
      if (prominence >= options.minimumProminence && fingerWidth >= 5 && fingerWidth <= options.maximumFingerWidth)
        proposals.push({ x: center, y: tipY, component: component.id, width: fingerWidth, prominence,
          ...(localLobes ? { lobeBounds: { left: leftValley, right: rightValley } } : {}) });
    }
    proposals.sort((a, b) => b.prominence - a.prominence);
    for (const p of proposals) if (!tips.some((t) => Math.abs(t.x - p.x) < Math.max(options.minimumSeparation,
      Math.min(t.width, p.width) * 0.85) && t.component === p.component)) tips.push(p);
  }
  tips.sort((a, b) => a.x - b.x);
  const candidates = tips.slice(0, 20).map((tip, index) => {
    const radius = Math.ceil(tip.width / 2) + 6;
    const bounds = { left: Math.max(0, tip.x - radius), right: Math.min(width - 1, tip.x + radius),
      top: Math.max(0, tip.y - options.scanDistance), bottom: Math.min(height - 1, tip.y + options.scanDistance) };
    let forward: number | null = null; let behind: number | null = null;
    let shadowPixels = 0; let unknownPixels = 0; let forwardCensored = false; let behindCensored = false;
    for (let y = bounds.top; y <= bounds.bottom; y += 1) for (let x = bounds.left; x <= bounds.right; x += 1) {
      const i = y * width + x;
      if (mask[i]) continue;
      const mismatch = options.filter.method === "color" ? difference.colorShift[i] : difference.residualCurrent[i];
      if (!difference.valid[i] || !Number.isFinite(mismatch) || (options.filter.method === "projection" && !difference.projectionValid[i])) { unknownPixels += 1; continue; }
      if (difference.lumaDrop[i] <= options.noiseFloor || mismatch > (options.filter.method === "color" ? options.filter.maximumColorShift : options.filter.maximumResidual)) continue;
      shadowPixels += 1;
      if (y > tip.y) { forward = Math.max(forward ?? 0, y - tip.y); if (y === bounds.bottom) forwardCensored = true; }
      if (y < tip.y) { behind = Math.max(behind ?? 0, tip.y - y); if (y === bounds.top) behindCensored = true; }
    }
    const outward = { x: tip.x, y: Math.min(height - 1, tip.y + 1) };
    return { id: index + 1, ...tip, bounds,
      forwardBand: measureShadowBand(difference, tip, outward, { ...options.filter, noiseFloor: options.noiseFloor, maxDistance: options.scanDistance, halfWidth: 2 }),
      neighborhood: { shadowPixels, unknownPixels, forwardExtent: forward, behindExtent: behind, forwardCensored, behindCensored } };
  });
  return { coordinateSpace: "analysis-pixels" as const, assumption: "fingers-point-down" as const,
    options: { ...options, filter: { ...options.filter } },
    mask, components, candidates };
}


/** Automatic proposals from the same raw filtered-darkening geometry as DFS.
 * Assumes downward-facing fingers; connected/occluded tips can remain merged.
 * IDs are spatial candidate numbers for this frame, not tracking identities.
 */
export function identifyFilteredFingertips(difference: ShadowDifference,
  overrides: Partial<Omit<FingertipOptions, "noiseFloor" | "minimumColorShift">> = {}) {
  const options = { ...DEFAULT_FINGERTIP_OPTIONS, minimumProminence: 2, ...overrides };
  const { width, height } = difference; const count = width * height;
  if (!Number.isInteger(width) || !Number.isInteger(height) || width < 1 || height < 1 || count > 640 * 640 ||
    ![difference.valid, difference.projectionValid, difference.lumaDrop, difference.colorShift, difference.residualCurrent].every((a) => a.length === count) ||
    ![options.minimumComponentArea, options.minimumProminence, options.minimumSeparation,
      options.maximumFingerWidth, options.scanDistance, options.filter.maximumColorShift, options.filter.maximumResidual].every(Number.isFinite) ||
    options.minimumComponentArea < 1 || options.minimumComponentArea > 640 * 640 ||
    options.minimumProminence < 1 || options.minimumProminence > 640 || options.minimumSeparation < 2 || options.minimumSeparation > 640 ||
    options.maximumFingerWidth < 3 || options.maximumFingerWidth > 128 || options.filter.maximumColorShift < 0 || options.filter.maximumResidual < 0 ||
    !["color", "projection"].includes(options.filter.method) || !Number.isInteger(options.scanDistance) || options.scanDistance < 1 || options.scanDistance > 64) return null;
  // Geometry always uses the established >5 darkening floor, independently of
  // the four DFS cutoffs. Do not derive it by inverting rendered black pixels.
  const mask = filteredDarkeningBoundaryMask(difference, options.filter);
  const result = extractFingertips(mask, difference, { ...options, noiseFloor: 5 }, true);
  return { ...result, mask, segmentation: "filtered-darkening" as const, clusters: [] };
}
