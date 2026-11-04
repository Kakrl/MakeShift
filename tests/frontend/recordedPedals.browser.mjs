// Actual source playback timeline, BrowserAudio and production sampled worklet (#222).
// Run against a production server; this does not measure acoustic audibility.
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { createRequire } from "node:module";
const require = createRequire(new URL("../../frontend/package.json", import.meta.url));
const { chromium } = require("playwright");
const ts = require("typescript");
const data = source => `data:text/javascript;base64,${Buffer.from(source).toString("base64")}`;
async function module(path, imports = {}) {
  let source = ts.transpileModule(await readFile(new URL(`../../frontend/src/${path}`, import.meta.url), "utf8"), {
    compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 },
  }).outputText;
  for (const [from, to] of Object.entries(imports)) source = source.replaceAll(JSON.stringify(from), JSON.stringify(to));
  return data(source);
}
const events = await module("events/noteEvents.ts");
const metrics = await module("diagnostics/performanceMetrics.ts", { "../events/noteEvents": events });
const audio = await module("app/audio/audioEngine.ts", {
  "../../diagnostics/performanceMetrics": metrics,
  "./pianoSamples": data("export async function loadPianoSamples(){return window.gateBank;}"),
});
const layout = await module("cv/keyboardLayout.ts");
const noteMap = await module("cv/noteMap.ts", { "./keyboardLayout": layout });
const pedals = await module("app/midi/recordedPedals.ts");
const timeline = await module("app/midi/playbackTimeline.ts", {
  "./recordedPedals": pedals, "../audio/audioEngine": audio, "../../cv/noteMap": noteMap,
});
const browser = await chromium.launch({ channel: process.env.AUDIO_BROWSER_CHANNEL || "chromium", headless: true });
try {
  const page = await browser.newPage();
  await page.addInitScript(() => {
    const Native = window.AudioWorkletNode;
    window.AudioWorkletNode = class extends Native {
      constructor(...args) { super(...args); window.gateBank = args[2].processorOptions.samples; }
    };
  });
  await page.goto(`${process.env.MAKE_SHIFT_URL || "http://127.0.0.1:3000"}/audio`);
  await page.getByRole("button", { name: "Enable audio", exact: true }).click();
  await page.getByRole("status").filter({ hasText: "Audio enabled" }).waitFor();
  await page.getByRole("button", { name: "Stop sound" }).click();
  const result = await page.evaluate(async urls => {
    const { BrowserAudio } = await import(urls.audio);
    const { createPlaybackTimeline } = await import(urls.timeline);
    const owner = new BrowserAudio(); await owner.initialize();
    const context = owner.context;
    const analyser = context.createAnalyser(); analyser.fftSize = 2048;
    owner.node.connect(analyser);
    const wait = ms => new Promise(resolve => setTimeout(resolve, ms));
    const rms = () => {
      const pcm = new Float32Array(analyser.fftSize); analyser.getFloatTimeDomainData(pcm);
      return Math.sqrt(pcm.reduce((sum, x) => sum + x * x, 0) / pcm.length);
    };
    const off = { sustain: false, sostenuto: false, soft: false };
    const rows = [];
    try {
      for (const retained of ["sustain", "sostenuto"]) {
        const take = { id: retained, name: retained, bpm: 120, createdAt: "2026-11-02T12:00:00Z",
          notes: [{ pitch: "C4", velocity: 90, startMs: 0, durationMs: 100 }],
          pedals: { version: 1, noteOrder: [{ on: 0, off: 2 }], events: [
            { timeMs: 50, order: 1, state: { ...off, [retained]: true } },
            { timeMs: 1000, order: 3, state: off },
          ] },
        };
        const player = createPlaybackTimeline(take, owner);
        try {
          if (!await player.play()) throw Error("Playback failed");
          await wait(300); const tail = rms(); if (tail < 0.00005) throw Error("Missing retained sound");
          player.pause(); await wait(100); const paused = rms(); if (paused !== 0) throw Error("Pause leaked a retained voice");
          if (!await player.play()) throw Error("Resume failed");
          await wait(100); const resumed = rms(); if (resumed !== 0) throw Error("Resume resurrected a released tail");
          player.seek(0); await wait(300); const restart = rms(); if (restart < 0.00005) throw Error("Seek/restart failed");
          player.stop(); await wait(100); if (rms() !== 0) throw Error("Stop leaked sound");
          await wait(1000); if (rms() !== 0 || player.getSnapshot().state !== "stopped") throw Error("Stale callback restarted sound");
          if (owner.context !== context) throw Error("Playback recreated the context");
          rows.push({ retained, tail, paused, resumed, restart, stopped: rms() });
        } finally { player.dispose(); }
      }
      return { rows, sampleRate: context.sampleRate, browser: navigator.userAgent, acousticVerification: "pending" };
    } finally { await owner.close(); }
  }, { audio, timeline });
  assert.equal(result.rows.length, 2);
  console.log(JSON.stringify({ result: "PASS", ...result }, null, 2));
} finally { await browser.close(); }
