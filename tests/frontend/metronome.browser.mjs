/* Browser audio graph check for the exact TypeScript metronome controller.
 * Page integration is covered separately with simulated CV in Vitest.
 * This is graph evidence, not a human listening/physical-camera pass.
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
const require = createRequire(
  new URL("../../frontend/package.json", import.meta.url),
);
const { chromium } = require("playwright");
const ts = require("typescript");
// Only resource accounting is replaced; clock, lifecycle and click audio are real.
const source = readFileSync(
  new URL("../../frontend/src/app/audio/metronome.ts", import.meta.url),
  "utf8",
).replace(
  /import\s*\{[^}]*\}\s*from\s*"\.\.\/\.\.\/diagnostics\/performanceMetrics";/,
  "const trackAudioContext = context => context; const closeTrackedAudioContext = context => context.close();",
);
const code = ts.transpileModule(source, {
  compilerOptions: {
    target: ts.ScriptTarget.ES2022,
    module: ts.ModuleKind.ES2022,
  },
}).outputText;
const browser = await chromium.launch({
  channel: process.env.AUDIO_BROWSER_CHANNEL || "chromium",
});
try {
  const page = await browser.newPage();
  await page.goto(
    `${(process.env.MAKE_SHIFT_URL || "http://127.0.0.1:3000").replace(/\/+$/, "")}/audio`,
  );
  await page.evaluate(async (code) => {
    const NativeContext = window.AudioContext;
    window.AudioContext = class extends NativeContext {
      constructor() {
        super();
        window.clickContext = this;
        const analyser = this.createAnalyser();
        analyser.fftSize = 2048;
        analyser.connect(this.destination);
        window.clickAnalyser = analyser;
      }
    };
    const { createMetronome } = await import(
      `data:text/javascript;base64,${btoa(code)}`
    );
    window.audioBeats = [];
    window.testMetronome = createMetronome(undefined, (context) => {
      const node = new AudioWorkletNode(context, "makeshift-metronome", {
        numberOfInputs: 0,
        numberOfOutputs: 1,
        outputChannelCount: [1],
      });
      const connect = node.connect.bind(node);
      node.connect = () => connect(window.clickAnalyser);
      node.port.addEventListener("message", (event) =>
        window.audioBeats.push(event.data),
      );
      return node;
    });
    window.countBeats = [];
    window.countCompletions = 0;
    window.configureClicks = (audible) =>
      window.testMetronome.configure(
        { tempo: 120, beatsPerMeasure: 4, audible },
        {
          onCountInBeat: (beat) => window.countBeats.push(beat),
          onCountInComplete: () => window.countCompletions++,
          onUnavailable: () => {
            throw new Error("Click audio became unavailable");
          },
        },
      );
    window.configureClicks(true);
    const button = document.createElement("button");
    button.textContent = "Start test metronome";
    button.onclick = async () => {
      window.clickReady = await window.testMetronome.prepare();
      window.testMetronome.setPlaying(true);
    };
    document.body.append(button);
    window.sampleClicks = async (milliseconds) => {
      const samples = new Float32Array(window.clickAnalyser.fftSize);
      let maxRms = 0;
      const end = performance.now() + milliseconds;
      while (performance.now() < end) {
        window.clickAnalyser.getFloatTimeDomainData(samples);
        maxRms = Math.max(
          maxRms,
          Math.sqrt(
            samples.reduce((sum, value) => sum + value * value, 0) /
              samples.length,
          ),
        );
        await new Promise((resolve) => setTimeout(resolve, 10));
      }
      return maxRms;
    };
  }, code);
  await page.getByRole("button", { name: "Start test metronome" }).click();
  await page.waitForFunction(() => window.clickReady);
  const liveRms = await page.evaluate(() => window.sampleClicks(650));
  assert(liveRms > 0.001);
  // Block the UI thread for over three beats: the worklet must keep rendering.
  await page.evaluate(() => {
    window.audioBeats = [];
    const end = performance.now() + 1800;
    while (performance.now() < end) {
      /* Deliberate browser main-thread stall. */
    }
  });
  await page.waitForFunction(() => window.audioBeats.length >= 3);
  const busyBeats = await page.evaluate(() =>
    window.audioBeats.map(({ frame, rate }) => ({ frame, rate })),
  );
  for (let i = 1; i < busyBeats.length; i++)
    assert(
      Math.abs(
        busyBeats[i].frame - busyBeats[i - 1].frame - busyBeats[i].rate / 2,
      ) <= 1,
    );
  await page.evaluate(() => window.testMetronome.setPlaying(true, true));
  await page.waitForTimeout(150);
  assert((await page.evaluate(() => window.sampleClicks(600))) < 0.00001);
  await page.evaluate(() => window.testMetronome.beginCountIn());
  await page.waitForFunction(() => window.countCompletions === 1);
  assert.deepEqual(await page.evaluate(() => window.countBeats), [1, 2, 3, 4]);
  assert((await page.evaluate(() => window.sampleClicks(650))) > 0.001);
  await page.evaluate(() => window.testMetronome.setAudible(false));
  await page.waitForTimeout(150);
  assert((await page.evaluate(() => window.sampleClicks(600))) < 0.00001);
  await page.evaluate(() => {
    window.countBeats = [];
    window.testMetronome.beginCountIn();
  });
  await page.waitForFunction(() => window.countCompletions === 2);
  assert.deepEqual(await page.evaluate(() => window.countBeats), [1, 2, 3, 4]);
  assert((await page.evaluate(() => window.sampleClicks(150))) < 0.00001);
  await page.evaluate(() => window.testMetronome.close());
  await page.waitForFunction(() => window.clickContext.state === "closed");
  // Exercise cleanup/setup reuse with an actual second browser AudioContext.
  await page.getByRole("button", { name: "Start test metronome" }).click();
  await page.waitForFunction(() => window.clickContext.state === "running");
  await page.evaluate(() => window.configureClicks(true));
  assert((await page.evaluate(() => window.sampleClicks(650))) > 0.001);
  await page.evaluate(() => window.testMetronome.close());
  console.log(
    JSON.stringify({
      browser: browser.version(),
      liveRms,
      busyThreadBeats: busyBeats.length,
      busyThreadSpacing: "within one audio sample of 500ms",
      pause: "silent",
      resume: "count-in and ongoing clicks",
      mutedCountIn: "passed",
      toggleOff: "silent",
      cleanupReuse: "passed",
      audibleHardware: "not measured",
    }),
  );
} finally {
  await browser.close();
}
