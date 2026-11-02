// Simulated Web Audio transport, running the real controller and processor.
import { processorHarness } from "./metronomeHarness";
import type { createMetronome } from "../../frontend/src/app/audio/metronome";
type Output = {
  prepare(): Promise<boolean>;
  click(accent: boolean): void;
  silence(): void;
  close(): void;
};
export function createSimulatedMetronome(
  output: Output,
  factory: typeof createMetronome,
) {
  return factory(
    () => {
      const harness = processorHarness(1000);
      let timer: ReturnType<typeof setTimeout> | undefined;
      let connected = false;
      let audible = true;
      const context = {
        state: "suspended",
        onstatechange: null,
        destination: {},
        audioWorklet: { addModule: async () => {} },
        async resume() {
          if (!(await output.prepare())) throw new Error("unavailable");
          context.state = "running";
        },
        async close() {
          connected = false;
          clearTimeout(timer);
          context.state = "closed";
          output.close();
        },
      };
      const node = {
        port: {
          onmessage: null as null | ((event: { data: object }) => void),
          close() {},
          postMessage(
            message: Parameters<typeof harness.processor.command>[0],
          ) {
            if (message.type === "configure")
              audible = Boolean(message.audible);
            if (
              message.type === "stop" ||
              (message.type === "playing" && message.paused) ||
              (message.type === "configure" && !audible)
            )
              output.silence();
            harness.processor.command(message);
            clearTimeout(timer);
            timer = setTimeout(pump, 0);
          },
        },
        connect() {
          connected = true;
        },
        disconnect() {
          connected = false;
          clearTimeout(timer);
        },
      };
      function pump() {
        if (!connected) return;
        harness.scope.currentFrame = Date.now();
        harness.render(1);
        for (const message of harness.events.splice(0)) {
          if (audible) output.click(message.frame % 2000 === 0);
          node.port.onmessage?.({ data: message });
        }
        timer = setTimeout(pump, 10);
      }
      Object.assign(context, { testNode: node });
      return context as unknown as AudioContext;
    },
    (context) =>
      (context as unknown as { testNode: AudioWorkletNode }).testNode,
  );
}
