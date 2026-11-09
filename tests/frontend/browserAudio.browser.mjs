/* Run against npm run build && npm start:
 * NODE_PATH may point at an existing Playwright installation.
 * MAKE_SHIFT_URL defaults to http://127.0.0.1:3000.
 * This measures browser graph output, not physical speaker audibility.
 */
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import os from "node:os";
const requireFromFrontend = createRequire(
  new URL("../../frontend/package.json", import.meta.url),
);
const { chromium } = requireFromFrontend("playwright");

function installAudioProbe(sampleRate) {
  const NativeContext = window.AudioContext;
  const NativeNode = window.AudioWorkletNode;
  window.AudioContext = class extends NativeContext {
    constructor(options) {
      super({ ...options, sampleRate });
      window.testContext = this;
    }
  };
  window.AudioWorkletNode = class extends NativeNode {
    constructor(...args) {
      super(...args);
      if (args[0] instanceof OfflineAudioContext) return;
      window.testPianoSamples = args[2].processorOptions.samples;
      window.testAnalyser = args[0].createAnalyser();
      window.testAnalyser.fftSize = 2048;
      this.connect(window.testAnalyser);
      const post = this.port.postMessage.bind(this.port);
      window.testCommands = [];
      this.port.postMessage = (message) => {
        window.testCommands.push(message);
        post(message);
      };
    }
  };
}

async function measureRange() {
  // Keep this protocol in sync with docs/browser_audio.md.
  const { SampledPiano } = await import("/audio/sampled-piano.js");
  const bank = window.testPianoSamples;
  const rate = window.testContext.sampleRate;
  const notes = Array.from({ length: 88 }, (_, index) => 21 + index);
  const segment = Math.ceil((rate * 0.5) / 128) * 128;
  const context = new OfflineAudioContext(2, notes.length * segment, rate);
  // Offline rendering can outrun messages sent from the main thread. Inject
  // commands at exact frames in a test-only subclass of the deployed processor.
  const probeUrl = URL.createObjectURL(
    new Blob(
      [
        `
    import { PianoProcessor } from ${JSON.stringify(new URL("/audio/piano-worklet.js", location.href))};
    registerProcessor("range-probe", class extends PianoProcessor {
      process(inputs, outputs) {
        if (currentFrame % ${segment} === 0) {
          const index = currentFrame / ${segment};
          const session = index + 1;
          this.port.onmessage({ data: { type: "reset", session } });
          this.port.onmessage({ data: {
            type: "note-on", session, press: 1, note: index + 21, velocity: 1,
          } });
        }
        return super.process(inputs, outputs);
      }
    });
  `,
      ],
      { type: "text/javascript" },
    ),
  );
  try {
    await context.audioWorklet.addModule(probeUrl);
  } finally {
    URL.revokeObjectURL(probeUrl);
  }
  const node = new AudioWorkletNode(context, "range-probe", {
    numberOfInputs: 0,
    numberOfOutputs: 1,
    outputChannelCount: [2],
    processorOptions: { samples: bank },
  });
  node.connect(context.destination);
  const output = await context.startRendering();
  const synth = new SampledPiano(rate, bank);
  const channels = [0, 1].map((channel) => output.getChannelData(channel));
  const rows = notes.map((note, index) => {
    const start = index * segment;
    const length = Math.round(rate * 0.4);
    const offset = start + Math.round(rate * 0.05);
    let peak = 0;
    const levels = channels.map((data) => {
      for (let i = start; i < start + segment; i++) {
        if (!Number.isFinite(data[i]))
          throw new Error(`Nonfinite output at MIDI ${note}`);
        peak = Math.max(peak, Math.abs(data[i]));
      }
      return Math.sqrt(
        data
          .subarray(offset, offset + length)
          .reduce((sum, x) => sum + x * x, 0) / length,
      );
    });
    if (Math.min(...levels) <= 0.00005 || peak > 0.950001)
      throw new Error(
        `MIDI ${note} at ${rate} Hz failed level bounds: ${levels}, peak ${peak}`,
      );

    const expected = 440 * 2 ** ((note - 69) / 12);
    const harmonics = Math.min(4, Math.floor((rate * 0.4) / expected));
    const stride = Math.max(1, Math.floor(rate / (16 * harmonics * expected)));
    const data = channels[levels[0] >= levels[1] ? 0 : 1];
    const windowed = new Float64Array(Math.floor(length / stride));
    let energy = 0;
    for (let i = 0; i < windowed.length; i++) {
      let sum = 0;
      for (let j = 0; j < stride; j++) sum += data[offset + i * stride + j];
      const hann =
        0.5 - 0.5 * Math.cos((2 * Math.PI * i) / (windowed.length - 1));
      windowed[i] = (sum * hann) / stride;
      energy += windowed[i] ** 2;
    }
    function estimate(partial) {
      let cents = 0;
      let power = -Infinity;
      const search = (min, max, step) => {
        for (let candidate = min; candidate <= max; candidate += step) {
          const frequency = partial * expected * 2 ** (candidate / 1200);
          const coefficient =
            2 * Math.cos((2 * Math.PI * frequency * stride) / rate);
          let previous = 0;
          let older = 0;
          for (const x of windowed) {
            const current = x + coefficient * previous - older;
            older = previous;
            previous = current;
          }
          const score =
            previous ** 2 + older ** 2 - coefficient * previous * older;
          if (score > power) {
            power = score;
            cents = candidate;
          }
        }
      };
      search(-100, 100, 5);
      search(Math.max(-100, cents - 4), Math.min(100, cents + 4), 1);
      return {
        partial,
        cents,
        energy: (2 * power) / (windowed.length * energy),
      };
    }
    const partials = Array.from({ length: harmonics }, (_, index) =>
      estimate(index + 1),
    );
    const tuning =
      partials.find((candidate) => candidate.energy >= 0.01) ?? partials[0];
    const attackStart = start + Math.round(rate * 0.005);
    const attackEnd = start + Math.round(rate * 0.08);
    const attackPower =
      channels.reduce(
        (sum, channel) =>
          sum +
          channel
            .subarray(attackStart, attackEnd)
            .reduce((power, x) => power + x * x, 0),
        0,
      ) /
      (2 * (attackEnd - attackStart));
    const partialCenterHz =
      partials.reduce(
        (sum, { partial, cents, energy }) =>
          sum + energy * partial * expected * 2 ** (cents / 1200),
        0,
      ) / partials.reduce((sum, { energy }) => sum + energy, 0);
    return {
      note,
      roots: synth.presets[note].layers.map(({ sample }) => sample.note),
      tuning,
      partials,
      attackDb: 10 * Math.log10(attackPower),
      partialCenterHz,
      rms: Math.sqrt((levels[0] ** 2 + levels[1] ** 2) / 2),
      peak,
    };
  });
  return { rate, rows };
}

async function profileChords() {
  const { SampledPiano } = await import("/audio/sampled-piano.js");
  const rate = window.testContext.sampleRate;
  const workloads = [
    [48, 52, 55, 60, 64, 67, 72, 76, 79, 84],
    [21, 28, 36, 48, 55, 60, 67, 76, 96, 108],
  ];
  const profiles = workloads.map((notes) => ({
    synth: new SampledPiano(rate, window.testPianoSamples),
    notes,
    samples: [],
  }));
  const left = new Float32Array(128);
  const right = new Float32Array(128);
  for (let batch = 0; batch < 400; batch++) {
    for (let order = 0; order < profiles.length; order++) {
      const { synth, notes, samples } =
        profiles[(batch + order) % profiles.length];
      const session = batch + 1;
      synth.handle({ type: "reset", session });
      for (const [index, note] of notes.entries())
        synth.handle({
          type: "note-on",
          session,
          press: index + 1,
          note,
          velocity: 1,
        });
      const start = performance.now();
      for (let block = 0; block < 64; block++) synth.render(left, right);
      const mean = (performance.now() - start) / 64;
      if (batch >= 100) samples.push(mean);
    }
  }
  return {
    rate,
    workloads: profiles.map(({ notes, samples }) => {
      samples.sort((a, b) => a - b);
      return {
        notes,
        batches: samples.length,
        p50Ms: samples[149],
        p99Ms: samples[296],
        maxMs: samples.at(-1),
      };
    }),
  };
}

(async () => {
  const browser = await chromium.launch({
    channel: process.env.AUDIO_BROWSER_CHANNEL || "msedge",
    headless: true,
  });
  try {
    const page = await browser.newPage();
    const errors = [];
    page.on("pageerror", (error) => errors.push(error.message));
    await page.addInitScript(installAudioProbe, 48000);
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
    for (const name of [
      "Lowest A0",
      "Bass C2",
      "Middle C4",
      "High C6",
      "Highest C8",
    ]) {
      await page.getByRole("button", { name, exact: true }).click();
      await page.waitForTimeout(150);
      assert((await readRms()) > 0.00005, `${name} must sound offline`);
    }
    const key = page.getByRole("combobox", { name: "Piano key" });
    assert.equal(await key.locator("option").count(), 88);
    await key.selectOption("107");
    await page.getByRole("button", { name: "Play selected key" }).click();
    await page.getByRole("status").filter({ hasText: "MIDI 107" }).waitFor();
    const sweep = page.getByRole("button", { name: "Play all 88 keys" });
    const stop = page.getByRole("button", { name: "Stop sound" });
    const attacks = () =>
      page.evaluate(() =>
        window.testCommands
          .filter(({ type }) => type === "note-on")
          .map(({ note }) => note),
      );
    const beforeSweep = (await attacks()).length;
    await sweep.click();
    await page.waitForFunction(
      (before) =>
        window.testCommands.filter(({ type }) => type === "note-on").length >=
        before + 2,
      beforeSweep,
    );
    assert.deepEqual(
      (await attacks()).slice(beforeSweep, beforeSweep + 2),
      [21, 22],
    );
    await stop.click();
    const stopped = await attacks();
    await page.waitForTimeout(350);
    assert.deepEqual(
      await attacks(),
      stopped,
      "Stop must cancel the sweep timer",
    );
    assert.equal(await readRms(), 0);

    await sweep.click();
    await page.evaluate(() => window.testContext.suspend());
    await page.getByRole("status").filter({ hasText: "unavailable" }).waitFor();
    const interrupted = await attacks();
    await page
      .getByRole("button", { name: "Enable audio", exact: true })
      .click();
    await page
      .getByRole("status")
      .filter({ hasText: "Audio enabled" })
      .waitFor();
    await page.waitForTimeout(350);
    assert.deepEqual(
      await attacks(),
      interrupted,
      "resume must not restart the sweep",
    );
    assert.equal(await readRms(), 0, "resume must not replay a held chord");
    await page.getByRole("button", { name: "Soft A4" }).click();
    await page.waitForTimeout(150);
    assert((await readRms()) > 0.00005);
    await page.context().setOffline(false);
    const range = [];
    const profile = await page.evaluate(profileChords);
    const tuningFailures = [];
    const transitionFailures = [];
    for (const rate of [44100, 48000, 96000]) {
      const probe =
        rate === actualSamples.rate ? page : await browser.newPage();
      try {
        if (probe !== page) {
          probe.on("pageerror", (error) => errors.push(error.message));
          await probe.addInitScript(installAudioProbe, rate);
          await probe.goto(base + "/audio");
          await probe.getByRole("button", { name: "Enable audio" }).click();
          await probe
            .getByRole("status")
            .filter({ hasText: "Audio enabled" })
            .waitFor();
        }
        const result = await probe.evaluate(measureRange);
        assert.equal(result.rate, rate);
        for (const { note, tuning } of result.rows) {
          if (Math.abs(tuning.cents) > 25 || tuning.energy < 0.01) {
            tuningFailures.push({ rate, note, ...tuning });
          }
        }
        const bassCenter = (note) => result.rows[note - 21].partialCenterHz;
        if (!(bassCenter(31) >= bassCenter(30))) {
          transitionFailures.push({
            rate,
            fromHz: bassCenter(30),
            toHz: bassCenter(31),
          });
        }
        for (const [index, row] of result.rows.entries()) {
          if (index === 0 || row.note > 96) continue;
          const attackStepDb = row.attackDb - result.rows[index - 1].attackDb;
          if (Math.abs(attackStepDb) > 1.25) {
            transitionFailures.push({ rate, note: row.note, attackStepDb });
          }
        }
        range.push(result);
      } finally {
        if (probe !== page) await probe.close();
      }
    }
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
          range,
          tuningFailures,
          transitionFailures,
          profile: {
            browserThread: "main",
            cpu: os.cpus()[0].model,
            ...profile,
          },
          offlineRegisters: "A0 through C8 controls passed",
          suspensionRecovery: "passed",
          navigationCleanup: "passed",
          audibleHardware: "not measured",
        },
        null,
        2,
      ),
    );
    assert.deepEqual(
      tuningFailures,
      [],
      "Each key must meet the documented tuning tolerance",
    );
    assert.deepEqual(
      transitionFailures,
      [],
      "Bass partial balance and adjacent attack levels must stay smooth",
    );
  } finally {
    await browser.close();
  }
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
