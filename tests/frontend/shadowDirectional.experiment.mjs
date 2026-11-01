// Offline hypothesis comparison; reuses the exact native sources from the prior export.
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { createRequire } from "node:module";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const require = createRequire(new URL("../../frontend/package.json", import.meta.url));
const { chromium } = require("playwright"); const ts = require("typescript");
const previous = path.join(root, "frontend/test-results/shadow-hypothesis");
const regionMode = process.argv.includes("--edge-regions");
const dfsMode = process.argv.includes("--dfs");
const strongDownward = process.argv.includes("--strong-downward");
const localCorridor = process.argv.includes("--local-corridor");
assert.ok(!(strongDownward && localCorridor), "Choose strength OR locality");
assert.ok(!localCorridor || dfsMode, "Local corridor requires --dfs");
const filteredBoundary = strongDownward || localCorridor || process.argv.includes("--filtered-boundary");
assert.ok(!strongDownward || dfsMode, "Strong downward mode requires --dfs");
assert.ok(!filteredBoundary || dfsMode, "Filtered boundary requires --dfs");
assert.ok(!(regionMode && dfsMode), "Select one experiment mode");
const output = path.join(root, `frontend/test-results/${dfsMode ? (filteredBoundary && !strongDownward && !localCorridor ? "shadow-dfs-filtered-boundary" : "shadow-dfs") : regionMode ? "shadow-edge-regions" : "shadow-directional"}`);
let previousDfsBytes = null;
if (strongDownward || localCorridor) {
  try { previousDfsBytes = await readFile(path.join(output, "previous-results.json")); }
  catch (error) { if (error.code !== "ENOENT") throw error; previousDfsBytes = await readFile(path.join(output, "results.json")); }
  assert.equal(JSON.parse(previousDfsBytes).records.length, 30);
  await writeFile(path.join(output, "previous-results.json"), previousDfsBytes);
}
let d80Bytes = null;
if (localCorridor) {
  try { d80Bytes = await readFile(path.join(output, "d80-results.json")); }
  catch (error) {
    if (error.code !== "ENOENT") throw error;
    d80Bytes = await readFile(path.join(output, "results.json"));
    assert.equal(JSON.parse(d80Bytes).strongDownward, true, "Expected D80 snapshot before replacement");
  }
  await writeFile(path.join(output, "d80-results.json"), d80Bytes);
}
const hash = (bytes) => createHash("sha256").update(bytes).digest("hex");
const baselineBytes = await readFile(path.join(previous, "results.json"));
const baseline = JSON.parse(baselineBytes);
assert.equal(baseline.records.length, 30, "Expected the original 30-frame comparison");
const later = JSON.parse(await readFile(path.join(root, baseline.frameCaches[1].path)));
const referenceBytes = await readFile(path.join(root, baseline.reference));
assert.equal(hash(referenceBytes), baseline.referenceSha256, "Reference changed since the baseline");
const reference = `data:image/png;base64,${referenceBytes.toString("base64")}`;
const codes = {};
for (const name of ["shadowHeatmap", "shadowBand", "fingertipCandidates", "shadowTipEvidence"]) {
  codes[`./${name}`] = ts.transpileModule(await readFile(path.join(root, `frontend/src/cv/${name}.ts`), "utf8"),
    { compilerOptions: { target: ts.ScriptTarget.ES2020, module: ts.ModuleKind.CommonJS } }).outputText;
}
const tokens = (await readFile(path.join(root, "frontend/src/app/globals.css"), "utf8")).match(/--color-[\w-]+\s*:[^;]+;/g).join("\n");
await mkdir(output, { recursive: true });
const browser = await chromium.launch({ channel: process.env.CV_BROWSER_CHANNEL || "chrome", headless: true });
const records = [];
try {
  const page = await browser.newPage();
  await page.setContent(`<style>:root { ${tokens} }</style>`);
  await page.evaluate((codes) => {
    const modules = {};
    for (const [name, code] of Object.entries(codes)) { const exports = {};
      new Function("exports", "require", code)(exports, (id) => modules[id]); modules[name] = exports; }
    window.experiment = { ...modules["./shadowHeatmap"], ...modules["./fingertipCandidates"], ...modules["./shadowTipEvidence"] };
  }, codes);
  for (const old of baseline.records) {
    const source = old.group === "middle-first" ? `data:image/png;base64,${(await readFile(path.join(previous, `${old.group}-${old.frame}.native.png`))).toString("base64")}` :
      later.frames.find((f) => f.frame === old.frame && f.finger === (old.group === "index" ? "index" : "middle")).source;
    assert.equal(hash(Buffer.from(source.split(",")[1], "base64")), old.sourceSha256, "Source changed since baseline");
    const gate = baseline.association.find((g) => g.id === old.group);
    const result = await page.evaluate(async ({ source, reference, gate, old, regionMode, dfsMode, filteredBoundary, strongDownward, localCorridor }) => {
      const api = window.experiment;
      const load = async (url) => { const image = new Image(); image.src = url; await image.decode(); return image; };
      const image = await load(source); const background = await load(reference);
      const width = old.width; const height = old.height;
      const sample = (image) => { const c = document.createElement("canvas"); c.width = width; c.height = height;
        const ctx = c.getContext("2d"); ctx.drawImage(image, 0, 0, width, height); return ctx.getImageData(0, 0, width, height); };
      const current = sample(image); const difference = api.measureShadowDifference(current, sample(background), 40);
      const estimates = api.estimateFingertips(current, difference);
      const crop = gate.crop;
      const eligible = estimates.candidates.filter((c) => Math.abs(c.x - gate.targetX) <= gate.maximumXDistance && c.y >= crop[1] && c.y < crop[1] + crop[3]);
      const recomputedTip = eligible.length === 1 ? { x: eligible[0].x, y: eligible[0].y, width: eligible[0].width } : null;
      const localizationChanged = JSON.stringify(recomputedTip) !== JSON.stringify(old.tip);
      const tip = old.tip; // Freeze original proposals; do not retune anchors for this hypothesis.
      const measure = dfsMode ? api.measureMonotoneShadowPaths : regionMode ? api.measureEdgeShadowRegions : api.measureDirectionalShadowPattern;
      const boundaryMask = filteredBoundary ? api.filteredDarkeningBoundaryMask(difference) : estimates.mask;
      const dfsOptions = localCorridor ? { corridorRadius: 4 } : strongDownward ? { downwardThreshold: 80 } : undefined;
      const directional = tip ? measure(difference, boundaryMask, tip, undefined, dfsOptions) : null;
      const colorDirectional = tip ? measure(difference, filteredBoundary ? api.filteredDarkeningBoundaryMask(difference,
        { method: "color", maximumColorShift: 10, maximumResidual: 0.12 }) : estimates.mask, tip,
        { method: "color", maximumColorShift: 10, maximumResidual: 0.12 }, dfsOptions) : null;
      const displayLevel = regionMode || dfsMode ? directional?.levels.find((l) => l.patternMatch === true) ?? directional?.levels.find((l) => l.threshold === 40) : null;
      const displayThreshold = displayLevel?.threshold ?? 40;
      const color = (name) => getComputedStyle(document.documentElement).getPropertyValue(`--color-${name}`).trim();
      const palette = api.readHeatmapPalette();
      const layer = (pixels) => { const c = document.createElement("canvas"); c.width = width; c.height = height;
        c.getContext("2d").putImageData(pixels, 0, 0); return c; };
      const overlay = layer(current); const ctx = overlay.getContext("2d");
      ctx.fillStyle = color("yellow"); ctx.globalAlpha = 0.25;
      for (let y = crop[1]; y < crop[1] + crop[3]; y += 1) for (let x = crop[0]; x < crop[0] + crop[2]; x += 1)
        if (boundaryMask[y * width + x]) ctx.fillRect(x, y, 1, 1);
      ctx.globalAlpha = 1;
      const raw = layer(new ImageData(api.colorizeShadowDifference(difference, "darkening", 5, 120, palette), width, height));
      const filtered = layer(new ImageData(api.colorizeShadowDifference(difference, "candidate", 5, 120, palette,
        { method: "projection", maximumColorShift: 10, maximumResidual: 0.12 }), width, height));
      // Region overlay shows every sampled pixel. Heatmaps show thin outlines,
      // preserving interior evidence. Colors mark regions, not classifications.
      if (directional && !regionMode && !dfsMode) {
        ctx.globalAlpha = 0.65; ctx.fillStyle = color("green");
        for (const p of directional.upwardSamples) ctx.fillRect(p.x, p.y, 1, 1);
        for (const ray of directional.rays) {
          ctx.fillStyle = color("blue");
          for (const p of ray.samples) ctx.fillRect(p.x, p.y, 1, 1);
          ctx.fillStyle = color("purple");
          for (const p of ray.samples.filter((p) => p.distance <= directional.settings.rimAllowance)) ctx.fillRect(p.x, p.y, 1, 1);
          for (const c of [raw, filtered]) if (ray.boundary !== null) { const cx = c.getContext("2d");
            cx.strokeStyle = color("blue"); cx.lineWidth = 0.4; cx.beginPath(); cx.moveTo(ray.x, ray.boundary);
            const end = ray.samples.at(-1); cx.lineTo(end.x, end.y); cx.stroke(); }
        }
        ctx.globalAlpha = 1; ctx.strokeStyle = color("red"); ctx.lineWidth = 1;
        ctx.beginPath(); ctx.arc(tip.x, tip.y, 2, 0, Math.PI * 2); ctx.stroke();
      }
      if (directional && regionMode) {
        ctx.globalAlpha = 0.35; ctx.fillStyle = color("green");
        for (const p of directional.upwardSamples) ctx.fillRect(p.x, p.y, 1, 1);
        const shown = displayLevel;
        for (const region of shown.regions) {
          ctx.fillStyle = color(region.patternMatch === true ? "purple" : "red");
          for (const p of region.pixels) ctx.fillRect(p.x, p.y, 1, 1);
        }
        ctx.globalAlpha = 1; ctx.fillStyle = color("blue");
        for (const p of directional.edgeSamples) ctx.fillRect(p.x, p.y, 1, 1);
        for (const tile of [raw, filtered]) { const cx = tile.getContext("2d"); cx.fillStyle = color("blue");
          for (const region of shown.regions) for (const p of region.edgeSeeds) cx.fillRect(p.x, p.y, 1, 1); }
        ctx.strokeStyle = color("red"); ctx.beginPath(); ctx.arc(tip.x, tip.y, 2, 0, Math.PI * 2); ctx.stroke();
      }
      if (directional && dfsMode) {
        const shown = displayLevel;
        const down = shown.downwardSearches.find((r) => r.reached) ?? shown.downwardSearches[0];
        const up = shown.upwardSearches.find((r) => r.reached) ?? shown.upwardSearches[0];
        for (const tile of [overlay, raw, filtered]) {
          const cx = tile.getContext("2d");
          if (localCorridor) {
            const allowed = new Set(directional.corridor.map((p) => p.y * width + p.x));
            cx.globalAlpha = 0.55; cx.fillStyle = color("purple");
            for (const p of directional.corridor) if ([[1, 0], [-1, 0], [0, 1], [0, -1]].some(([dx, dy]) =>
              !allowed.has((p.y + dy) * width + p.x + dx))) cx.fillRect(p.x, p.y, 1, 1);
            cx.globalAlpha = 1;
          }
          cx.globalAlpha = 0.3; cx.fillStyle = color("red");
          for (const search of shown.downwardSearches) for (const p of search.visited) cx.fillRect(p.x, p.y, 1, 1);
          cx.fillStyle = color("green");
          for (const search of shown.upwardSearches) for (const p of search.visited) cx.fillRect(p.x, p.y, 1, 1);
          cx.globalAlpha = 1; cx.fillStyle = color("blue");
          for (const p of directional.arc) cx.fillRect(p.x, p.y, 1, 1);
          cx.fillStyle = color("purple");
          for (const p of shown.attachments) cx.fillRect(p.x, p.y, 1, 1);
          cx.lineWidth = 0.4;
          for (const [y, name] of [[directional.aY, "purple"], [directional.downwardY, "red"], [directional.upwardY, "green"]]) {
            cx.strokeStyle = color(name); cx.beginPath(); cx.moveTo(crop[0], y); cx.lineTo(crop[0] + crop[2], y); cx.stroke();
          }
          const witness = down?.reached ? down : up ?? down;
          if (witness) {
            cx.setLineDash([1, 1]); cx.strokeStyle = color("purple");
            cx.strokeRect(witness.minimumX, directional.upwardY, witness.maximumX - witness.minimumX + 1, directional.downwardY - directional.upwardY);
            cx.setLineDash([]);
          }
          for (const [search, name] of [[down, "red"], [up, "green"]]) if (search?.reached) {
            cx.lineWidth = 0.7; cx.strokeStyle = color(name); cx.beginPath();
            for (const [i, p] of search.path.entries()) { if (!i) cx.moveTo(p.x + 0.5, p.y + 0.5); else cx.lineTo(p.x + 0.5, p.y + 0.5); }
            cx.stroke(); cx.lineWidth = 0.6; cx.beginPath(); cx.arc(search.endpoint.x + 0.5, search.endpoint.y + 0.5, 1.6, 0, 2 * Math.PI); cx.stroke();
          }
        }
      }
      const combined = document.createElement("canvas"); combined.width = 1200; combined.height = 540;
      const c = combined.getContext("2d"); c.fillStyle = color("white"); c.fillRect(0, 0, combined.width, combined.height);
      c.fillStyle = color("surface-dark"); c.font = "16px sans-serif";
      c.fillText(`${old.group} / frame ${old.frame} / ${old.phase} / prior review: ${old.review.status}`, 5, 20);
      const pressLabel = (value) => value === true ? "PRESS" : value === false ? "NO PRESS" : "UNKNOWN";
      for (const [i, threshold] of [5, 20, 40, 60].entries()) {
        const value = directional?.levels.find((l) => l.threshold === threshold)?.patternMatch;
        const wrongTarget = old.review.status === "wrong-target";
        c.fillStyle = color(wrongTarget || value == null ? "yellow-soft" : value ? "green-soft" : "red-soft");
        c.fillRect(i * 300 + 3, 32, 294, 42);
        c.fillStyle = color("surface-dark"); c.font = "bold 20px sans-serif";
        c.fillText(`${strongDownward ? `U${threshold}/D80` : `${threshold}${localCorridor ? " B4" : " luma"}`}: ${wrongTarget ? "INVALID TARGET" : pressLabel(value)}`, i * 300 + 10, 60);
      }
      c.font = "16px sans-serif";
      const titles = dfsMode ? ["Native source", `DFS${localCorridor ? " band4" : filteredBoundary ? " filtered edge" : ""} at ${displayThreshold} luma`, "Raw darkening / DFS", "Filtered darkening / DFS"] : regionMode ? ["Native source", `Edge regions at ${displayThreshold} luma`, "Raw darkening / shadow seeds", "Filtered darkening / shadow seeds"] :
        ["Native source", "Sampled regions", "Raw darkening / scan directions", "Filtered darkening / scan directions"];
      for (const [i, tile] of [image, overlay, raw, filtered].entries()) {
        c.fillText(titles[i], i * 300 + 3, 99);
        c.imageSmoothingEnabled = i === 0;
        const sx = i === 0 ? image.width / width : 1; const sy = i === 0 ? image.height / height : 1;
        const scale = Math.min(300 / crop[2], 300 / crop[3]);
        c.drawImage(tile, crop[0] * sx, crop[1] * sy, crop[2] * sx, crop[3] * sy, i * 300, 105, crop[2] * scale, crop[3] * scale);
      }
      const flag = (v) => v === null ? "?" : v ? "yes" : "no";
      c.fillText(dfsMode ? `Blue: arc; purple: band (if enabled)/attachments/a; red: down/veto; green: up/support. Dashed width: shown witness (${displayThreshold} luma).` : regionMode ? `Yellow: finger; blue: edge samples; purple: qualifying regions at ${displayThreshold} luma; red: other seeded shadows; green: upward strips.` :
        "Yellow: finger; green: upward context; blue: forward scans; purple: allowed 2-pixel rim; red: estimated tip.", 5, 425);
      for (const [i, l] of (directional?.levels ?? []).entries()) {
        const detail = dfsMode ? `${l.attachments.length} up/${l.downwardAttachments.length} down seeds; D>${l.downwardThreshold}; veto ${flag(l.downwardVeto)}; up ${flag(l.upwardReached)}; unknown D/U ${flag(l.downwardUnknown)}/${flag(l.upwardUnknown)}; c/d/e4; W${directional.settings.searchWidth}${localCorridor ? "; B4" : ""}` : regionMode ? `${l.regions.length} regions; qualifying IDs [${l.qualifyingRegions.join("/")}]; ${l.regions.slice(0, 3).map((r) => `#${r.id}: down ${r.downwardExtent}px, up ${r.upwardWideRows} rows`).join("; ")}${l.regions.length > 3 ? "; more in JSON" : ""}` :
          `upward ${flag(l.upwardPresent)}; thin band ${flag(l.thinBand)}; downward clear ${flag(l.downwardClear)}`;
        c.fillText(`>${l.threshold} luma: ${detail}; pattern ${flag(l.patternMatch)}`, 5, 447 + i * 20);
      }
      c.font = "14px sans-serif";
      c.fillText("Algorithm output: experimental shadow pattern. UNKNOWN means insufficient evidence; phase in header is the user label.", 5, 531);
      return { directional, colorDirectional, recomputedTip, localizationChanged, displayThreshold, png: combined.toDataURL("image/png").split(",")[1] };
    }, { source, reference, gate, old, regionMode, dfsMode, filteredBoundary, strongDownward, localCorridor });
    const filename = `${old.group}-${old.frame}.png`;
    await writeFile(path.join(output, filename), Buffer.from(result.png, "base64"));
    records.push({ group: old.group, frame: old.frame, phase: old.phase, tip: old.tip, priorReview: old.review,
      sourceSha256: old.sourceSha256, requestedTimeSeconds: old.requestedTimeSeconds, decodedMediaTime: old.decodedMediaTime,
      filename, displayThreshold: result.displayThreshold, recomputedTip: result.recomputedTip, localizationChanged: result.localizationChanged, directional: result.directional, colorDirectional: result.colorDirectional });
  }
} finally { await browser.close(); }
const flag = (v) => v === null || v === undefined ? "unknown" : v ? "yes" : "no";
const rows = records.flatMap((r) => (r.directional?.levels ?? []).map((l) => dfsMode ? {
  group: r.group, frame: r.frame, phase: r.phase, review: r.priorReview.status, threshold: l.threshold,
  attachments: l.attachments.length, downwardThreshold: l.downwardThreshold, downwardAttachments: l.downwardAttachments.length, downwardVeto: flag(l.downwardVeto), upwardReached: flag(l.upwardReached),
  downwardUnknown: flag(l.downwardUnknown), upwardUnknown: flag(l.upwardUnknown), pattern: flag(l.patternMatch) } : regionMode ? {
  group: r.group, frame: r.frame, phase: r.phase, review: r.priorReview.status, threshold: l.threshold,
  regions: l.regions.length, qualifying: l.qualifyingRegions.join("/"), pattern: flag(l.patternMatch),
  downwardExtents: l.regions.map((region) => region.downwardExtent).join("/"),
  upwardWideRows: l.regions.map((region) => region.upwardWideRows).join("/") } : {
  group: r.group, frame: r.frame, phase: r.phase, review: r.priorReview.status, threshold: l.threshold,
  upwardRows: l.upwardStrongRows, upward: flag(l.upwardPresent), thinBand: flag(l.thinBand),
  downwardClear: flag(l.downwardClear), pattern: flag(l.patternMatch),
  extents: l.rayLevels.map((ray) => ray.extent ?? "?").join("/") }));
const columns = Object.keys(rows[0]);
await writeFile(path.join(output, "summary.csv"), [columns.join(","), ...rows.map((r) => columns.map((k) => r[k]).join(","))].join("\n") + "\n");
await writeFile(path.join(output, "results.json"), JSON.stringify({ schemaVersion: 1, generatedAt: new Date().toISOString(),
  classification: dfsMode ? "exploratory-bounded-monotone-dfs-not-validated-contact" : regionMode ? "exploratory-any-edge-region-not-validated-contact" : "exploratory-directional-pattern-not-press-classifier", node: process.version, browser: browser.version(),
  baselineSha256: hash(baselineBytes), referenceSha256: hash(referenceBytes), annotationSource: baseline.annotationSource,
  strongDownward, localCorridor, corridorDefinition: localCorridor ? "Exterior Chebyshev-distance <=4 band around selected lower/side arc, plus straight downward extension from the lowest arc pixels to the saved veto row within the same lateral margin. Lateral stop without unknown; forward depth remains reachable. D80 disabled." : null, d80Sha256: d80Bytes ? hash(d80Bytes) : null, previousDfsSha256: previousDfsBytes ? hash(previousDfsBytes) : null,
  filteredBoundary, boundaryDefinition: filteredBoundary ? "Valid darkening >5 with finite projection residual >0.12 (primary), color shift >10 (secondary). No clustering, morphology or anchor/width changes. Local connected cross-section selected by unchanged DFS. Black clear/invalid pixels are excluded." : "Original color-cluster mask",
  dfsMode, dfsDefinition: dfsMode ? "c=d=e=4 analysis pixels. Arc below fingertipY-c, monotone downward/sideways DFS from every shadow attachment, ANY reach to fingertipY+d vetoes. At least one monotone upward/sideways path from the same attachments to fingertipY-c-e supports. Width equals estimated finger width centered per attachment. Width cap stops without unknown; unavailable pixels and incomplete geometry remain unknown; known color exclusions stop traversal." : null,
  regionMode, regionDefinition: regionMode ? "At least one eight-connected local shadow component seeded directly outside the distal mask edge: maximum downward Y extent 8 analysis pixels from saved tip, upward contiguous width >=2 on >=3 rows in six-pixel side strips. Other components do not veto. Unknown downstream boundaries or cropped side/bottom extents cannot establish a short region." : null,
  notes: dfsMode ? "Same native hashes and saved tips, recomputed masks. All four cutoffs reported. Visualization first matching cutoff otherwise 40. User phase never used in measurement. Downward veto has priority over upward success. Prior decisions saved separately when replacing canonical DFS images. No motion or live notes." : regionMode ? "Same native source hashes and saved tips. Masks recomputed. One qualifying connected region suffices; no ray veto. All four cutoffs reported. Overlay displays first matching cutoff, otherwise 40, for visualization only. Side/upward connections can include neighboring shadows. No motion or live notes." : "Exact baseline source hashes asserted; baseline tips reused. Masks recomputed; localization changes recorded. Upward context is visible side shadow behind tip; ownership unknown. Seven forward rays are sparse, not a whole-area absence test. All four cutoffs are reported, with fixed 2-pixel rim allowance. No motion or live notes.", records }, null, 2));
await writeFile(path.join(output, "index.html"), `<!doctype html><meta charset="utf-8"><title>${dfsMode ? "Bounded monotone shadow DFS" : regionMode ? "At least one qualifying fingertip shadow" : "Upward shadow / thin rim / clear forward fan"}</title>
<style>:root{${tokens}}body{font:16px sans-serif;color:var(--color-ink);background:var(--color-white);margin:24px}img{max-width:100%}td,th{padding:6px;border:1px solid var(--color-divider)}table{border-collapse:collapse}</style>
${dfsMode ? `<h1>Bounded directional shadow DFS${localCorridor ? " — curved boundary band4" : strongDownward ? " — downward darkening >80" : ""}${filteredBoundary ? " — filtered darkening boundary" : ""}</h1>
${localCorridor ? `<p>Both searches stay within an exterior four-pixel Chebyshev band around the selected curved fingertip arc. Downward and upward use matching 5/20/40/60 darkening cutoffs; D80 removed. Purple shows band boundary. The distal cap extends straight down to the saved veto row within the same lateral margin; forward depth is not capped by the band radius. Lateral stops do not create UNKNOWN. <a href="changes.html">Original / D80 / new comparison</a>.</p>` : ""}
${strongDownward ? `<p>Downward seeds AND traversal require darkening &gt;80; upward thresholds remain 5/20/40/60. <a href="changes.html">Old/new pass/fail comparison</a>. Canonical PNGs replaced; previous decisions retained in previous-results.json.</p>` : ""}
${filteredBoundary ? `<p>Boundary experiment only: valid darkening &gt;5 and projection residual &gt;0.12 supplies geometry instead of the color-cluster mask. Saved tips/widths and c/d/e remain fixed. Clear/invalid black pixels are excluded. ${strongDownward || localCorridor ? "" : `Compare with <a href="../shadow-dfs/index.html">current canonical DFS</a>.`} This is a boundary proposal, not verified skin segmentation.</p>` : ""}
<p>c=d=e=4 analysis pixels. Start at a=fingertip Y−c, find the local finger cross-section, trace the lower silhouette below a, then find directly attached shadow pixels. From each seed DFS moves down/sideways only. ANY seed reaching fingertip Y+d rejects the finger. At least one seed must also reach a−e via up/sideways-only DFS. A real thin attached shadow is required. Global downward veto wins over upward success.</p>
<p>Each seed's horizontal window is one estimated finger width, centered on that seed (even widths have one extra pixel on the left). Hitting the width cap stops that search without UNKNOWN. Known color-filter exclusions also stop traversal. Missing measurements, image bounds or incomplete arc geometry can still produce UNKNOWN. These are local bounded paths, not whole-component extents or verified contact.</p>
<p>Blue: traced arc; purple: shadow attachments and a row; red: downward visited pixels/path/rejection endpoint and d line; green: upward visited pixels/path/support endpoint and e line. Dashed purple bounds show the rejection witness, otherwise the upward witness/first search. Overlays show first matching cutoff if any, otherwise 40, labeled for visualization only. All four cutoffs remain independent. Native source is preserved in the first panel.</p>` : regionMode ? `<h1>At least one qualifying fingertip shadow region</h1>
<p>Only one region must qualify; other shadows do not veto it. Eight-connected shadow components in a bounded fingertip neighborhood must touch the distal estimated mask edge. The SAME region must extend no more than eight analysis pixels below the saved tip and have contiguous width of at least two pixels on at least three upward rows in the side strips. Width/row defaults are exploratory. Empty clear paper is insufficient. Unknown downstream boundaries or clipped sides/bottom stay unavailable.</p>
<p>Same 30 native source hashes and fixed saved tips as before, masks recomputed with unchanged defaults. Analysis 640×427, reference cutoff 40, residual ≤0.12; all four darkening cutoffs shown. Frame labels are approximate user annotations. The second panel colors all seeded components at its labeled cutoff (first matching cutoff, otherwise 40, for display only): purple qualifies, red does not qualify or is unknown. Blue marks edge samples; heatmap blue marks actual shadow seeds. Green marks upward strips. No rays are used by this rule.</p>` : `<h1>Upward shadow + thin rim + clear forward fan</h1>
<p>Same 30 native frames as shadow-hypothesis, verified by hashes. Saved fingertip coordinates are held fixed; masks are recomputed and recomputed-tip differences are recorded in JSON. Motion excluded. 640×427 analysis. Seven rays at −60, −40, −20, 0, 20, 40, 60° from image-down, anchored on the estimated lower silhouette within −8/+6 rows of the saved tip (missing local boundaries stay unknown). Scan length 24 pixels; two-pixel rim allowance. These settings are experimental and fixed across frames.</p>
<p>Green marks visible side strips behind the tip (upward context), blue the forward samples and purple the allowed rim. Upward presence requires strong compatible samples on at least three rows; insufficient coverage stays unknown. Thin band requires every ray's attached extent ≤2 pixels. Downward clear requires every sample beyond that rim to be known clear at the reported cutoff; any strong sample rejects it. Missing/occluded pixels stay unknown. A match requires all three conditions. This tests a pattern, not verified physical contact.</p>
`}
<p>PNG banners show PRESS / NO PRESS / UNKNOWN separately at each cutoff. These are experimental pattern outputs, not user phase labels. Wrong-target rows show INVALID TARGET.</p>
<p>Primary projection residual ≤0.12. Color-shift ≤10 comparison is in JSON. All four luma cutoffs shown, none selected by phase. ${dfsMode ? "Directional searches cannot climb against their allowed Y direction and are laterally bounded;" : regionMode ? "Bounded regions can mix connected neighboring shadows;" : "Rays leave unsampled gaps;"} upward shadow may belong to neighbors. Prior review flags are carried forward; wrong-target first-middle 120 must be excluded from target interpretation. Directional-limit flags describe the OLD central strip.</p>
<p><a href="summary.csv">CSV</a> · <a href="results.json">Raw samples and metadata</a></p>
<table><tr>${columns.map((k) => `<th>${k}</th>`).join("")}</tr>${rows.map((r) => `<tr>${columns.map((k) => `<td>${r[k]}</td>`).join("")}</tr>`).join("")}</table>
${records.map((r) => `<figure><figcaption>${r.group} ${r.frame}: ${r.phase} — prior review ${r.priorReview.status}</figcaption><a href="${r.filename}"><img loading="lazy" src="${r.filename}" alt="${r.group} frame ${r.frame}: source, sampled regions and heatmaps"></a></figure>`).join("\n")}`);
if (strongDownward || localCorridor) {
  const old = JSON.parse(previousDfsBytes);
  const d80 = d80Bytes ? JSON.parse(d80Bytes) : null;
  const comparisons = records.flatMap((r) => {
    const before = old.records.find((p) => p.group === r.group && p.frame === r.frame);
    assert.ok(before); assert.equal(before.sourceSha256, r.sourceSha256);
    const recent = d80?.records.find((p) => p.group === r.group && p.frame === r.frame);
    if (recent) assert.equal(recent.sourceSha256, r.sourceSha256);
    const expected = ["touch", "touch-interval"].includes(r.phase);
    const valid = r.priorReview.status !== "wrong-target";
    const status = (value) => !valid ? "excluded" : value == null ? "unknown" : value === expected ? "pass" : "fail";
    return r.directional.levels.map((l) => {
      const previous = before.directional.levels.find((p) => p.threshold === l.threshold);
      return { group: r.group, frame: r.frame, phase: r.phase, upwardThreshold: l.threshold,
        oldDownwardThreshold: previous.downwardThreshold ?? previous.threshold, newDownwardThreshold: l.downwardThreshold,
        expected: valid ? expected ? "PRESS" : "NO PRESS" : "excluded",
        oldDecision: flag(previous.patternMatch), newDecision: flag(l.patternMatch),
        ...(recent ? { d80Decision: flag(recent.directional.levels.find((p) => p.threshold === l.threshold).patternMatch),
          d80Status: status(recent.directional.levels.find((p) => p.threshold === l.threshold).patternMatch),
          changedFromD80: recent.directional.levels.find((p) => p.threshold === l.threshold).patternMatch !== l.patternMatch } : {}),
        oldStatus: status(previous.patternMatch), newStatus: status(l.patternMatch),
        changed: previous.patternMatch !== l.patternMatch };
    });
  });
  const totals = [5, 20, 40, 60].map((threshold) => {
    const subset = comparisons.filter((r) => r.upwardThreshold === threshold);
    const count = (prefix) => subset.reduce((a, r) => {
      a[r[`${prefix}Status`]] += 1;
      if (r[`${prefix}Status`] === "fail") a[r.expected === "PRESS" ? "rejectedTouch" : "acceptedNonTouch"] += 1;
      return a;
    }, { pass: 0, fail: 0, unknown: 0, excluded: 0, rejectedTouch: 0, acceptedNonTouch: 0 });
    return { upwardThreshold: threshold, old: count("old"), ...(d80 ? { d80: count("d80") } : {}), new: count("new") };
  });
  await writeFile(path.join(output, "changes.json"), JSON.stringify({ oldResultsSha256: hash(previousDfsBytes), d80Sha256: d80Bytes ? hash(d80Bytes) : null,
    note: `${localCorridor ? "New: band4 with distal-cap forward extension, matching cutoffs, D80 disabled. " : ""}Agreement with approximate user phases in one clip; not validated physical contact accuracy. Wrong-target excluded. Old boundary is color-cluster; new boundary is filtered. Previous filtered-boundary experiment had identical primary decisions to old.`, totals, comparisons }, null, 2));
  const keys = Object.keys(comparisons[0]);
  await writeFile(path.join(output, "changes.csv"), [keys.join(","), ...comparisons.map((r) => keys.map((k) => r[k]).join(","))].join("\n") + "\n");
  await writeFile(path.join(output, "changes.html"), `<!doctype html><meta charset="utf-8"><title>DFS old/new results</title>
<style>:root{${tokens}}body{font:16px sans-serif;color:var(--color-ink);background:var(--color-white);margin:24px}td,th{padding:8px;border:1px solid var(--color-divider)}table{border-collapse:collapse}.pass{background:var(--color-green-soft)}.fail{background:var(--color-red-soft)}</style>
<h1>DFS: original / ${localCorridor ? "D80 / boundary band4" : "downward &gt;80"}</h1><p>New: filtered boundary, ${localCorridor ? "four-pixel exterior arc band for both searches; matching downward/upward cutoffs; D80 removed" : "downward seeds/traversal &gt;80; upward thresholds unchanged"}. Pass/fail means agreement with approximate user phase labels, not verified contact accuracy. Wrong-target first-middle120 excluded. Old: original color-cluster DFS; the previous filtered-boundary run had identical primary decisions.</p>
<p><a href="index.html">New images</a> · <a href="changes.csv">CSV</a> · <a href="changes.json">Comparison JSON</a> · <a href="previous-results.json">Original decisions and paths</a>${d80 ? ` · <a href="d80-results.json">D80 decisions and paths</a>` : ""}</p>
<table><tr><th>Upward cutoff</th><th>Old pass / fail / unknown</th>${d80 ? "<th>D80 pass / fail / unknown</th>" : ""}<th>New pass / fail / unknown</th><th>New rejected touches / accepted non-touches</th></tr>${totals.map((t) => `<tr><td>${t.upwardThreshold}</td><td>${t.old.pass} / ${t.old.fail} / ${t.old.unknown}</td>${t.d80 ? `<td>${t.d80.pass} / ${t.d80.fail} / ${t.d80.unknown}</td>` : ""}<td>${t.new.pass} / ${t.new.fail} / ${t.new.unknown}</td><td>${t.new.rejectedTouch} / ${t.new.acceptedNonTouch}</td></tr>`).join("")}</table>
<table><tr>${keys.map((k) => `<th>${k}</th>`).join("")}</tr>${comparisons.map((r) => `<tr>${keys.map((k) => `<td class="${k.endsWith("Status") ? r[k] : ""}">${k === "frame" ? `<a href="${r.group}-${r.frame}.png">${r[k]}</a>` : r[k]}</td>`).join("")}</tr>`).join("")}</table>`);
  console.info("Old/new phase agreement:", JSON.stringify(totals));
}
console.info(`Exported ${records.length} frames: ${output}/index.html`);
if (filteredBoundary && !strongDownward && !localCorridor) {
  await writeFile(path.join(output, "comparison.html"), `<!doctype html><meta charset="utf-8"><title>Index boundary control comparison</title>
<style>:root{${tokens}}body{font:16px sans-serif;color:var(--color-ink);background:var(--color-white);margin:24px}section{display:grid;grid-template-columns:1fr 1fr;gap:16px}img{width:100%}figure{margin:0}h2{margin-top:32px}</style>
<h1>Index 148–152: canonical DFS and boundary-only control</h1>
<p>Left: current canonical DFS (see its card settings). Right: filtered-boundary control with matching downward/upward cutoffs. Click a card to enlarge. Saved tip, width, c/d/e and shadow cutoffs stay fixed. Neither result is validated contact. <a href="index.html">All 30 frames and raw results</a></p>
${records.filter((r) => r.group === "index" && r.frame >= 148 && r.frame <= 152).map((r) => `<h2>Frame ${r.frame}</h2><section>
<figure><figcaption>Current canonical DFS</figcaption><a href="../shadow-dfs/${r.filename}"><img src="../shadow-dfs/${r.filename}" alt="Current canonical DFS, frame ${r.frame}"></a></figure>
<figure><figcaption>Filtered boundary</figcaption><a href="${r.filename}"><img src="${r.filename}" alt="Filtered boundary, frame ${r.frame}"></a></figure></section>`).join("\n")}`);
}
for (const threshold of [5, 20, 40, 60]) console.info(`>${threshold}:`, JSON.stringify(rows.filter((r) => r.threshold === threshold && r.review !== "wrong-target").reduce((a, r) => {
  a[r.pattern] = (a[r.pattern] || 0) + 1; return a;
}, {})));
