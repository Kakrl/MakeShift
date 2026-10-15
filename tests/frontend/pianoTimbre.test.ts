import { describe, it, expect } from "vitest";
import { Synth } from "../../frontend/public/audio/synth.js";

function start(rate = 48000, note = 60, velocity = 1, options = {}) {
  const s = new Synth(rate, options);
  s.handle({ type: "reset", session: 1 });
  s.handle({ type: "note-on", session: 1, press: 1, note, velocity });
  return s;
}
function render(s: Synth, n: number) {
  const b = new Float32Array(n);
  s.render(b);
  return b;
}
function power(b: Float32Array) {
  return b.reduce((sum, x) => sum + x * x, 0) / b.length;
}
function spectrum(b: Float32Array, rate: number, hz: number) {
  let re = 0,
    im = 0;
  for (let i = 0; i < b.length; i++) {
    re += b[i] * Math.cos((2 * Math.PI * hz * i) / rate);
    im += b[i] * Math.sin((2 * Math.PI * hz * i) / rate);
  }
  return Math.hypot(re, im) / b.length;
}

describe("piano modal DSP (#175)", () => {
  for (const rate of [8000, 44100, 48000, 96000, 192000, 384000]) {
    it(`decays, releases from current level, and respects Nyquist at ${rate}`, () => {
      const s = start(rate);
      const v = s.voices[0];
      render(s, v.preset.attack);
      expect(v.level).toBe(1);
      render(s, v.preset.decay);
      expect(v.level).toBeCloseTo(0.35, 10);
      const bright = v.cutoff;
      const early = render(s, Math.round(rate * 0.1));
      render(s, rate * 2);
      const late = render(s, Math.round(rate * 0.1));
      expect(power(late)).toBeLessThan(power(early));
      expect(v.cutoff).toBeLessThan(bright);
      const level = v.level,
        cutoff = v.cutoff;
      s.handle({ type: "note-off", session: 1, press: 1 });
      expect(v.level).toBe(level);
      render(s, Math.floor(v.preset.release / 2));
      expect(v.level).toBeCloseTo(level * 0.25, 3);
      expect(v.cutoff).toBeLessThan(cutoff);
      s.handle({ type: "note-off", session: 1, press: 1 });
      const tail = render(s, v.preset.release);
      expect(tail.every(Number.isFinite)).toBe(true);
      expect(v.press).toBe(0);
      expect(power(render(s, 128))).toBe(0);
      for (let note = 0; note < 128; note++) {
        const preset = s.presets[note];
        for (let p = 0; p < 16; p++) {
          const k = p + 1;
          const hz =
            preset.frequency *
            k *
            Math.sqrt((1 + preset.stiffness * k * k) / (1 + preset.stiffness));
          expect(preset.steps[p]).toBe(hz < rate * 0.45 ? hz / rate : 0);
        }
      }
      const high = start(rate, 127);
      if (high.presets[127].frequency >= rate * 0.45)
        expect(power(render(high, rate))).toBe(0);
    });
  }
  it("has tuned fundamental and independently fading complex partials", () => {
    const s = start(48000, 69);
    render(s, 1000);
    const early = render(s, 4800);
    const v = s.voices[0];
    const ratio = v.weights[3] / v.weights[0];
    render(s, 96000);
    const late = render(s, 4800);
    expect(v.weights[3] / v.weights[0]).toBeLessThan(ratio * 0.01);
    const second = s.presets[69].steps[1] * 48000;
    expect(second).toBeGreaterThan(880);
    expect(spectrum(early, 48000, second)).toBeGreaterThan(
      spectrum(early, 48000, 700) * 3,
    );
    expect(spectrum(late, 48000, 440)).toBeGreaterThan(
      spectrum(late, 48000, 445) * 1.4,
    );
    expect(
      spectrum(late, 48000, second) / spectrum(late, 48000, 440),
    ).toBeLessThan(
      spectrum(early, 48000, second) / spectrum(early, 48000, 440),
    );
  });
  it("preserves the tuned onset gain and finite headroom for ten-note chords", () => {
    let previous = 0;
    for (const velocity of [0.2, 0.5, 1]) {
      const s = start(48000, 69, velocity);
      expect(s.voices[0].gain).toBeCloseTo(0.095 * velocity ** 1.5, 12);
      const level = power(render(s, 4800));
      expect(level).toBeGreaterThan(previous);
      previous = level;
    }
    for (const rate of [8000, 44100, 48000, 96000, 192000, 384000]) {
      for (const notes of [
        Array(10).fill(69),
        [48, 52, 55, 60, 64, 67, 72, 76, 79, 84],
      ]) {
        const s = start(rate, notes[0]);
        notes
          .slice(1)
          .forEach((note, index) =>
            s.handle({
              type: "note-on",
              session: 1,
              press: index + 2,
              note,
              velocity: 1,
            }),
          );
        expect(
          render(s, Math.round(rate * 0.2)).every(
            (x) => Number.isFinite(x) && Math.abs(x) < 1,
          ),
        ).toBe(true);
      }
    }
  });

  it("tracks velocity and register with independent filters", () => {
    const soft = start(48000, 60, 0.25),
      loud = start(48000, 60, 0.75);
    const a = render(soft, 4800),
      b = render(loud, 4800);
    expect(power(b)).toBeGreaterThan(power(a) * 4);
    expect(loud.voices[0].cutoff).toBeGreaterThan(soft.voices[0].cutoff);
    expect(loud.presets[24].release).toBeGreaterThan(loud.presets[96].release);
    expect(loud.presets[96].tracking).toBeGreaterThan(
      loud.presets[24].tracking,
    );
  });
  it("is block independent; early releases, reuse, stealing and emergency silence are safe", () => {
    const a = start(),
      b = start();
    const whole = render(a, 10000),
      blocks = new Float32Array(10000);
    for (let i = 0; i < blocks.length; i += 31)
      b.render(blocks.subarray(i, i + 31));
    expect(blocks).toEqual(whole);
    for (const age of [0, 12, 1000, 10000]) {
      const s = start();
      render(s, age);
      s.handle({ type: "note-off", session: 1, press: 1 });
      render(s, 10000);
      expect(s.voices[0].press).toBe(0);
    }
    for (let p = 2; p <= 10; p++)
      b.handle({
        type: "note-on",
        session: 1,
        press: p,
        note: 60,
        velocity: 1,
      });
    render(b, 1000);
    const previous = b.voices[0].last;
    b.handle({ type: "note-on", session: 1, press: 11, note: 72, velocity: 1 });
    expect(b.voices[0].correction).toBe(previous);
    expect(b.voices[0].ic1).toBe(0);
    b.handle({ type: "note-off", session: 1, press: 1 });
    expect(b.voices[0].releasing).toBe(false);
    b.handle({ type: "note-on", session: 1, press: 11, note: 72, velocity: 1 });
    expect(b.lastPress).toBe(11);
    expect(
      render(b, 100000).every((x) => Number.isFinite(x) && Math.abs(x) < 1),
    ).toBe(true);
    b.handle({ type: "release-all", session: 1 });
    expect(power(render(b, 128))).toBe(0);
    b.handle({ type: "reset", session: 2 });
    b.handle({ type: "note-on", session: 1, press: 12, note: 60, velocity: 1 });
    expect(power(render(b, 128))).toBe(0);
  });
  it("renders equal cutoff bounds as a finite fixed filter", () => {
    for (const rate of [8000, 48000, 96000]) {
      const cutoff = 1000;
      const s = start(rate, 60, 1, { cutoffMin: cutoff, cutoffMax: cutoff });
      expect(s.presets.every((preset) => preset.tracking === 0)).toBe(true);
      expect(s.filterTable.every((g) => g === s.filterTable[0])).toBe(true);
      const held = render(s, rate);
      expect(held.every(Number.isFinite)).toBe(true);
      expect(power(held)).toBeGreaterThan(0);
      s.handle({ type: "note-off", session: 1, press: 1 });
      expect(render(s, s.voices[0].preset.release).every(Number.isFinite)).toBe(
        true,
      );
      expect(s.voices[0].press).toBe(0);
      expect(power(render(s, 128))).toBe(0);
    }
  });
  it("retires held tails and validates filter configuration", () => {
    const s = start(8000);
    render(s, 8000 * 30);
    expect(s.voices[0].press).toBe(0);
    for (const key of [
      "cutoffMin",
      "cutoffMax",
      "resonance",
      "cutoffFast",
      "cutoffSlow",
      "cutoffDepth",
    ])
      for (const value of [NaN, Infinity, -1])
        expect(() => start(48000, 60, 1, { [key]: value })).toThrow();
    expect(() => start(48000, 60, 1, { mode: "piano", attack: 0 })).toThrow();
    for (const resonance of [0.5, 1]) {
      const extreme = start(8000, 60, 1, {
        resonance,
        cutoffMin: 20,
        cutoffMax: 100000,
        cutoffFast: 0.001,
        cutoffSlow: 0.001,
      });
      expect(
        render(extreme, 80000).every(
          (x) => Number.isFinite(x) && Math.abs(x) < 1,
        ),
      ).toBe(true);
    }
  });
  // Offline correctness stress, not a wall-clock DSP performance threshold.
  // Keep each rate independently reportable and allow shared CI runner overhead.
  it.each([44100, 48000, 96000])(
    "bounds rapid retriggers and malformed events without changing active state at %i Hz",
    (rate) => {
      const s = start(rate);
      const output = new Float32Array(128);
      for (let p = 2; p < 1000; p++) {
        s.handle({
          type: "note-on",
          session: 1,
          press: p,
          note: 24 + (p % 90),
          velocity: 1,
        });
        if (p % 3 === 0)
          s.handle({ type: "note-off", session: 1, press: p - 2 });
        s.render(output);
        expect(output.every((x) => Number.isFinite(x) && Math.abs(x) < 1)).toBe(
          true,
        );
      }
      const presses = s.voices.map((v) => v.press);
      for (const event of [
        null,
        {},
        { type: "reset", session: NaN },
        { type: "note-on", session: 1, press: 1001, note: 128, velocity: 1 },
        { type: "note-on", session: 1, press: 1001, note: 60, velocity: NaN },
        { type: "reset", session: 1 },
      ])
        s.handle(event);
      expect(s.voices.map((v) => v.press)).toEqual(presses);
      s.handle({ type: "reset", session: 2 });
      expect(power(render(s, 128))).toBe(0);
    },
    15000,
  );
});
