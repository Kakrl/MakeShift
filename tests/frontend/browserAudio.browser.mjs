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
          window.testPianoSamples = args[2].processorOptions.samples;
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
    const initializationStart = Date.now();
    await page
      .getByRole("button", { name: "Enable audio", exact: true })
      .click();
    assert.equal(moduleResponse.status(), 200);
    await page
      .getByRole("status")
      .filter({ hasText: "Audio enabled" })
      .waitFor();
    const initializationMs = Date.now() - initializationStart;
    const actualSamples = await page.evaluate(async () => {
      const { SampledPiano } = await import("/audio/sampled-piano.js");
      const bank = window.testPianoSamples;
      if (bank.length !== 19)
        throw new Error("All 19 recordings must be ready");
      const rate = window.testContext.sampleRate;
      const synth = new SampledPiano(rate, bank);
      const left = new Float32Array(Math.round(rate * 0.5));
      const right = new Float32Array(left.length);
      let peak = 0;
      for (let note = 0; note < 128; note++) {
        synth.handle({ type: "reset", session: note + 1 });
        for (let press = 1; press <= 10; press++)
          synth.handle({
            type: "note-on",
            session: note + 1,
            press,
            note,
            velocity: 1,
          });
        synth.render(left, right);
        for (let i = 0; i < left.length; i++) {
          if (!Number.isFinite(left[i]) || !Number.isFinite(right[i]))
            throw new Error("Nonfinite real-sample output");
          peak = Math.max(peak, Math.abs(left[i]), Math.abs(right[i]));
        }
      }
      return {
        count: bank.length,
        decodedBytes: bank.reduce(
          (sum, s) => sum + s.left.byteLength + s.right.byteLength,
          0,
        ),
        rate,
        tenVoicePeak: peak,
      };
    });
    assert(
      actualSamples.tenVoicePeak <= 0.850001,
      "real recordings must retain coherent chord headroom",
    );
    // All assets are loaded; even an offline page must still play live notes.
    await page.context().setOffline(true);
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
    assert(
      soft > 0.00005,
      "soft recorded note must reach the browser audio graph",
    );
    await page.getByRole("button", { name: "Stop sound" }).click();
    await page.waitForTimeout(150);
    assert.equal(await readRms(), 0);
    await page.getByRole("button", { name: "Loud A4" }).click();
    await page.waitForTimeout(150);
    const loud = await readRms();
    assert(
      loud / soft > 2 && loud / soft < 6,
      "velocity increases recorded-note amplitude",
    );
    await page.getByRole("button", { name: "Stop sound" }).click();
    await page.waitForTimeout(100);
    await page.getByRole("button", { name: "Ten-note chord" }).click();
    await page.waitForTimeout(150);
    assert((await readRms()) > 0.0005);
    for (const name of ["Bass C2", "Middle C4", "High C6"]) {
      await page.getByRole("button", { name, exact: true }).click();
      await page.waitForTimeout(150);
      assert((await readRms()) > 0.00005, `${name} must sound offline`);
    }
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
    assert((await readRms()) > 0.00005);
    await page.context().setOffline(false);
    await page.getByRole("link", { name: "MakeShift", exact: true }).click();
    await page.waitForURL(base + "/");
    // Client navigation can finish before React runs the audio unmount cleanup.
    await page.waitForFunction(
      () => window.testContext.state === "closed",
      null,
      {
        timeout: 5000,
      },
    );
    assert.equal(await page.evaluate(() => window.testContext.state), "closed");
    assert.deepEqual(errors, []);
    console.log(
      JSON.stringify(
        {
          browser: browser.version(),
          softRms: soft,
          loudRms: loud,
          productionModule: "200",
          initializationMs,
          actualSamples,
          offlineRegisters: "bass/mid/treble passed",
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
