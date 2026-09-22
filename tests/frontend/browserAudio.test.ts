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
        expect(rms(output.subarray(rate))).toBeCloseTo(0.08 / Math.sqrt(2), 3);
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
