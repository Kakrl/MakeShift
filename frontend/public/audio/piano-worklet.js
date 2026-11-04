import { SampledPiano } from "./sampled-piano.js";

/* global AudioWorkletProcessor, registerProcessor, sampleRate */
class PianoProcessor extends AudioWorkletProcessor {
  static get parameterDescriptors() {
    return [{ name: "volume", defaultValue: 1, minValue: 0, maxValue: 4, automationRate: "a-rate" }];
  }
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

  process(_inputs, outputs, parameters) {
    const channels = outputs[0];
    if (channels?.[0]) {
      this.synth.render(channels[0], channels[1] ?? channels[0], parameters.volume);
    }
    if (this.received) {
      this.port.postMessage(this.received);
      this.received = 0;
    }
    return true;
  }
}
registerProcessor("makeshift-piano", PianoProcessor);
