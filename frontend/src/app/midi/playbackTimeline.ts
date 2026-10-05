import { browserAudio, type BrowserAudio } from "../audio/audioEngine";
import type { Recording } from "./midiUtils";

type AudioToken = NonNullable<ReturnType<BrowserAudio["noteOn"]>>;
export type PlaybackAudio = Pick<
  BrowserAudio,
  "initialize" | "noteOn" | "noteOff" | "subscribeInvalidation"
>;
export type PlaybackState =
  | "stopped"
  | "loading"
  | "playing"
  | "paused"
  | "ended"
  | "disposed";
type Note = { pitch: number; velocity: number; start: number; end: number };
type Boundary = { time: number; index: number; on: boolean };

function pitchNumber(pitch: string): number {
  const match = /^([A-G])([#b]?)(-?\d+)$/.exec(pitch);
  if (!match) throw new RangeError(`Invalid pitch: ${pitch}`);
  const semitones: Record<string, number> = {
    C: 0,
    D: 2,
    E: 4,
    F: 5,
    G: 7,
    A: 9,
    B: 11,
  };
  const semitone = semitones[match[1]];
  const value =
    (Number(match[3]) + 1) * 12 +
    semitone +
    (match[2] === "#" ? 1 : match[2] === "b" ? -1 : 0);
  if (!Number.isInteger(value) || value < 0 || value > 127)
    throw new RangeError(`Pitch outside MIDI range: ${pitch}`);
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
  const durationMs = notes.reduce((end, note) => Math.max(end, note.end), 0);
  const boundaries: Boundary[] = notes
    .flatMap((note, index) =>
      note.start === note.end || note.velocity === 0
        ? []
        : [
            { time: note.start, index, on: true },
            { time: note.end, index, on: false },
          ],
    )
    .sort(
      (a, b) =>
        a.time - b.time || Number(a.on) - Number(b.on) || a.index - b.index,
    );
  const active = new Map<number, AudioToken>();
  let state: PlaybackState = "stopped";
  let position = 0;
  let anchor = 0;
  let rate = 1;
  let cursor = 0;
  let generation = 0;
  let error: string | null = null;
  let timer: ReturnType<typeof setTimeout> | undefined;

  function positionMs() {
    return state === "playing"
      ? Math.min(
          durationMs,
          position + Math.max(0, performance.now() - anchor) * rate,
        )
      : position;
  }

  function cancelTimer() {
    clearTimeout(timer);
    timer = undefined;
    generation++;
  }

  function releaseNotes() {
    const tokens = [...active.values()];
    active.clear();
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
    if (state === "playing")
      fail("Audio was interrupted; select Play to retry");
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
        if (event.on) {
          // A delayed timer must not replay a burst of notes already finished.
          if (notes[event.index].end > now) startNote(event.index);
        } else {
          const token = active.get(event.index);
          active.delete(event.index);
          if (token && !audio.noteOff(token))
            fail("Audio rejected a note release");
        }
        if (state !== "playing") return;
      }
      if (now >= durationMs) {
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
    anchor = performance.now();
    state = "playing";
    cursor = 0;
    while (cursor < boundaries.length && boundaries[cursor].time < position)
      cursor++;
    try {
      // Resume/seek rearticulates notes spanning the new position for their remainder.
      for (let index = 0; index < notes.length; index++) {
        const note = notes[index];
        if (note.start < position && note.end > position && note.velocity > 0)
          startNote(index);
        if (state !== "playing") return;
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
