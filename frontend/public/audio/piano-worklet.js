import { Synth } from "./synth.js";

/* global AudioWorkletProcessor, registerProcessor, sampleRate */
class PianoProcessor extends AudioWorkletProcessor {
  constructor() {
    super();
    this.synth = new Synth(sampleRate);
    this.received = 0;
    this.port.onmessage = ({ data }) => {
      // The owner permits at most 64 unacknowledged events plus one reset.
      this.synth.handle(data);
      this.received++;
    };
  }

  process(_inputs, outputs) {
    const channels = outputs[0];
    if (channels?.[0]) {
      this.synth.render(channels[0]);
      for (let channel = 1; channel < channels.length; channel++) {
        channels[channel].set(channels[0]);
      }
    }
    if (this.received) {
      this.port.postMessage(this.received);
      this.received = 0;
    }
    return true;
  }
}
registerProcessor("makeshift-piano", PianoProcessor);
