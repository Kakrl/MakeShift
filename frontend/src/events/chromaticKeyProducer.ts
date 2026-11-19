import type { LiveSession } from "./liveSession";

// Vision has no motion/force estimate. Use a fixed onset velocity until one is supplied.
export const VISION_VELOCITY = 0.2;

/** One complete chromatic snapshot per frame, with the session ID captured before processing. */
export function createChromaticKeyProducer(session: LiveSession) {
  let owner: string | null = null;
  let press = 0;
  const active = new Map<number, number>();
  return (
    keys: readonly number[],
    timestampMs: number,
    capturedSessionId: string | null,
  ) => {
    const id = session.sessionId;
    if (!id || capturedSessionId !== id) return;
    if (owner !== id) {
      owner = id;
      active.clear();
      press = 0;
    }
    if (
      keys.some(
        (key) =>
          !Number.isInteger(key) ||
          key < 0 ||
          key > 12 * session.layout.octaves,
      )
    ) {
      session.trackingFailed();
      return;
    }
    const current = new Set(keys);
    const start = session.layout.startingMidi;
    for (const [key, pressId] of active) {
      if (current.has(key)) continue;
      const result = session.noteOff(id, pressId, start + key, timestampMs);
      if (result !== "accepted" && result !== "suppressed") return;
      active.delete(key);
    }
    for (const key of current) {
      if (active.has(key)) continue;
      const pressId = ++press;
      const result = session.noteOn(
        id,
        pressId,
        start + key,
        VISION_VELOCITY,
        timestampMs,
      );
      if (result !== "accepted" && result !== "suppressed") return;
      active.set(key, pressId);
    }
  };
}
