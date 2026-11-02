import { SampledPiano } from "./sampled-piano.js";

/* global AudioWorkletProcessor, registerProcessor, sampleRate */
class PianoProcessor extends AudioWorkletProcessor {
  constructor(options) {
    super();
    this.synth = new SampledPiano(sampleRate, options.processorOptions.samples);
    this.received = 0;
    this.port.onmessage = ({ data }) => {
      // The owner permits at most 64 unacknowledged events plus one reset.
      this.synth.handle(data);
      this.received++;
    };
    this.port.postMessage("ready");
  }

  process(_inputs, outputs) {
    const channels = outputs[0];
    if (channels?.[0]) {
      this.synth.render(channels[0], channels[1] ?? channels[0]);
    }
    if (this.received) {
      this.port.postMessage(this.received);
      this.received = 0;
    }
    return true;
  }
}
registerProcessor("makeshift-piano", PianoProcessor);
