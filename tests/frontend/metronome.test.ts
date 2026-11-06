import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
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
beforeEach(() => {
  vi.stubGlobal("requestAnimationFrame", (callback: FrameRequestCallback) =>
    setTimeout(() => callback(performance.now()), 16));
  vi.stubGlobal("cancelAnimationFrame", (id: ReturnType<typeof setTimeout>) => clearTimeout(id));
});
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});
describe("audio-thread metronome", () => {
  it.each([[4,4],[3,4],[6,8],[7,8],[2,2],[32,32]])(
    "counts %i/%i on denominator-note boundaries and completes after a full measure", (beats, denominator) => {
      const h = fixture();
      h.command("configure", { tempo: 120, beats, denominator, audible: true });
      h.command("count-in");
      const spacing = 48000 * 0.5 * 4 / denominator;
      h.render(beats * spacing + 1);
      expect(h.events.filter(e => e.beat !== null).map(e => e.frame))
        .toEqual(Array.from({ length: beats }, (_, beat) => beat * spacing));
      expect(h.events.filter(e => e.type === "complete").map(e => e.frame))
        .toEqual([beats * spacing]);
    },
  );
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
    currentTime: 2,
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
  const command = nodes[1].port.postMessage.mock.calls.at(-1)![0];
  const message = { type: "complete", generation: command.generation,
    countStartFrame: 0, countIntervalFrames: 24000, countTotal: 4, rate: 48000 };
  stale({ data: message });
  expect(complete).not.toHaveBeenCalled();
  nodes[1].port.onmessage!({
    data: message,
  });
  expect(complete).toHaveBeenCalledTimes(1);
  clock.close();
});

function preparationFixture() {
  const context = {
    state: "suspended" as AudioContextState,
    destination: {},
    onstatechange: null as null | (() => void),
    audioWorklet: { addModule: vi.fn(async () => {}) },
    resume: vi.fn(async () => { context.state = "running"; }),
    close: vi.fn(async () => { context.state = "closed"; }),
  };
  const node = {
    port: { onmessage: null, postMessage: vi.fn(), close: vi.fn() },
    onprocessorerror: null,
    connect: vi.fn(), disconnect: vi.fn(),
  };
  return { context, node };
}

it.each(["resume throw", "resume rejection", "module", "connect"])(
  "releases failed %s preparation and retries with a fresh context",
  async failure => {
    const first = preparationFixture(), second = preparationFixture();
    if (failure === "resume throw") first.context.resume.mockImplementationOnce(() => { throw new Error("resume"); });
    if (failure === "resume rejection") first.context.resume.mockRejectedValueOnce(new Error("resume"));
    if (failure === "module") first.context.audioWorklet.addModule.mockRejectedValueOnce(new Error("module"));
    if (failure === "connect") first.node.connect.mockImplementationOnce(() => { throw new Error("connect"); });
    const createContext = vi.fn()
      .mockReturnValueOnce(first.context)
      .mockReturnValueOnce(second.context);
    const createNode = vi.fn((context: AudioContext) =>
      (context === (first.context as unknown as AudioContext) ? first.node : second.node) as unknown as AudioWorkletNode);
    const clock = createMetronome(createContext, createNode);
    expect(await clock.prepare()).toBe(false);
    expect(first.context.close).toHaveBeenCalledOnce();
    expect(first.context.onstatechange).toBeNull();
    if (failure === "connect") {
      expect(first.node.port.close).toHaveBeenCalledOnce();
      expect(first.node.disconnect).toHaveBeenCalledOnce();
      expect(first.node.port.onmessage).toBeNull();
      expect(first.node.onprocessorerror).toBeNull();
    }
    expect(await clock.prepare()).toBe(true);
    expect(createContext).toHaveBeenCalledTimes(2);
    expect(second.context.close).not.toHaveBeenCalled();
    clock.close();
  },
);

it("does not let a retired module failure close a newer successful preparation", async () => {
  const first = preparationFixture(), second = preparationFixture();
  let rejectModule!: (error: Error) => void;
  first.context.audioWorklet.addModule.mockImplementationOnce(() =>
    new Promise<void>((_resolve, reject) => { rejectModule = reject; }));
  const createContext = vi.fn()
    .mockReturnValueOnce(first.context)
    .mockReturnValueOnce(second.context);
  const clock = createMetronome(createContext, () => second.node as unknown as AudioWorkletNode);
  const retired = clock.prepare();
  await Promise.resolve();
  expect(first.context.audioWorklet.addModule).toHaveBeenCalledOnce();
  clock.close();
  expect(await clock.prepare()).toBe(true);
  rejectModule(new Error("late module failure"));
  expect(await retired).toBe(false);
  expect(first.context.close).toHaveBeenCalledOnce();
  expect(second.context.close).not.toHaveBeenCalled();
  expect(second.node.disconnect).not.toHaveBeenCalled();
  expect(await clock.prepare()).toBe(true);
  expect(createContext).toHaveBeenCalledTimes(2);
  clock.close();
});

it.each([20, 120, 300])("uses the audio timeline at %i BPM without replaying queued beats", async tempo => {
  const pending = new Map<number, FrameRequestCallback>();
  let id = 0;
  const context = {
    state: "running", currentTime: 0, destination: {}, onstatechange: null,
    audioWorklet: { addModule: vi.fn(async () => {}) },
    getOutputTimestamp() {
      return { contextTime: context.currentTime, performanceTime: 1000 + context.currentTime * 1000 };
    },
    close: vi.fn(async () => {}),
  };
  const node = {
    port: { onmessage: null as null | ((event: { data: object }) => void), postMessage: vi.fn(), close: vi.fn() },
    connect: vi.fn(), disconnect: vi.fn(), onprocessorerror: null,
  };
  const clock = createMetronome(() => context as unknown as AudioContext,
    () => node as unknown as AudioWorkletNode, {
      request: callback => { pending.set(++id, callback); return id; },
      cancel: handle => { pending.delete(handle); },
    });
  const beat = vi.fn(), complete = vi.fn();
  clock.configure({ tempo, beatsPerMeasure: 4, audible: true }, {
    onCountInBeat: beat, onCountInComplete: complete, onUnavailable() {},
  });
  await clock.prepare();
  clock.setPlaying(true);
  clock.beginCountIn();
  const generation = node.port.postMessage.mock.calls.at(-1)![0].generation;
  const interval = 60 / tempo;
  const message = { type: "beat", beat: 1, generation, frame: 0, rate: 48000,
    countStartFrame: 0, countIntervalFrames: interval * 48000, countTotal: 4 };
  node.port.onmessage!({ data: message });
  expect(beat.mock.calls.map(call => call[0])).toEqual([1]);
  // Only animation frames run: beat 2/3/4 messages remain undelivered.
  context.currentTime = interval * 2.5;
  let callback = pending.values().next().value!;
  pending.clear(); callback(0);
  expect(beat.mock.calls.map(call => call[0])).toEqual([1, 3]);
  node.port.onmessage!({ data: message }); // Late duplicate must not redraw 1.
  expect(beat.mock.calls.map(call => call[0])).toEqual([1, 3]);
  context.currentTime = interval * 4 + 0.2;
  callback = pending.values().next().value!;
  pending.clear(); callback(0);
  expect(complete).toHaveBeenCalledOnce();
  expect(complete.mock.calls[0][0]).toBeCloseTo(1000 + interval * 4000, 6);
  expect(pending.size).toBe(0);
  node.port.onmessage!({ data: { ...message, type: "complete" } });
  expect(complete).toHaveBeenCalledOnce();
  clock.close();
});
