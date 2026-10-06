import assert from "node:assert/strict";
import { chromium } from "../../frontend/node_modules/playwright/index.mjs";

const browser = await chromium.launch({ channel: process.env.BROWSER_CHANNEL ?? "chromium", args: [
  "--use-fake-device-for-media-stream", "--use-fake-ui-for-media-stream",
] });
try {
  const page = await browser.newPage();
  const origin = process.env.MAKE_SHIFT_URL ?? "http://127.0.0.1:3000";
  await page.goto(`${origin}/calibration`);
  for (const octaves of [1, 2, 3]) {
    await page.locator("#paper-octaves").selectOption(String(octaves));
    await page.locator("#octave-count").selectOption(String(octaves));
    await page.locator("#starting-note").selectOption("60");
    const saved = await page.evaluate(() => JSON.parse(localStorage.getItem("makeshift:keyboard-layout:v1")));
    assert.deepEqual(saved, { octaves, startingMidi: 60, whiteKeys: 7 * octaves + 1,
      paperOctaves: octaves, paperFitOverride: false });
    await page.reload();
    assert.equal(await page.locator("#octave-count").inputValue(), String(octaves));
    assert.equal(await page.locator("#starting-note").inputValue(), "60");
    assert.equal(await page.locator("#paper-octaves").inputValue(), String(octaves));
  }
  await page.locator("#paper-octaves").selectOption("1");
  await page.getByRole("alert").filter({ hasText: "does not fit" }).waitFor();
  assert.equal(await page.getByRole("button", { name: "Next Step", exact: true }).count(), 0);
  await page.getByRole("checkbox", { name: "Allow the full keyboard to extend beyond my paper" }).check();
  assert.equal(await page.getByRole("button", { name: "Next Step", exact: true }).count(), 1);
  await page.reload();
  assert.equal(await page.getByRole("checkbox").isChecked(), true);
  await page.evaluate(() => {
    localStorage.setItem("makeshift.calibration.v1", "legacy fixture");
    localStorage.setItem("depthCalibrationLines", "legacy fixture");
  });
  await page.locator("#starting-note").selectOption("72");
  assert.equal(await page.getByRole("checkbox").isChecked(), false);
  assert.equal(await page.getByRole("button", { name: "Next Step", exact: true }).count(), 0);
  assert.deepEqual(await page.evaluate(() => [localStorage.getItem("makeshift.calibration.v1"),
    localStorage.getItem("depthCalibrationLines")]), [null, null]);
  const options = await page.locator("#starting-note option").evaluateAll(options => options.map(option => Number(option.value)));
  assert.deepEqual(options, [0, 12, 24, 36, 48, 60, 72, 84]);
  console.info("PASS: production octave/start/paper controls, persistence, warning/override, invalidation and MIDI bounds (fake camera)");
} finally {
  await browser.close();
}
