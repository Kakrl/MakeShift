import {
  trackAudioContext,
  closeTrackedAudioContext,
} from "../../diagnostics/performanceMetrics";

type Settings = { tempo: number; beatsPerMeasure: number; denominator?: number; audible: boolean };
type Callbacks = {
  onCountInBeat(beat: number): void;
  onCountInComplete(boundaryMs: number): void;
  onUnavailable(): void;
};

/** Owns a separate click graph: no musical events or recorded MIDI notes. */
export function createMetronome(
  createContext = () => new AudioContext(),
  createNode = (context: AudioContext) =>
    new AudioWorkletNode(context, "makeshift-metronome", {
      numberOfInputs: 0,
      numberOfOutputs: 1,
      outputChannelCount: [1],
    }),
  frames = {
    request: (callback: FrameRequestCallback) => requestAnimationFrame(callback),
    cancel: (id: number) => cancelAnimationFrame(id),
  },
) {
  let context: AudioContext | null = null;
  let node: AudioWorkletNode | null = null;
  let pending: Promise<boolean> | null = null;
  let generation = 0;
  let visualFrame: number | null = null;
  let timeline: { start: number; interval: number; beats: number; rate: number } | null = null;
  let displayedBeat: number | null = null;
  let settings: Settings = { tempo: 120, beatsPerMeasure: 4, audible: false };
  let callbacks: Callbacks = {
    onCountInBeat() {},
    onCountInComplete() {},
    onUnavailable() {},
  };
  let playing = false,
    paused = false,
    counting = false;
  function send(type: string, fields: object = {}) {
    node?.port.postMessage({ type, generation, ...fields });
  }
  function configure() {
    send("configure", {
      tempo: settings.tempo,
      beats: settings.beatsPerMeasure,
      denominator: settings.denominator ?? 4,
      audible: settings.audible,
    });
  }
  function stop() {
    generation++;
    cancelVisuals();
    playing = false;
    counting = false;
    send("stop");
  }
  function cancelVisuals() {
    if (visualFrame !== null) frames.cancel(visualFrame);
    visualFrame = null;
    timeline = null;
    displayedBeat = null;
  }
  function updateCountIn(owner: AudioContext) {
    if (context !== owner || !playing || !counting || !timeline) return;
    const now = performance.now();
    const { contextTime = NaN, performanceTime = NaN } = owner.getOutputTimestamp?.() ?? {};
    const outputReady = Number.isFinite(contextTime) &&
      Number.isFinite(performanceTime) && performanceTime > 0;
    const audio = outputReady ? contextTime : owner.currentTime;
    const main = outputReady ? performanceTime : now;
    const position = audio;
    const end = Math.ceil(timeline.start + timeline.interval * timeline.beats - 1e-7) / timeline.rate;
    if (position >= end) {
      const boundaryMs = main + (end - audio) * 1000;
      counting = false;
      paused = false;
      cancelVisuals();
      callbacks.onCountInComplete(boundaryMs);
      return;
    }
    if (position >= timeline.start / timeline.rate) {
      const beat = Math.min(timeline.beats,
        Math.floor((position * timeline.rate - timeline.start) / timeline.interval + 1e-7) + 1);
      if (beat !== displayedBeat) {
        displayedBeat = beat;
        callbacks.onCountInBeat(beat);
      }
    }
    if (visualFrame === null) {
      const version = generation;
      const id = frames.request(() => {
        if (visualFrame !== id || version !== generation || context !== owner) return;
        visualFrame = null;
        updateCountIn(owner);
      });
      visualFrame = id;
    }
  }
  function releaseContext(owner: AudioContext) {
    // A retired preparation must not release a newer attempt's resources.
    if (context !== owner) return;
    stop();
    context = null;
    owner.onstatechange = null;
    if (node) {
      node.port.onmessage = null;
      node.onprocessorerror = null;
      node.port.close();
      node.disconnect();
      node = null;
    }
    void closeTrackedAudioContext(owner);
  }
  function prepare(): Promise<boolean> {
    if (pending) return pending;
    let owner: AudioContext;
    try {
      owner = context ??= trackAudioContext(createContext());
    } catch {
      return Promise.resolve(false);
    }
    const task = (async () => {
      try {
        // Resume synchronously from the gesture, before awaiting module loading.
        const resumed =
          owner.state === "suspended" ? owner.resume() : Promise.resolve();
        await resumed;
        if (context !== owner) return false;
        if (!node) {
          await owner.audioWorklet.addModule("/audio/metronome-worklet.js");
          if (context !== owner) return false;
          const created = createNode(owner);
          node = created;
          created.port.onmessage = ({ data }) => {
            if (node !== created || data.generation !== generation || !playing)
              return;
            if (!counting) return;
            if (!timeline && Number.isFinite(data.countStartFrame) && data.countStartFrame >= 0 &&
              Number.isFinite(data.countIntervalFrames) && data.countIntervalFrames > 0 &&
              Number.isFinite(data.rate) && data.rate > 0 &&
              Number.isInteger(data.countTotal) && data.countTotal >= 1 && data.countTotal <= 32) {
              timeline = { start: data.countStartFrame,
                interval: data.countIntervalFrames, beats: data.countTotal, rate: data.rate };
            }
            updateCountIn(owner);
          };
          created.onprocessorerror = () => {
            if (node === created) {
              stop();
              created.port.onmessage = null;
              created.port.close();
              created.disconnect();
              node = null;
              callbacks.onUnavailable();
            }
          };
          created.connect(owner.destination);
          configure();
          send("playing", { active: playing, paused });
          owner.onstatechange = () => {
            if (context === owner && owner.state !== "running" && playing) {
              stop();
              callbacks.onUnavailable();
            }
          };
        }
        if (owner.state !== "running") {
          releaseContext(owner);
          return false;
        }
        return true;
      } catch {
        releaseContext(owner);
        return false;
      }
    })();
    pending = task;
    void task.finally(() => {
      if (pending === task) pending = null;
    });
    return task;
  }
  return {
    prepare,
    configure(next: Settings, nextCallbacks: Callbacks) {
      if (
        !Number.isFinite(next.tempo) ||
        next.tempo < 20 ||
        next.tempo > 300 ||
        !Number.isInteger(next.beatsPerMeasure) ||
        next.beatsPerMeasure < 1 ||
        next.beatsPerMeasure > 32 ||
        ![1, 2, 4, 8, 16, 32].includes(next.denominator ?? 4)
      )
        throw new Error("Invalid metronome settings");
      settings = next;
      callbacks = nextCallbacks;
      configure();
    },
    setAudible(audible: boolean) {
      settings = { ...settings, audible };
      configure();
    },
    setPlaying(active: boolean, recordingPaused = false) {
      if (!active) {
        stop();
        return;
      }
      playing = true;
      paused = recordingPaused;
      send("playing", { active, paused });
    },
    beginCountIn() {
      if (!playing || !node) return false;
      generation++;
      cancelVisuals();
      counting = true;
      send("count-in");
      return true;
    },
    cancelCountIn() {
      generation++;
      cancelVisuals();
      counting = false;
      send("cancel-count-in");
    },
    stop,
    close() {
      if (context) releaseContext(context);
      else stop();
      pending = null;
    },
  };
}
