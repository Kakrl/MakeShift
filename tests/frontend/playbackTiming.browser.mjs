import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { createServer } from "node:http";
import { createRequire } from "node:module";
import { arch, cpus, release, tmpdir } from "node:os";
import { join } from "node:path";

const require = createRequire(new URL("../../frontend/package.json", import.meta.url));
const { chromium } = require("playwright");
const ts = require("typescript");
const frontend = new URL("../../frontend/", import.meta.url);
const channel = process.env.AUDIO_BROWSER_CHANNEL || "chromium";
const visibilityOnly = process.env.PLAYBACK_VISIBILITY_ONLY === "1";

const modules = new Map();
for (const path of [
  "app/midi/playbackTimeline",
  "app/audio/audioEngine",
  "app/audio/pianoSamples",
  "cv/noteMap",
  "cv/keyboardLayout",
  "diagnostics/performanceMetrics",
  "events/noteEvents",
]) {
  const source = await readFile(new URL(`src/${path}.ts`, frontend), "utf8");
  modules.set(`/src/${path}`, ts.transpileModule(source, {
    compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 },
  }).outputText.replace('"../../../public/audio/sampled-piano.js"', '"/audio/sampled-piano.js"'));
}
modules.set("/probe.js", await readFile(new URL("./playbackTimingProbe.mjs", import.meta.url)));
modules.set("/audio/piano-worklet.js", 'import { registerProcessor } from "/probe.js";\n' +
  await readFile(new URL("public/audio/piano-worklet.js", frontend), "utf8"));

const server = createServer(async (request, response) => {
  const { pathname } = new URL(request.url, "http://localhost");
  try {
    if (pathname === "/" || pathname === "/other") {
      response.writeHead(200, { "Content-Type": "text/html" });
      response.end('<!doctype html><title>Playback verification</title><button>Play</button><a href="/other" target="_blank">Open tab</a>');
      return;
    }
    if (modules.has(pathname)) {
      response.writeHead(200, { "Content-Type": "text/javascript" });
      response.end(modules.get(pathname));
      return;
    }
    if (/^\/audio\/(?:[\w-]+\.js|piano-samples\/[\w#%.-]+\.mp3)$/.test(pathname)) {
      const asset = await readFile(new URL(`public${pathname}`, frontend));
      response.writeHead(200, { "Content-Type": pathname.endsWith(".mp3") ? "audio/mpeg" : "text/javascript" });
      response.end(asset);
      return;
    }
    response.writeHead(404).end();
  } catch {
    response.writeHead(500).end();
  }
});

function distribution(samples) {
  const sorted = samples.toSorted((a, b) => a - b);
  const at = (fraction) => Number(sorted[Math.ceil(fraction * sorted.length) - 1].toFixed(2));
  return { count: sorted.length, p50: at(0.5), p95: at(0.95), max: at(1) };
}

function closeTo(actual, expected, tolerance) {
  assert.ok(Math.abs(actual - expected) <= tolerance, `Expected ${actual} within ${tolerance} ms of ${expected}`);
}

await new Promise((resolve, reject) => {
  server.once("error", reject);
  server.listen(0, "127.0.0.1", resolve);
});

let browser;
let nativeBrowser;
let profile;
try {
  if (visibilityOnly) {
    // Attach to a regular browser without Playwright's focus emulation.
    profile = await mkdtemp(join(tmpdir(), "makeshift-playback-"));
    nativeBrowser = spawn(chromium.executablePath(), [
      `--user-data-dir=${profile}`, "--remote-debugging-port=0",
      "--no-first-run", "--no-default-browser-check", "about:blank",
    ], { stdio: ["ignore", "ignore", "pipe"] });
    const endpoint = await new Promise((resolve, reject) => {
      const timeout = setTimeout(() => reject(new Error("Chromium CDP startup timed out")), 10000);
      nativeBrowser.once("error", (error) => { clearTimeout(timeout); reject(error); });
      nativeBrowser.once("exit", (code) => {
        clearTimeout(timeout);
        reject(new Error(`Chromium exited before CDP startup (${code})`));
      });
      nativeBrowser.stderr.setEncoding("utf8");
      let output = "";
      nativeBrowser.stderr.on("data", (chunk) => {
        output = (output + chunk).slice(-4096);
        const match = output.match(/DevTools listening on (ws:\/\/[^\s]+)\s/);
        if (match) { clearTimeout(timeout); resolve(match[1]); }
      });
    });
    browser = await chromium.connectOverCDP(endpoint, { noDefaults: true });
  } else {
    browser = await chromium.launch({ channel, headless: true });
  }
  const context = visibilityOnly ? browser.contexts()[0] : await browser.newContext();
  const page = visibilityOnly ? context.pages()[0] : await context.newPage();
  if (visibilityOnly) await page.bringToFront();
  page.setDefaultTimeout(10000);
  await page.goto(`http://127.0.0.1:${server.address().port}`);
  await page.evaluate(async () => {
    const { browserAudio } = await import("/src/app/audio/audioEngine");
    const { createPlaybackTimeline } = await import("/src/app/midi/playbackTimeline");
    const note = (pitch, startMs, endMs) => ({ pitch, startMs, durationMs: endMs - startMs, velocity: 80 });
    const timingNotes = [
      note("C4", 30, 175), note("D4", 120, 145),
      note("E4", 160, 330), note("G4", 160, 330), note("B4", 160, 330),
      note("A4", 400, 445), note("B4", 410, 455), note("C5", 420, 465),
    ];
    const interruptionNotes = [
      note("C4", 0, 10000), note("D4", 1200, 1300), note("E4", 1500, 10000),
    ];
    const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
    const stallUntil = (deadline) => {
      while (performance.now() < deadline) { /* intentional main-thread load */ }
    };

    const harness = window.playbackTest = {
      async runTiming(loaded) {
        const timeline = createPlaybackTimeline({ bpm: 120, notes: timingNotes });
        const first = harness.blocks.length;
        try {
          if (!await timeline.play()) throw new Error("Could not start timing run");
          const origin = performance.now() - timeline.getSnapshot().positionMs;
          const context = browserAudio.context;
          // Pair the main clock with the graph clock. This estimate includes
          // render-quantum phase and clock sampling error, and excludes the DAC.
          const before = performance.now();
          const graphTime = context.currentTime;
          const graphOrigin = (before + performance.now()) / 2 - graphTime * 1000;
          let stall = null;
          if (loaded) {
            await wait(90);
            const start = performance.now() - origin;
            stallUntil(origin + 245);
            stall = { start, end: performance.now() - origin };
          }
          await wait(Math.max(0, origin + 700 - performance.now()));
          return {
            stall,
            state: timeline.getSnapshot().state,
            blocks: harness.blocks.slice(first).map((block) => ({
              ...block, elapsed: graphOrigin + block.frame / context.sampleRate * 1000 - origin,
            })),
          };
        } finally {
          timeline.dispose();
        }
      },
      async controls() {
        const timeline = createPlaybackTimeline({ bpm: 120, notes: [
          note("C4", 0, 1000), note("D4", 320, 410), note("E4", 520, 620),
          note("F4", 1500, 1600),
        ] });
        const first = harness.blocks.length;
        try {
          if (!await timeline.play()) throw new Error("Could not start controls run");
          await wait(55);
          stallUntil(performance.now() + 35);
          timeline.setPlaybackRate(2);
          await wait(190); // D4 completes; E4 is still ahead.
          timeline.seek(550); // Rearticulate C4 and start E4 inside its boundary.
          await wait(15);
          timeline.pause();
          const paused = timeline.getSnapshot();
          await wait(250);
          const stillPaused = timeline.getSnapshot();
          if (!await timeline.play()) throw new Error("Could not resume controls run");
          await wait(10);
          timeline.stop();
          await wait(600); // Outlast any stale callback for F4.
          return { paused, stillPaused, stopped: timeline.getSnapshot(), blocks: harness.blocks.slice(first) };
        } finally {
          timeline.dispose();
        }
      },
      async interruptible() {
        harness.timeline?.dispose();
        harness.timeline = createPlaybackTimeline({ bpm: 120, notes: interruptionNotes });
        if (!await harness.timeline.play()) throw new Error("Could not start interruption run");
      },
      blocks: [],
    };
    document.querySelector("button").onclick = async () => {
      try {
        await browserAudio.initialize();
        harness.context = browserAudio.context;
        const port = browserAudio.node.port;
        const receive = port.onmessage;
        port.onmessage = (event) => {
          const { data } = event;
          if (typeof data === "object") harness.blocks.push(data);
          else receive.call(port, event);
        };
        harness.ready = true;
      } catch (error) {
        harness.error = error.message;
      }
    };
  });
  if (visibilityOnly) {
    await page.waitForFunction(() => !document.hidden, undefined, { polling: 50, timeout: 5000 });
  }
  await page.getByRole("button", { name: "Play" }).click({ force: visibilityOnly });
  await page.waitForFunction(() => window.playbackTest.ready || window.playbackTest.error);
  assert.equal(await page.evaluate(() => window.playbackTest.error), undefined);

  function events(blocks) {
    const pitches = new Map();
    return blocks.flatMap(({ commands, elapsed }) => commands.flatMap((command) => {
      const key = `${command.session}/${command.press}`;
      if (command.type === "note-on") {
        pitches.set(key, command.note);
        return [{ type: "on", pitch: command.note, elapsed, key }];
      }
      if (command.type === "note-off") return [{ type: "off", pitch: pitches.get(key), elapsed, key }];
      return [];
    }));
  }

  const mark = () => page.evaluate(() => window.playbackTest.blocks.length);
  const snapshot = () => page.evaluate(() => window.playbackTest.timeline.getSnapshot());
  const start = async () => {
    const first = await mark();
    await page.evaluate(() => window.playbackTest.interruptible());
    await page.waitForFunction((i) => window.playbackTest.blocks.slice(i).some(({ peak }) => peak > 0), first);
    return first;
  };
  const checkQuiet = async (first) => {
    await page.waitForFunction((i) => window.playbackTest.blocks.length > i &&
      window.playbackTest.blocks.at(-1).active === 0 && window.playbackTest.blocks.at(-1).peak === 0, first);
    const blocks = await page.evaluate((i) => window.playbackTest.blocks.slice(i), first);
    assert.deepEqual(events(blocks).filter(({ type }) => type === "on").map(({ pitch }) => pitch), [60]);
    assert.equal(blocks.at(-1).peak, 0);
  };

  if (visibilityOnly) {
    const hiddenStart = await start();
    const [other] = await Promise.all([
      context.waitForEvent("page"),
      page.getByRole("link", { name: "Open tab" }).click({ force: true }),
    ]);
    await other.bringToFront();
    await page.waitForFunction(() => document.hidden, undefined, { polling: 50, timeout: 5000 });
    const hidden = await snapshot();
    assert.equal(hidden.state, "paused", "An actual tab switch must pause playback");
    assert.equal(hidden.error, null);
    assert.equal(await page.evaluate(() => window.playbackTest.timeline.play()), false);
    await page.waitForTimeout(1650);
    await page.bringToFront();
    await page.waitForFunction(() => !document.hidden);
    assert.deepEqual(await snapshot(), hidden);
    await checkQuiet(hiddenStart);
    await page.evaluate(async () => {
      const { timeline, context } = window.playbackTest;
      timeline.dispose();
      await context.close();
    });
    console.log(`Chromium ${browser.version()} tab hide/show passed (actual tab switch)`);
  } else {
    const report = {};
    for (const loaded of [false, true]) {
      const starts = [], ends = [], following = [], stalls = [];
      for (let i = 0; i < 8; i++) {
        const run = await page.evaluate((load) => window.playbackTest.runTiming(load), loaded);
        assert.equal(run.state, "ended");
        assert.ok(run.blocks.some((block) => block.peak > 0));
        assert.equal(run.blocks.at(-1).active, 0);
        assert.equal(run.blocks.at(-1).peak, 0);
        const delivered = events(run.blocks);
        const expected = [
          [60, 30, 175], [62, 120, 145], [64, 160, 330], [67, 160, 330],
          [71, 160, 330], [69, 400, 445], [71, 410, 455], [72, 420, 465],
        ].filter(([pitch]) => !loaded || pitch !== 62);
        const on = delivered.filter(({ type }) => type === "on");
        const releases = delivered.filter(({ type }) => type === "off");
        assert.equal(releases.length, on.length);
        const off = on.map(({ key }) => releases.find((release) => release.key === key));
        assert.deepEqual(on.map(({ pitch }) => pitch), expected.map(([pitch]) => pitch), JSON.stringify({ loaded, i, delivered, stall: run.stall }));
        assert.deepEqual(off.map(({ pitch }) => pitch), expected.map(([pitch]) => pitch), JSON.stringify({ loaded, i, delivered, stall: run.stall }));
        expected.forEach(([, start, end], index) => {
          starts.push(on[index].elapsed - start);
          ends.push(off[index].elapsed - end);
          if (start >= 400) following.push(on[index].elapsed - start);
          if (loaded && start === 160) {
            assert.ok(run.stall.start < 120 && run.stall.end >= 245 && run.stall.end < 300);
            assert.ok(on[index].elapsed > 200, "Chord should start after the main-thread stall");
            assert.ok(off[index].elapsed - on[index].elapsed < end - start - 30, "Late chord must be shortened");
            closeTo(off[index].elapsed, end, 50);
          }
          if (start >= 400) closeTo(on[index].elapsed, start, 50);
        });
        if (loaded) stalls.push(run.stall.end - run.stall.start);
      }
      report[loaded ? "stalled" : "baseline"] = {
        onsetMs: distribution(starts), releaseMs: distribution(ends),
        followingOnsetMs: distribution(following),
        ...(loaded ? { stallDurationMs: distribution(stalls) } : {}),
      };
    }

    const controls = await page.evaluate(() => window.playbackTest.controls());
    assert.equal(controls.paused.state, "paused");
    assert.deepEqual(controls.paused, controls.stillPaused);
    assert.equal(controls.stopped.state, "stopped");
    assert.equal(controls.stopped.positionMs, 0);
    assert.equal(controls.stopped.error, null);
    const controlEvents = events(controls.blocks);
    const controlStarts = controlEvents.filter(({ type }) => type === "on");
    const controlReleases = controlEvents.filter(({ type }) => type === "off");
    assert.deepEqual(controlStarts.map(({ pitch }) => pitch), [60, 62, 60, 64, 60, 64]);
    assert.deepEqual(controlReleases.map(({ key }) => key).sort(), controlStarts.map(({ key }) => key).sort());
    assert.equal(controls.blocks.at(-1).active, 0);
    assert.equal(controls.blocks.at(-1).peak, 0);

    const suspendedStart = await start();
    await page.evaluate(() => window.playbackTest.context.suspend());
    await page.waitForFunction(() => window.playbackTest.timeline.getSnapshot().state === "paused");
    const suspended = await snapshot();
    assert.match(suspended.error, /interrupted/);
    await page.waitForTimeout(1650); // Cross the pending note boundaries while suspended.
    await page.evaluate(() => window.playbackTest.context.resume());
    assert.deepEqual(await snapshot(), suspended);
    await checkQuiet(suspendedStart);

    await page.evaluate(async () => {
      window.playbackTest.timeline.dispose();
      await window.playbackTest.context.close();
    });
    console.log(JSON.stringify({
      browser: `${channel} ${browser.version()}`, headless: true,
      host: `${process.platform} ${release()} ${arch()}`, cpu: cpus()[0].model,
      sampleRate: await page.evaluate(() => window.playbackTest.context.sampleRate),
      ...report, controls: "passed", audioSuspension: "passed",
    }, null, 2));
  }
} finally {
  server.close();
  try {
    await browser?.close();
  } finally {
    nativeBrowser?.kill();
    if (profile) await rm(profile, { recursive: true, force: true, maxRetries: 5 });
  }
}
