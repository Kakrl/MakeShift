import { describe, expect, it } from "vitest";
import { Synth } from "../../frontend/public/audio/synth.js";

function synth(rate = 48000) {
  const engine = new Synth(rate);
  engine.handle({ type: "reset", session: 1 });
  return engine;
}
function on(
  engine: Synth,
  press: number,
  note = 69,
  velocity = 1,
  session = 1,
) {
  engine.handle({ type: "note-on", session, press, note, velocity });
}
function render(engine: Synth, length = 48000) {
  const output = new Float32Array(length);
  // Exercise the same variable block boundaries as the worklet's DSP call.
  for (let offset = 0; offset < length; offset += 128)
    engine.render(output.subarray(offset, Math.min(offset + 128, length)));
  return output;
}
function rms(samples: Float32Array) {
  return Math.sqrt(
    samples.reduce((sum, value) => sum + value * value, 0) / samples.length,
  );
}

describe("production browser synthesis offline", () => {
  for (const rate of [44100, 48000, 96000]) {
    for (const note of [24, 36, 48, 60, 69, 72, 84, 96, 108, 120, 127]) {
      it(`renders MIDI ${note} at ${rate} Hz sample rate`, () => {
        const engine = synth(rate);
        on(engine, 1, note);
        const output = render(engine, rate * 2);
        let crossings = 0,
          first = 0,
          last = 0;
        for (let i = rate; i < output.length - 1; i++) {
          if (output[i] <= 0 && output[i + 1] > 0) {
            const position = i - output[i] / (output[i + 1] - output[i]);
            if (crossings === 0) first = position;
            last = position;
            crossings++;
          }
        }
        expect(
          Math.abs(
            (rate * (crossings - 1)) / (last - first) -
              440 * 2 ** ((note - 69) / 12),
          ),
        ).toBeLessThan(0.1);
        expect([...output].every(Number.isFinite)).toBe(true);
        expect(rms(output.subarray(rate))).toBeCloseTo(
          (0.08 * 0.7) / Math.sqrt(2),
          3,
        );
      });
    }
  }

  it("scales amplitude linearly with velocity and uses a smooth attack and release", () => {
    const soft = synth(),
      loud = synth();
    on(soft, 1, 69, 0.25);
    on(loud, 1, 69, 0.75);
    const a = render(soft),
      b = render(loud);
    expect(rms(b) / rms(a)).toBeCloseTo(3, 5);
    expect(rms(a.subarray(0, 100))).toBeLessThan(rms(a.subarray(1000, 1100)));
    loud.handle({ type: "note-off", session: 1, press: 1 });
    const tail = render(loud, 4000);
    expect(rms(tail.subarray(0, 1000))).toBeGreaterThan(0);
    expect(rms(tail.subarray(1920))).toBe(0);
  });

  it("sums ten independent repeated pitches, steals oldest, and ignores its late release", () => {
    const engine = synth(),
      single = synth();
    for (let press = 1; press <= 10; press++) on(engine, press);
    on(single, 1);
    expect(rms(render(engine)) / rms(render(single))).toBeCloseTo(10, 4);
    on(engine, 11, 72);
    expect(engine.voices.map((voice) => voice.press)).toEqual([
      11, 2, 3, 4, 5, 6, 7, 8, 9, 10,
    ]);
    engine.handle({ type: "note-off", session: 1, press: 1 });
    expect(engine.voices[0].releasing).toBe(false);
    const output = render(engine);
    expect(
      output.every((value) => Number.isFinite(value) && Math.abs(value) <= 0.8),
    ).toBe(true);
  });

  it("reuses released voices and preserves phase across render blocks", () => {
    const engine = synth(),
      reference = synth();
    for (let press = 1; press <= 10; press++) on(engine, press);
    engine.handle({ type: "note-off", session: 1, press: 5 });
    render(engine, 2000);
    on(engine, 11);
    expect(engine.voices[4].press).toBe(11);
    expect(engine.voices[0].press).toBe(1);
    const blocks = synth();
    on(blocks, 1);
    on(reference, 1);
    const continuous = new Float32Array(4000);
    reference.render(continuous);
    expect(render(blocks, 4000)).toEqual(continuous);
  });

  it("rejects malformed, duplicate, unordered and stale events; reset and release-all silence", () => {
    const engine = synth();
    for (const event of [null, {}, { type: "reset", session: NaN }])
      engine.handle(event);
    for (const velocity of [NaN, Infinity, -1, 0, 1.01])
      on(engine, 1, 69, velocity);
    for (const note of [-1, 128, NaN, 60.5]) on(engine, 1, note);
    expect(rms(render(engine, 128))).toBe(0);
    on(engine, 2);
    on(engine, 2);
    on(engine, 1);
    expect(engine.voices.filter((voice) => voice.press)).toHaveLength(1);
    engine.handle({ type: "release-all", session: 1 });
    expect(rms(render(engine, 128))).toBe(0);
    engine.handle({ type: "reset", session: 2 });
    on(engine, 3); // stale session
    expect(rms(render(engine, 128))).toBe(0);
    on(engine, 1, 69, 1, 2);
    engine.handle({ type: "note-off", session: 1, press: 1 });
    engine.handle({ type: "reset", session: 1 });
    expect(rms(render(engine, 128))).toBeGreaterThan(0);
    engine.handle({ type: "reset", session: 3 });
    expect(rms(render(engine, 128))).toBe(0);
  });
});

describe("sample-timed ADSR envelopes (#27)", () => {
  function configured(rate: number, options = {}) {
    const engine = new Synth(rate, options);
    engine.handle({ type: "reset", session: 1 });
    on(engine, 1);
    return engine;
  }
  function off(engine: Synth, press = 1) {
    engine.handle({ type: "note-off", session: 1, press });
  }

  for (const rate of [8000, 44100, 48000, 96000, 192000, 384000]) {
    it(`matches each default envelope sample and boundary at ${rate} Hz`, () => {
      const engine = configured(rate);
      const voice = engine.voices[0];
      const a = Math.round(0.005 * rate),
        d = Math.round(0.08 * rate);
      const r = Math.round(0.04 * rate);
      const sample = new Float32Array(1);
      let previous = 0;
      for (let i = 1; i <= a + d + 17; i++) {
        const expected =
          i <= a ? i / a : i <= a + d ? 1 - (0.3 * (i - a)) / d : 0.7;
        engine.render(sample);
        expect(voice.level).toBeCloseTo(expected, 12);
        expect(sample[0]).toBeCloseTo(
          Math.sin(((i - 1) * 2 * Math.PI * 440) / rate) * expected * 0.08,
          6,
        );
        // Carrier slope plus the larger envelope slope bounds every boundary.
        expect(Math.abs(sample[0] - previous)).toBeLessThanOrEqual(
          0.08 * ((2 * Math.PI * 440) / rate + 1 / a) + 1e-7,
        );
        previous = sample[0];
      }
      expect(voice.stage).toBe("sustain");
      off(engine);
      expect(voice.level).toBe(0.7);
      for (let i = 1; i <= r; i++) {
        engine.render(sample);
        expect(voice.level).toBeCloseTo(0.7 * (1 - i / r), 12);
        expect(Math.abs(sample[0] - previous)).toBeLessThanOrEqual(
          0.08 * ((2 * Math.PI * 440) / rate + 0.7 / r) + 1e-7,
        );
        previous = sample[0];
        expect(voice.press).toBe(i === r ? 0 : 1);
      }
      expect(render(engine, 128).every((v) => v === 0)).toBe(true);
    });

    for (const stage of ["attack", "decay", "sustain"]) {
      it(`releases from ${stage}, ignores duplicate off, and retriggers independently at ${rate}`, () => {
        const engine = configured(rate);
        const elapsed =
          stage === "attack"
            ? Math.floor(0.002 * rate)
            : stage === "decay"
              ? Math.round(0.025 * rate)
              : Math.round(0.1 * rate);
        render(engine, elapsed);
        const voice = engine.voices[0];
        expect(voice.stage).toBe(stage);
        const start = voice.level;
        off(engine);
        expect(voice.level).toBe(start);
        const half = Math.floor(engine.release / 2);
        render(engine, half);
        expect(voice.level).toBeCloseTo(
          start * (1 - half / engine.release),
          12,
        );
        off(engine); // Must not restart the release clock.
        on(engine, 2); // Same pitch, new independent press and attack.
        expect(engine.voices[1].level).toBe(0);
        render(engine, engine.release - half - 1);
        expect(voice.press).toBe(1);
        expect(voice.level).toBeCloseTo(start / engine.release, 12);
        render(engine, 1);
        expect(voice.press).toBe(0);
        expect(engine.voices[1].press).toBe(2);
        on(engine, 3);
        expect(engine.voices[0].press).toBe(3);
        expect(engine.voices[0].level).toBe(0);
      });
    }

    it(`handles zero and sub-sample stages at ${rate}`, () => {
      for (const duration of [0, 1e-12, 1 / rate]) {
        for (const sustain of [0, 0.5, 1]) {
          const engine = configured(rate, {
            attack: duration,
            decay: duration,
            sustain,
            release: duration,
          });
          const output = render(engine, 3);
          expect(output.every(Number.isFinite)).toBe(true);
          expect(engine.voices[0].level).toBe(sustain);
          off(engine);
          expect(render(engine, 1)[0]).toBe(0);
          expect(engine.voices[0].press).toBe(0);
        }
      }
      const engine = configured(rate);
      off(engine); // No rendered attack sample yet.
      expect(engine.voices[0].press).toBe(0);
      expect(render(engine, 128).every((v) => v === 0)).toBe(true);
    });
  }

  it("skips zero attack/decay separately and preserves the peak sample", () => {
    const instantAttack = configured(48000, { attack: 0, decay: 0.01 });
    expect(instantAttack.voices[0].level).toBe(1);
    render(instantAttack, 1);
    expect(instantAttack.voices[0].level).toBeCloseTo(1 - 0.3 / 480, 12);
    const instantDecay = configured(48000, { attack: 0.001, decay: 0 });
    render(instantDecay, 48);
    expect(instantDecay.voices[0].level).toBe(1);
    render(instantDecay, 1);
    expect(instantDecay.voices[0].level).toBe(0.7);
  });

  it("defines hard stealing in every stage, preserves other voices, and rejects stale releases", () => {
    for (const elapsed of [50, 1000, 6000]) {
      for (const releasing of [false, true]) {
        const engine = synth();
        for (let p = 1; p <= 10; p++) on(engine, p);
        render(engine, elapsed);
        if (releasing) {
          off(engine);
          render(engine, 23);
        }
        const oldSample =
          Math.sin(engine.voices[0].phase) * engine.voices[0].level * 0.08;
        const other = { ...engine.voices[1] };
        on(engine, 11);
        expect(engine.voices[0].level).toBe(0);
        expect(engine.voices[0].phase).toBe(0);
        expect(engine.voices[0].stage).toBe("attack");
        expect(Math.abs(oldSample)).toBeLessThanOrEqual(0.08); // Explicit hard-cut discontinuity bound.
        expect(Math.abs(oldSample)).toBeGreaterThan(0); // It is not a seamless crossfade.
        expect(engine.voices[1]).toEqual(other);
        off(engine, 1);
        expect(engine.voices[0].releasing).toBe(false);
        on(engine, 11); // Duplicate cannot reset progress.
        render(engine, 10);
        const level = engine.voices[0].level;
        on(engine, 11);
        expect(engine.voices[0].level).toBe(level);
      }
    }
  });

  it("is block-size independent through decay, sustain, and release", () => {
    const a = configured(44100),
      b = configured(44100);
    const whole = new Float32Array(7500);
    b.render(whole);
    expect(render(a, 7500)).toEqual(whole);
    off(a);
    off(b);
    const tail = new Float32Array(2000);
    b.render(tail);
    expect(render(a, 2000)).toEqual(tail);
  });

  it("validates parameter ranges and copies configuration at construction", () => {
    for (const key of ["attack", "decay", "release"]) {
      for (const value of [-1, NaN, Infinity, 10.01])
        expect(() => new Synth(48000, { [key]: value })).toThrow();
    }
    for (const sustain of [-0.1, 1.01, NaN, Infinity])
      expect(() => new Synth(48000, { sustain })).toThrow();
    for (const rate of [0, 7999, 384001, NaN, Infinity])
      expect(() => new Synth(rate)).toThrow();
    const options = { attack: 10, decay: 10, release: 10, sustain: 0 };
    const engine = configured(8000, options);
    options.attack = NaN;
    render(engine, 80000);
    expect(engine.voices[0].level).toBe(1);
    render(engine, 80000);
    expect(engine.voices[0].level).toBe(0);
    off(engine);
    expect(engine.voices[0].press).toBe(0);
  });
});
