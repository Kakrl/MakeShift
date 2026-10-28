// Real BrowserAudio/worklet output and independent metronome graph (#205).
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
const notes = await module("events/noteSession.ts", { "../diagnostics/performanceMetrics": metrics, "./noteEvents": events });
const sink = await module("events/audioSession.ts", { "./noteSession": notes });
const meter = await module("lib/meter.ts");
const clicks = await module("app/audio/countIn.ts", { "../../lib/meter": meter });
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
    const { NoteSession } = await import(urls.notes);
    const { createAudioSink } = await import(urls.sink);
    const { scheduleCountInClicks } = await import(urls.clicks);
    const owner = new BrowserAudio(); await owner.initialize();
    const context = owner.context; // Instrument the actual owner's private graph.
    const analyser = context.createAnalyser(); analyser.fftSize = 2048;
    owner.node.connect(analyser);
    const wait = ms => new Promise(resolve => setTimeout(resolve, ms));
    const rms = () => {
      const pcm = new Float32Array(analyser.fftSize); analyser.getFloatTimeDomainData(pcm);
      return Math.sqrt(pcm.reduce((sum, x) => sum + x * x, 0) / pcm.length);
    };
    await wait(50); // Initial reset acknowledgement, not a production note delay.
    let invalidations = 0; owner.subscribeInvalidation(() => invalidations++);
    const sink = createAudioSink(owner), session = new NoteSession(sink);
    const id = session.start(); let sequence = 0;
    const event = (type, pressId) => session.receive({ version: 1, sessionId: id,
      sequence: ++sequence, timestampMs: performance.now(), type, pressId, pitch: 60, velocity: 0.9 });
    const delivered = []; session.subscribe(d => delivered.push(d.event.type));
    const rows = [];
    try {
      for (const retained of ["sustain", "sostenuto"]) {
        event("note-on", sequence + 1);
        const pressId = sequence;
        owner.setPedals({ sustain: retained === "sustain", sostenuto: retained === "sostenuto", soft: false });
        event("note-off", pressId); await wait(120);
        const before = rms(); if (before < 0.00005) throw Error("Retained piano must sound before entry");
        session.pauseInput(); sink.pauseInput();
        const gatedPress = sequence + 1;
        if (event("note-on", gatedPress) !== "suppressed") throw Error("Onset was not gated");
        await wait(120); const silent = rms(); if (silent !== 0) throw Error("Gated piano is not silent");
        if (owner.setPedals({ sustain: true, sostenuto: true, soft: true })) throw Error("Pedals activated while gated");
        // Separate real OfflineAudioContext verifies clicks remain nonzero at every
        // denominator boundary while the live worklet stays silent.
        const clickContext = new OfflineAudioContext(1, 48000, 48000);
        scheduleCountInClicks(clickContext, 240, { numerator: 4, denominator: 4 });
        const pcm = (await clickContext.startRendering()).getChannelData(0);
        for (let beat = 0; beat < 4; beat++) {
          if (!pcm.subarray(beat * 12000, beat * 12000 + 2400).some(x => Math.abs(x) > 0.01)) throw Error("Missing metronome click");
        }
        if (rms() !== 0) throw Error("Piano leaked during clicks");
        session.resumeInput(); owner.resumeInput();
        if (event("note-off", gatedPress) !== "suppressed") throw Error("Suppressed release was replayed");
        event("note-on", sequence + 1); await wait(120);
        const after = rms(); if (after < 0.00005) throw Error("Fresh press must sound after opening");
        rows.push({ retained, before, gated: silent, after, clicks: 4 });
      }
      session.flushObservers();
      if (delivered.filter(type => type === "note-on").length !== 4) throw Error("Suppressed onset reached consumers");
      if (invalidations || owner.context !== context) throw Error("Gate invalidated/recreated audio");
      return { rows, invalidations, browser: navigator.userAgent, acousticVerification: "pending" };
    } finally { session.stop(); await owner.close(); }
  }, { audio, notes, sink, clicks });
  assert.equal(result.rows.length, 2);
  console.log(JSON.stringify({ result: "PASS", ...result }, null, 2));
} finally { await browser.close(); }
