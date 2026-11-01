// Static shadow hypothesis exploration on previously exported frames, not contact verification.
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { createRequire } from "node:module";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const require = createRequire(new URL("../../frontend/package.json", import.meta.url));
const { chromium } = require("playwright"); const ts = require("typescript");
const output = path.join(root, "frontend/test-results/shadow-hypothesis");
await mkdir(output, { recursive: true });
const hash = (bytes) => createHash("sha256").update(bytes).digest("hex");
const firstPath = "frontend/test-results/shadow-sequence/sequence.json";
const laterPath = "frontend/test-results/shadow-sequence/fingers/sequence.json";
const firstBytes = await readFile(path.join(root, firstPath)); const laterBytes = await readFile(path.join(root, laterPath));
const first = JSON.parse(firstBytes); const later = JSON.parse(laterBytes);
const referenceBytes = await readFile(path.join(root, "images_test_cases/background.png"));
const reference = `data:image/png;base64,${referenceBytes.toString("base64")}`;
const clipPath = "tests/automation/CV Test Videos/cv_automation_test_1.mov";
const clipBytes = await readFile(path.join(root, clipPath));
// Fixed association gates from the existing review crops; no phase or previous-frame input.
const groups = [
  { id: "index", crop: [285, 140, 90, 100], targetX: 318, keyFrames: [146, 147, 148, 153, 154],
    frames: later.frames.filter((f) => f.finger === "index"),
    phase: (n) => n === 146 ? "hover" : n === 147 ? "near-touch" : n === 148 ? "touch" : n <= 152 ? "touch-interval" : n === 153 ? "released" : "hover-again" },
  { id: "middle-first", crop: [340, 145, 100, 95], targetX: 385, keyFrames: [110, 111, 112, 118, 120], frames: first.frames,
    phase: (n) => n === 110 ? "hover" : n === 111 ? "near-touch" : n === 112 ? "touch" : n <= 117 ? "touch-interval" : n < 120 ? "separation" : "hover-again" },
  { id: "middle-second", crop: [245, 140, 100, 105], targetX: 277, keyFrames: [163, 164, 165, 171, 172],
    frames: later.frames.filter((f) => f.finger === "middle"),
    phase: (n) => n === 163 ? "hover" : n === 164 ? "before-labeled-touch" : n === 165 ? "touch" : n <= 170 ? "touch-interval" : n === 171 ? "released" : "hover-again" },
];
assert.equal(groups.reduce((n, g) => n + g.frames.length, 0), 30);
const codes = {};
for (const name of ["shadowHeatmap", "shadowBand", "fingertipCandidates", "shadowTipEvidence"]) {
  codes[`./${name}`] = ts.transpileModule(await readFile(path.join(root, `frontend/src/cv/${name}.ts`), "utf8"),
    { compilerOptions: { target: ts.ScriptTarget.ES2020, module: ts.ModuleKind.CommonJS } }).outputText;
}
const tokens = (await readFile(path.join(root, "frontend/src/app/globals.css"), "utf8")).match(/--color-[\w-]+\s*:[^;]+;/g).join("\n");
const browser = await chromium.launch({ channel: process.env.CV_BROWSER_CHANNEL || "chrome", headless: true });
const records = []; const sheets = [];
const reviewFor = (group, frame) => {
  if (group.id === "middle-first" && frame === 120) return { status: "wrong-target", note: "Source review: the fixed gate selected a neighboring upper fingertip; exclude this row from target-finger interpretation." };
  if (group.id === "middle-second" && [163, 164].includes(frame)) return { status: "directional-limit", note: "Source/map review: broad shadow lies diagonally to the right; the central downward strip reports a short rim. This is a counterexample to using that strip alone." };
  return { status: group.keyFrames.includes(frame) ? "comparison-inspected" : "not-individually-reviewed", note: "Localization is exploratory, not ground truth." };
};
try {
  const page = await browser.newPage();
  await page.setContent(`<style>:root { ${tokens} }</style>`);
  await page.evaluate((codes) => {
    const modules = {};
    for (const [name, code] of Object.entries(codes)) { const exports = {};
      new Function("exports", "require", code)(exports, (id) => modules[id]); modules[name] = exports; }
    window.experiment = { ...modules["./shadowHeatmap"], ...modules["./fingertipCandidates"], ...modules["./shadowTipEvidence"] };
  }, codes);
  // The first sequence cache contains only enlarged crops. Recover full frames
  // for whole-image clustering; preserve both original cache files on disk.
  await page.evaluate(async (base64) => {
    const video = document.createElement("video"); video.muted = true; video.preload = "auto";
    document.body.append(video); window.clipVideo = video;
    const bytes = Uint8Array.from(atob(base64), (c) => c.charCodeAt(0));
    const url = URL.createObjectURL(new Blob([bytes], { type: "video/quicktime" }));
    await new Promise((resolve, reject) => { video.onloadedmetadata = resolve;
      video.onerror = () => reject(new Error(`Clip decoding failed: ${video.error?.code} ${video.error?.message}`)); video.src = url; });
    const presented = new Promise((resolve) => video.requestVideoFrameCallback(resolve));
    await video.play(); await presented; video.pause();
  }, clipBytes.toString("base64"));
  for (const group of groups) {
    const tiles = [];
    for (const frame of group.frames) {
      let source = frame.source; let decodedMediaTime = null;
      if (group.id === "middle-first") {
        const recovered = await page.evaluate(async (time) => {
          const video = window.clipVideo;
          let metadata;
          const presented = new Promise((resolve) => video.requestVideoFrameCallback((_, data) => { metadata = data; resolve(); }));
          const seeked = new Promise((resolve) => video.addEventListener("seeked", resolve, { once: true }));
          video.currentTime = time;
          await Promise.race([Promise.all([seeked, presented]), new Promise((_, reject) => setTimeout(() => reject(new Error("Frame seek timed out")), 20000))]);
          const canvas = document.createElement("canvas"); canvas.width = video.videoWidth; canvas.height = video.videoHeight;
          canvas.getContext("2d").drawImage(video, 0, 0);
          return { source: canvas.toDataURL("image/png"), decodedMediaTime: metadata.mediaTime };
        }, frame.time);
        source = recovered.source; decodedMediaTime = recovered.decodedMediaTime;
        await writeFile(path.join(output, `${group.id}-${frame.frame}.native.png`), Buffer.from(source.split(",")[1], "base64"));
      }
      const phase = group.phase(frame.frame);
      const result = await page.evaluate(async ({ source, reference, frame, phase, id, crop, targetX, review }) => {
        const api = window.experiment;
        const load = async (url) => { const image = new Image(); image.src = url; await image.decode(); return image; };
        const image = await load(source); const background = await load(reference);
        if (image.width !== background.width || image.height !== background.height) throw new Error("Reference/source native dimension mismatch");
        const scale = Math.min(1, 640 / Math.max(image.width, image.height));
        const width = Math.round(image.width * scale); const height = Math.round(image.height * scale);
        const sample = (image) => { const c = document.createElement("canvas"); c.width = width; c.height = height;
          const ctx = c.getContext("2d"); ctx.drawImage(image, 0, 0, width, height); return ctx.getImageData(0, 0, width, height); };
        const current = sample(image); const difference = api.measureShadowDifference(current, sample(background), 40);
        const estimates = api.estimateFingertips(current, difference);
        const eligible = estimates.candidates.filter((c) => Math.abs(c.x - targetX) <= 18 && c.y >= crop[1] && c.y < crop[1] + crop[3])
          .sort((a, b) => Math.abs(a.x - targetX) - Math.abs(b.x - targetX));
        const selection = !eligible.length ? "missing" : eligible.length > 1 ? "ambiguous" : "selected";
        const tip = selection === "selected" ? eligible[0] : null;
        const evidence = tip ? api.measureTipShadowEvidence(difference, estimates.mask, tip) : null;
        const colorEvidence = tip ? api.measureTipShadowEvidence(difference, estimates.mask, tip,
          { method: "color", maximumColorShift: 10, maximumResidual: 0.12 }) : null;
        const color = (name) => getComputedStyle(document.documentElement).getPropertyValue(`--color-${name}`).trim();
        const palette = api.readHeatmapPalette();
        const layer = (pixels) => { const c = document.createElement("canvas"); c.width = width; c.height = height;
          c.getContext("2d").putImageData(pixels, 0, 0); return c; };
        const overlay = layer(current); const ctx = overlay.getContext("2d");
        ctx.fillStyle = color("yellow"); ctx.globalAlpha = 0.3;
        for (let y = crop[1]; y < crop[1] + crop[3]; y += 1) for (let x = crop[0]; x < crop[0] + crop[2]; x += 1)
          if (estimates.mask[y * width + x]) ctx.fillRect(x, y, 1, 1);
        ctx.globalAlpha = 1; ctx.fillStyle = color("blue");
        for (const ray of evidence?.rays ?? []) if (ray.boundary !== null) ctx.fillRect(ray.x, ray.boundary, 1, 1);
        if (tip) { ctx.strokeStyle = color("red"); ctx.lineWidth = 1; ctx.beginPath(); ctx.arc(tip.x, tip.y, 2, 0, Math.PI * 2); ctx.stroke(); }
        const raw = layer(new ImageData(api.colorizeShadowDifference(difference, "darkening", 5, 120, palette), width, height));
        const filtered = layer(new ImageData(api.colorizeShadowDifference(difference, "candidate", 5, 120, palette,
          { method: "projection", maximumColorShift: 10, maximumResidual: 0.12 }), width, height));
        for (const c of [raw, filtered]) if (evidence) { const cx = c.getContext("2d"); cx.fillStyle = color("blue");
          for (const ray of evidence.rays) if (ray.boundary !== null) cx.fillRect(ray.x, ray.boundary, 1, 1); }
        const tiles = [image, overlay, raw, filtered].map((layer, index) => {
          const c = document.createElement("canvas"); c.width = 220; c.height = 220;
          const cx = c.getContext("2d"); cx.fillStyle = color("white"); cx.fillRect(0, 0, 220, 220); cx.imageSmoothingEnabled = index === 0;
          const factor = index === 0 ? image.width / width : 1;
          const h = crop[3] / crop[2] * 220;
          const w = h > 220 ? 220 * 220 / h : 220;
          cx.drawImage(layer, crop[0] * factor, crop[1] * (index === 0 ? image.height / height : 1),
            crop[2] * factor, crop[3] * (index === 0 ? image.height / height : 1), 0, 0, w, Math.min(220, h));
          return c.toDataURL("image/png");
        });
        const combined = document.createElement("canvas"); combined.width = 880; combined.height = 310;
        const c = combined.getContext("2d"); c.fillStyle = color("white"); c.fillRect(0, 0, 880, 310);
        c.fillStyle = color("surface-dark"); c.font = "16px sans-serif";
        c.fillText(`${id} / frame ${frame} / ${phase} / tip ${tip ? `${tip.x},${tip.y}` : selection} / ${review.status}`, 5, 20);
        const titles = ["Native source", "Estimated finger / edge", "Raw darkening", "Projection-filtered darkening"];
        for (let i = 0; i < tiles.length; i += 1) { c.fillText(titles[i], i * 220 + 4, 43);
          const img = await load(tiles[i]); c.drawImage(img, i * 220, 50); }
        const levels = evidence?.levels.map((l) => `${l.threshold}: ${l.medianExtent ?? "?"} px (${l.completeRays}/${l.totalRays})`).join("; ") ?? "Unavailable";
        c.fillText(`Forward extent by luma cutoff — ${levels}`, 5, 287);
        c.fillText("Yellow: estimated finger; blue: sampled edge. '?' stays unknown. Side/back shadow is separate context.", 5, 306);
        return { png: combined.toDataURL("image/png").split(",")[1], tiles, record: { group: id, frame, phase,
          width, height, nativeWidth: image.width, nativeHeight: image.height, selection, eligibleCandidates: eligible.map(({ x, y, width }) => ({ x, y, width })),
          tip: tip ? { x: tip.x, y: tip.y, width: tip.width } : null, evidence, colorEvidence } };
      }, { source, reference, frame: frame.frame, phase, id: group.id, crop: group.crop, targetX: group.targetX, review: reviewFor(group, frame.frame) });
      const filename = `${group.id}-${frame.frame}.png`;
      await writeFile(path.join(output, filename), Buffer.from(result.png, "base64"));
      records.push({ ...result.record, sourceSha256: hash(Buffer.from(source.split(",")[1], "base64")),
        sourceOrigin: group.id === "middle-first" ? "video-redecoded" : "existing-full-frame-cache",
        requestedTimeSeconds: frame.time, decodedMediaTime,
        decodedTimeOffsetMs: decodedMediaTime === null ? null : (decodedMediaTime - frame.time) * 1000,
        review: reviewFor(group, frame.frame), filename });
      if (group.keyFrames.includes(frame.frame)) tiles.push({ frame: frame.frame, phase, images: result.tiles,
        levels: result.record.evidence?.levels, selection: result.record.selection, review: reviewFor(group, frame.frame).status });
    }
    const png = await page.evaluate(async ({ tiles, id }) => {
      const c = document.createElement("canvas"); c.width = tiles.length * 220; c.height = 1120;
      const ctx = c.getContext("2d"); const style = getComputedStyle(document.documentElement);
      ctx.fillStyle = style.getPropertyValue("--color-white").trim(); ctx.fillRect(0, 0, c.width, c.height);
      ctx.fillStyle = style.getPropertyValue("--color-surface-dark").trim(); ctx.font = "16px sans-serif";
      ctx.fillText(`${id}: static shadow comparison; settings fixed; approximate viewer labels`, 5, 20);
      for (const [i, tile] of tiles.entries()) {
        ctx.font = "16px sans-serif"; ctx.fillText(`Frame ${tile.frame}`, i * 220 + 4, 44);
        ctx.font = "14px sans-serif"; ctx.fillText(tile.phase, i * 220 + 4, 63);
        for (const [j, src] of tile.images.entries()) { const image = new Image(); image.src = src; await image.decode();
          ctx.drawImage(image, i * 220, 80 + j * 230); }
        for (const [j, level] of (tile.levels ?? []).entries()) ctx.fillText(`>${level.threshold}: ${level.medianExtent ?? "?"} px (${level.completeRays}/${level.totalRays})`, i * 220 + 5, 1020 + j * 16);
        if (!tile.levels) ctx.fillText(tile.selection, i * 220 + 5, 1020);
        ctx.fillText(tile.review, i * 220 + 5, 1100);
      }
      return c.toDataURL("image/png").split(",")[1];
    }, { tiles, id: group.id });
    await writeFile(path.join(output, `${group.id}-comparison.png`), Buffer.from(png, "base64"));
    sheets.push(`${group.id}-comparison.png`);
  }
} finally { await browser.close(); }
const format = (n) => n === null || n === undefined ? "unknown" : n.toFixed(2);
const csv = ["group,frame,phase,selection,review,x,y,tip_mean_drop,near_mean_drop,side_back_mean_drop,extent_5,extent_20,extent_40,extent_60,complete_rays_40,total_rays"];
for (const r of records) csv.push([r.group, r.frame, r.phase, r.selection, r.review.status, r.tip?.x ?? "", r.tip?.y ?? "", format(r.evidence?.tipMeanDrop),
  format(r.evidence?.forwardNear.meanDrop), format(r.evidence?.sideBack.meanDrop), ...[0, 1, 2, 3].map((n) => format(r.evidence?.levels[n].medianExtent)),
  r.evidence?.levels[2].completeRays ?? "", r.evidence?.levels[2].totalRays ?? ""].join(","));
await writeFile(path.join(output, "summary.csv"), `${csv.join("\n")}\n`);
await writeFile(path.join(output, "results.json"), JSON.stringify({ schemaVersion: 1, generatedAt: new Date().toISOString(),
  classification: "exploratory-static-comparison", node: process.version, browser: browser.version(), reference: "images_test_cases/background.png",
  referenceSha256: hash(referenceBytes), frameCaches: [{ path: firstPath, sha256: hash(firstBytes) }, { path: laterPath, sha256: hash(laterBytes) }],
  clip: { path: clipPath, sha256: hash(clipBytes), note: "First-middle full frames redecoded; later sequences reuse saved native frames" },
  annotationSource: "User approximate viewer annotations from 2026-10-28, not verified encoded-frame or physical contact identities",
  association: groups.map(({ id, crop, targetX }) => ({ id, crop, targetX, maximumXDistance: 18 })), records }, null, 2));
await writeFile(path.join(output, "index.html"), `<!doctype html><meta charset="utf-8"><title>Static shadow hypothesis</title>
<style>:root{${tokens}}body{font:16px sans-serif;color:var(--color-ink);background:var(--color-white);margin:24px}img{max-width:100%}table{border-collapse:collapse}td,th{padding:6px;border:1px solid var(--color-divider)}</style>
<h1>Static forward-shadow hypothesis</h1><p>Motion excluded. Native source, estimated finger boundary, raw darkening, projection-filtered darkening (top to bottom in comparison sheets). Fixed 640×427 analysis, reference cutoff 40, projection residual ≤0.12, 24-pixel scans. Forward runs must begin within three pixels of the estimated edge. Four fixed luma cutoffs are exploratory, not press thresholds. Zero: three known clear samples at that cutoff; unknown: insufficient/ambiguous/censored evidence.</p>
<p>Source localization was judged useful by the user on the earlier gallery; no measured fingertip accuracy is claimed. Targets use fixed spatial gates from existing review crops. Phase labels never enter localization or shadow measurement. Side/back evidence is kept separately and can include neighboring shadow. One clip, same lighting, no held-out evaluation.</p>
<p>Review flags are retrospective source/map observations, not automatic quality gates: first-middle 120 selects a neighboring tip; second-middle 163–164 have a broad lobe to the right that a central downward strip misses. Keep these rows visible. First-middle native frames were recovered from the original video; requested viewer times and decoded media times are recorded separately, with offsets up to about one frame. No encoded-frame or onset-timing accuracy is claimed.</p>
<p><a href="summary.csv">CSV summary</a> · <a href="results.json">All profiles / metadata</a></p>
${sheets.map((name) => `<figure><figcaption>${name}</figcaption><img src="${name}" alt="${name}"></figure>`).join("\n")}
<table><tr><th>Sequence / frame</th><th>User phase</th><th>Review</th><th>Tip</th><th>Near mean drop</th><th>Side/back mean drop</th><th>Forward extents at 5 / 20 / 40 / 60 luma</th></tr>
${records.map((r) => `<tr><td><a href="${r.filename}">${r.group} ${r.frame}</a></td><td>${r.phase}</td><td title="${r.review.note}">${r.review.status}</td><td>${r.tip ? `${r.tip.x}, ${r.tip.y}` : r.selection}</td><td>${format(r.evidence?.forwardNear.meanDrop)}</td><td>${format(r.evidence?.sideBack.meanDrop)}</td><td>${r.evidence?.levels.map((l) => `${format(l.medianExtent)} (${l.completeRays}/${l.totalRays})`).join(" / ") ?? "unknown"}</td></tr>`).join("\n")}</table>`);
console.info(`Exported ${records.length} frames; ${records.filter((r) => r.selection === "selected").length} selected tips. Gallery: ${output}/index.html`);
