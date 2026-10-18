import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";

const requireFromFrontend = createRequire(
  new URL("../../frontend/package.json", import.meta.url),
);
const { chromium } = requireFromFrontend("playwright");
const backgroundPath = process.env.CV_IMAGE_BACKGROUND;
const casePaths = (process.env.CV_IMAGE_CASES || "").split(path.delimiter).filter(Boolean);
const resultPath = process.env.CV_IMAGE_RESULT_FILE;
assert(backgroundPath, "Set CV_IMAGE_BACKGROUND to the empty-sheet reference image");
assert(casePaths.length, "Set CV_IMAGE_CASES to labeled image paths");
assert(resultPath, "Set CV_IMAGE_RESULT_FILE to the report destination");

const base = (process.env.MAKE_SHIFT_URL || "http://127.0.0.1:3000").replace(/\/+$/, "");
const browser = await chromium.launch({
  headless: true,
  ...(process.env.CV_BROWSER_CHANNEL ? { channel: process.env.CV_BROWSER_CHANNEL } : {}),
});

try {
  const page = await browser.newPage();
  const pageErrors = [];
  page.on("pageerror", (error) => pageErrors.push(error.message));
  await page.goto(`${base}/cv-image-test`);
  await page.locator("#background").setInputFiles(backgroundPath);
  await page.locator("#cases").setInputFiles(casePaths);
  await page.getByRole("button", { name: "Run image analysis" }).click();
  const status = page.getByRole("status");
  const deadline = Date.now() + 10 * 60 * 1000;
  let currentStatus = "";
  while (Date.now() < deadline) {
    currentStatus = await status.innerText();
    if (currentStatus.startsWith("Analysis complete:")) break;
    if (pageErrors.length) throw new Error(pageErrors.join("\n"));
    if (currentStatus && !currentStatus.startsWith("Analyzing ") &&
      currentStatus !== "Loading image, marker, and hand detectors..." &&
      currentStatus !== "Choose background.png and labeled case images.") {
      throw new Error(`Image replay failed: ${currentStatus}`);
    }
    await page.waitForTimeout(250);
  }
  assert(currentStatus.startsWith("Analysis complete:"), "Image replay timed out");
  assert.deepEqual(pageErrors, [], "Image replay must not throw browser errors");
  const reportElement = page.locator("#result-report");
  await reportElement.waitFor({ state: "attached", timeout: 30_000 });
  const reportText = (await reportElement.textContent())?.trim() || "";
  assert(reportText, `Replay completed without a report; page status: ${currentStatus}`);
  let report;
  try {
    report = JSON.parse(reportText);
  } catch (error) {
    throw new Error(`Replay produced invalid report JSON: ${reportText.slice(0, 500)}; ${error}`);
  }
  await mkdir(path.dirname(resultPath), { recursive: true });
  await writeFile(resultPath, JSON.stringify(report, null, 2));
  process.stdout.write(`${JSON.stringify({
    imageCount: report.images.length,
    background: report.setup,
    reportPath: resultPath,
  }, null, 2)}\n`);
} finally {
  await browser.close();
}
