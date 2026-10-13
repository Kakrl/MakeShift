/** Fixed storage DSP shared by the production worklet and offline tests. */
export class LegacySynth {
  constructor(
    rate,
    { attack = 0.005, decay = 0.08, sustain = 0.7, release = 0.04 } = {},
  ) {
    if (!Number.isFinite(rate) || rate < 8000 || rate > 384000)
      throw new Error("Invalid sample rate");
    for (const duration of [attack, decay, release]) {
      if (!Number.isFinite(duration) || duration < 0 || duration > 10)
        throw new Error("Envelope durations must be seconds in [0, 10]");
    }
    if (!Number.isFinite(sustain) || sustain < 0 || sustain > 1)
      throw new Error("Sustain must be in [0, 1]");
    this.rate = rate;
    // Positive durations get at least one sample; zero skips a stage.
    this.attack = attack === 0 ? 0 : Math.max(1, Math.round(attack * rate));
    this.decay = decay === 0 ? 0 : Math.max(1, Math.round(decay * rate));
    this.release = release === 0 ? 0 : Math.max(1, Math.round(release * rate));
    this.sustain = sustain;
    this.session = 0;
    this.lastPress = 0;
    this.voices = Array.from({ length: 10 }, () => ({
      press: 0,
      phase: 0,
      step: 0,
      gain: 0,
      level: 0,
      releasing: false,
      stage: "idle",
      elapsed: 0,
      releaseStart: 0,
    }));
  }

  clear() {
    for (const voice of this.voices) {
      voice.press = 0;
      voice.level = 0;
      voice.stage = "idle";
      voice.releasing = false;
    }
  }

  handle(event) {
    if (!event || typeof event !== "object") return;
    if (!Number.isSafeInteger(event.session) || event.session < 1) return;
    if (event.type === "reset") {
      if (event.session <= this.session) return;
      this.clear();
      this.session = event.session;
      this.lastPress = 0;
      return;
    }
    if (event.session !== this.session) return;
    if (event.type === "release-all") {
      this.clear();
      return;
    }
    if (!Number.isSafeInteger(event.press) || event.press < 1) return;
    if (event.type === "note-off") {
      for (const voice of this.voices) {
        if (voice.press !== event.press || voice.releasing) continue;
        voice.releasing = true;
        voice.stage = "release";
        voice.elapsed = 0;
        voice.releaseStart = voice.level;
        if (this.release === 0 || voice.level === 0) {
          voice.level = 0;
          voice.press = 0;
          voice.stage = "idle";
        }
      }
      return;
    }
    if (
      event.type !== "note-on" ||
      event.press <= this.lastPress ||
      !Number.isInteger(event.note) ||
      event.note < 0 ||
      event.note > 127 ||
      !Number.isFinite(event.velocity) ||
      event.velocity <= 0 ||
      event.velocity > 1
    )
      return;
    this.lastPress = event.press;
    let selected = this.voices[0];
    for (const voice of this.voices) {
      if (voice.press === 0) {
        selected = voice;
        break;
      }
      if (voice.press < selected.press) selected = voice;
    }
    selected.press = event.press;
    selected.phase = 0;
    selected.step =
      (2 * Math.PI * (440 * 2 ** ((event.note - 69) / 12))) / this.rate;
    // Above Nyquist is intentionally silent rather than an aliased wrong pitch.
    selected.gain = selected.step < Math.PI ? event.velocity * 0.08 : 0;
    selected.level = 0;
    selected.releasing = false;
    selected.elapsed = 0;
    selected.releaseStart = 0;
    selected.stage = "attack";
    if (this.attack === 0) {
      selected.level = this.decay === 0 ? this.sustain : 1;
      selected.stage = this.decay === 0 ? "sustain" : "decay";
    }
  }

  render(output) {
    for (let frame = 0; frame < output.length; frame++) {
      let value = 0;
      for (let index = 0; index < 10; index++) {
        const voice = this.voices[index];
        if (voice.press === 0) continue;
        // Integer progress avoids cumulative rounding drift and pins endpoints.
        if (voice.stage === "attack") {
          voice.level = ++voice.elapsed / this.attack;
          if (voice.elapsed === this.attack) {
            voice.elapsed = 0;
            voice.stage = this.decay === 0 ? "sustain" : "decay";
          }
        } else if (voice.stage === "decay") {
          voice.level = 1 + (this.sustain - 1) * (++voice.elapsed / this.decay);
          if (voice.elapsed === this.decay) {
            voice.level = this.sustain;
            voice.stage = "sustain";
          }
        } else if (voice.stage === "sustain") {
          voice.level = this.sustain;
        } else if (voice.stage === "release") {
          voice.level =
            voice.releaseStart * (1 - ++voice.elapsed / this.release);
          if (voice.elapsed === this.release) {
            voice.level = 0;
            voice.press = 0;
            voice.stage = "idle";
            continue;
          }
        }
        value += Math.sin(voice.phase) * voice.level * voice.gain;
        voice.phase = (voice.phase + voice.step) % (2 * Math.PI);
      }
      output[frame] = Math.max(-1, Math.min(1, value));
    }
  }
}

/** Bounded modal approximation: no samples, noise, detuning or pedal model. */
export class Synth extends LegacySynth {
  constructor(rate, options = {}) {
    super(rate, options);
    this.legacy =
      options.mode === "legacy" ||
      ["attack", "decay", "sustain", "release"].some((key) => key in options);
    if (
      options.mode !== undefined &&
      !["legacy", "piano"].includes(options.mode)
    )
      throw new Error("Invalid synth mode");
    if (options.mode === "piano" && this.legacy)
      throw new Error("ADSR options require legacy mode");
    const {
      cutoffMin = 180,
      cutoffMax = 18000,
      resonance = 0.707,
      cutoffFast = 0.09,
      cutoffSlow = 0.8,
      cutoffDepth = 0.85,
    } = options;
    for (const [value, min, max] of [
      [cutoffMin, 20, 20000],
      [cutoffMax, cutoffMin, 100000],
      [resonance, 0.5, 1],
      [cutoffFast, 0.001, 10],
      [cutoffSlow, 0.001, 10],
      [cutoffDepth, 0, 1],
    ]) {
      if (!Number.isFinite(value) || value < min || value > max)
        throw new Error("Invalid cutoff envelope parameter");
    }
    this.cutoffMin = Math.min(cutoffMin, rate * 0.4);
    this.cutoffMax = Math.min(cutoffMax, rate * 0.45);
    this.cutoffDepth = cutoffDepth;
    this.damping = 1 / resonance;
    this.cutoffFastFactor = Math.exp(-1 / (rate * cutoffFast));
    this.cutoffSlowFactor = Math.exp(-1 / (rate * cutoffSlow));
    this.stealSamples = Math.max(1, Math.round(rate * 0.003));
    this.sine = new Float64Array(4097);
    this.filterTable = new Float64Array(1025);
    for (let i = 0; i <= 4096; i++)
      this.sine[i] = Math.sin((i * Math.PI) / 2048);
    for (let i = 0; i <= 1024; i++) {
      const fc =
        this.cutoffMin * (this.cutoffMax / this.cutoffMin) ** (i / 1024);
      this.filterTable[i] = Math.tan((Math.PI * fc) / rate);
    }
    // All note-dependent exponentials, tuning and partial steps precede readiness.
    this.presets = Array.from({ length: 128 }, (_, note) => {
      const register = note / 127;
      const frequency = 440 * 2 ** ((note - 69) / 12);
      const stiffness = 0.00002 + 0.00018 * register ** 2;
      const steps = new Float64Array(16);
      const factors = new Float64Array(16);
      for (let p = 0; p < 16; p++) {
        const k = p + 1;
        const f =
          k * frequency * Math.sqrt((1 + stiffness * k * k) / (1 + stiffness));
        steps[p] = f < rate * 0.45 ? f / rate : 0;
        factors[p] = Math.exp(-p / (rate * (0.24 + 0.35 * (1 - register))));
      }
      return {
        frequency,
        stiffness,
        steps,
        factors,
        attack: Math.max(
          1,
          Math.round(rate * (0.001 + 0.003 * (1 - register))),
        ),
        decay: Math.max(1, Math.round(rate * (0.05 + 0.1 * (1 - register)))),
        slow: Math.exp(-1 / (rate * (0.5 + 3.5 * (1 - register)))),
        release: Math.max(1, Math.round(rate * (0.04 + 0.11 * (1 - register)))),
        tracking: Math.min(
          1,
          Math.max(
            0,
            Math.log(Math.max(frequency * 2, this.cutoffMin) / this.cutoffMin) /
              Math.log(this.cutoffMax / this.cutoffMin),
          ),
        ),
      };
    });
    this.voices = this.voices.map((voice) => ({
      ...voice,
      phases: new Float64Array(16),
      weights: new Float64Array(16),
      preset: this.presets[69],
      age: 0,
      fast: 1,
      slow: 1,
      cutoff: 0,
      cutoffStart: 0,
      brightness: 0,
      g: 0,
      targetG: 0,
      gStep: 0,
      control: 0,
      ic1: 0,
      ic2: 0,
      last: 0,
      correction: 0,
      correctionLeft: 0,
    }));
  }

  clear() {
    super.clear();
    for (const voice of this.voices) {
      voice.ic1 = voice.ic2 = voice.last = voice.correction = 0;
      voice.correctionLeft = 0;
    }
  }

  handle(event) {
    if (this.legacy) return super.handle(event);
    const previous = this.lastPress;
    let stolen = null;
    let oldOutput = 0;
    if (event?.type === "note-on") {
      for (const v of this.voices)
        if (v.press === 0) {
          stolen = v;
          break;
        }
      if (!stolen) {
        stolen = this.voices[0];
        for (const v of this.voices) if (v.press < stolen.press) stolen = v;
        oldOutput = stolen.last;
      }
    }
    // Shared validation/allocator preserves the existing session and press contract.
    super.handle(event);
    if (event?.type === "note-off" && event.session === this.session) {
      for (const v of this.voices)
        if (v.press === event.press && v.elapsed === 0)
          v.cutoffStart = v.cutoff;
    }
    if (this.lastPress === previous || !stolen) return;
    const v = stolen;
    v.preset = this.presets[event.note];
    v.phases.fill(0);
    let sum = 0;
    for (let p = 0; p < 16; p++) {
      const w =
        v.preset.steps[p] === 0
          ? 0
          : p === 0
            ? 1
            : (0.22 + 0.35 * event.velocity) / (p + 1) ** 1.6;
      v.weights[p] = w;
      sum += w;
    }
    for (let p = 0; p < 16; p++) v.weights[p] /= sum || 1;
    v.gain = event.velocity * 0.08;
    v.stage = "attack";
    v.age = v.elapsed = v.level = 0;
    v.fast = v.slow = 1;
    v.brightness = 0.4 + 0.6 * event.velocity;
    v.cutoff = v.preset.tracking;
    v.g = v.targetG = v.gStep = v.control = 0;
    v.ic1 = v.ic2 = v.last = 0;
    v.correction = oldOutput;
    v.correctionLeft = this.stealSamples;
  }

  render(output) {
    if (this.legacy) return super.render(output);
    for (let frame = 0; frame < output.length; frame++) {
      let mix = 0;
      for (const v of this.voices) {
        if (!v.press) continue;
        const preset = v.preset;
        v.age++;
        if (v.stage === "attack") {
          const t = ++v.elapsed / preset.attack;
          v.level = t * t * (3 - 2 * t);
          if (v.elapsed === preset.attack) {
            v.stage = "decay";
            v.elapsed = 0;
          }
        } else if (v.stage === "decay") {
          const t = ++v.elapsed / preset.decay;
          // Fast exponential-like fall joins the slow tail continuously.
          v.level = 0.35 + 0.65 * (1 - t) ** 3;
          if (v.elapsed === preset.decay) {
            v.stage = "tail";
            v.elapsed = 0;
          }
        } else if (v.stage === "tail") v.level *= preset.slow;
        else if (v.stage === "release") {
          const t = ++v.elapsed / preset.release;
          v.level = v.releaseStart * (1 - t) ** 2;
          if (v.elapsed >= preset.release) v.level = 0;
        }
        if (
          (v.level < 0.00001 && v.stage !== "attack") ||
          v.age >= this.rate * 30
        ) {
          v.press = 0;
          v.stage = "idle";
          v.level = 0;
          v.ic1 = v.ic2 = v.last = 0;
          continue;
        }
        v.fast *= this.cutoffFastFactor;
        v.slow *= this.cutoffSlowFactor;
        if (v.releasing)
          v.cutoff =
            v.cutoffStart * Math.max(0, 1 - v.elapsed / preset.release);
        else {
          const opening = Math.min(1, v.age / preset.attack);
          v.cutoff = Math.min(
            1,
            preset.tracking +
              (1 - preset.tracking) *
                this.cutoffDepth *
                v.brightness *
                opening *
                (0.7 * v.fast + 0.3 * v.slow),
          );
        }
        if (v.control === 0) {
          const x = v.cutoff * 1024;
          const i = Math.min(1023, Math.floor(x));
          v.targetG =
            this.filterTable[i] +
            (this.filterTable[i + 1] - this.filterTable[i]) * (x - i);
          v.gStep = (v.targetG - v.g) / 16;
          v.control = 16;
        }
        v.control--;
        v.g += v.gStep;
        let excitation = 0;
        for (let p = 0; p < 16; p++) {
          if (!preset.steps[p]) continue;
          const x = v.phases[p] * 4096;
          const i = Math.floor(x);
          excitation +=
            (this.sine[i] + (this.sine[i + 1] - this.sine[i]) * (x - i)) *
            v.weights[p];
          v.phases[p] += preset.steps[p];
          if (v.phases[p] >= 1) v.phases[p]--;
          v.weights[p] *= preset.factors[p];
        }
        // Topology-preserving state-variable low-pass with bounded resonance.
        const a1 = 1 / (1 + v.g * (v.g + this.damping));
        const a2 = v.g * a1;
        const a3 = v.g * a2;
        const v3 = excitation - v.ic2;
        const v1 = a1 * v.ic1 + a2 * v3;
        const v2 = v.ic2 + a2 * v.ic1 + a3 * v3;
        v.ic1 = 2 * v1 - v.ic1;
        v.ic2 = 2 * v2 - v.ic2;
        v.last = v2 * v.level * v.gain;
        if (v.correctionLeft > 0)
          v.last += v.correction * (--v.correctionLeft / this.stealSamples);
        mix += v.last;
      }
      output[frame] = mix;
    }
  }
}
