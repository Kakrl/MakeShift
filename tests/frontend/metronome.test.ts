import { describe, expect, it, vi, afterEach } from "vitest";
import { processorHarness } from "./metronomeHarness";
import { createMetronome } from "../../frontend/src/app/audio/metronome";
import { createSimulatedMetronome } from "./simulatedMetronome";
function fixture(rate = 48000) {
  const h = processorHarness(rate);
  const command = (type: string, fields: object = {}) =>
    h.processor.command({ type, generation: 1, ...fields });
  command("configure", { tempo: 120, beats: 4, audible: true });
  command("playing", { active: true, paused: false });
  return { ...h, command };
}
afterEach(() => {
  vi.useRealTimers();
});
describe("audio-thread metronome", () => {
  it.each([44100, 48000, 96000])(
    "keeps exact beat spacing at %i Hz independently of message delivery",
    (rate) => {
      const h = fixture(rate);
      // No main-thread callbacks or timers run while these audio samples render.
      const samples = h.render(rate * 3);
      expect(h.events.map((e) => e.frame)).toEqual([
        0,
        rate / 2,
        rate,
        rate * 1.5,
        rate * 2,
        rate * 2.5,
      ]);
      expect(samples.some((v) => Math.abs(v) > 0.1)).toBe(true);
      expect(samples.every(Number.isFinite)).toBe(true);
    },
  );
  it("runs one count-in then accompaniment without duplicate boundary clicks", () => {
    const h = fixture();
    h.command("count-in");
    h.render(120001);
    expect(h.events.filter((e) => e.beat !== null).map((e) => e.beat)).toEqual([
      1, 2, 3, 4,
    ]);
    expect(
      h.events.filter((e) => e.type === "complete").map((e) => e.frame),
    ).toEqual([96000]);
    expect(h.events.map((e) => e.frame)).toEqual([
      0, 24000, 48000, 72000, 96000, 120000,
    ]);
  });
  it("silences pause and toggle-off but keeps muted count-in", () => {
    const h = fixture();
    h.render(100);
    h.command("playing", { active: true, paused: true });
    expect(h.render(48000).every((v) => v === 0)).toBe(true);
    h.command("configure", { tempo: 120, beats: 4, audible: false });
    h.command("count-in");
    expect(h.render(96001).every((v) => v === 0)).toBe(true);
    expect(h.events.filter((e) => e.type === "complete")).toHaveLength(1);
  });
  it("applies a new tempo after the pending beat", () => {
    const h = fixture();
    h.render(12000);
    h.command("configure", { tempo: 60, beats: 4, audible: true });
    h.render(72001);
    expect(h.events.map((e) => e.frame)).toEqual([0, 24000, 72000]);
  });
  it("cancels count-in and stops all output", () => {
    const h = fixture();
    h.command("count-in");
    h.render(24001);
    h.command("cancel-count-in");
    h.render(96000);
    expect(h.events.some((e) => e.type === "complete")).toBe(false);
    h.command("stop");
    const before = h.events.length;
    expect(h.render(96000).every((v) => v === 0)).toBe(true);
    expect(h.events).toHaveLength(before);
  });
  it("rejects stale count-in messages and reopens after cleanup", async () => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout", "performance"] });
    const output = {
      prepare: vi.fn(async () => true),
      click: vi.fn(),
      silence: vi.fn(),
      close: vi.fn(),
    };
    const clock = createSimulatedMetronome(output, createMetronome);
    const done = vi.fn();
    clock.configure(
      { tempo: 120, beatsPerMeasure: 4, audible: true },
      { onCountInBeat() {}, onCountInComplete: done, onUnavailable() {} },
    );
    expect(await clock.prepare()).toBe(true);
    clock.setPlaying(true);
    clock.beginCountIn();
    vi.advanceTimersByTime(500);
    clock.stop();
    vi.advanceTimersByTime(2000);
    expect(done).not.toHaveBeenCalled();
    clock.close();
    expect(await clock.prepare()).toBe(true);
    clock.setPlaying(true);
    vi.advanceTimersByTime(500);
    expect(output.click).toHaveBeenCalled();
    clock.close();
    expect(output.close).toHaveBeenCalledTimes(2);
  });
});

it("recreates a failed processor and rejects notifications from the retired node", async () => {
  const nodes: {
    port: {
      onmessage: null | ((event: { data: object }) => void);
      postMessage: ReturnType<typeof vi.fn>;
      close: ReturnType<typeof vi.fn>;
    };
    onprocessorerror: null | (() => void);
    connect: ReturnType<typeof vi.fn>;
    disconnect: ReturnType<typeof vi.fn>;
  }[] = [];
  const context = {
    state: "running",
    audioWorklet: { addModule: vi.fn(async () => {}) },
    destination: {},
    close: vi.fn(async () => {}),
    onstatechange: null,
  };
  const clock = createMetronome(
    () => context as unknown as AudioContext,
    () => {
      const node = {
        port: {
          onmessage: null as null | ((event: { data: object }) => void),
          postMessage: vi.fn(),
          close: vi.fn(),
        },
        onprocessorerror: null as null | (() => void),
        connect: vi.fn(),
        disconnect: vi.fn(),
      };
      nodes.push(node);
      return node as unknown as AudioWorkletNode;
    },
  );
  const unavailable = vi.fn(),
    complete = vi.fn();
  clock.configure(
    { tempo: 120, beatsPerMeasure: 4, audible: true },
    {
      onCountInBeat() {},
      onCountInComplete: complete,
      onUnavailable: unavailable,
    },
  );
  expect(await clock.prepare()).toBe(true);
  clock.setPlaying(true);
  clock.beginCountIn();
  const stale = nodes[0].port.onmessage!;
  nodes[0].onprocessorerror!();
  expect(unavailable).toHaveBeenCalledTimes(1);
  expect(nodes[0].disconnect).toHaveBeenCalled();
  expect(await clock.prepare()).toBe(true);
  expect(nodes).toHaveLength(2);
  clock.setPlaying(true);
  clock.beginCountIn();
  const message = nodes[1].port.postMessage.mock.calls.at(-1)![0];
  stale({ data: { type: "complete", generation: message.generation } });
  expect(complete).not.toHaveBeenCalled();
  nodes[1].port.onmessage!({
    data: { type: "complete", generation: message.generation },
  });
  expect(complete).toHaveBeenCalledTimes(1);
  clock.close();
});
