/** Public wire contract. Times are milliseconds relative to the main performance.timeOrigin. */
type Header = {
  version: 1;
  sessionId: string;
  sequence: number;
  timestampMs: number;
};

export type NoteEvent = Readonly<
  Header &
    (
      | { type: "note-on"; pressId: number; pitch: number; velocity: number }
      | { type: "note-off"; pressId: number; pitch: number }
      | { type: "release-all" }
    )
>;

const positiveInteger = (value: unknown): value is number =>
  typeof value === "number" && Number.isSafeInteger(value) && value > 0;
const finiteTime = (value: unknown): value is number =>
  typeof value === "number" && Number.isFinite(value) && value >= 0;

/** Copy only validated fields; no caller-owned object reaches consumers. */
export function parseNoteEvent(value: unknown): NoteEvent | null {
  if (!value || typeof value !== "object") return null;
  const e = value as Record<string, unknown>;
  if (
    e.version !== 1 ||
    typeof e.sessionId !== "string" ||
    e.sessionId.length === 0 ||
    e.sessionId.length > 128 ||
    !positiveInteger(e.sequence) ||
    !finiteTime(e.timestampMs)
  )
    return null;
  const header: Header = {
    version: 1,
    sessionId: e.sessionId,
    sequence: e.sequence,
    timestampMs: e.timestampMs,
  };
  if (e.type === "release-all")
    return Object.freeze({ ...header, type: e.type });
  if (
    !positiveInteger(e.pressId) ||
    typeof e.pitch !== "number" ||
    !Number.isInteger(e.pitch) ||
    e.pitch < 0 ||
    e.pitch > 127
  )
    return null;
  if (e.type === "note-off")
    return Object.freeze({
      ...header,
      type: e.type,
      pressId: e.pressId,
      pitch: e.pitch,
    });
  if (
    e.type !== "note-on" ||
    typeof e.velocity !== "number" ||
    !Number.isFinite(e.velocity) ||
    e.velocity <= 0 ||
    e.velocity > 1
  )
    return null;
  return Object.freeze({
    ...header,
    type: e.type,
    pressId: e.pressId,
    pitch: e.pitch,
    velocity: e.velocity,
  });
}

/** Capture each realm's timeOrigin once during worker setup, never from each event. */
export function toMainTime(
  timestampMs: number,
  sourceOriginMs: number,
  mainOriginMs: number,
): number {
  if (![timestampMs, sourceOriginMs, mainOriginMs].every(finiteTime))
    throw new RangeError("Invalid clock input");
  const result = timestampMs + (sourceOriginMs - mainOriginMs);
  if (!finiteTime(result))
    throw new RangeError("Event predates main clock origin");
  return result;
}

/** Anchor only while running, and invalidate on every suspension/interruption. */
export class AudioClock {
  private anchor: { mainMs: number; audioSeconds: number } | null = null;
  resume(mainMs: number, audioSeconds: number) {
    if (![mainMs, audioSeconds].every(finiteTime))
      throw new RangeError("Invalid audio anchor");
    this.anchor = { mainMs, audioSeconds };
  }
  suspend() {
    this.anchor = null;
  }
  toSeconds(eventMs: number, currentAudioSeconds: number): number {
    if (!this.anchor) throw new Error("Audio clock is suspended");
    if (![eventMs, currentAudioSeconds].every(finiteTime))
      throw new RangeError("Invalid audio time");
    return Math.max(
      currentAudioSeconds,
      this.anchor.audioSeconds + (eventMs - this.anchor.mainMs) / 1000,
    );
  }
}

/** Recording owns pause policy; excludedPausedMs is paused time preceding this event. */
export function toRecordingMilliseconds(
  eventMs: number,
  startMs: number,
  excludedPausedMs = 0,
): number {
  if (![eventMs, startMs, excludedPausedMs].every(finiteTime))
    throw new RangeError("Invalid recording time");
  return Math.max(0, eventMs - startMs - excludedPausedMs);
}
