import { performanceBoundaries, pedalsOff } from "./recordedPedals";
import { browserAudio, type BrowserAudio } from "../audio/audioEngine";
import { pitchToMidi } from "../../cv/noteMap";
import type { Recording } from "./midiUtils";

type AudioToken = NonNullable<ReturnType<BrowserAudio["noteOn"]>>;
export type PlaybackAudio = Pick<
  BrowserAudio,
  "initialize" | "noteOn" | "noteOff" | "subscribeInvalidation"
> & Partial<Pick<BrowserAudio, "setPedals" | "silencePlayback" | "claimPlayback">>;
export type PlaybackState =
  | "stopped"
  | "loading"
  | "playing"
  | "paused"
  | "ended"
  | "disposed";
type Note = { pitch: number; velocity: number; start: number; end: number };
type Span = { clock: number; position: number; rate: number; until: number };

function pitchNumber(pitch: string): number {
  const value = pitchToMidi(pitch);
  if (value === null) throw new RangeError(`Invalid pitch: ${pitch}`);
  return value;
}

/** A recording-time clock and one deadline timer, independent of React and live CV.
 * Call play() from a user gesture; dispose() when the owning view is removed.
 */
export function createPlaybackTimeline(
  recording: Recording,
  audio: PlaybackAudio = browserAudio,
) {
  if (!Number.isFinite(recording.bpm) || recording.bpm <= 0)
    throw new RangeError("Recording BPM must be positive");
  const bpm = recording.bpm;
  // Own a normalized snapshot; editing the source take cannot change queued notes.
  const notes: Note[] = recording.notes.map((note) => {
    const end = note.startMs + note.durationMs;
    if (
      ![note.startMs, note.durationMs, end, note.velocity].every(
        Number.isFinite,
      ) ||
      note.startMs < 0 ||
      note.durationMs < 0 ||
      note.velocity < 0 ||
      note.velocity > 100
    )
      throw new RangeError("Invalid recorded note timing or velocity");
    return {
      pitch: pitchNumber(note.pitch),
      velocity: note.velocity / 100,
      start: note.startMs,
      end,
    };
  });
  const boundaries = performanceBoundaries(recording.notes, recording.pedals);
  const hasPedals = !!recording.pedals;
  if (hasPedals && (!audio.setPedals || !audio.silencePlayback)) throw new RangeError("Pedal playback requires pedal audio transport");
  const durationMs = boundaries.reduce((end, e) => Math.max(end, e.time), 0);
  const active = new Map<number, AudioToken>();
  let ownsAudio = false;
  let state: PlaybackState = "stopped";
  let position = 0;
  let anchor = 0;
  let rate = 1;
  let cursor = 0;
  let generation = 0;
  let error: string | null = null;
  let timer: ReturnType<typeof setTimeout> | undefined;
  const spans: Span[] = [];

  function positionMs() {
    return state === "playing"
      ? Math.min(
          durationMs,
          position + Math.max(0, performance.now() - anchor) * rate,
        )
      : position;
  }

  function openSpan() {
    spans.push({ clock: anchor, position, rate, until: Infinity });
    if (spans.length > 32) spans.shift();
  }

  function closeSpan(clockMs: number) {
    const last = spans[spans.length - 1];
    if (last && last.until === Infinity) last.until = clockMs;
  }

  function positionAtMs(clockMs: number): number | null {
    for (let index = spans.length - 1; index >= 0; index--) {
      const span = spans[index];
      if (clockMs >= span.clock && clockMs < span.until)
        return Math.min(
          durationMs,
          span.position + (clockMs - span.clock) * span.rate,
        );
    }
    return null;
  }

  function cancelTimer() {
    clearTimeout(timer);
    timer = undefined;
    generation++;
  }

  function releaseNotes() {
    const tokens = [...active.values()];
    active.clear();
    if (hasPedals) {
      const owned = ownsAudio;
      ownsAudio = false;
      if (!owned) return;
      try { if (!audio.silencePlayback!()) error ??= "Audio rejected emergency silence"; } catch { error ??= "Audio failed emergency silence"; }
      return;
    }
    for (const token of tokens) {
      try {
        if (!audio.noteOff(token)) error ??= "Audio rejected a note release";
      } catch {
        error ??= "Audio failed to release a note";
      }
    }
  }

  function pause() {
    if (state === "disposed") return;
    if (state === "playing") closeSpan(performance.now());
    position = positionMs();
    state = "paused";
    cancelTimer();
    releaseNotes();
  }

  function fail(message: string) {
    error = message;
    pause();
  }

  const unsubscribe = audio.subscribeInvalidation(() => {
    // Initialization resets the transport too; no playback exists until it resolves.
    if (state === "playing") {
      ownsAudio = false;
      fail("Audio was interrupted; select Play to retry");
    }
  });

  function startNote(index: number) {
    const note = notes[index];
    const ticket = generation;
    const token = audio.noteOn(note.pitch, note.velocity);
    if (!token) {
      fail("Audio rejected a playback note");
      return;
    }
    if (ticket !== generation || state !== "playing") {
      audio.noteOff(token);
      return;
    }
    active.set(index, token);
  }

  function tick() {
    if (state !== "playing") return;
    try {
      const now = positionMs();
      while (cursor < boundaries.length && boundaries[cursor].time <= now) {
        const event = boundaries[cursor++];
        if (event.kind === "pedal") {
          if (!audio.setPedals!(event.state)) fail("Audio rejected playback pedals");
        } else if (event.kind === "on") {
          // Skip missed strikes once the key would be up, even under sustain.
          // An already dispatched strike still receives its release and can ring under pedals.
          if (notes[event.index].end > now && notes[event.index].velocity > 0) startNote(event.index);
        } else {
          const token = active.get(event.index);
          active.delete(event.index);
          if (token && !audio.noteOff(token))
            fail("Audio rejected a note release");
        }
        if (state !== "playing") return;
      }
      if (now >= durationMs) {
        closeSpan(performance.now());
        position = durationMs;
        state = "ended";
        cancelTimer();
        releaseNotes();
        return;
      }
      const deadline = boundaries[cursor]?.time ?? durationMs;
      const ticket = generation;
      timer = setTimeout(
        () => {
          if (ticket !== generation) return;
          timer = undefined;
          tick();
        },
        Math.min(2_147_483_647, Math.max(1, (deadline - positionMs()) / rate)),
      );
    } catch (cause) {
      fail(cause instanceof Error ? cause.message : "Playback audio failed");
    }
  }

  function begin() {
    ownsAudio = true;
    anchor = performance.now();
    state = "playing";
    openSpan();
    cursor = 0;
    while (cursor < boundaries.length && boundaries[cursor].time < position)
      cursor++;
    try {
      // Reconstruct only physical presses, never released pedal tails. Simulate
      // history in memory so a long seek cannot flood the bounded audio port.
      let pedals = pedalsOff();
      const held = new Map<number, { soft: boolean; captured: boolean; held: boolean }>();
      for (const event of boundaries) {
        if (event.time >= position) break;
        if (event.kind === "pedal") {
          if (!pedals.sostenuto && event.state.sostenuto) for (const value of held.values()) value.captured = value.held;
          if (!event.state.sostenuto) for (const value of held.values()) value.captured = false;
          pedals = event.state;
          for (const [index, value] of held) if (!value.held && !(pedals.sustain || value.captured)) held.delete(index);
        } else if (event.kind === "on" && notes[event.index].velocity > 0) {
          if (hasPedals && held.size >= 10) held.delete(held.keys().next().value!);
          held.set(event.index, { soft: pedals.soft, captured: false, held: true });
        } else if (event.kind === "off") {
          const value = held.get(event.index);
          if (value) { value.held = false; if (!(pedals.sustain || value.captured)) held.delete(event.index); }
        }
      }
      if (hasPedals) {
        // Keep the most recent ten held strikes, matching the fixed voice budget.
        const voices = [...held].filter(([, value]) => value.held).slice(-10);
        const send = (value: typeof pedals) => { if (!audio.setPedals!(value)) throw new Error("Audio rejected pedal restoration"); };
        send(pedalsOff());
        for (const captured of [true, false]) {
          for (const [index, value] of voices) {
            if (value.captured !== captured || notes[index].end <= position) continue;
            send({ sustain: false, sostenuto: !captured && pedals.sostenuto, soft: value.soft });
            startNote(index);
            if (state !== "playing") return;
          }
          if (captured && pedals.sostenuto) send({ ...pedals, sustain: false });
        }
        send(pedals);
      } else {
        for (const index of held.keys()) {
          if (notes[index].end > position && held.get(index)?.held) startNote(index);
          if (state !== "playing") return;
        }
      }
      tick();
    } catch (cause) {
      fail(cause instanceof Error ? cause.message : "Playback audio failed");
    }
  }

  return {
    getSnapshot() {
      return {
        state,
        positionMs: positionMs(),
        durationMs,
        playbackRate: rate,
        bpm: bpm * rate,
        error,
      };
    },

    /** Song position at a performance.now() timestamp, or null if not playing then. */
    positionAt: positionAtMs,

    async play(): Promise<boolean> {
      if (state === "disposed") return false;
      if (state === "playing") return true;
      if (state === "loading") return false;
      cancelTimer();
      const ticket = generation;
      state = "loading";
      error = null;
      try {
        await audio.initialize();
        if (ticket !== generation) return false;
        if (audio.claimPlayback && !audio.claimPlayback()) { fail("Audio playback ownership unavailable"); return false; }
        if (ticket !== generation) return false;
        if (position >= durationMs) position = 0;
        begin();
        return error === null;
      } catch (cause) {
        if (ticket === generation)
          fail(
            cause instanceof Error
              ? cause.message
              : "Audio initialization failed",
          );
        return false;
      }
    },

    pause,

    stop() {
      if (state === "disposed") return;
      pause();
      position = 0;
      state = "stopped";
    },

    seek(milliseconds: number) {
      if (!Number.isFinite(milliseconds))
        throw new RangeError("Seek position must be finite");
      if (state === "disposed") return;
      const resume = state === "playing";
      pause();
      position = Math.max(0, Math.min(durationMs, milliseconds));
      if (resume) begin();
    },

    setPlaybackRate(value: number) {
      if (!Number.isFinite(value) || value < 0.25 || value > 4)
        throw new RangeError("Playback rate must be between 0.25 and 4");
      if (state === "disposed") return;
      position = positionMs();
      anchor = performance.now();
      rate = value;
      if (state === "playing") {
        closeSpan(anchor);
        openSpan();
        cancelTimer();
        tick();
      }
    },

    dispose() {
      if (state === "disposed") return;
      pause();
      unsubscribe();
      state = "disposed";
    },
  };
}

export type PlaybackTimeline = ReturnType<typeof createPlaybackTimeline>;
