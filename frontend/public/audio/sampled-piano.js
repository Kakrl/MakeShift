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
  const gain = Math.min((PIANO_LEVEL * lift) / rms, 0.085 / peak);
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
    const seen = new Set();
    for (const sample of bank) {
      if (
        !PIANO_SAMPLES.some(({ note }) => note === sample.note) ||
        seen.has(sample.note) ||
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
      seen.add(sample.note);
      // Validate the worklet's own copy before readiness, including its peak bound.
      for (let i = 0; i < sample.left.length; i++)
        if (
          !Number.isFinite(sample.left[i]) ||
          !Number.isFinite(sample.right[i]) ||
          Math.abs(sample.left[i] * sample.gain) > 0.085000001 ||
          Math.abs(sample.right[i] * sample.gain) > 0.085000001
        )
          throw new Error("Invalid piano recording levels");
    }
    this.presets = Array.from({ length: 128 }, (_, note) => {
      let sample = bank[0];
      for (const candidate of bank)
        if (Math.abs(candidate.note - note) < Math.abs(sample.note - note))
          sample = candidate;
      return {
        sample,
        step:
          440 * 2 ** ((note - 69) / 12) < rate * 0.45
            ? 2 ** ((note - sample.note) / 12)
            : 0,
      };
    });
    this.fade = Math.max(1, Math.round(rate * 0.003));
    this.voices = this.voices.map((v) => ({
      ...v,
      preset: this.presets[60],
      position: 0,
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
    for (const v of this.voices)
      v.lastL = v.lastR = v.oldL = v.oldR = v.fadeLeft = 0;
  }

  handle(event) {
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
    if (!selected.preset.step) {
      selected.press = 0;
      selected.stage = "idle";
      selected.lastL = selected.lastR = 0;
      return;
    }
    selected.position = selected.preset.sample.offset;
    selected.gain = selected.preset.sample.gain * event.velocity ** 1.5;
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
        const sample = v.preset.sample;
        if (v.position >= sample.left.length - 1 || ++v.age > this.rate * 30) {
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
        const index = Math.floor(v.position),
          fraction = v.position - index;
        const gain = v.gain * v.level;
        v.lastL =
          (sample.left[index] +
            (sample.left[index + 1] - sample.left[index]) * fraction) *
          gain;
        v.lastR =
          (sample.right[index] +
            (sample.right[index + 1] - sample.right[index]) * fraction) *
          gain;
        if (v.fadeLeft) {
          const old = --v.fadeLeft / this.fade;
          v.lastL = old * v.oldL + (1 - old) * v.lastL;
          v.lastR = old * v.oldR + (1 - old) * v.lastR;
        }
        l += v.lastL;
        r += v.lastR;
        v.position += v.preset.step;
      }
      left[i] = l;
      if (right !== left) right[i] = r;
    }
  }
}
