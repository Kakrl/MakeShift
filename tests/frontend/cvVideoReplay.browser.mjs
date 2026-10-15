/* Run one labeled clip through the browser's video decoder and production CV.
 * Usage: CV_VIDEO_FILE=/path/clip.mp4 CV_SIDECAR_FILE=/path/clip.json
 *        npm run test:cv-video
 */
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { writeFile } from "node:fs/promises";
const requireFromFrontend = createRequire(
  new URL("../../frontend/package.json", import.meta.url),
);
const { chromium } = requireFromFrontend("playwright");

const videoPath = process.env.CV_VIDEO_FILE;
const sidecarPath = process.env.CV_SIDECAR_FILE;
assert(videoPath, "Set CV_VIDEO_FILE to an MP4 clip");
assert(sidecarPath, "Set CV_SIDECAR_FILE to its JSON sidecar");
const base = (process.env.MAKE_SHIFT_URL || "http://127.0.0.1:3000").replace(/\/+$/, "");
const browser = await chromium.launch({
  headless: true,
  ...(process.env.CV_BROWSER_CHANNEL
    ? { channel: process.env.CV_BROWSER_CHANNEL }
    : {}),
});
try {
  const page = await browser.newPage();
  const pageErrors = [];
  page.on("pageerror", (error) => pageErrors.push(error.message));
  await page.goto(`${base}/cv-video-replay`);
  await page.locator("#clip").setInputFiles(videoPath);
  await page.locator("#sidecar").setInputFiles(sidecarPath);
  await page.getByRole("button", { name: "Run replay" }).click();
  const status = page.getByRole("status");
  const deadline = Date.now() + 10 * 60 * 1000;
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
  assert.deepEqual(pageErrors, [], "CV replay must not throw browser errors");
  const output = JSON.parse(await page.locator("pre").innerText());
  const outputJson = JSON.stringify(output, null, 2);
  if (process.env.CV_RESULT_FILE) await writeFile(process.env.CV_RESULT_FILE, outputJson);
  process.stdout.write(`${outputJson}\n`);
} finally {
  await browser.close();
}
