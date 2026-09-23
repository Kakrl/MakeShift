import { BrowserAudio } from "../app/audio/audioEngine";
import { NoteSession } from "./noteSession";

/** Attach one shared session owner to one BrowserAudio instance after initialize(). */
export function createAudioSession(audio: BrowserAudio, now?: () => number) {
  const tokens = new Map<number, { session: number; press: number }>();
  const session = new NoteSession(({ event }) => {
    if (event.type === "release-all") {
      tokens.clear();
      audio.releaseAll();
      return true;
    }
    if (event.type === "note-on") {
      const token = audio.noteOn(event.pitch, event.velocity);
      if (!token) return false;
      tokens.set(event.pressId, token);
      return true;
    }
    const token = tokens.get(event.pressId);
    tokens.delete(event.pressId);
    return token !== undefined && audio.noteOff(token);
  }, now);
  const unsubscribe = audio.subscribeInvalidation(() => session.interrupt());
  return {
    session,
    dispose() {
      session.stop();
      unsubscribe();
    },
  };
}
