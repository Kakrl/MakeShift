import type { Recorder } from "../app/midi/midiUtils";
import { midiToPitch } from "../cv/noteMap";
import type { LiveSession } from "./liveSession";

const recordingVelocity = (velocity: number) => Math.max(1, Math.round(velocity * 100));

/** MIDI and feedback share accepted history, after synchronous audio delivery. */
export function connectPianoConsumers(
  session: LiveSession,
  recorder: Recorder,
  feedback: (pitches: ReadonlySet<number>) => void,
) {
  const active = new Map<string, { pitch: number; velocity: number }>();
  const unsubscribe = session.subscribeNotes(({ event }) => {
    if (event.type === "release-all") {
      active.clear();
      recorder.releaseAllNotes(event.timestampMs);
    } else {
      const identity = `${event.sessionId}:${event.pressId}`;
      const pitch = midiToPitch(event.pitch);
      if (event.type === "note-on") {
        active.set(identity, { pitch: event.pitch, velocity: event.velocity });
        recorder.noteOn(pitch, recordingVelocity(event.velocity), event.timestampMs, identity);
      } else {
        active.delete(identity);
        recorder.noteOff(pitch, event.timestampMs, identity);
      }
    }
    feedback(new Set([...active.values()].map(note => note.pitch)));
  });
  return Object.assign(unsubscribe, {
    /** Call after draining history and opening/resuming the recording boundary. */
    captureHeld(timestampMs = performance.now()) {
      for (const [identity, note] of active) {
        recorder.noteOn(midiToPitch(note.pitch), recordingVelocity(note.velocity), timestampMs, identity);
      }
    },
  });
}
