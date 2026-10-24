import { describe, expect, it } from "vitest";
import { Synth } from "../../frontend/public/audio/synth.js";
import { defaultBindings, PedalController, validBindings } from "../../frontend/src/events/pedals";

function fixture() {
  const synth = new Synth(8000);
  synth.handle({ type: "reset", session: 1 });
  const on = (press: number) => synth.handle({ type: "note-on", session: 1, press, note: 60, velocity: 0.8 });
  const off = (press: number) => synth.handle({ type: "note-off", session: 1, press });
  const pedals = (sustain = false, sostenuto = false, soft = false) => synth.handle({ type: "pedals", version: 1, session: 1, sustain, sostenuto, soft });
  const render = (n = 100) => synth.render(new Float32Array(n));
  return { synth, on, off, pedals, render };
}

describe("pedal DSP", () => {
  it("handles every ordering of a note and two pedal press/release pairs", () => {
    let count = 0;
    function visit(order: number[], remaining: number[]) {
      if (remaining.length) {
        for (const n of remaining) {
          if (n % 2 === 1 && !order.includes(n - 1)) continue;
          visit([...order, n], remaining.filter(x => x !== n));
        }
        return;
      }
      const f = fixture();
      let held = false, captured = false, sustain = false, sostenuto = false, damped = false;
      for (const n of order) {
        if (n === 0) { held = true; f.on(1); f.render(); }
        if (n === 1) { held = false; f.off(1); }
        if (n === 2) sustain = true;
        if (n === 3) sustain = false;
        if (n === 4) { sostenuto = true; captured = held; }
        if (n === 5) { sostenuto = false; captured = false; }
        if (n >= 2) f.pedals(sustain, sostenuto);
        if (order.slice(0, order.indexOf(n) + 1).includes(1) && !held && !sustain && !captured) damped = true;
        if (order.slice(0, order.indexOf(n) + 1).includes(0)) {
          expect(f.synth.voices[0].held).toBe(held);
          expect(f.synth.voices[0].releasing).toBe(damped);
        }
      }
      count++;
    }
    visit([], [0, 1, 2, 3, 4, 5]);
    expect(count).toBe(90);
  });
  it("captures identities only on the edge; combines sustain and sostenuto", () => {
    const f = fixture(); f.on(1); f.render(); f.pedals(false, true);
    f.on(2); f.render(); f.pedals(false, true); f.off(1); f.off(2);
    expect(f.synth.voices[0].releasing).toBe(false);
    expect(f.synth.voices[1].releasing).toBe(true);
    f.pedals(true, false); expect(f.synth.voices[0].releasing).toBe(false);
    f.pedals(); expect(f.synth.voices[0].releasing).toBe(true);
  });
  it("clear-all preserves held notes; stale controls and duplicate releases are harmless", () => {
    const f = fixture(); f.on(1); f.render(); f.pedals(true, true); f.pedals();
    expect(f.synth.voices[0].releasing).toBe(false);
    f.synth.handle({ type: "pedals", version: 1, session: 2, sustain: true, sostenuto: true, soft: true });
    f.off(1); f.render(); const elapsed = f.synth.voices[0].elapsed;
    f.off(1); expect(f.synth.voices[0].elapsed).toBe(elapsed);
    expect(f.synth.pedals.sustain).toBe(false);
  });
  it("does not capture a released sustain tail or resurrect damped voices", () => {
    const f = fixture(); f.on(1); f.render(); f.pedals(true); f.off(1);
    f.pedals(true, true); expect(f.synth.voices[0].captured).toBe(false);
    f.pedals(false, true); expect(f.synth.voices[0].releasing).toBe(true);
    f.render(2000); f.pedals(true); expect(f.synth.voices[0].press).toBe(0);
  });
  it("soft affects future strikes only, with quieter gain and fewer harmonics", () => {
    const f = fixture(); f.on(1); const gain = f.synth.voices[0].gain;
    const brightness = f.synth.voices[0].brightness;
    f.pedals(false, false, true); f.on(2);
    expect(f.synth.voices[0].gain).toBe(gain);
    expect(f.synth.voices[1].gain).toBeCloseTo(gain * 0.65);
    expect(f.synth.voices[1].brightness).toBeLessThan(brightness);
    expect(f.synth.voices[1].weights[1]).toBeLessThan(f.synth.voices[0].weights[1]);
  });
  it("steals oldest deterministically without inherited capture; reset clears everything", () => {
    const f = fixture(); f.on(1); f.pedals(true, true);
    for (let p = 2; p <= 11; p++) f.on(p);
    expect(f.synth.voices).toHaveLength(10);
    expect(f.synth.voices[0].press).toBe(11);
    expect(f.synth.voices[0].captured).toBe(false);
    f.off(1); expect(f.synth.voices[0].held).toBe(true);
    f.synth.handle({ type: "reset", session: 2 });
    expect(f.synth.voices.every(v => !v.press && !v.captured)).toBe(true);
    expect(f.synth.pedals).toEqual({ sustain: false, sostenuto: false, soft: false });
  });
  it("retires retained tails finitely and handles release before attack", () => {
    const f = fixture(); f.on(1); f.off(1); f.render();
    expect(f.synth.voices[0].press).toBe(0);
    f.on(2); f.pedals(true); f.off(2); f.render(8000 * 30);
    expect(f.synth.voices.every(v => !v.press)).toBe(true);
  });
});

describe("pedal source owner", () => {
  function owner() {
    const bindings = defaultBindings(); bindings.sustain.code = "KeyS";
    bindings.sostenuto = { code: "KeyD", mode: "toggle" }; bindings.none.code = "KeyX";
    const commands: unknown[] = [];
    const c = new PedalController(bindings, s => { commands.push(s); return true; }, () => {});
    return { c, commands };
  }
  it("composes UI and held keys without repeated effective edges", () => {
    const { c, commands } = owner(); c.toggle("sustain"); c.keydown("KeyS", false);
    c.keyup("KeyS"); expect(c.state.sustain).toBe(true); expect(commands).toHaveLength(1);
    c.toggle("sustain"); expect(c.state.sustain).toBe(false);
    c.keydown("KeyD", false); c.keydown("KeyD", true); c.keydown("KeyD", false);
    expect(c.state.sostenuto).toBe(true); c.keyup("KeyD"); c.keydown("KeyD", false);
    expect(c.state.sostenuto).toBe(false);
  });
  it("suppresses held sources across clear, rebind and invalidation until a fresh press", () => {
    const { c } = owner(); c.keydown("KeyS", false); c.keydown("KeyX", false);
    c.keydown("KeyS", true); expect(c.state.sustain).toBe(false);
    c.keyup("KeyX"); c.keyup("KeyS"); c.keydown("KeyS", false);
    expect(c.state.sustain).toBe(true); c.rebind(c.bindings);
    expect(c.state.sustain).toBe(false); c.keydown("KeyS", false);
    expect(c.state.sustain).toBe(false); c.keyup("KeyS"); c.keydown("KeyS", false);
    c.clear(false); expect(c.state.sustain).toBe(false);
  });
  it("rejects corrupt, conflicting and reserved bindings", () => {
    expect(validBindings(defaultBindings())).toBe(true);
    expect(validBindings(null)).toBe(false);
    const b = defaultBindings(); b.sustain.code = "Escape"; expect(validBindings(b)).toBe(false);
    b.sustain.code = "KeyS"; b.soft.code = "KeyS"; expect(validBindings(b)).toBe(false);
  });
  it("recovers to no pedals when transport rejects an activation", () => {
    const c = new PedalController(defaultBindings(), () => false, () => {});
    c.toggle("sustain"); expect(c.state.sustain).toBe(false);
  });
});
