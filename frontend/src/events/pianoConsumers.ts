import type { Recorder } from "../app/midi/midiUtils";
import { midiToPitch } from "../cv/noteMap";
import type { LiveSession } from "./liveSession";

/** MIDI and feedback share accepted history, after synchronous audio delivery. */
export function connectPianoConsumers(
  session: LiveSession,
  recorder: Recorder,
  feedback: (pitches: ReadonlySet<number>) => void,
) {
  const active = new Map<string, number>();
  const unsubscribe = session.subscribeNotes(({ event }) => {
    if (event.type === "release-all") {
      active.clear();
      recorder.releaseAllNotes(event.timestampMs);
    } else {
      const identity = `${event.sessionId}:${event.pressId}`;
      const pitch = midiToPitch(event.pitch);
      if (event.type === "note-on") {
        active.set(identity, event.pitch);
        recorder.noteOn(pitch, event.velocity * 100, event.timestampMs, identity);
      } else {
        active.delete(identity);
        recorder.noteOff(pitch, event.timestampMs, identity);
      }
    }
    feedback(new Set(active.values()));
  });
  return unsubscribe;
}
