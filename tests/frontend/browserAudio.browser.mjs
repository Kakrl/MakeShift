/* Run against npm run build && npm start:
 * NODE_PATH may point at an existing Playwright installation.
 * MAKE_SHIFT_URL defaults to http://127.0.0.1:3000.
 * This measures browser graph output, not physical speaker audibility.
 */
import assert from "node:assert/strict";
import { createRequire } from "node:module";
const requireFromFrontend = createRequire(
  new URL("../../frontend/package.json", import.meta.url),
);
const { chromium } = requireFromFrontend("playwright");

(async () => {
  const browser = await chromium.launch({
    channel: process.env.AUDIO_BROWSER_CHANNEL || "msedge",
    headless: true,
  });
  try {
    const page = await browser.newPage();
    const errors = [];
    page.on("pageerror", (error) => errors.push(error.message));
    await page.addInitScript(() => {
      const NativeContext = window.AudioContext;
      const NativeNode = window.AudioWorkletNode;
      window.AudioContext = class extends NativeContext {
        constructor(options) {
          super(options);
          window.testContext = this;
        }
      };
      window.AudioWorkletNode = class extends NativeNode {
        constructor(...args) {
          super(...args);
          window.testNode = this;
          window.testAnalyser = args[0].createAnalyser();
          window.testAnalyser.fftSize = 2048;
          this.connect(window.testAnalyser);
        }
      };
    });
    const base = process.env.MAKE_SHIFT_URL || "http://127.0.0.1:3000";
    await page.goto(base + "/audio");
    const moduleResponse = await page.request.get(
      base + "/audio/piano-worklet.js",
    );
    await page
      .getByRole("button", { name: "Enable audio", exact: true })
      .click();
    assert.equal(moduleResponse.status(), 200);
    await page
      .getByRole("status")
      .filter({ hasText: "Audio enabled" })
      .waitFor();
    const readRms = () =>
      page.evaluate(() => {
        const data = new Float32Array(window.testAnalyser.fftSize);
        window.testAnalyser.getFloatTimeDomainData(data);
        return Math.sqrt(
          data.reduce((sum, value) => sum + value * value, 0) / data.length,
        );
      });
    await page.getByRole("button", { name: "Soft A4" }).click();
    await page.waitForTimeout(150);
    const soft = await readRms();
    assert(soft > 0.005, "soft tone must reach the browser audio graph");
    await page.getByRole("button", { name: "Stop sound" }).click();
    await page.waitForTimeout(150);
    assert.equal(await readRms(), 0);
    await page.getByRole("button", { name: "Loud A4" }).click();
    await page.waitForTimeout(150);
    const loud = await readRms();
    assert(Math.abs(loud / soft - 3) < 0.1);
    await page.getByRole("button", { name: "Stop sound" }).click();
    await page.waitForTimeout(100);
    await page.getByRole("button", { name: "Ten-note chord" }).click();
    await page.waitForTimeout(150);
    assert((await readRms()) > 0.03);
    await page.evaluate(() => window.testContext.suspend());
    await page.getByRole("button", { name: "Soft A4" }).click();
    await page.getByRole("status").filter({ hasText: "unavailable" }).waitFor();
    await page
      .getByRole("button", { name: "Enable audio", exact: true })
      .click();
    await page
      .getByRole("status")
      .filter({ hasText: "Audio enabled" })
      .waitFor();
    await page.waitForTimeout(150);
    assert.equal(await readRms(), 0, "resume must not replay a held chord");
    await page.getByRole("button", { name: "Soft A4" }).click();
    await page.waitForTimeout(150);
    assert((await readRms()) > 0.005);
    await page.getByRole("link", { name: "MakeShift", exact: true }).click();
    await page.waitForURL(base + "/");
    assert.equal(await page.evaluate(() => window.testContext.state), "closed");
    assert.deepEqual(errors, []);
    console.log(
      JSON.stringify(
        {
          browser: browser.version(),
          softRms: soft,
          loudRms: loud,
          productionModule: "200",
          suspensionRecovery: "passed",
          navigationCleanup: "passed",
          audibleHardware: "not measured",
        },
        null,
        2,
      ),
    );
  } finally {
    await browser.close();
  }
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
