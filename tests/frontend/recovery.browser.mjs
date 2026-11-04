/* #220 production UI with fake camera; physical movement/listening stays manual.
 * Run after build/start: BROWSER_CHANNEL=msedge node tests/frontend/recovery.browser.mjs
 */
import assert from "node:assert/strict";
import { chromium } from "../../frontend/node_modules/playwright/index.mjs";

const browser = await chromium.launch({ channel: process.env.BROWSER_CHANNEL ?? "chromium",
  args: ["--use-fake-device-for-media-stream", "--use-fake-ui-for-media-stream"] });
try {
  const page = await browser.newPage();
  const origin = process.env.MAKE_SHIFT_URL ?? "http://127.0.0.1:3000";
  await page.addInitScript(() => localStorage.setItem("hasVisited", "true"));
  await page.goto(origin);
  await page.waitForFunction(() => {
    const video = document.querySelector("video");
    return video?.readyState >= 2 && video.srcObject?.getVideoTracks()[0]?.readyState === "live";
  });
  await page.evaluate(() => {
    const video = document.querySelector("video");
    const settings = video.srcObject.getVideoTracks()[0].getSettings();
    const width = video.videoWidth, height = video.videoHeight;
    localStorage.setItem("makeshift.calibration.v1", JSON.stringify({
      version: 1, coordinates: "unmirrored-frame-pixels/marker-unit-square", sheet: "aruco-0-3-white-keys-v1",
      camera: { deviceId: settings.deviceId, width, height, facingMode: settings.facingMode ?? "" },
      layout: { octaves: 1, startingMidi: 48, whiteKeys: 8 },
      corners: [{ x: width * .1, y: height * .1 }, { x: width * .9, y: height * .1 },
        { x: width * .9, y: height * .9 }, { x: width * .1, y: height * .9 }],
      contact: { model: "landmark-reference-v1", rest: [Array(21).fill({ x: .5, y: .5, z: 0 })] },
    }));
  });
  await page.reload();
  const legend = page.getByRole("complementary", { name: "Sheet-reference alignment" });
  await legend.waitFor({ timeout: 60_000 });
  assert.match(await legend.innerText(), /Calibrated position \(solid\)/);
  assert.match(await legend.innerText(), /Current position unavailable/);
  const timing = legend.getByText("After realigning, allow about 10 seconds for checking. Once ready, select Enable audio.");
  assert.equal(await legend.getAttribute("aria-live"), null);
  for (const width of [320, 390, 1440]) {
    await page.setViewportSize({ width, height: 900 });
    const box = await legend.boundingBox();
    assert.equal(await timing.isVisible(), true, `timing guidance visible at ${width}px`);
    const timingBox = await timing.boundingBox();
    assert.ok(timingBox.width > 1 && timingBox.height > 1, "timing guidance is not screen-reader-only");
    const videoBox = await page.locator("video").boundingBox();
    assert.ok(timingBox.y >= videoBox.y && timingBox.y + timingBox.height <= videoBox.y + videoBox.height,
      `timing guidance is not clipped by the camera at ${width}px`);
    assert.ok(box.x >= 0 && box.x + box.width <= width, `legend within ${width}px`);
    assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), `no ${width}px page overflow`);
  }
  // A camera resolution mismatch offers one keyboard-accessible calibration action.
  await page.evaluate(() => {
    const saved = JSON.parse(localStorage.getItem("makeshift.calibration.v1"));
    saved.camera.width += 100;
    localStorage.setItem("makeshift.calibration.v1", JSON.stringify(saved));
  });
  await page.reload();
  const calibrate = page.getByRole("link", { name: "Calibrate", exact: true });
  await calibrate.waitFor({ timeout: 60_000 });
  const status = page.getByRole("status").filter({ hasText: "Camera resolution changed" });
  assert.equal(await status.count(), 1);
  assert.equal(await legend.count(), 0);
  assert.equal(await page.getByText(/Saved data is checked before playing/).count(), 0);
  await page.locator("body").click({ position: { x: 1, y: 1 } });
  let reached = false;
  for (let i = 0; i < 40; i++) {
    await page.keyboard.press("Tab");
    reached = await calibrate.evaluate(el => el === document.activeElement);
    if (reached) break;
  }
  assert.ok(reached, "Tab reaches the calibration action");
  await page.keyboard.press("Enter");
  await page.waitForURL("**/calibration");
  console.log(JSON.stringify({ browser: browser.version(), responsiveWidths: [320, 390, 1440],
    savedOutline: "passed; fake camera has no marker sheet", keyboardCalibration: "passed",
    announcements: "single primary status, legend not live; real screen reader untested" }, null, 2));
} finally { await browser.close(); }
