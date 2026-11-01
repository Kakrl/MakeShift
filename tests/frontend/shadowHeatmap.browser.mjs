import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { mkdir, readdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const require = createRequire(new URL("../../frontend/package.json", import.meta.url));
const { chromium } = require("playwright");
const output = path.join(root, "frontend/test-results/shadow-heatmap");
await mkdir(output, { recursive: true });
const cases = path.join(root, "images_test_cases");
const images = (await readdir(cases)).filter((name) => /^(hover|press|approach|release)_.*\.png$/.test(name)).sort();
assert(images.length, "Labeled images are required for this local experiment");
const base = process.env.MAKE_SHIFT_URL || "http://127.0.0.1:3107";
const browser = await chromium.launch({ channel: process.env.CV_BROWSER_CHANNEL || "chrome", headless: true });
try {
  const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
  const errors = []; const modelRequests = [];
  page.on("pageerror", (error) => errors.push(error.message));
  page.on("request", (request) => { if (/mediapipe|opencv|hand_landmarker/.test(request.url())) modelRequests.push(request.url()); });
  await page.goto(`${base}/cv-shadow-test`);
  await page.locator("#heatmap-reference").setInputFiles(path.join(cases, "background.png"));
  const waitReady = () => page.waitForFunction(() => document.querySelector('[role="status"]')?.textContent?.startsWith("Heatmaps ready."));
  const hash = () => page.locator("#darkening-map").evaluate((canvas) => {
    const data = canvas.getContext("2d").getImageData(0, 0, canvas.width, canvas.height).data;
    let result = 2166136261;
    for (const value of data) result = Math.imul(result ^ value, 16777619) >>> 0;
    return result;
  });
  const stats = [];
  for (const name of ["background.png", ...images]) {
    await page.locator("#heatmap-source").setInputFiles(path.join(cases, name));
    await page.waitForFunction((name) => [...document.querySelectorAll("p")].some((element) => element.textContent === name), name);
    // Wait for both loading and React's paused-frame render to finish.
    await waitReady();
    await page.waitForFunction(() => document.querySelector("#darkening-map")?.width === 640);
    stats.push({ name, hash: await hash(), summary: await page.locator('[aria-live="polite"]').innerText() });
    for (const mode of ["multiplier", "attenuation", "residualReference", "residualCurrent", "candidate"]) {
      assert.equal(await page.locator(`#${mode}-map`).evaluate((canvas) => canvas.width), 640);
    }
    await page.locator("#residualCurrent-map").hover();
    stats.at(-1).reference = "background.png";
    stats.at(-1).projectionSample = await page.getByTestId("projection-pixel").innerText();
    assert.match(stats.at(-1).projectionSample, /Sample.*a .*1−a .*e_B .*e_I/);
    await page.locator("#darkening-map").hover();
    stats.at(-1).rgbSample = await page.locator('[aria-live="polite"]').innerText();
    if (name === "background.png") assert.match(stats.at(-1).summary, /maximum 0\.0/);
  }
  const mapPixels = (id) => page.locator(`#${id}`).evaluate((canvas) => Array.from(canvas.getContext("2d").getImageData(0, 0, canvas.width, canvas.height).data));
  const beforeResidualScale = await mapPixels("residualCurrent-map");
  await page.getByLabel("Residual full scale", { exact: true }).fill("0.1");
  await page.waitForFunction((before) => {
    const canvas = document.querySelector("#residualCurrent-map");
    return canvas.getContext("2d").getImageData(0, 0, canvas.width, canvas.height).data.some((n, i) => n !== before[i]);
  }, beforeResidualScale);
  await page.getByLabel("Residual full scale", { exact: true }).fill("0.3");
  await page.getByLabel("Exclusion method", { exact: true }).selectOption("projection");
  await page.getByLabel("Maximum retained e_I", { exact: true }).fill("0");
  await page.waitForFunction(() => {
    const canvas = document.querySelector("#candidate-map");
    return canvas.width === 640;
  });
  const strictCandidate = await mapPixels("candidate-map");
  await page.getByLabel("Maximum retained e_I", { exact: true }).fill("1");
  await page.waitForFunction((before) => {
    const canvas = document.querySelector("#candidate-map");
    return canvas.getContext("2d").getImageData(0, 0, canvas.width, canvas.height).data.some((n, i) => n !== before[i]);
  }, strictCandidate);
  await page.getByLabel("Maximum retained e_I", { exact: true }).fill("0.15");
  await page.getByLabel("Exclusion method", { exact: true }).selectOption("color");
  const original = await hash();
  await page.getByLabel("Darkening full scale", { exact: true }).fill("240");
  await page.waitForFunction((old) => {
    const canvas = document.querySelector("#darkening-map");
    const data = canvas.getContext("2d").getImageData(0, 0, canvas.width, canvas.height).data;
    let result = 2166136261;
    for (const value of data) result = Math.imul(result ^ value, 16777619) >>> 0;
    return result !== old;
  }, original);
  await page.getByLabel("Darkening full scale", { exact: true }).fill("120");
  await waitReady();
  await page.screenshot({ path: path.join(output, "image-heatmap.png"), fullPage: true });

  const collector = page.getByRole("region", { name: "Labeled shadow samples" });
  await collector.getByLabel("Sample label", { exact: true }).selectOption("shadow");
  await collector.getByLabel("Contact phase", { exact: true }).selectOption("hover");
  await collector.getByLabel("Patch size", { exact: true }).selectOption("3");
  await collector.getByLabel("Sample note", { exact: true }).fill("edge patch test");
  await collector.getByLabel("Sample X", { exact: true }).fill("0");
  await collector.getByLabel("Sample Y", { exact: true }).fill("0");
  await collector.getByRole("button", { name: "Save selected sample", exact: true }).click();
  await collector.getByLabel("Sample label", { exact: true }).selectOption("skin");
  await collector.getByLabel("Patch size", { exact: true }).selectOption("1");
  await page.locator("#sample-source").click();
  assert.match(await collector.getByTestId("sample-count").innerText(), /^2 \/ 200/);
  const exportSamples = async (name) => {
    const downloaded = page.waitForEvent("download");
    await collector.getByRole("button", { name: "Export samples JSON", exact: true }).click();
    const download = await downloaded;
    assert.equal(download.suggestedFilename(), "shadow-samples.json");
    const destination = path.join(output, name);
    await download.saveAs(destination);
    return JSON.parse(await readFile(destination, "utf8"));
  };
  const initialSamples = await exportSamples("image-samples.json");
  assert.equal(initialSamples.schemaVersion, 1);
  assert.equal(initialSamples.samples.length, 2);
  assert.equal(initialSamples.samples[0].selection.label, "shadow");
  assert.equal(initialSamples.samples[0].selection.phase, "hover");
  assert.equal(initialSamples.samples[0].selection.note, "edge patch test");
  assert.equal(initialSamples.samples[0].counts.total, 4);
  assert.equal(initialSamples.samples[0].context.reference.name, "background.png");
  assert.equal(initialSamples.samples[0].context.source.name, images.at(-1));
  assert.equal(initialSamples.samples[1].selection.label, "skin");
  assert.equal(initialSamples.samples[1].pixels.length, 1);
  await page.screenshot({ path: path.join(output, "labeled-samples.png"), fullPage: true });

  const mismatch = await page.evaluate(() => { const canvas = document.createElement("canvas"); canvas.width = 2; canvas.height = 2; return canvas.toDataURL().split(",")[1]; });
  await page.locator("#heatmap-source").setInputFiles({ name: "mismatched.png", mimeType: "image/png", buffer: Buffer.from(mismatch, "base64") });
  await page.waitForFunction(() => document.querySelector('[role="status"]')?.textContent?.startsWith("Resolution mismatch:"));
  assert(await page.locator("#darkening-map").evaluate((canvas) => !canvas.getContext("2d").getImageData(0, 0, canvas.width, canvas.height).data.some((value) => value !== 0)), "Mismatch must clear the previous map");

  for (const mode of ["multiplier", "attenuation", "residualReference", "residualCurrent", "candidate"]) {
    assert(await page.locator(`#${mode}-map`).evaluate((canvas) => !canvas.getContext("2d").getImageData(0, 0, canvas.width, canvas.height).data.some((n) => n !== 0)), "Mismatch clears projection maps");
  }
  assert(await collector.getByRole("button", { name: "Save selected sample", exact: true }).isDisabled(), "Mismatch disables sample capture");
  const video = path.join(root, "tests/automation/CV Test Videos/cv_automation_test_1.mov");
  await page.locator("#heatmap-source").setInputFiles(video);
  await page.waitForFunction(() => document.querySelector("#heatmap-video")?.readyState >= 2);
  await page.getByRole("button", { name: "Capture empty reference" }).click();
  await waitReady();
  assert.match(await page.locator('[aria-live="polite"]').innerText(), /maximum 0\.0/);
  await page.locator("#heatmap-video").evaluate((video) => { video.currentTime = 100 / 30; });
  await page.getByText(/approximate frame 100$/).waitFor();
  const frame100 = await page.locator("#heatmap-source-canvas").evaluate((canvas) => Array.from(canvas.getContext("2d").getImageData(0, 0, canvas.width, canvas.height).data));
  await page.getByRole("button", { name: "Next frame", exact: true }).click();
  await page.getByText(/approximate frame 101$/).waitFor();
  const agreement = await page.evaluate(() => {
    const sampled = document.querySelector("#heatmap-source-canvas");
    const live = document.createElement("canvas"); live.width = sampled.width; live.height = sampled.height;
    live.getContext("2d", { willReadFrequently: true }).drawImage(document.querySelector("#heatmap-video"), 0, 0, live.width, live.height);
    const actual = sampled.getContext("2d").getImageData(0, 0, live.width, live.height).data;
    const expected = live.getContext("2d").getImageData(0, 0, live.width, live.height).data;
    let maximumDifference = 0;
    let differingChannels = 0;
    for (let index = 0; index < actual.length; index += 1) {
      const delta = Math.abs(actual[index] - expected[index]);
      maximumDifference = Math.max(maximumDifference, delta);
      if (delta) differingChannels += 1;
    }
    return { maximumDifference, differingChannels };
  });
  assert(agreement.maximumDifference <= 2, `Heatmap source must match the decoded frame within canvas rounding: ${JSON.stringify(agreement)}`);
  await page.getByRole("button", { name: "Previous frame", exact: true }).click();
  await page.getByText(/approximate frame 100$/).waitFor();
  const repeat = await page.locator("#heatmap-source-canvas").evaluate((canvas, original) => {
    const actual = canvas.getContext("2d").getImageData(0, 0, canvas.width, canvas.height).data;
    let maximumDifference = 0;
    for (let i = 0; i < actual.length; i += 1) maximumDifference = Math.max(maximumDifference, Math.abs(actual[i] - original[i]));
    return maximumDifference;
  }, frame100);
  assert(repeat <= 2, `Returning to the same approximate frame must reproduce source pixels within decoder rounding; max difference ${repeat}`);
  await collector.getByLabel("Sample label", { exact: true }).selectOption("ambiguous");
  await collector.getByLabel("Contact phase", { exact: true }).selectOption("touch");
  await collector.getByLabel("Patch size", { exact: true }).selectOption("5");
  await collector.getByRole("button", { name: "Save selected sample", exact: true }).click();
  const videoSamples = await exportSamples("video-samples.json");
  assert.equal(videoSamples.samples.length, 3);
  assert.deepEqual(videoSamples.samples.slice(0, 2), initialSamples.samples, "Saved snapshots survive source and reference changes");
  assert.equal(videoSamples.samples[2].context.source.frame, 100);
  assert.equal(videoSamples.samples[2].context.source.frameIdentity, "approximate");
  assert.equal(videoSamples.samples[2].context.source.kind, "video");
  assert.equal(videoSamples.samples[2].selection.label, "ambiguous");
  assert.notEqual(videoSamples.samples[2].context.reference.id, initialSamples.samples[0].context.reference.id);
  await collector.getByRole("button", { name: /^Remove sample / }).last().click();
  assert.match(await collector.getByTestId("sample-count").innerText(), /^2 \/ 200/);
  await page.locator("#darkening-map").hover();
  assert.match(await page.locator('[aria-live="polite"]').innerText(), /current RGB.*reference RGB.*signed darkening/);
  await page.screenshot({ path: path.join(output, "video-heatmap.png"), fullPage: true });
  await page.setViewportSize({ width: 390, height: 844 });
  assert(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), "Mobile page must not overflow");
  await page.screenshot({ path: path.join(output, "mobile-heatmap.png") });
  await page.locator("#darkening-map").scrollIntoViewIfNeeded();
  await page.screenshot({ path: path.join(output, "mobile-map-detail.png") });
  assert.deepEqual(errors, []); assert.deepEqual(modelRequests, [], "Heatmap must not load hand/marker inference");
  const report = { images: stats, imageCount: images.length, videoCaptureAndStepping: "passed", mismatch: "passed", settingsAndPixelInspector: "passed", projectionMapsAndExclusionControls: "passed", labeledSamplesAndExport: "passed", mobile: "passed", modelRequests, pageErrors: errors };
  await writeFile(path.join(output, "report.json"), JSON.stringify(report, null, 2));
  process.stdout.write(JSON.stringify({ imageCount: images.length, video: "passed", output }, null, 2));
} finally { await browser.close(); }
