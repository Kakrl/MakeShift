/** Fixed storage DSP shared by the production worklet and offline tests. */
export class Synth {
  constructor(rate) {
    if (!Number.isFinite(rate) || rate < 8000)
      throw new Error("Invalid sample rate");
    this.rate = rate;
    this.session = 0;
    this.lastPress = 0;
    this.voices = Array.from({ length: 10 }, () => ({
      press: 0,
      phase: 0,
      step: 0,
      gain: 0,
      level: 0,
      releasing: false,
    }));
  }

  clear() {
    for (const voice of this.voices) voice.press = 0;
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
        if (voice.press === event.press) voice.releasing = true;
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
  }

  render(output) {
    for (let frame = 0; frame < output.length; frame++) {
      let value = 0;
      for (let index = 0; index < 10; index++) {
        const voice = this.voices[index];
        if (voice.press === 0) continue;
        voice.level = voice.releasing
          ? Math.max(0, voice.level - 1 / (0.04 * this.rate))
          : Math.min(1, voice.level + 1 / (0.005 * this.rate));
        if (voice.releasing && voice.level === 0) {
          voice.press = 0;
          continue;
        }
        value += Math.sin(voice.phase) * voice.level * voice.gain;
        voice.phase = (voice.phase + voice.step) % (2 * Math.PI);
      }
      output[frame] = Math.max(-1, Math.min(1, value));
    }
  }
}
