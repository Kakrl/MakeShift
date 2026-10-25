import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { runInNewContext } from "node:vm";
export type BeatMessage = {
  type: string;
  beat: number | null;
  frame: number;
  rate: number;
  generation: number;
};
type Command = { type: string; generation: number; [key: string]: unknown };
type Processor = {
  command(message: Command): void;
  process(inputs: unknown[], outputs: Float32Array[][]): boolean;
  port: { postMessage(message: BeatMessage): void };
};
export function processorHarness(rate = 48000) {
  let Constructor!: new () => Processor;
  const scope = {
    sampleRate: rate,
    currentFrame: 0,
    AudioWorkletProcessor: class {
      port = { postMessage(message: BeatMessage) { void message; } };
    },
    registerProcessor: (_name: string, ctor: typeof Constructor) => {
      Constructor = ctor;
    },
  };
  runInNewContext(
    readFileSync(
      resolve(process.cwd(), "public/audio/metronome-worklet.js"),
      "utf8",
    ),
    scope,
  );
  const processor = new Constructor();
  const events: BeatMessage[] = [];
  processor.port.postMessage = (message) => events.push(message);
  function render(frames: number) {
    const result = new Float32Array(frames);
    processor.process([], [[result]]);
    scope.currentFrame += frames;
    return result;
  }
  return { processor, events, render, scope };
}
