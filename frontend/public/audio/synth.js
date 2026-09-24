/** Fixed storage DSP shared by the production worklet and offline tests. */
export class Synth {
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
