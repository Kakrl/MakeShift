/* Clicks are synthesized and timed entirely on the audio rendering thread. */
class MetronomeProcessor extends AudioWorkletProcessor {
  constructor() {
    super();
    this.tempo = 120;
    this.beats = 4;
    this.audible = false;
    this.playing = false;
    this.paused = false;
    this.count = null;
    this.next = null;
    this.beat = 0;
    this.age = Infinity;
    this.frequency = 820;
    this.gain = 0;
    this.generation = 0;
    this.port.onmessage = ({ data: m }) => this.command(m);
  }
  wanted() {
    return (
      this.playing && (this.count !== null || (this.audible && !this.paused))
    );
  }
  command(m) {
    this.generation = m.generation;
    if (m.type === "configure") {
      if (
        !(
          Number.isFinite(m.tempo) &&
          m.tempo >= 20 &&
          m.tempo <= 300 &&
          Number.isInteger(m.beats) &&
          m.beats >= 1 &&
          m.beats <= 16
        )
      )
        return;
      this.tempo = m.tempo;
      this.beats = m.beats;
      this.audible = m.audible;
      if (!this.audible) this.age = Infinity;
    } else if (m.type === "playing") {
      this.playing = m.active;
      this.paused = m.paused;
      if (!m.active) this.count = null;
    } else if (m.type === "count-in") {
      if (!this.playing) return;
      this.count = 0;
      this.countTotal = this.beats;
      this.next = null;
      this.beat = 0;
      this.age = Infinity;
    } else if (m.type === "cancel-count-in") {
      this.count = null;
    } else if (m.type === "stop") {
      this.playing = false;
      this.count = null;
    }
    if (!this.wanted()) {
      this.next = null;
      this.age = Infinity;
    }
  }
  process(_inputs, outputs) {
    const channels = outputs[0];
    if (!channels?.length) return true;
    const out = channels[0];
    for (let i = 0; i < out.length; i++) {
      const frame = currentFrame + i;
      if (this.wanted() && this.next === null) {
        this.next = frame;
        this.beat = 0;
      }
      if (this.wanted() && frame >= this.next) {
        let type = "beat",
          countBeat = null;
        if (this.count !== null) {
          if (this.count === this.countTotal) {
            this.count = null;
            this.paused = false;
            this.beat = 0;
            type = "complete";
          } else {
            this.beat = this.count++;
            countBeat = this.count;
          }
        }
        if (this.audible) {
          this.frequency = this.beat === 0 ? 1050 : 820;
          this.gain = this.beat === 0 ? 0.65 : 0.38;
          this.age = 0;
        }
        this.port.postMessage({
          type,
          beat: countBeat,
          generation: this.generation,
          frame,
          rate: sampleRate,
        });
        this.beat = (this.beat + 1) % this.beats;
        this.next += (sampleRate * 60) / this.tempo;
        if (!this.wanted()) this.next = null;
      }
      let value = 0;
      if (this.age < sampleRate * 0.06) {
        const seconds = this.age / sampleRate;
        const envelope =
          this.gain *
          Math.exp(Math.log(0.001 / this.gain) * Math.min(seconds / 0.055, 1));
        value = envelope * Math.sin(2 * Math.PI * this.frequency * seconds);
        this.age++;
      }
      for (const channel of channels) channel[i] = value;
    }
    return true;
  }
}
registerProcessor("makeshift-metronome", MetronomeProcessor);
