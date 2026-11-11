import type { FallingNote } from "../../cv/fallingNotes";
import { FALL_LEAD_MS } from "../../cv/fallingNotes";
import type { KeyboardLayout } from "../../cv/keyboardLayout";
import { pitchToMidi } from "../../cv/noteMap";
import type { NoteEvent } from "../../events/noteEvents";
import type { Recording } from "./midiUtils";
import { createPlaybackTimeline, type PlaybackAudio, type PlaybackTimeline } from "./playbackTimeline";
import { createScorer, type Scorer } from "./playAlongScore";

/** One song falling toward the keyboard (#131), on its own playback timeline. */
export type PlayAlong = Readonly<{
  title: string;
  notes: readonly FallingNote[];
  timeline: PlaybackTimeline;
  score: Scorer;
}>;

// The player makes the sound; the timeline only keeps time.
const silentAudio: PlaybackAudio = {
  initialize: async () => {},
  noteOn: () => ({ session: 0, press: 0 }),
  noteOff: () => true,
  subscribeInvalidation: () => () => {},
};

/** Shifts the song by one fall so its first notes start at the top of the frame. */
export function createPlayAlong(
  recording: Recording,
  audio: PlaybackAudio = silentAudio,
  layout?: KeyboardLayout,
): PlayAlong {
  const shifted = {
    ...recording,
    notes: recording.notes.map((note) => ({ ...note, startMs: note.startMs + FALL_LEAD_MS })),
  };
  const notes = shifted.notes.flatMap((note) => {
    const midi = pitchToMidi(note.pitch);
    return midi === null ? [] : [{ midi, startMs: note.startMs, endMs: note.startMs + note.durationMs }];
  });
  // Notes off the printed keyboard cannot be played, so they are not scored.
  const playable = layout
    ? notes.filter((note) => note.midi >= layout.startingMidi && note.midi <= layout.startingMidi + 12 * layout.octaves)
    : notes;
  return Object.freeze({
    title: recording.name,
    notes,
    timeline: createPlaybackTimeline(shifted, audio),
    score: createScorer(playable),
  });
}

let current: PlayAlong | null = null;
const listeners = new Set<() => void>();
const emit = () => listeners.forEach((listener) => listener());

export const getPlayAlong = () => current;

export function subscribePlayAlong(listener: () => void) {
  listeners.add(listener);
  return () => void listeners.delete(listener);
}

export function startPlayAlong(recording: Recording, layout?: KeyboardLayout) {
  current?.timeline.dispose();
  current = createPlayAlong(recording, silentAudio, layout);
  void current.timeline.play();
  emit();
}

export function pausePlayAlong() {
  current?.timeline.pause();
}

export function stopPlayAlong() {
  if (!current) return;
  current.timeline.dispose();
  current = null;
  emit();
}

/** Feeds a live note event to the song's score while the song is playing. */
export function scorePlayAlongPress(event: NoteEvent) {
  if (event.type !== "note-on" || !current) return;
  if (current.timeline.getSnapshot().state !== "playing") return;
  current.score.press(event.pitch, current.timeline.positionAt(event.timestampMs));
}
