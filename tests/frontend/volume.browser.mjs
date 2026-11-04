// Production sample PCM through the exact shared output graph, plus native UI keys.
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
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
const storage = await module("lib/storage.ts");
const volume = await module("app/audio/volume.ts", { "../../lib/storage": storage });
const events = await module("events/noteEvents.ts");
const metrics = await module("diagnostics/performanceMetrics.ts", { "../events/noteEvents": events });
const audio = await module("app/audio/audioEngine.ts", {
  "../../diagnostics/performanceMetrics": metrics,
  "./volume": volume,
  "./pianoSamples": data("export async function loadPianoSamples(){return window.volumeBank;}"),
});
const browser = await chromium.launch({ channel: process.env.AUDIO_BROWSER_CHANNEL || "chromium", headless: true });
try {
  const page = await browser.newPage();
  await page.addInitScript(() => {
    const Native = window.AudioWorkletNode;
    window.AudioWorkletNode = class extends Native {
      constructor(...args) { super(...args); window.volumeBank = args[2].processorOptions.samples; window.volumeRate = args[0].sampleRate; }
    };
  });
  const base = process.env.MAKE_SHIFT_URL || "http://127.0.0.1:3000";
  await page.goto(`${base}/audio`);
  await page.getByRole("button", { name: "Enable audio", exact: true }).click();
  await page.getByRole("status").filter({ hasText: "Audio enabled" }).waitFor();
  const result = await page.evaluate(async urls => {
    const { createPianoOutput } = await import(urls.volume);
    const { SampledPiano } = await import("/audio/sampled-piano.js");
    const rate = window.volumeRate, length = Math.round(rate * 1.2);
    async function render(notes, velocity, level, pedal = false, mute = false) {
      const synth = new SampledPiano(rate, window.volumeBank);
      synth.handle({ type: "reset", session: 1 });
      notes.forEach((note, i) => synth.handle({ type: "note-on", session: 1, press: i + 1, note, velocity }));
      if (pedal) {
        synth.handle({ type: "pedals", version: 1, session: 1, sustain: true, sostenuto: false, soft: false });
        notes.forEach((_, i) => synth.handle({ type: "note-off", session: 1, press: i + 1 }));
      }
      const ctx = new OfflineAudioContext(2, length, rate);
      const buffer = ctx.createBuffer(2, length, rate);
      const expression = Float32Array.from({ length }, (_, i) => {
        const gain = (level / 100) ** 2;
        return mute ? gain * Math.max(0, Math.min(1, (0.33 - i / rate) / 0.03)) : gain;
      });
      synth.render(buffer.getChannelData(0), buffer.getChannelData(1), expression);
      const source = ctx.createBufferSource(); source.buffer = buffer;
      const { gain } = createPianoOutput(ctx);
      source.connect(gain); source.start();
      const output = await ctx.startRendering();
      let peak = 0, sum = 0, tail = 0;
      for (let channel = 0; channel < 2; channel++) {
        const pcm = output.getChannelData(channel);
        for (let i = 0; i < length; i++) {
          if (!Number.isFinite(pcm[i])) throw Error("Nonfinite volume output");
          peak = Math.max(peak, Math.abs(pcm[i])); sum += pcm[i] ** 2;
          if (i > rate * 0.4) tail = Math.max(tail, Math.abs(pcm[i]));
        }
      }
      return { peak, rms: Math.sqrt(sum / (length * 2)), tail };
    }
    const rows = [];
    for (const note of [36, 60, 84]) {
      const baseline = await render([note], 0.6, 100);
      const maximum = await render([note], 0.6, 200);
      const soft = await render([note], 0.3, 200);
      const db = 20 * Math.log10(maximum.rms / baseline.rms);
      const quietBaseline = await render([note], 0.3, 100);
      const quietBoost = soft.rms / quietBaseline.rms;
      if (Math.abs(db - 20 * Math.log10(2.08)) > 0.05 || Math.abs(quietBoost - 1.27) > 0.01 || maximum.rms <= soft.rms || maximum.peak >= 1) throw Error(`Register ${note} failed expression/velocity/headroom`);
      rows.push({ note, db, baseline, maximum, soft });
    }
    const chords = [];
    for (const notes of [...Array.from({ length: 128 }, (_, note) => Array(10).fill(note)), [36, 40, 43, 48, 52, 55, 60, 64, 67, 72]]) {
      const chord = await render(notes, 1, 200, true);
      if (chord.peak >= 1 || chord.tail <= 0) throw Error(`Pedal chord ${notes} clipped or disappeared: ${chord.peak}`);
      chords.push(chord);
    }
    const muted = await render([60], 1, 0);
    const ramped = await render([60], 1, 200, true, true);
    if (muted.peak !== 0 || ramped.tail !== 0) throw Error("Volume mute leaked");
    const { BrowserAudio } = await import(urls.audio);
    const owner = new BrowserAudio();
    try {
      await owner.initialize();
      const wait = ms => new Promise(resolve => setTimeout(resolve, ms));
      const analyser = owner.context.createAnalyser(); analyser.fftSize = 2048;
      owner.node.connect(analyser);
      const peak = () => {
        const pcm = new Float32Array(analyser.fftSize); analyser.getFloatTimeDomainData(pcm);
        return Math.max(...pcm.map(Math.abs));
      };
      await wait(50);
      owner.noteOn(60, 0.3);
      owner.setVolume(200); await wait(100);
      if (owner.node.parameters.get("volume").value !== 4 || peak() <= 0) throw Error("Worklet expression parameter did not sound");
      owner.setVolume(0); await wait(100);
      if (peak() !== 0) throw Error("Held worklet note did not mute");
      owner.setVolume(200); await wait(100);
      if (peak() <= 0) throw Error("Held worklet note did not resume");
    } finally { await owner.close(); }
    return { rows, chordCases: chords.length, chordPeak: Math.max(...chords.map(c => c.peak)), muted, ramped, liveWorklet: "held-note expression/mute/unmute passed", rate, browser: navigator.userAgent };
  }, { volume, audio });
  await page.goto(base);
  const slider = page.getByRole("slider", { name: "Piano volume" });
  await slider.focus(); await slider.press("End");
  assert.equal(await slider.inputValue(), "200");
  await slider.press("ArrowLeft"); assert.equal(await slider.inputValue(), "199");
  await page.reload(); assert.equal(await slider.inputValue(), "199");
  await slider.focus(); await slider.press("Home"); assert.equal(await slider.getAttribute("aria-valuetext"), "Muted");
  await page.setViewportSize({ width: 320, height: 780 });
  assert(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), "Volume UI must fit mobile width");
  await slider.scrollIntoViewIfNeeded();
  await page.screenshot({ path: fileURLToPath(new URL("../../frontend/test-results/volume-mobile.png", import.meta.url)) });
  await page.getByRole("button", { name: "Shared songs", exact: true }).click();
  const dialog = page.getByRole("dialog", { name: "Songs", exact: true });
  const playbackSlider = dialog.getByRole("slider", { name: "Piano volume" });
  assert.equal(await playbackSlider.inputValue(), "0");
  await playbackSlider.focus(); await playbackSlider.press("End");
  assert.equal(await playbackSlider.inputValue(), "200");
  await dialog.getByRole("button", { name: "Close", exact: true }).click();
  assert.equal(await slider.inputValue(), "200");
  console.log(JSON.stringify({ result: "PASS", ...result, acousticVerification: "pending" }, null, 2));
} finally { await browser.close(); }
