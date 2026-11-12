/* global currentFrame */
export function registerProcessor(name, PianoProcessor) {
  globalThis.registerProcessor(name, class extends PianoProcessor {
    constructor(options) {
      super(options);
      this.commands = [];
      this.wasActive = false;
      this.awaitingSilence = false;
      const handle = this.synth.handle.bind(this.synth);
      this.synth.handle = (command) => {
        handle(command);
        this.commands.push(command);
      };
    }

    process(inputs, outputs) {
      const keepAlive = super.process(inputs, outputs);
      const active = this.synth.voices.filter((voice) => voice.press !== 0).length;
      const settled = !active && !this.wasActive;
      if (this.commands.length || (this.awaitingSilence && settled)) {
        let peak = 0;
        for (const channel of outputs[0]) {
          for (const sample of channel) peak = Math.max(peak, Math.abs(sample));
        }
        const commands = this.commands;
        this.commands = [];
        this.port.postMessage({ frame: currentFrame, commands, active, peak });
      }
      this.awaitingSilence = !settled;
      this.wasActive = active > 0;
      return keepAlive;
    }
  });
}
