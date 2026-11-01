/* Run one labeled clip through the browser's video decoder and production CV.
 * Usage: CV_VIDEO_FILE=/path/clip.mp4 CV_SIDECAR_FILE=/path/clip.json
 *        npm run test:cv-video
 */
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { access, mkdir, writeFile } from "node:fs/promises";
import { constants } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
const requireFromFrontend = createRequire(
  new URL("../../frontend/package.json", import.meta.url),
);
const { chromium } = requireFromFrontend("playwright");
const repoRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../..",
);

const videoPath = process.env.CV_VIDEO_FILE;
const sidecarPath = process.env.CV_SIDECAR_FILE;
const technique = process.env.CV_TECHNIQUE;
const headful = process.env.CV_HEADFUL === "1";
const stepCheck = process.env.CV_SHADOW_STEP_CHECK === "1";
const manualStep = process.env.CV_MANUAL_STEP === "1";
const frameDelayMs = Number(process.env.CV_FRAME_DELAY_MS || 0);
assert(videoPath, "Set CV_VIDEO_FILE to an MP4 clip");
assert(sidecarPath, "Set CV_SIDECAR_FILE to its JSON sidecar");
assert(Number.isFinite(frameDelayMs) && frameDelayMs >= 0 && frameDelayMs <= 5000,
  "CV_FRAME_DELAY_MS must be between 0 and 5000");
assert(!manualStep || headful, "CV_MANUAL_STEP=1 requires CV_HEADFUL=1");
const base = (process.env.MAKE_SHIFT_URL || "http://127.0.0.1:3000").replace(/\/+$/, "");
const browser = await chromium.launch({
  headless: !headful,
  ...(process.env.CV_BROWSER_CHANNEL
    ? { channel: process.env.CV_BROWSER_CHANNEL }
    : {}),
});
const captureDir = path.resolve(
  process.env.CV_CAPTURE_DIR || repoRoot,
);
const captureDownloads = [];

async function uniqueCapturePath(filename) {
  const extension = path.extname(filename);
  const stem = path.basename(filename, extension);
  let candidate = path.join(captureDir, filename);
  let suffix = 1;
  while (true) {
    try {
      await access(candidate, constants.F_OK);
      candidate = path.join(captureDir, `${stem} (${suffix})${extension}`);
      suffix += 1;
    } catch {
      return candidate;
    }
  }
}

try {
  const page = await browser.newPage();
  if (stepCheck) await page.setViewportSize({ width: 1440, height: 1000 });
  const pageErrors = [];
  page.on("pageerror", (error) => pageErrors.push(error.message));
  page.on("download", (download) => {
    const saved = (async () => {
      await mkdir(captureDir, { recursive: true });
      const destination = await uniqueCapturePath(download.suggestedFilename());
      await download.saveAs(destination);
      process.stdout.write(`Saved capture: ${destination}\n`);
    })();
    captureDownloads.push(saved);
  });
  const queryParams = new URLSearchParams();
  if (technique) queryParams.set("technique", technique);
  if (frameDelayMs > 0) queryParams.set("frameDelayMs", String(frameDelayMs));
  if (manualStep || stepCheck) queryParams.set("manual", "1");
  if (process.env.CV_SHADOW_EVIDENCE === "1") queryParams.set("shadowEvidence", "1");
  const query = queryParams.size ? `?${queryParams.toString()}` : "";
  await page.goto(`${base}/cv-video-replay${query}`);
  await page.locator("#clip").setInputFiles(videoPath);
  await page.locator("#sidecar").setInputFiles(sidecarPath);
  if (stepCheck || (process.env.CV_SHADOW_EVIDENCE === "1" && !manualStep)) await page.getByRole("combobox", { name: "Diagnostic view" }).selectOption("finger");
  if (stepCheck) {
    const minimum = page.getByRole("spinbutton", { name: "Minimum darkening from paper", exact: true });
    await minimum.fill("61");
    assert.equal(await minimum.inputValue(), "61");
    await page.getByRole("button", { name: "Reset dark-pixel filter", exact: true }).click();
    assert.equal(await minimum.inputValue(), "60");
  }
  await page.getByRole("button", { name: "Run replay" }).click();
  const status = page.getByRole("status");
  if (stepCheck) {
    const evidencePanel = page.getByRole("region", { name: "Frame shadow evidence" });
    await page.waitForFunction(() => document.querySelector('[aria-label="Frame shadow evidence"]')?.textContent?.startsWith("Frame 0:"), null, { timeout: 120000 });
    await page.getByRole("button", { name: "Next frame", exact: true }).click();
    await page.waitForFunction(() => document.querySelector('[aria-label="Frame shadow evidence"]')?.textContent?.startsWith("Frame 1:"));
    const cachedText = await evidencePanel.innerText();
    await page.getByRole("button", { name: "Previous frame", exact: true }).click();
    await page.waitForFunction(() => document.querySelector('[aria-label="Frame shadow evidence"]')?.textContent?.startsWith("Frame 0:"));
    await page.getByRole("button", { name: "Next frame", exact: true }).click();
    await page.waitForFunction(() => document.querySelector('[aria-label="Frame shadow evidence"]')?.textContent?.startsWith("Frame 1:"));
    assert.equal(await evidencePanel.innerText(), cachedText, "Cached next frame must restore the same evidence");
    await page.getByRole("button", { name: "Resume", exact: true }).click();
    await page.waitForFunction(() => {
      const panel = document.querySelector('[aria-label="Frame shadow evidence"]');
      return Number(/^Frame (\d+):/.exec(panel?.textContent || "")?.[1]) >= 110 &&
        (document.querySelector('[aria-label="Inspect finger"]')?.querySelectorAll("option").length || 0) >= 2 &&
        [...(panel?.querySelectorAll("tbody tr") || [])].some((row) => !row.textContent?.includes("unavailable") && row.querySelectorAll("td")[1]?.textContent !== "—");
    }, null, { timeout: 120000 });
    await page.getByRole("button", { name: "Pause", exact: true }).click();
    await page.waitForTimeout(200);
    const measuredFrame = /^Frame (\d+):/.exec(await evidencePanel.innerText())?.[1];
    const measuredText = await evidencePanel.innerText();
    await page.getByRole("button", { name: "Previous frame", exact: true }).click();
    await page.waitForFunction((number) => document.querySelector('[aria-label="Frame shadow evidence"]')?.textContent?.startsWith(`Frame ${Number(number) - 1}:`), measuredFrame);
    await page.getByRole("button", { name: "Next frame", exact: true }).click();
    await page.waitForFunction((number) => document.querySelector('[aria-label="Frame shadow evidence"]')?.textContent?.startsWith(`Frame ${number}:`), measuredFrame);
    assert.equal(await evidencePanel.innerText(), measuredText, "Measured frame must restore exact values");
    const selector = page.getByRole("combobox", { name: "Inspect finger" });
    const choices = await selector.locator("option").allTextContents();
    assert(choices.length >= 2, "Inspector check needs multiple tracked fingers");
    await selector.selectOption(choices.at(-1));
    assert.equal(await selector.inputValue(), choices.at(-1));
    assert.equal(await evidencePanel.getByRole("img").count(), 4, "Four aligned metric charts must render");
    assert.equal(await page.locator("#finger-detail").getAttribute("width"), "210");
    await page.screenshot({ fullPage: true, path: path.join(path.dirname(process.env.CV_RESULT_FILE || "/tmp/cv-result.json"), "shadow-evidence-stepping.png") });
    await page.setViewportSize({ width: 390, height: 844 });
    await page.screenshot({ fullPage: true, path: path.join(path.dirname(process.env.CV_RESULT_FILE || "/tmp/cv-result.json"), "shadow-evidence-mobile.png") });
    assert(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth), "Mobile replay must not overflow horizontally");
    await page.setViewportSize({ width: 1440, height: 1000 });
    await page.getByRole("combobox", { name: "Diagnostic view" }).selectOption("heatmap");
    const heatmaps = page.getByRole("region", { name: "Replay shadow heatmaps" });
    await heatmaps.getByText(new RegExp(`^Frame ${measuredFrame} · reference`)).waitFor();
    for (const mode of ["multiplier", "attenuation", "residualReference", "residualCurrent", "candidate"]) {
      await page.waitForFunction((mode) => document.querySelector(`#${mode}-map`)?.width === 640, mode);
    }
    await heatmaps.getByLabel("Exclusion method", { exact: true }).selectOption("projection");
    await heatmaps.getByLabel("Maximum retained e_I", { exact: true }).fill("0.2");
    await page.locator("#residualCurrent-map").hover();
    assert.match(await heatmaps.getByTestId("projection-pixel").innerText(), /Sample.*a .*e_B .*e_I/);
    const collector = heatmaps.getByRole("region", { name: "Labeled shadow samples" });
    await collector.getByLabel("Sample label", { exact: true }).selectOption("ambiguous");
    await collector.getByLabel("Contact phase", { exact: true }).selectOption("approach");
    await collector.getByRole("button", { name: "Save selected sample", exact: true }).click();
    assert.match(await collector.getByTestId("sample-count").innerText(), /^1 \/ 200/);
    assert.match(await collector.locator("tbody").innerText(), new RegExp(`frame ${measuredFrame}`));
    const band = heatmaps.getByRole("region", { name: "Fingertip shadow band" });
    assert(await band.getByRole("button", { name: "Save band measurement", exact: true }).isDisabled());
    for (const [label, value] of [["Tip X", 300], ["Tip Y", 200], ["Outward X", 300], ["Outward Y", 220]]) await band.getByLabel(label, { exact: true }).fill(String(value));
    await band.getByRole("button", { name: "Confirm anchors for this frame", exact: true }).click();
    await band.getByRole("button", { name: "Save band measurement", exact: true }).click();
    assert.match(await band.getByTestId("band-count").innerText(), /^1 \/ 200/);
    const map = page.locator("#replay-darkening-map");
    assert.equal(await map.getAttribute("width"), "640");
    const hashMap = () => map.evaluate((canvas) => {
      const data = canvas.getContext("2d").getImageData(0, 0, canvas.width, canvas.height).data;
      let hash = 2166136261;
      for (const channel of data) hash = Math.imul(hash ^ channel, 16777619) >>> 0;
      return hash;
    });
    const beforeScale = await hashMap();
    await heatmaps.getByLabel("Darkening full scale", { exact: true }).fill("240");
    await page.waitForFunction((before) => {
      const canvas = document.querySelector("#replay-darkening-map");
      const data = canvas.getContext("2d").getImageData(0, 0, canvas.width, canvas.height).data;
      let hash = 2166136261;
      for (const channel of data) hash = Math.imul(hash ^ channel, 16777619) >>> 0;
      return hash !== before;
    }, beforeScale);
    await page.getByRole("button", { name: "Previous frame", exact: true }).click();
    await heatmaps.getByText(new RegExp(`^Frame ${Number(measuredFrame) - 1} · reference`)).waitFor();
    assert(await band.getByRole("button", { name: "Save band measurement", exact: true }).isDisabled(), "Band anchors need confirmation on a different frame");
    await page.getByRole("button", { name: "Next frame", exact: true }).click();
    await heatmaps.getByText(new RegExp(`^Frame ${measuredFrame} · reference`)).waitFor();
    assert.match(await collector.getByTestId("sample-count").innerText(), /^1 \/ 200/, "Samples survive cached frame navigation");
    await page.screenshot({ fullPage: true, path: path.join(path.dirname(process.env.CV_RESULT_FILE || "/tmp/cv-result.json"), "replay-shadow-heatmaps.png") });
    await page.setViewportSize({ width: 390, height: 844 });
    assert(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), "Heatmap view must fit mobile width");
    await heatmaps.scrollIntoViewIfNeeded();
    await page.screenshot({ path: path.join(path.dirname(process.env.CV_RESULT_FILE || "/tmp/cv-result.json"), "replay-shadow-heatmaps-mobile.png") });
    await page.setViewportSize({ width: 1440, height: 1000 });
    await page.getByRole("button", { name: "Resume", exact: true }).click();
    await heatmaps.getByText("Pause replay to inspect this frame’s heatmaps.", { exact: true }).waitFor();
    assert(await collector.getByRole("button", { name: "Save selected sample", exact: true }).isDisabled(), "Cannot save samples during playback");
    assert(await band.getByRole("button", { name: "Save band measurement", exact: true }).isDisabled(), "Cannot measure bands during playback");
    await page.waitForFunction(() => {
      const canvas = document.querySelector("#candidate-map");
      return !canvas.getContext("2d").getImageData(0, 0, canvas.width, canvas.height).data.some((n) => n !== 0);
    });
  }
  const deadline = Date.now() + (manualStep ? 60 * 60 * 1000 : 10 * 60 * 1000);
  let previousStatus = "";
  while (Date.now() < deadline) {
    const currentStatus = await status.innerText();
    if (currentStatus !== previousStatus) {
      process.stdout.write(`${currentStatus}\n`);
      previousStatus = currentStatus;
    }
    if (currentStatus === "Replay complete") break;
    if (currentStatus.startsWith("Replay failed:")) {
      throw new Error(currentStatus);
    }
    await page.waitForTimeout(1000);
  }
  assert.equal(previousStatus, "Replay complete", "CV replay timed out");
  await Promise.all(captureDownloads);
  assert.deepEqual(pageErrors, [], "CV replay must not throw browser errors");
  const output = JSON.parse(await page.locator("pre").textContent());
  if (process.env.CV_SHADOW_EVIDENCE === "1") {
    assert.equal(output.shadowEvidenceFrames.length, output.processedFrames);
    assert(output.shadowEvidenceFrames.some((frame) => frame.fingertips.some((tip) => tip.evidence)),
      "Evidence replay needs at least one measured fingertip");
    const visibleView = await page.getByRole("combobox", { name: "Diagnostic view" }).inputValue();
    await page.getByRole("region", { name: visibleView === "heatmap" ? "Replay shadow heatmaps" : "Frame shadow evidence" }).waitFor();
  }
  const outputJson = JSON.stringify(output, null, 2);
  if (process.env.CV_RESULT_FILE) await writeFile(process.env.CV_RESULT_FILE, outputJson);
  process.stdout.write(`${outputJson}\n`);
} finally {
  await browser.close();
}
