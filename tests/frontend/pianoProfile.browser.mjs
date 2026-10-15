// Paired browser-main-thread DSP microbenchmark; NOT an AudioWorklet deadline test.
import { createRequire } from "node:module";
import os from "node:os";
const require = createRequire(
  new URL("../../frontend/package.json", import.meta.url),
);
const { chromium } = require("playwright");
const browser = await chromium.launch({
  channel: process.env.AUDIO_BROWSER_CHANNEL || "chromium",
  headless: true,
});
try {
  const page = await browser.newPage();
  await page.goto(process.env.MAKE_SHIFT_URL || "http://127.0.0.1:3000");
  const results = await page.evaluate(async () => {
    const { Synth } = await import("/audio/synth.js");
    let resolution = Infinity;
    for (let i = 0; i < 10000; i++) {
      const a = performance.now(),
        b = performance.now();
      if (b > a) resolution = Math.min(resolution, b - a);
    }
    const rows = [];
    for (const rate of [44100, 48000, 96000])
      for (const workload of ["single", "chord", "stealing"]) {
        const pair = [new Synth(rate, { mode: "legacy" }), new Synth(rate)];
        const times = [[], []];
        const output = new Float32Array(128);
        const presses = [0, 0];
        for (const s of pair) s.handle({ type: "reset", session: 1 });
        for (let block = 0; block < 5000; block++) {
          // Alternate order to reduce systematic JIT/temperature/order bias.
          for (let k = 0; k < 2; k++) {
            const j = (block + k) % 2,
              s = pair[j];
            if (block % (workload === "stealing" ? 4 : 100) === 0) {
              if (workload !== "stealing")
                s.handle({ type: "release-all", session: 1 });
              for (let n = 0; n < (workload === "single" ? 1 : 10); n++)
                s.handle({
                  type: "note-on",
                  session: 1,
                  press: ++presses[j],
                  note: 48 + n,
                  velocity: 1,
                });
            }
            const start = performance.now();
            s.render(output);
            const duration = performance.now() - start;
            if (block >= 1000) times[j].push(duration);
            if (!output.every((x) => Number.isFinite(x) && Math.abs(x) <= 1))
              throw new Error("Unbounded output");
          }
        }
        for (let j = 0; j < 2; j++) {
          const t = times[j].sort((a, b) => a - b);
          const quantumMs = (128 / rate) * 1000;
          rows.push({
            mode: j ? "piano" : "legacy",
            rate,
            workload,
            configuredBlock: 128,
            samples: t.length,
            simulatedSeconds: (t.length * 128) / rate,
            p50Ms: t[Math.ceil(t.length * 0.5) - 1],
            p99Ms: t[Math.ceil(t.length * 0.99) - 1],
            maxMs: t[t.length - 1],
            overHalfBlock: t.filter((x) => x >= quantumMs / 2).length,
            overBlock: t.filter((x) => x >= quantumMs).length,
          });
        }
      }
    return {
      timerResolutionMs: Number.isFinite(resolution) ? resolution : null,
      rows,
    };
  });
  console.log(
    JSON.stringify(
      {
        date: new Date().toISOString(),
        browser: browser.version(),
        hardware: os.cpus()[0].model,
        os: `${os.platform()} ${os.release()}`,
        boundary:
          "browser main thread, synchronous DSP only; event handling and timer reads excluded",
        warmupBlocks: 1000,
        instrumentation:
          "two performance.now reads per call; quantization can dominate",
        liveCV: "not exercised",
        deadlinesAndDropouts: "not measured",
        physicalLatency: "not measured",
        ...results,
      },
      null,
      2,
    ),
  );
} finally {
  await browser.close();
}
