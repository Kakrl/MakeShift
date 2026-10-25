import {
  trackAudioContext,
  closeTrackedAudioContext,
} from "../../diagnostics/performanceMetrics";

type Settings = { tempo: number; beatsPerMeasure: number; audible: boolean };
type Callbacks = {
  onCountInBeat(beat: number): void;
  onCountInComplete(): void;
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
) {
  let context: AudioContext | null = null;
  let node: AudioWorkletNode | null = null;
  let pending: Promise<boolean> | null = null;
  let generation = 0;
  let settings: Settings = { tempo: 120, beatsPerMeasure: 4, audible: true };
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
      audible: settings.audible,
    });
  }
  function stop() {
    generation++;
    playing = false;
    counting = false;
    send("stop");
  }
  function prepare(): Promise<boolean> {
    if (pending) return pending;
    let owner: AudioContext;
    try {
      owner = context ??= trackAudioContext(createContext());
    } catch {
      return Promise.resolve(false);
    }
    // Resume synchronously from the gesture, before awaiting module loading.
    const resumed =
      owner.state === "suspended" ? owner.resume() : Promise.resolve();
    const task = (async () => {
      try {
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
            if (data.type === "complete" && counting) {
              counting = false;
              paused = false;
              callbacks.onCountInComplete();
            } else if (counting && data.beat !== null)
              callbacks.onCountInBeat(data.beat);
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
        return owner.state === "running";
      } catch {
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
        next.beatsPerMeasure > 16
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
      counting = true;
      send("count-in");
      return true;
    },
    cancelCountIn() {
      generation++;
      counting = false;
      send("cancel-count-in");
    },
    stop,
    close() {
      stop();
      const previous = context;
      context = null;
      pending = null;
      if (node) {
        node.port.onmessage = null;
        node.port.close();
        node.disconnect();
        node = null;
      }
      if (previous) {
        previous.onstatechange = null;
        void closeTrackedAudioContext(previous);
      }
    },
  };
}
