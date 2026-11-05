// Standalone current-detector image diagnostics. No app server or models needed.
import { createHash } from "node:crypto";
import { createRequire } from "node:module";
import { mkdir, mkdtemp, readdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const require = createRequire(new URL("../../frontend/package.json", import.meta.url));
const { chromium } = require("playwright");
const ts = require("typescript");
const hash = (bytes) => createHash("sha256").update(bytes).digest("hex");
const escape = (s) => String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);

if (process.argv.includes("--help")) {
  console.info("npm run test:shadow-images\nCV_IMAGE_CASE_DIR: input directory (default: images_test_cases)\nCV_IMAGE_OCTAVES: 1,2,3 matching the printed sheet (default: 1)\nCV_DFS_CUTOFF: 5,20,40,60 marker colors (default: 20); tables include 20/40/60\nCV_BROWSER_CHANNEL: installed Playwright browser channel (default: chrome)\nOutput: frontend/test-results/shadow-images/ (replaced after a completed run)\nbackground.png needs all four piano markers. Only candidates inside the virtual keys are reported.\nEvery candidate reports PRESS / NO PRESS / UNKNOWN; these are not accuracy verdicts.");
  process.exit(0);
}
if (process.argv.slice(2).length) throw new Error("Unknown arguments; use --help");
const cutoff = Number(process.env.CV_DFS_CUTOFF ?? 20);
if (![5, 20, 40, 60].includes(cutoff)) throw new Error("CV_DFS_CUTOFF must be 5, 20, 40 or 60");
const octaves = Number(process.env.CV_IMAGE_OCTAVES ?? 1);
if (![1, 2, 3].includes(octaves)) throw new Error("CV_IMAGE_OCTAVES must be 1, 2 or 3");
const input = process.env.CV_IMAGE_CASE_DIR ? path.resolve(process.env.CV_IMAGE_CASE_DIR) : path.join(root, "images_test_cases");
const parent = path.join(root, "frontend/test-results");
const output = path.join(parent, "shadow-images");
const names = (await readdir(input, { withFileTypes: true }))
  .filter((entry) => entry.isFile() && /\.(png|jpe?g|webp)$/i.test(entry.name) && entry.name !== "background.png")
  .map((entry) => entry.name).sort((a, b) => a.localeCompare(b, "en", { numeric: true }));
if (!names.length) throw new Error(`No case images found in ${input}`);
const referenceBytes = await readFile(path.join(input, "background.png"));
const dataUrl = (bytes, name) => `data:image/${/\.jpe?g$/i.test(name) ? "jpeg" : /\.webp$/i.test(name) ? "webp" : "png"};base64,${bytes.toString("base64")}`;
const codes = {};
const sourceHashes = {};
for (const name of ["events/noteEvents", "diagnostics/performanceMetrics",
  ...["shadowHeatmap", "shadowBand", "shadowTipEvidence", "fingertipCandidates", "keyboardLayout",
    "keyboardGeometry", "homography", "calibration", "collision", "markerDetector", "liveShadowBaseline"].map((name) => `cv/${name}`)]) {
  const source = await readFile(path.join(root, `frontend/src/${name}.ts`), "utf8");
  sourceHashes[name] = hash(source);
  codes[`/${name}`] = ts.transpileModule(source, { compilerOptions: {
    target: ts.ScriptTarget.ES2020, module: ts.ModuleKind.CommonJS,
  } }).outputText;
}
const css = await readFile(path.join(root, "frontend/src/app/globals.css"), "utf8");
const tokens = css.match(/--color-[\w-]+\s*:[^;]+;/g).join("\n");
await mkdir(parent, { recursive: true });
const staging = await mkdtemp(path.join(parent, ".shadow-images-"));
let browser;
const records = [];
try {
  browser = await chromium.launch({ channel: process.env.CV_BROWSER_CHANNEL || "chrome", headless: true });
  const page = await browser.newPage();
  await page.setContent(`<style>:root { ${tokens} }</style>`);
  const errors = [];
  page.on("pageerror", (error) => errors.push(error.message));
  const openCvPath = require.resolve("@techstark/opencv-js/dist/opencv.js");
  sourceHashes.openCv = hash(await readFile(openCvPath));
  await page.addScriptTag({ path: openCvPath });
  await page.evaluate(async () => { window.openCvRuntime = await window.cv; });
  await page.evaluate((codes) => {
    const modules = { "@techstark/opencv-js": { default: window.openCvRuntime } };
    for (const [name, code] of Object.entries(codes)) {
      const exports = {};
      new Function("exports", "require", code)(exports, (id) => {
        const key = id.startsWith(".") ? new URL(id, `https://modules${name}`).pathname : id;
        if (!modules[key]) throw new Error(`Unresolved CV import: ${id} in ${name}`);
        return modules[key];
      });
      modules[name] = exports;
    }
    window.shadowImages = Object.assign({}, ...Object.entries(modules).filter(([name]) => name.startsWith("/cv/")).map(([, value]) => value));
  }, codes);
  const settings = await page.evaluate(() => window.shadowImages.LIVE_SHADOW_DFS_SETTINGS);
  const geometry = await page.evaluate(async ({ reference, octaves }) => {
    const cv = window.shadowImages;
    const image = new Image(); image.src = reference; await image.decode();
    const canvas = document.createElement("canvas"); canvas.width = image.naturalWidth; canvas.height = image.naturalHeight;
    canvas.getContext("2d", { willReadFrequently: true }).drawImage(image, 0, 0);
    const detector = await cv.MarkerDetector.create();
    try {
      const detection = detector.detect(canvas);
      const corners = cv.markerCorners(detection, { width: canvas.width, height: canvas.height });
      if (!corners) throw new Error("background.png needs all four valid piano markers (0–3); cannot determine playable space");
      const frameToSheet = cv.computeHomography(corners, cv.PAGE_CORNERS);
      const sheetToFrame = frameToSheet && cv.invertHomography(frameToSheet);
      if (!sheetToFrame) throw new Error("Background piano marker geometry is invalid");
      const layout = { ...cv.DEFAULT_LAYOUT, octaves, whiteKeys: 7 * octaves + 1 };
      const keys = cv.getWhiteKeyPolygons(layout).map((key) => key.map((point) => cv.projectPoint(sheetToFrame, point)));
      if (!keys.every((key) => key.every((point) => point && Number.isFinite(point.x) && Number.isFinite(point.y)))) {
        throw new Error("Background piano projection is invalid");
      }
      return { frameToSheet, layout, keys, markerCenters: corners, width: canvas.width, height: canvas.height };
    } finally { detector.dispose(); }
  }, { reference: dataUrl(referenceBytes, "background.png"), octaves });
  for (const [index, name] of ["background.png", ...names].entries()) {
    const imageFile = `${String(index).padStart(3, "0")}.png`;
    let sourceSha256;
    try {
      const bytes = name === "background.png" ? referenceBytes : await readFile(path.join(input, name));
      sourceSha256 = hash(bytes);
      const result = await page.evaluate(async ({ source, reference, name, cutoff, geometry }) => {
        const cv = window.shadowImages;
        const load = async (src) => { const image = new Image(); image.src = src; await image.decode(); return image; };
        const image = await load(source);
        const background = await load(reference);
        if (image.naturalWidth !== background.naturalWidth || image.naturalHeight !== background.naturalHeight) {
          throw new Error(`Resolution ${image.naturalWidth}x${image.naturalHeight} differs from background ${background.naturalWidth}x${background.naturalHeight}`);
        }
        const scale = Math.min(1, 640 / Math.max(image.naturalWidth, image.naturalHeight));
        const width = Math.round(image.naturalWidth * scale);
        const height = Math.round(image.naturalHeight * scale);
        const sample = (image) => {
          const canvas = document.createElement("canvas"); canvas.width = width; canvas.height = height;
          const c = canvas.getContext("2d", { willReadFrequently: true });
          c.drawImage(image, 0, 0, width, height); return c.getImageData(0, 0, width, height);
        };
        const current = sample(image);
        const referencePixels = sample(background);
        const started = performance.now();
        const detected = cv.detectShadowBaseline(current, referencePixels, image.naturalWidth, image.naturalHeight,
          geometry.frameToSheet, geometry.layout, cutoff, true);
        const { difference, mask: geometryMask } = detected.diagnostics;
        const excludedCount = detected.candidates.filter((candidate) => candidate.keyIndex < 0).length;
        const candidates = detected.candidates.filter((candidate) => candidate.keyIndex >= 0).map((candidate) => {
          const dfs = candidate.dfs;
          const levels = [5, 20, 40, 60].map((threshold) => {
            const level = dfs?.levels.find((l) => l.threshold === threshold);
            return { threshold, decision: level?.patternMatch == null ? "UNKNOWN" : level.patternMatch ? "PRESS" : "NO PRESS",
              downwardVeto: level?.downwardVeto ?? null, upwardReached: level?.upwardReached ?? null,
              downwardUnknown: level?.downwardUnknown ?? null, upwardUnknown: level?.upwardUnknown ?? null,
              ignoredStartingPoints: level?.ignoredSeeds.length ?? null,
              rejectionPixel: level?.rejectionPixel ?? null, supportingPixel: level?.supportingPixel ?? null };
          });
          return { id: candidate.id, x: candidate.x, y: candidate.y, width: candidate.width, keyIndex: candidate.keyIndex,
            decision: levels.find((l) => l.threshold === cutoff).decision, levels };
        });
        const analysisMs = performance.now() - started;
        const palette = cv.readHeatmapPalette();
        const color = (name) => getComputedStyle(document.documentElement).getPropertyValue(`--color-${name}`).trim();
        const canvas = document.createElement("canvas"); canvas.width = width * 2;
        const legendY = (height + 54) * 2;
        canvas.height = legendY + (Math.max(1, candidates.length) + 1) * 28 + 16;
        const c = canvas.getContext("2d");
        c.fillStyle = color("white"); c.fillRect(0, 0, canvas.width, canvas.height);
        const filter = { method: "projection", maximumColorShift: 10, maximumResidual: 0.12 };
        const mask = new ImageData(width, height);
        for (let i = 0; i < geometryMask.length; i++) {
          const value = geometryMask[i] ? 255 : 0; mask.data.set([value, value, value, 255], i * 4);
        }
        const panels = [current,
          new ImageData(cv.colorizeShadowDifference(difference, "darkening", 5, 120, palette), width, height), mask,
          new ImageData(cv.colorizeShadowDifference(difference, "candidate", 5, 120, palette, filter), width, height)];
        const titles = ["Source + candidate locations", "Raw darkening", "Filtered geometry mask", "Projection-filtered shadow"];
        const decisionColor = { PRESS: "success-strong", "NO PRESS": "danger", UNKNOWN: "blue" };
        for (let n = 0; n < 4; n++) {
          const x0 = (n % 2) * width; const y0 = Math.floor(n / 2) * (height + 54);
          c.fillStyle = color("surface-dark"); c.font = "15px sans-serif";
          c.fillText(titles[n], x0 + 8, y0 + 20);
          c.font = "12px sans-serif"; c.fillText(`${name} | cutoff ${cutoff} | margin ${cv.LIVE_SHADOW_DFS_SETTINGS.corridorRadius} / width ${cv.LIVE_SHADOW_DFS_SETTINGS.minimumUpwardShadowWidth}`, x0 + 8, y0 + 40, width - 16);
          c.putImageData(panels[n], x0, y0 + 54);
          c.strokeStyle = color("blue"); c.lineWidth = 1;
          for (const key of geometry.keys) {
            c.beginPath(); key.forEach((point, index) => {
              const x = x0 + point.x * width / geometry.width;
              const y = y0 + 54 + point.y * height / geometry.height;
              if (index === 0) c.moveTo(x, y); else c.lineTo(x, y);
            }); c.closePath(); c.stroke();
          }
          // Keep candidate markers on the source only; leave diagnostic pixels unobscured.
          for (const candidate of n === 0 ? candidates : []) {
            const x = x0 + candidate.x; const y = y0 + 54 + candidate.y;
            c.strokeStyle = color(decisionColor[candidate.decision]); c.lineWidth = 2;
            c.beginPath(); c.arc(x, y, 5, 0, Math.PI * 2); c.stroke();
          }
        }
        const columns = ["Candidate (x, y)", "20 luma", "40 luma", "60 luma"];
        c.font = "bold 15px sans-serif"; c.fillStyle = color("surface-dark");
        for (const [column, title] of columns.entries()) {
          c.fillText(title, column * canvas.width / 4 + 8, legendY + 22);
        }
        for (const [index, candidate] of candidates.entries()) {
          const y = legendY + 50 + index * 28;
          c.fillStyle = color("surface-dark"); c.fillText(`#${candidate.id} (${candidate.x}, ${candidate.y})`, 8, y);
          for (const [column, threshold] of [20, 40, 60].entries()) {
            const decision = candidate.levels.find((level) => level.threshold === threshold).decision;
            c.fillStyle = color(decisionColor[decision]);
            c.fillText(decision, (column + 1) * canvas.width / 4 + 8, y);
          }
          c.strokeStyle = color("control-inactive"); c.lineWidth = 1;
          c.beginPath(); c.moveTo(0, y + 7); c.lineTo(canvas.width, y + 7); c.stroke();
        }
        if (!candidates.length) { c.fillStyle = color("surface-dark"); c.fillText("NO CANDIDATES", 8, legendY + 50); }
        return { png: canvas.toDataURL("image/png").split(",")[1], width, height,
          sourceWidth: image.naturalWidth, sourceHeight: image.naturalHeight, analysisMs, excludedCount, candidates };
      }, { source: dataUrl(bytes, name), reference: dataUrl(referenceBytes, "background.png"), name, cutoff, geometry });
      const { png, ...record } = result;
      if (name === "background.png" && record.candidates.length) throw new Error("Background self-comparison produced candidates");
      await writeFile(path.join(staging, imageFile), Buffer.from(png, "base64"));
      records.push({ name, sourceSha256, image: imageFile, ...record });
      console.info(`${name}: ${record.candidates.map((c) => `#${c.id} ${c.decision}`).join("; ") || "NO CANDIDATES"}`);
    } catch (error) {
      const message = error.message.split("\n")[0].replace(/^page\.evaluate: (Error: )?/, "");
      records.push({ name, sourceSha256, error: message, candidates: [] });
      console.error(`${name}: ERROR ${message}`);
    }
  }
  if (errors.length) throw new Error(errors.join("\n"));
  const summary = { images: records.length, errors: records.filter((r) => r.error).length,
    noCandidates: records.filter((r) => !r.error && !r.candidates.length).length,
    candidates: records.reduce((n, r) => n + r.candidates.length, 0),
    excludedOutsidePiano: records.reduce((n, r) => n + (r.excludedCount ?? 0), 0),
    ...Object.fromEntries(["PRESS", "NO PRESS", "UNKNOWN"].map((decision) => [decision,
      records.reduce((n, r) => n + r.candidates.filter((c) => c.decision === decision).length, 0)])) };
  const note = "Only candidates inside the background-marker-projected virtual piano keys are shown; outside points skip DFS. Anonymous decisions, not physical-contact pass/fail. No finger identity, tracking or note dispatch. Coordinates are analysis pixels. NO CANDIDATES is not a hover verdict. Timings exclude marker setup/decode/render and are not physical latency.";
  const report = { schemaVersion: 3, generatedAt: new Date().toISOString(), input, cutoff, settings, geometry,
    referenceSha256: hash(referenceBytes), sourceHashes, node: process.version, browser: browser.version(), note, summary, records };
  await writeFile(path.join(staging, "details.json"), JSON.stringify(report, null, 2) + "\n");
  // Keep the routine handoff small; full all-cutoff evidence lives separately.
  const compact = { ...report, records: records.map((record) => ({ ...record,
    candidates: record.candidates.map((candidate) => ({ id: candidate.id, x: candidate.x,
      y: candidate.y, width: candidate.width, keyIndex: candidate.keyIndex, decision: candidate.decision,
      decisions: Object.fromEntries(candidate.levels.filter((level) => [20, 40, 60].includes(level.threshold))
        .map((level) => [level.threshold, level.decision])) })),
  })) };
  await writeFile(path.join(staging, "summary.json"), JSON.stringify(compact) + "\n");
  await writeFile(path.join(staging, "results.txt"), [
    `Shadow image decisions | marker colors: cutoff ${cutoff} | X margin ${settings.corridorRadius} | upward width ${settings.minimumUpwardShadowWidth}`,
    note, "", ...records.flatMap((r) => [r.name,
      ...(r.error ? [`  ERROR: ${r.error}`] : r.candidates.length ? [
        "  Candidate    20 luma     40 luma     60 luma",
        ...r.candidates.map((c) => `  ${`#${c.id}`.padEnd(13)}${[20, 40, 60].map((threshold) =>
          c.levels.find((level) => level.threshold === threshold).decision.padEnd(12)).join("").trimEnd()}`),
      ] : ["  NO CANDIDATES"])]),
    "", JSON.stringify(summary), "",
  ].join("\n"));
  const html = `<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Shadow image decisions</title>
    <style>:root{${tokens}}body{background:var(--color-white);color:var(--color-surface-dark);font:16px system-ui;max-width:1400px;margin:24px auto;padding:0 16px}img{max-width:100%;height:auto}td,th{text-align:left;padding:5px 14px;border-bottom:1px solid var(--color-control-inactive)}section{margin:40px 0}</style>
    <h1>Shadow image decisions — 20 / 40 / 60 luma</h1><p>Source marker colors use cutoff ${cutoff}; candidate numbers and coordinates appear in the tables. Heatmaps have no candidate markers or labels. Each image's bottom table compares all three cutoffs.</p><p>${escape(note)}</p>
    <p><a href="results.txt">Simple results</a> · <a href="summary.json">Compact summary</a> · <a href="details.json">All-cutoff details</a></p><p>${escape(JSON.stringify(summary))}</p>
    ${records.map((r) => `<section><h2>${escape(r.name)}</h2>${r.error ? `<p>ERROR: ${escape(r.error)}</p>` : `<p>${r.candidates.length ? "" : "NO CANDIDATES"}</p><img loading="lazy" src="${r.image}" alt="${escape(r.name)}: source candidate locations, unobscured darkening, geometry and filtered shadow, and candidate decision table">
    <table><tr><th>Candidate</th><th>x,y</th><th>Width</th>${[20, 40, 60].map((n) => `<th>${n} luma</th>`).join("")}</tr>${r.candidates.map((c) => `<tr><td>#${c.id}</td><td>${c.x},${c.y}</td><td>${c.width}</td>${c.levels.filter((l) => [20, 40, 60].includes(l.threshold)).map((l) => `<td>${l.decision}</td>`).join("")}</tr>`).join("")}</table>`}</section>`).join("\n")}`;
  await writeFile(path.join(staging, "index.html"), html);
  // Replace only this runner's fixed output; previous results survive failed startup.
  await rm(output, { recursive: true, force: true });
  await rename(staging, output);
  console.info(`\n${JSON.stringify(summary)}\nResults: ${output}/index.html`);
  if (summary.errors) process.exitCode = 1;
} finally {
  await browser?.close();
  await rm(staging, { recursive: true, force: true });
}
