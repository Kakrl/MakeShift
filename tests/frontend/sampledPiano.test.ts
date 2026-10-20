import { afterEach, describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import { createHash } from "node:crypto";
import {
  PIANO_SAMPLES,
  PIANO_BASS_DB,
  PIANO_LEVEL,
  preparePianoSample,
  SampledPiano,
} from "../../frontend/public/audio/sampled-piano.js";
import { loadPianoSamples } from "../../frontend/src/app/audio/pianoSamples";

function buffer(rate = 48000, note = 69, duration = 0.5) {
  const left = Float32Array.from(
    { length: Math.round(rate * duration) },
    (_, i) =>
      0.5 * Math.sin((2 * Math.PI * 440 * 2 ** ((note - 69) / 12) * i) / rate),
  );
  const right = left.map((x) => -x);
  return {
    sampleRate: rate,
    length: left.length,
    numberOfChannels: 2,
    getChannelData: (channel: number) => (channel ? right : left),
  };
}
function bank(rate = 48000) {
  return PIANO_SAMPLES.map(({ note }) =>
    preparePianoSample(note, buffer(rate, Number(note))),
  );
}
function start(rate = 48000, note = 69, velocity = 1) {
  const piano = new SampledPiano(rate, bank(rate));
  piano.handle({ type: "reset", session: 1 });
  piano.handle({ type: "note-on", session: 1, press: 1, note, velocity });
  return piano;
}
function render(piano: SampledPiano, length = 4800) {
  const left = new Float32Array(length),
    right = new Float32Array(length);
  piano.render(left, right);
  return { left, right };
}
function rms(data: Float32Array) {
  return Math.sqrt(data.reduce((sum, x) => sum + x * x, 0) / data.length);
}
afterEach(() => vi.unstubAllGlobals());

describe("sampled piano (#210)", () => {
  it("pins the auditioned +6 dB normalization and preserves stereo", () => {
    const b = buffer();
    const low = preparePianoSample(36, b),
      high = preparePianoSample(69, b);
    const middle = preparePianoSample(48, b);
    expect(PIANO_BASS_DB).toBe(6);
    expect(high.gain * rms(b.getChannelData(0))).toBeCloseTo(PIANO_LEVEL, 10);
    expect(20 * Math.log10(low.gain / high.gain)).toBeCloseTo(6, 10);
    expect(20 * Math.log10(middle.gain / high.gain)).toBeCloseTo(
      (6 * 21) / 33,
      10,
    );
    expect(low.left).not.toBe(b.getChannelData(0));
    const output = render(start());
    expect(rms(output.left)).toBeGreaterThan(0);
    output.left.forEach((x, i) => expect(output.right[i] + x).toBe(0));
  });

  it("copies finite PCM, trims only leading silence and bounds unusual crest factors", () => {
    const b = buffer();
    b.getChannelData(0).fill(0, 0, 2000);
    b.getChannelData(1).fill(0, 0, 2000);
    const prepared = preparePianoSample(36, b);
    expect(prepared.offset).toBeGreaterThan(1900);
    expect(prepared.offset).toBeLessThan(2001);
    const impulse = buffer();
    impulse.getChannelData(0).fill(0);
    impulse.getChannelData(1).fill(0);
    impulse.getChannelData(0)[100] = 1;
    const capped = preparePianoSample(24, impulse);
    expect(capped.gain).toBe(0.085);
    impulse.getChannelData(0)[100] = NaN;
    expect(() => preparePianoSample(24, impulse)).toThrow();
    expect(() =>
      preparePianoSample(24, { ...b, numberOfChannels: 0 }),
    ).toThrow();
    expect(() => preparePianoSample(24, { ...b, sampleRate: NaN })).toThrow();
    expect(() => new SampledPiano(48000, [])).toThrow();
    const samples = bank();
    samples[1] = samples[0];
    expect(() => new SampledPiano(48000, samples)).toThrow();
  });

  it.each([8000, 44100, 48000, 96000, 192000, 384000])(
    "keeps all MIDI pitches and coherent/mixed ten-note chords bounded at %i Hz",
    (rate) => {
      const piano = new SampledPiano(rate, bank(rate));
      for (let note = 0; note < 128; note++) {
        piano.handle({ type: "reset", session: note + 1 });
        for (let press = 1; press <= 10; press++)
          piano.handle({
            type: "note-on",
            session: note + 1,
            press,
            note,
            velocity: 1,
          });
        const output = render(piano, 256);
        if (440 * 2 ** ((note - 69) / 12) >= rate * 0.45) {
          expect(rms(output.left)).toBe(0);
          expect(rms(output.right)).toBe(0);
        }
        expect(
          [...output.left, ...output.right].every(
            (x) => Number.isFinite(x) && Math.abs(x) <= 0.850001,
          ),
        ).toBe(true);
      }
      piano.handle({ type: "reset", session: 129 });
      [24, 36, 43, 48, 52, 60, 69, 72, 84, 96].forEach((note, i) =>
        piano.handle({
          type: "note-on",
          session: 129,
          press: i + 1,
          note,
          velocity: 1,
        }),
      );
      expect(
        render(piano, rate / 4).left.every(
          (x) => Number.isFinite(x) && Math.abs(x) <= 0.850001,
        ),
      ).toBe(true);
    },
    15000,
  );

  it("retains velocity ordering in bass/mid/treble and correct transposed pitch", () => {
    for (const note of [24, 36, 48, 60, 69, 84, 96]) {
      let previous = 0;
      for (const velocity of [0.2, 0.5, 1]) {
        const level = rms(render(start(48000, note, velocity)).left);
        expect(level).toBeGreaterThan(previous);
        previous = level;
      }
    }
    const output = render(start(48000, 70), 16000).left.slice(1000);
    let crossings = 0;
    for (let i = 1; i < output.length; i++)
      if (output[i - 1] <= 0 && output[i] > 0) crossings++;
    expect(
      Math.abs((crossings * 48000) / output.length - 440 * 2 ** (1 / 12)),
    ).toBeLessThan(4);
  });

  it("is block independent and preserves release, stealing, reset and malformed-input safety", () => {
    const a = start(),
      b = start();
    const whole = render(a).left,
      blocks = new Float32Array(4800);
    for (let i = 0; i < blocks.length; i += 31)
      b.render(blocks.subarray(i, i + 31));
    expect(blocks).toEqual(whole);
    const held = a.voices[0].level;
    a.handle({ type: "note-off", session: 1, press: 1 });
    render(a, 4800);
    expect(a.voices[0].level).toBeCloseTo(held / 2, 8);
    a.handle({ type: "note-off", session: 1, press: 1 });
    render(a, 4800);
    expect(rms(render(a).left)).toBe(0);
    for (let press = 2; press <= 10; press++)
      b.handle({ type: "note-on", session: 1, press, note: 36, velocity: 1 });
    render(b, 1000);
    const old = b.voices[0].lastL;
    b.handle({ type: "note-on", session: 1, press: 11, note: 84, velocity: 1 });
    expect(b.voices[0].oldL).toBe(old);
    b.handle({ type: "note-off", session: 1, press: 1 });
    expect(b.voices[0].releasing).toBe(false);
    b.handle({ type: "note-on", session: 1, press: 11, note: 60, velocity: 1 });
    b.handle({
      type: "note-on",
      session: 1,
      press: 12,
      note: 60,
      velocity: NaN,
    });
    expect(b.lastPress).toBe(11);
    expect(render(b, 3000).left.every((x) => Math.abs(x) <= 0.850001)).toBe(
      true,
    );
    b.handle({ type: "release-all", session: 1 });
    expect(rms(render(b).left)).toBe(0);
    b.handle({ type: "reset", session: 2 });
    b.handle({ type: "note-on", session: 1, press: 13, note: 36, velocity: 1 });
    expect(rms(render(b).left)).toBe(0);
    expect(rms(render(start(), 48000).left.slice(30000))).toBe(0);
  });

  it("pins all committed recordings to the manifest hashes", () => {
    const base = new URL(
      "../../frontend/public/audio/piano-samples/",
      import.meta.url,
    );
    const manifest = JSON.parse(
      readFileSync(new URL("manifest.json", base), "utf8"),
    );
    expect(manifest.files.map((f: { name: string }) => f.name).sort()).toEqual(
      PIANO_SAMPLES.map(({ name }) => `${name}.mp3`).sort(),
    );
    for (const file of manifest.files) {
      const data = readFileSync(new URL(file.name, base));
      expect(data.length).toBe(file.bytes);
      expect(createHash("sha256").update(data).digest("hex")).toBe(file.sha256);
    }
  });
});

describe("sample loading", () => {
  it("fetches locally with at most four outstanding decodes and preserves manifest order", async () => {
    let pending = 0,
      max = 0;
    const fetcher = vi.fn(async (url: string) => {
      expect(url).toMatch(/^\/audio\/piano-samples\//);
      max = Math.max(max, ++pending);
      return { ok: true, arrayBuffer: async () => new ArrayBuffer(1) };
    });
    vi.stubGlobal("fetch", fetcher);
    const decode = vi.fn(async () => {
      await Promise.resolve();
      pending--;
      return buffer();
    });
    const context = {
      sampleRate: 48000,
      decodeAudioData: decode,
    } as unknown as AudioContext;
    const result = await loadPianoSamples(
      context,
      new AbortController().signal,
    );
    expect(max).toBeLessThanOrEqual(4);
    expect(fetcher).toHaveBeenCalledTimes(19);
    expect(result.map((s) => s.note)).toEqual(PIANO_SAMPLES.map((s) => s.note));
  });

  it.each(["http", "decode", "abort", "rate"])(
    "rejects %s failures before readiness",
    async (cause) => {
      const controller = new AbortController();
      vi.stubGlobal(
        "fetch",
        vi.fn(async () => ({
          ok: cause !== "http",
          arrayBuffer: async () => new ArrayBuffer(1),
        })),
      );
      const context = {
        sampleRate: 48000,
        decodeAudioData: async () => {
          if (cause === "decode") throw new Error("Decode failed");
          if (cause === "abort") controller.abort();
          return buffer(cause === "rate" ? 44100 : 48000);
        },
      } as unknown as AudioContext;
      await expect(
        loadPianoSamples(context, controller.signal),
      ).rejects.toThrow();
    },
  );
});
