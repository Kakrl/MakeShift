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
  if (manualStep) queryParams.set("manual", "1");
  const query = queryParams.size ? `?${queryParams.toString()}` : "";
  await page.goto(`${base}/cv-video-replay${query}`);
  await page.locator("#clip").setInputFiles(videoPath);
  await page.locator("#sidecar").setInputFiles(sidecarPath);
  await page.getByRole("button", { name: "Run replay" }).click();
  const status = page.getByRole("status");
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
  const output = JSON.parse(await page.locator("pre").innerText());
  const outputJson = JSON.stringify(output, null, 2);
  if (process.env.CV_RESULT_FILE) await writeFile(process.env.CV_RESULT_FILE, outputJson);
  process.stdout.write(`${outputJson}\n`);
} finally {
  await browser.close();
}
