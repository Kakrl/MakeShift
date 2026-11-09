import { LegacySynth } from "./synth.js";

/** Same 19 recordings and fixed headroom used in the accepted listening prototype. */
export const PIANO_SAMPLES = Object.freeze(
  [
    [24, "C1"],
    [36, "C2"],
    [39, "Ds2"],
    [42, "Fs2"],
    [45, "A2"],
    [48, "C3"],
    [51, "Ds3"],
    [54, "Fs3"],
    [57, "A3"],
    [60, "C4"],
    [63, "Ds4"],
    [66, "Fs4"],
    [69, "A4"],
    [72, "C5"],
    [75, "Ds5"],
    [78, "Fs5"],
    [81, "A5"],
    [84, "C6"],
    [96, "C7"],
  ].map(([note, name]) => Object.freeze({ note, name })),
);

// Fixed, not voice-count-dependent: chords do not turn held voices down.
export const PIANO_LEVEL = 0.003274555342244959;
export const PIANO_BASS_DB = 6;
export const PIANO_BOOST_DB = 6;
const OUTPUT_GAIN = 10 ** (PIANO_BOOST_DB / 20);
const VOICE_PEAK = 0.085;
const MAX_BLEND_BOOST = 10 ** (3 / 20);

function interpolate(data, index, fraction) {
  return data[index] + (data[index + 1] - data[index]) * fraction;
}

// Measure after the de-click fade. This analysis happens before readiness.
function attackPower(layers, rate) {
  const start = Math.round(rate * 0.005);
  const end = Math.round(rate * 0.08);
  let sum = 0;
  for (let frame = start; frame < end; frame++) {
    let left = 0,
      right = 0;
    for (const { sample, step, gain } of layers) {
      const position = sample.offset + frame * step;
      if (position >= sample.left.length - 1) continue;
      const index = Math.floor(position);
      const fraction = position - index;
      left += interpolate(sample.left, index, fraction) * gain;
      right += interpolate(sample.right, index, fraction) * gain;
    }
    sum += left * left + right * right;
  }
  return sum / (2 * (end - start));
}

function makeLayer(sample, note, weight) {
  const step = 2 ** ((note - sample.note) / 12);
  return {
    sample,
    step,
    gain: sample.gain * Math.sqrt(weight),
    duration: Math.ceil((sample.left.length - 1 - sample.offset) / step),
  };
}

/** Runs during loading, never inside audio rendering. Keeps the recorded stereo image. */
export function preparePianoSample(note, buffer) {
  if (
    !Number.isInteger(note) ||
    note < 0 ||
    note > 127 ||
    !Number.isFinite(buffer.sampleRate) ||
    buffer.sampleRate < 8000 ||
    buffer.sampleRate > 384000 ||
    !Number.isInteger(buffer.length) ||
    buffer.length < 2 ||
    buffer.length > buffer.sampleRate * 60 ||
    ![1, 2].includes(buffer.numberOfChannels)
  )
    throw new Error("Invalid piano recording");
  const left = buffer.getChannelData(0);
  const right = buffer.getChannelData(buffer.numberOfChannels - 1);
  let peak = 0,
    sum = 0;
  const end = Math.min(buffer.length, Math.round(buffer.sampleRate * 0.5));
  for (const data of [left, right]) {
    for (let i = 0; i < buffer.length; i++) {
      if (!Number.isFinite(data[i])) throw new Error("Invalid piano recording");
      peak = Math.max(peak, Math.abs(data[i]));
      if (i < end) sum += data[i] * data[i];
    }
  }
  const rms = Math.sqrt(sum / (2 * end));
  if (!(rms > 0)) throw new Error("Silent piano recording");
  let first = end;
  for (const data of [left, right])
    for (let i = 0; i < end; i++)
      if (Math.abs(data[i]) > peak * 0.002) {
        first = Math.min(first, i);
        break;
      }
  const lift =
    10 ** ((PIANO_BASS_DB * Math.max(0, Math.min(1, (69 - note) / 33))) / 20);
  // Normal recordings retain the auditioned RMS curve. Cap pathological crest
  // factors as well: ten coherent voices remain <=0.85 before Float32 rounding.
  const gain = Math.min((PIANO_LEVEL * lift) / rms, VOICE_PEAK / peak);
  return {
    note,
    left: new Float32Array(left),
    right: new Float32Array(right),
    gain,
    offset: Math.max(0, first - Math.round(buffer.sampleRate * 0.001)),
  };
}

/** Fixed ten-voice stereo sampler using the existing session/press contract. */
export class SampledPiano extends LegacySynth {
  constructor(rate, bank) {
    super(rate, { attack: 0.002, decay: 0, sustain: 1, release: 0.2 });
    if (!Array.isArray(bank) || bank.length !== PIANO_SAMPLES.length)
      throw new Error("Incomplete piano recordings");
    const peaks = new Map();
    for (const sample of bank) {
      if (
        !PIANO_SAMPLES.some(({ note }) => note === sample.note) ||
        peaks.has(sample.note) ||
        !(sample.left instanceof Float32Array) ||
        !(sample.right instanceof Float32Array) ||
        sample.left.length < 2 ||
        sample.left.length !== sample.right.length ||
        sample.left.length > rate * 60 ||
        !Number.isFinite(sample.gain) ||
        sample.gain <= 0 ||
        !Number.isInteger(sample.offset) ||
        sample.offset < 0 ||
        sample.offset >= sample.left.length - 1
      )
        throw new Error("Invalid piano recordings");
      // Validate the worklet copy and keep its peak for safe blend gains.
      let peak = 0;
      for (let i = 0; i < sample.left.length; i++) {
        const framePeak = Math.max(
          Math.abs(sample.left[i]),
          Math.abs(sample.right[i]),
        );
        if (
          !Number.isFinite(framePeak) ||
          framePeak * sample.gain > VOICE_PEAK + 1e-9
        )
          throw new Error("Invalid piano recording levels");
        peak = Math.max(peak, framePeak);
      }
      peaks.set(sample.note, peak);
    }
    const roots = [...bank].sort((a, b) => a.note - b.note);
    const powers = new Map(
      roots.map((sample) => [
        sample.note,
        attackPower([makeLayer(sample, sample.note, 1)], rate),
      ]),
    );
    this.presets = Array.from({ length: 128 }, (_, note) => {
      if (440 * 2 ** ((note - 69) / 12) >= rate * 0.45)
        return { layers: [], duration: 0 };
      const lower = roots.findLast((sample) => sample.note <= note) ?? roots[0];
      const upper = roots.find((sample) => sample.note >= note) ?? roots.at(-1);
      if (lower === upper) {
        const layer = makeLayer(lower, note, 1);
        return {
          layers: [layer],
          duration: Math.min(layer.duration, rate * 30),
        };
      }

      // Match blended onset energy to the neighboring roots despite phase differences.
      const weight = (note - lower.note) / (upper.note - lower.note);
      const layers = [
        makeLayer(lower, note, 1 - weight),
        makeLayer(upper, note, weight),
      ];
      const target =
        (1 - weight) * powers.get(lower.note) + weight * powers.get(upper.note);
      const measured = attackPower(layers, rate);
      const peak = layers.reduce(
        (sum, layer) => sum + peaks.get(layer.sample.note) * layer.gain,
        0,
      );
      const gain = Math.min(
        measured > 0 ? Math.sqrt(target / measured) : 1,
        MAX_BLEND_BOOST,
        VOICE_PEAK / peak,
      );
      for (const layer of layers) layer.gain *= gain;
      const duration = Math.max(layers[0].duration, layers[1].duration);
      return { layers, duration: Math.min(duration, rate * 30) };
    });
    this.pedals = { sustain: false, sostenuto: false, soft: false };
    this.fade = Math.max(1, Math.round(rate * 0.003));
    this.voices = this.voices.map((v) => ({
      ...v,
      held: false,
      captured: false,
      preset: this.presets[60],
      age: 0,
      lastL: 0,
      lastR: 0,
      oldL: 0,
      oldR: 0,
      fadeLeft: 0,
    }));
  }

  clear() {
    super.clear();
    if (this.pedals)
      this.pedals.sustain = this.pedals.sostenuto = this.pedals.soft = false;
    for (const v of this.voices) {
      v.lastL = v.lastR = v.oldL = v.oldR = v.fadeLeft = 0;
      v.held = v.captured = false;
    }
  }

  handle(event) {
    if (event?.type === "pedals") {
      if (
        event.version !== 1 ||
        event.session !== this.session ||
        ![event.sustain, event.sostenuto, event.soft].every(
          (x) => typeof x === "boolean",
        )
      )
        return;
      if (event.sostenuto && !this.pedals.sostenuto)
        for (const v of this.voices) v.captured = v.press !== 0 && v.held;
      if (!event.sostenuto) for (const v of this.voices) v.captured = false;
      this.pedals.sustain = event.sustain;
      this.pedals.sostenuto = event.sostenuto;
      this.pedals.soft = event.soft;
      for (const v of this.voices)
        if (v.press && !v.held && !v.releasing && !event.sustain && !v.captured)
          super.handle({
            type: "note-off",
            session: this.session,
            press: v.press,
          });
      return;
    }
    if (event?.type === "note-off" && event.session === this.session) {
      for (const v of this.voices) {
        if (v.press !== event.press || !v.held) continue;
        v.held = false;
        if (!this.pedals.sustain && !v.captured) super.handle(event);
      }
      return;
    }
    const previous = this.lastPress;
    // Remember the allocator's candidate before shared validation/assignment.
    let selected = this.voices[0];
    for (const v of this.voices) {
      if (!v.press) {
        selected = v;
        break;
      }
      if (v.press < selected.press) selected = v;
    }
    const oldL = selected.press ? selected.lastL : 0;
    const oldR = selected.press ? selected.lastR : 0;
    super.handle(event);
    if (this.lastPress === previous || event?.type !== "note-on") return;
    selected.preset = this.presets[event.note];
    if (!selected.preset.duration) {
      selected.press = 0;
      selected.stage = "idle";
      selected.lastL = selected.lastR = 0;
      return;
    }
    selected.held = true;
    selected.captured = false;
    selected.gain = event.velocity ** 1.5 * (this.pedals.soft ? 0.65 : 1);
    selected.age = 0;
    selected.oldL = oldL;
    selected.oldR = oldR;
    selected.fadeLeft = this.fade;
  }

  render(left, right = left) {
    for (let i = 0; i < left.length; i++) {
      let l = 0,
        r = 0;
      for (const v of this.voices) {
        if (!v.press) continue;
        const frame = v.age++;
        if (frame >= v.preset.duration) {
          v.press = 0;
          v.level = 0;
          v.stage = "idle";
          v.lastL = v.lastR = 0;
          continue;
        }
        if (v.stage === "attack") {
          v.level = ++v.elapsed / this.attack;
          if (v.elapsed >= this.attack) {
            v.stage = "sustain";
            v.elapsed = 0;
          }
        } else if (v.stage === "release") {
          v.level =
            v.releaseStart * Math.max(0, 1 - ++v.elapsed / this.release);
          if (!v.level) {
            v.press = 0;
            v.stage = "idle";
          }
        }
        let voiceL = 0,
          voiceR = 0;
        const layers = v.preset.layers;
        for (let layer = 0; layer < layers.length; layer++) {
          const { sample, step, gain } = layers[layer];
          const position = sample.offset + frame * step;
          if (position >= sample.left.length - 1) continue;
          const index = Math.floor(position);
          const fraction = position - index;
          voiceL += interpolate(sample.left, index, fraction) * gain;
          voiceR += interpolate(sample.right, index, fraction) * gain;
        }
        const envelope = v.gain * v.level;
        v.lastL = voiceL * envelope;
        v.lastR = voiceR * envelope;
        if (v.fadeLeft) {
          const old = --v.fadeLeft / this.fade;
          v.lastL = old * v.oldL + (1 - old) * v.lastL;
          v.lastR = old * v.oldR + (1 - old) * v.lastR;
        }
        l += v.lastL;
        r += v.lastR;
      }
      // Uniform output boost; only overloads reach this fixed safety ceiling.
      left[i] = Math.max(-0.95, Math.min(0.95, l * OUTPUT_GAIN));
      if (right !== left)
        right[i] = Math.max(-0.95, Math.min(0.95, r * OUTPUT_GAIN));
    }
  }
}
