import {
  trackAudioContext,
  closeTrackedAudioContext,
} from "../../diagnostics/performanceMetrics";

export type MetronomeOutput = {
  prepare(): Promise<boolean>;
  click(accent: boolean): void;
  silence(): void;
  close(): void;
};

// Clicks never enter the musical-event dispatcher or MIDI recorder.
function createClickOutput(): MetronomeOutput {
  let context: AudioContext | null = null;
  const voices = new Map<OscillatorNode, GainNode>();
  function silence() {
    for (const [oscillator, gain] of voices) {
      gain.disconnect();
      oscillator.stop();
      oscillator.disconnect();
    }
    voices.clear();
  }
  return {
    async prepare() {
      try {
        context ??= trackAudioContext(new AudioContext());
        const current = context;
        if (current.state === "suspended") await current.resume();
        return context === current && current.state === "running";
      } catch {
        return false;
      }
    },
    click(accent) {
      if (!context || context.state !== "running")
        throw new Error("Metronome audio unavailable");
      const oscillator = context.createOscillator();
      const gain = context.createGain();
      const now = context.currentTime;
      oscillator.connect(gain);
      gain.connect(context.destination);
      oscillator.type = "sine";
      oscillator.frequency.value = accent ? 1050 : 820;
      gain.gain.setValueAtTime(accent ? 0.65 : 0.38, now);
      gain.gain.exponentialRampToValueAtTime(0.001, now + 0.055);
      voices.set(oscillator, gain);
      oscillator.onended = () => {
        oscillator.disconnect();
        gain.disconnect();
        voices.delete(oscillator);
      };
      oscillator.start(now);
      oscillator.stop(now + 0.06);
    },
    silence,
    close() {
      silence();
      const previous = context;
      context = null;
      if (previous) void closeTrackedAudioContext(previous);
    },
  };
}

type Settings = { tempo: number; beatsPerMeasure: number; audible: boolean };
type Callbacks = {
  onCountInBeat(beat: number): void;
  onCountInComplete(): void;
  onUnavailable(): void;
};

/** One bounded deadline timer for accompaniment and the recording count-in.
 * Deadlines use a monotonic clock; clicks use Web Audio envelopes. Main-thread
 * stalls can delay an onset, so this is not a sample-accurate timing guarantee.
 */
export function createMetronome(
  output: MetronomeOutput = createClickOutput(),
  now = () => performance.now(),
) {
  let settings: Settings = { tempo: 120, beatsPerMeasure: 4, audible: true };
  let callbacks: Callbacks = {
    onCountInBeat() {},
    onCountInComplete() {},
    onUnavailable() {},
  };
  let playing = false;
  let paused = false;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let running = false;
  let generation = 0;
  let nextBeatAt = 0;
  let beatInMeasure = 0;
  let countIn: { beat: number; total: number } | null = null;

  function wanted() {
    return playing && (countIn !== null || (settings.audible && !paused));
  }
  function halt() {
    generation++;
    running = false;
    clearTimeout(timer);
    timer = undefined;
    output.silence();
  }
  function schedule() {
    const current = generation;
    timer = setTimeout(
      () => {
        if (current === generation) tick();
      },
      Math.max(0, nextBeatAt - now()),
    );
  }
  function tick() {
    timer = undefined;
    if (!running || !wanted()) return;
    if (now() < nextBeatAt) {
      schedule();
      return;
    }
    const current = generation;
    if (countIn) {
      if (countIn.beat === countIn.total) {
        countIn = null;
        paused = false;
        beatInMeasure = 0;
        callbacks.onCountInComplete();
      } else {
        beatInMeasure = countIn.beat++;
        callbacks.onCountInBeat(countIn.beat);
      }
    }
    // A callback may synchronously stop/invalidate the session.
    if (current !== generation || !wanted()) {
      reconcile();
      return;
    }
    try {
      if (settings.audible) output.click(beatInMeasure === 0);
    } catch {
      stop();
      callbacks.onUnavailable();
      return;
    }
    beatInMeasure = (beatInMeasure + 1) % settings.beatsPerMeasure;
    const interval = 60_000 / settings.tempo;
    nextBeatAt += interval;
    // Skip missed accompaniment deadlines, never burst catch-up clicks.
    if (nextBeatAt <= now()) nextBeatAt = now() + interval;
    schedule();
  }
  function reconcile() {
    if (!wanted()) {
      if (running) halt();
      return;
    }
    if (running) return;
    running = true;
    beatInMeasure = 0;
    nextBeatAt = now();
    schedule();
  }
  function stop() {
    playing = false;
    countIn = null;
    halt();
  }
  return {
    prepare: () => output.prepare(),
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
      if (!next.audible) output.silence();
      reconcile();
    },
    setAudible(audible: boolean) {
      settings = { ...settings, audible };
      if (!audible) output.silence();
      reconcile();
    },
    setPlaying(active: boolean, recordingPaused = false) {
      playing = active;
      paused = recordingPaused;
      if (!active) countIn = null;
      reconcile();
    },
    beginCountIn() {
      if (!playing) return false;
      halt();
      countIn = { beat: 0, total: settings.beatsPerMeasure };
      reconcile();
      return true;
    },
    cancelCountIn() {
      countIn = null;
      reconcile();
    },
    stop,
    // Reusable after cleanup: StrictMode can attach again to the same owner.
    close() {
      stop();
      output.close();
    },
  };
}
