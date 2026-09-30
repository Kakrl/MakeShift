import { keyIndexToMidi } from "../cv/noteMap";
import type { LiveSession } from "./liveSession";

export type KeyPress = Readonly<{ keyIndex: number; velocity: number }>;

/** One producer belongs to one session; delayed callbacks cannot adopt a new ID.
 * Contact classification belongs upstream (#34/#29), not in pitch mapping. */
export function createKeyEventProducer(session: LiveSession, sessionId: string) {
  let press = 0;
  const keys = new Map<number, number>();
  return (pressed: readonly KeyPress[], released: readonly number[], timestampMs: number) => {
    if (session.sessionId !== sessionId) return;
    for (const keyIndex of released) {
      const pitch = keyIndexToMidi(keyIndex);
      const pressId = keys.get(keyIndex);
      if (pitch === null || pressId === undefined) continue;
      const result = session.noteOff(sessionId, pressId, pitch, timestampMs);
      if (result !== "accepted") return;
      keys.delete(keyIndex);
    }
    for (const { keyIndex, velocity } of pressed) {
      const pitch = keyIndexToMidi(keyIndex);
      if (pitch === null || keys.has(keyIndex)) continue;
      const pressId = ++press;
      const result = session.noteOn(sessionId, pressId, pitch, velocity, timestampMs);
      if (result !== "accepted") return;
      keys.set(keyIndex, pressId);
    }
  };
}
