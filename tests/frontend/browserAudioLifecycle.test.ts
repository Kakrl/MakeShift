import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { BrowserAudio } from "../../frontend/src/app/audio/audioEngine";

class Context {
  static instances: Context[] = [];
  static failLoad = false;
  static resumeState = "running";
  state = "suspended";
  destination = {};
  onstatechange: (() => void) | null = null;
  audioWorklet = {
    addModule: vi.fn(async () => {
      if (Context.failLoad) throw new Error("Module load failed");
    }),
  };
  resume = vi.fn(async () => {
    this.state = Context.resumeState;
  });
  close = vi.fn(async () => {
    this.state = "closed";
  });
  constructor(public options: unknown) {
    Context.instances.push(this);
  }
}
class Worklet {
  static instances: Worklet[] = [];
  port = {
    postMessage: vi.fn(),
    close: vi.fn(),
    onmessage: null as null | ((event: { data: number }) => void),
  };
  connect = vi.fn();
  disconnect = vi.fn();
  onprocessorerror: (() => void) | null = null;
  constructor() {
    Worklet.instances.push(this);
  }
  ack() {
    this.port.onmessage?.({ data: this.port.postMessage.mock.calls.length });
  }
}

beforeEach(() => {
  Context.instances = [];
  Worklet.instances = [];
  Context.failLoad = false;
  Context.resumeState = "running";
  vi.stubGlobal("AudioContext", Context);
  vi.stubGlobal("AudioWorkletNode", Worklet);
});
afterEach(() => vi.unstubAllGlobals());

describe("browser audio owner lifecycle", () => {
  it("never initializes from notes; shares initialization and requests interactive latency", async () => {
    const audio = new BrowserAudio();
    expect(audio.noteOn(69)).toBeNull();
    expect(Context.instances).toHaveLength(0);
    await Promise.all([audio.initialize(), audio.initialize()]);
    expect(Context.instances).toHaveLength(1);
    expect(Context.instances[0].options).toEqual({
      latencyHint: "interactive",
    });
    expect(Context.instances[0].audioWorklet.addModule).toHaveBeenCalledWith(
      "/audio/piano-worklet.js",
    );
    expect(Worklet.instances).toHaveLength(1);
    expect(audio.status).toBe("ready");
    const a = audio.noteOn(69),
      b = audio.noteOn(69);
    expect(a).not.toEqual(b);
    await audio.initialize();
    expect(Worklet.instances[0].port.postMessage).toHaveBeenCalledTimes(3);
    await audio.close();
    expect(audio.status).toBe("idle");
  });

  it("reports load failures, closes resources, and permits an explicit retry", async () => {
    Context.failLoad = true;
    const audio = new BrowserAudio();
    await expect(audio.initialize()).rejects.toThrow("Module load failed");
    expect(audio.status).toBe("error");
    expect(Context.instances[0].close).toHaveBeenCalled();
    Context.failLoad = false;
    await audio.initialize();
    expect(audio.status).toBe("ready");
    await audio.close();
  });

  it("does not report a suspended context as ready", async () => {
    Context.resumeState = "suspended";
    const audio = new BrowserAudio();
    await expect(audio.initialize()).rejects.toThrow("suspended");
    expect(audio.noteOn(60)).toBeNull();
  });

  it("resets on interruption, rejects suspended notes and prevents old releases after restart", async () => {
    const audio = new BrowserAudio();
    await audio.initialize();
    const old = audio.noteOn(60)!;
    const context = Context.instances[0],
      node = Worklet.instances[0];
    node.ack();
    context.state = "suspended";
    context.onstatechange?.();
    expect(audio.status).toBe("suspended");
    expect(audio.noteOn(60)).toBeNull();
    await audio.initialize();
    node.ack();
    const fresh = audio.noteOn(60)!;
    expect(fresh.session).toBeGreaterThan(old.session);
    audio.noteOff(old);
    expect(node.port.postMessage).toHaveBeenLastCalledWith({
      type: "note-off",
      ...old,
    });
    await audio.close();
  });

  it("bounds queued messages and clears voices on overload before accepting fresh input", async () => {
    const audio = new BrowserAudio();
    await audio.initialize();
    const node = Worklet.instances[0];
    for (let i = 0; i < 500; i++) audio.noteOn(60);
    expect(node.port.postMessage).toHaveBeenCalledTimes(65);
    expect(node.port.postMessage.mock.calls.at(-1)?.[0].type).toBe("reset");
    for (let i = 0; i < 100; i++) audio.releaseAll();
    expect(node.port.postMessage).toHaveBeenCalledTimes(65);
    node.ack();
    expect(audio.noteOn(60)).not.toBeNull();
    await audio.close();
  });

  it("recovers from processor failure and closes while initialization is pending", async () => {
    const audio = new BrowserAudio();
    await audio.initialize();
    const node = Worklet.instances[0];
    node.onprocessorerror?.();
    expect(audio.status).toBe("error");
    expect(node.disconnect).toHaveBeenCalled();
    await audio.initialize();
    expect(Worklet.instances).toHaveLength(2);
    await audio.close();
    const pending = audio.initialize();
    await audio.close();
    await pending;
    expect(audio.status).toBe("idle");
    expect(Worklet.instances).toHaveLength(2);
  });
});
