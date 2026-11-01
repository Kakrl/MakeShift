// Local exploratory export, not an accuracy verification test. No model downloads.
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { createRequire } from "node:module";
import { mkdir, readdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const require = createRequire(new URL("../../frontend/package.json", import.meta.url));
const { chromium } = require("playwright");
const ts = require("typescript");
const filteredBoundary = process.argv.includes("--filtered-boundary");
const sequence = process.argv.includes("--sequence");
assert.ok(!sequence || filteredBoundary, "Sequence review requires filtered-boundary mode");
const output = path.join(root, `frontend/test-results/${filteredBoundary ? "fingertip-filtered" : "fingertip-candidates"}`);
await mkdir(output, { recursive: true });
let beforeBytes = null;
if (filteredBoundary) {
  try { beforeBytes = await readFile(path.join(output, "pre-lobe-results.json")); }
  catch (error) {
    if (error.code !== "ENOENT") throw error;
    try { beforeBytes = await readFile(path.join(output, "results.json")); }
    catch (missing) { if (missing.code !== "ENOENT") throw missing; }
  }
  if (beforeBytes) await writeFile(path.join(output, "pre-lobe-results.json"), beforeBytes);
}

const codes = {};
for (const name of ["shadowHeatmap", "shadowBand", "shadowTipEvidence", "fingertipCandidates"]) {
  const source = await readFile(path.join(root, `frontend/src/cv/${name}.ts`), "utf8");
  codes[`./${name}`] = ts.transpileModule(source, { compilerOptions: { target: ts.ScriptTarget.ES2020, module: ts.ModuleKind.CommonJS } }).outputText;
}
const css = await readFile(path.join(root, "frontend/src/app/globals.css"), "utf8");
const tokens = css.match(/--color-[\w-]+\s*:[^;]+;/g).join("\n");
const cases = path.join(root, "images_test_cases");
const names = (await readdir(cases)).filter((name) => name.endsWith(".png")).sort();
const referenceBytes = await readFile(path.join(cases, "background.png"));
const reference = `data:image/png;base64,${referenceBytes.toString("base64")}`;
const sources = await Promise.all(names.map(async (name) => ({ name, sourceBytes: await readFile(path.join(cases, name)), kind: "still" })));
if (sequence) {
  const original = path.join(root, "frontend/test-results/shadow-hypothesis");
  const baseline = JSON.parse(await readFile(path.join(original, "results.json")));
  assert.equal(createHash("sha256").update(referenceBytes).digest("hex"), baseline.referenceSha256);
  const later = JSON.parse(await readFile(path.join(root, baseline.frameCaches[1].path)));
  for (const old of baseline.records) {
    const sourceBytes = old.group === "middle-first" ? await readFile(path.join(original, `${old.group}-${old.frame}.native.png`)) :
      Buffer.from(later.frames.find((f) => f.frame === old.frame && f.finger === (old.group === "index" ? "index" : "middle")).source.split(",")[1], "base64");
    assert.equal(createHash("sha256").update(sourceBytes).digest("hex"), old.sourceSha256);
    sources.push({ name: `${old.group}-${old.frame}.native.png`, sourceBytes, kind: "sequence", group: old.group, frame: old.frame,
      phase: old.phase, priorReview: old.review }); // Display metadata only; no target selection or saved tip enters identification.
  }
}
const browser = await chromium.launch({ channel: process.env.CV_BROWSER_CHANNEL || "chrome", headless: true });
const records = [];
const tiles = [];
try {
  const page = await browser.newPage();
  await page.setContent(`<style>:root { ${tokens} }</style>`);
  await page.evaluate((codes) => {
    const modules = {};
    for (const [name, code] of Object.entries(codes)) {
      const exports = {};
      new Function("exports", "require", code)(exports, (id) => modules[id]);
      modules[name] = exports;
    }
    window.experiment = { ...modules["./shadowHeatmap"], ...modules["./fingertipCandidates"], ...modules["./shadowTipEvidence"] };
  }, codes);
  for (const { name, sourceBytes, ...sourceMetadata } of sources) {
    const source = `data:image/png;base64,${sourceBytes.toString("base64")}`;
    const result = await page.evaluate(async ({ source, reference, name, filteredBoundary }) => {
      const load = async (url) => { const image = new Image(); image.src = url; await image.decode(); return image; };
      const image = await load(source); const background = await load(reference);
      const scale = Math.min(1, 640 / Math.max(image.width, image.height));
      const width = Math.round(image.width * scale); const height = Math.round(image.height * scale);
      const sample = (image) => { const canvas = document.createElement("canvas"); canvas.width = width; canvas.height = height;
        const c = canvas.getContext("2d"); c.drawImage(image, 0, 0, width, height); return c.getImageData(0, 0, width, height); };
      const current = sample(image); const difference = window.experiment.measureShadowDifference(current, sample(background), 40);
      const started = performance.now();
      const estimate = filteredBoundary ? window.experiment.identifyFilteredFingertips(difference) : window.experiment.estimateFingertips(current, difference);
      const identificationMs = performance.now() - started;
      if (!estimate) throw new Error("Invalid fingertip inputs");
      const measuredCandidates = estimate.candidates.map((candidate) => ({ ...candidate,
        ...(filteredBoundary ? { dfs: window.experiment.measureMonotoneShadowPaths(difference, estimate.mask, candidate, undefined, { corridorRadius: 4 }) } : {}) }));
      const palette = window.experiment.readHeatmapPalette();
      const canvas = document.createElement("canvas"); canvas.width = width * 3; canvas.height = height + 65;
      const context = canvas.getContext("2d");
      const color = (name) => getComputedStyle(document.documentElement).getPropertyValue(`--color-${name}`).trim();
      context.fillStyle = color("white"); context.fillRect(0, 0, canvas.width, canvas.height);
      context.fillStyle = color("surface-dark"); context.font = "16px sans-serif";
      context.fillText(`${name} · ${estimate.candidates.length} unverified candidates`, 8, 20);
      for (const [n, title] of ["Source + estimated tips / scan boxes", filteredBoundary ? "Filtered-darkening geometry mask" : "Estimated reddish-region mask", "Projection shadow evidence + estimated tips"].entries()) context.fillText(title, n * width + 8, 45);
      context.putImageData(current, 0, 65);
      const maskImage = new ImageData(width, height);
      for (let i = 0; i < estimate.mask.length; i += 1) {
        const v = estimate.mask[i] ? 255 : 0;
        maskImage.data.set([v, v, v, 255], i * 4);
      }
      context.putImageData(maskImage, width, 65);
      context.putImageData(new ImageData(window.experiment.colorizeShadowDifference(difference, "candidate", 5, 120, palette,
        { method: "projection", maximumColorShift: 10, maximumResidual: 0.12 }), width, height), width * 2, 65);
      for (const candidate of measuredCandidates) for (const offset of [0, width, width * 2]) {
        context.strokeStyle = color("blue"); context.lineWidth = 1;
        const b = candidate.bounds; context.strokeRect(offset + b.left, b.top + 65, b.right - b.left, b.bottom - b.top);
        context.strokeStyle = color("red"); context.lineWidth = 2;
        context.beginPath(); context.arc(offset + candidate.x, candidate.y + 65, 4, 0, Math.PI * 2); context.stroke();
        context.fillStyle = color("red"); context.fillText(String(candidate.id), offset + candidate.x + 5, candidate.y + 60);
      }
      const { mask, ...record } = estimate; record.candidates = measuredCandidates;
      return { png: canvas.toDataURL("image/png").split(",")[1], record: { name, width, height, maskPixels: mask.reduce((a, b) => a + b, 0), identificationMs, ...record } };
    }, { source, reference, name, filteredBoundary });
    await writeFile(path.join(output, `${name}.candidates.png`), Buffer.from(result.png, "base64"));
    tiles.push(result.png);
    if (name === "background.png") assert.equal(result.record.candidates.length, 0, "The reference self-comparison must yield no tips");
    records.push({ ...result.record, ...sourceMetadata, sourceSha256: createHash("sha256").update(sourceBytes).digest("hex") });
    process.stdout.write(`${name}: ${result.record.candidates.length} candidates\n`);
  }
  const overview = await page.evaluate(async (tiles) => {
    const canvas = document.createElement("canvas"); canvas.width = 1280; canvas.height = Math.ceil(tiles.length / 4) * 246;
    const context = canvas.getContext("2d");
    for (const [i, png] of tiles.entries()) {
      const image = new Image(); image.src = `data:image/png;base64,${png}`; await image.decode();
      context.drawImage(image, 0, 0, 640, 492, (i % 4) * 320, Math.floor(i / 4) * 246, 320, 246);
    }
    return canvas.toDataURL("image/png").split(",")[1];
  }, tiles);
  await writeFile(path.join(output, "overview.png"), Buffer.from(overview, "base64"));
} finally { await browser.close(); }
await writeFile(path.join(output, "results.json"), JSON.stringify({ schemaVersion: 1, generatedAt: new Date().toISOString(),
  reference: "background.png", referenceSha256: createHash("sha256").update(referenceBytes).digest("hex"),
  node: process.version, browser: browser.version(), classification: "exploratory-unverified", filteredBoundary, sequence, beforeSha256: beforeBytes ? createHash("sha256").update(beforeBytes).digest("hex") : null,
  definition: filteredBoundary ? "No saved anchors, per-finger gates or anatomical identities. Valid darkening >5 rejected by projection residual >0.12; same mask as DFS. Strict whole-plateau maxima,raw-outline prominence>=2,local valley-bounded widths; all candidates measured with locality4 DFS, matching down/up cutoffs. IDs are frame-local spatial numbers. Timing is identification only, not physical latency." : "Legacy reddish color-cluster pilot", records }, null, 2));
await writeFile(path.join(output, "index.html"), `<!doctype html><meta charset="utf-8"><title>Fingertip candidates</title>
<h1>${filteredBoundary ? "Automatic filtered-boundary fingertips" : "Exploratory fingertip candidates"}</h1>
${filteredBoundary ? `<p>Strict plateau peaks and local raw-valley widths; fixed minimum prominence2 for filtered geometry. No saved tip positions, widths, per-finger gates or anatomical labels enter identification. <a href="changes.html">Old/new proposals</a>. Every proposal is measured by locality4 DFS at all four cutoffs; tables show all four cutoffs. PRESS is an experimental pattern result, not verified contact. Merged, missed and spurious tips remain possible. Phase/group names on cached sources are display metadata only.</p>` : ""}<p>Downward-facing fingers assumed. Numbers are spatial candidates, not finger identities or contact decisions. Boxes can contain neighboring shadows. Red circles: estimated distal ends. Blue boxes: bounded shadow neighborhoods. Settings and raw forward profiles: <a href="results.json">results.json</a>. <a href="overview.png">All source overlays</a>.</p>
${records.map(({ name, candidates }) => `<figure><figcaption>${name}</figcaption><img style="max-width:100%" src="${name}.candidates.png" alt="${name} source, mask and shadow with estimated tips">${filteredBoundary ? `<table><tr><th>Candidate</th><th>x,y</th><th>Width</th>${[5,20,40,60].map((t) => `<th>${t} luma</th>`).join("")}</tr>${candidates.map((c) => `<tr><td>${c.id}</td><td>${c.x},${c.y}</td><td>${c.width}</td>${[5,20,40,60].map((t) => { const v=c.dfs?.levels.find((l) => l.threshold===t)?.patternMatch; return `<td>${v == null ? "UNKNOWN" : v ? "PRESS" : "NO PRESS"}</td>`; }).join("")}</tr>`).join("")}</table>` : ""}</figure>`).join("\n")}`);
if (filteredBoundary && beforeBytes) {
  const before = JSON.parse(beforeBytes);
  const compact = (c) => ({ x: c.x, y: c.y, width: c.width, prominence: c.prominence, lobeBounds: c.lobeBounds });
  const comparisons = records.map((r) => {
    const old = before.records.find((x) => x.name === r.name);
    if (old) assert.equal(old.sourceSha256, r.sourceSha256);
    return { name: r.name, oldCount: old?.candidates.length ?? null, newCount: r.candidates.length,
      old: old?.candidates.map(compact) ?? [], new: r.candidates.map(compact) };
  });
  const reportedExamples = comparisons.filter((r) => /^middle-first-11[1-6]\.native/.test(r.name) || r.name === "hover_right-index_frame_000189_6300ms.png").map((r) => {
    const indexExample = r.name.startsWith("middle-first");
    const inReviewRegion = indexExample ? (c) => c.x >= 398 && c.x <= 427 && c.y >= 160 && c.y <= 185 :
      (c) => c.x >= 175 && c.x <= 205 && c.y >= 110 && c.y <= 145;
    return { name: r.name, regionPurpose: indexExample ? "user-reported missing index" : "user-reported duplicate pinky",
      old: r.old.filter(inReviewRegion), new: r.new.filter(inReviewRegion) };
  });
  const report = { beforeSha256: createHash("sha256").update(beforeBytes).digest("hex"),
    note: "Candidate-count/coordinate comparison,not accuracy. Fixed review rectangles summarize only the seven user-reported examples AFTER detection; they never enter identification or DFS.",
    oldTotal: comparisons.reduce((n,r) => n+(r.oldCount ?? 0),0), newTotal: comparisons.reduce((n,r) => n+r.newCount,0), reportedExamples, comparisons };
  await writeFile(path.join(output,"changes.json"),JSON.stringify(report,null,2));
  await writeFile(path.join(output,"changes.html"),`<!doctype html><meta charset="utf-8"><title>Fingertip proposal changes</title>
<h1>Old/new fingertip proposals</h1><p>Strict whole-plateau maxima; filtered-mode raw prominence>=2 and local valley-bounded width. Counts are not accuracy. Review regions below summarize the seven user-reported examples after detection; no regions or anatomical names enter identification. Original results:<a href="pre-lobe-results.json">JSON</a>. <a href="index.html">New images and DFS tables</a>. <a href="changes.json">Full comparison JSON</a>.</p>
<p>Total proposals:${report.oldTotal} → ${report.newTotal}.</p><table><tr><th>Reported example</th><th>Old proposals in review region</th><th>New proposals in review region</th></tr>${reportedExamples.map((r)=>`<tr><td><a href="${r.name}.candidates.png">${r.name}</a></td><td>${r.old.map((c)=>`(${c.x},${c.y}) width${c.width}`).join("; ") || "none"}</td><td>${r.new.map((c)=>`(${c.x},${c.y}) width${c.width}`).join("; ") || "none"}</td></tr>`).join("")}</table>
<table><tr><th>Input</th><th>Old count</th><th>New count</th></tr>${comparisons.map((r)=>`<tr><td><a href="${r.name}.candidates.png">${r.name}</a></td><td>${r.oldCount ?? "missing"}</td><td>${r.newCount}</td></tr>`).join("")}</table>`);
  console.info("Proposal changes:",JSON.stringify({oldTotal:report.oldTotal,newTotal:report.newTotal,reportedExamples}));
}
console.info(`Gallery: ${output}/index.html`);
