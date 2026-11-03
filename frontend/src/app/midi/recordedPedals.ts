import type { PedalState } from "../audio/audioEngine";
import type { RecordedNote } from "./midiUtils";

export const pedalsOff = (): PedalState => ({
  sustain: false,
  sostenuto: false,
  soft: false,
});
const copyState = (s: PedalState): PedalState => ({
  sustain: s.sustain,
  sostenuto: s.sostenuto,
  soft: s.soft,
});
export type RecordedPedals = {
  version: 1;
  events: { timeMs: number; order: number; state: PedalState }[];
  /** Parallel to physical notes, with a separate performance sequence. */
  noteOrder: { on: number; off: number }[];
};
export function validRecordedPedals(
  value: unknown,
  notes: readonly RecordedNote[],
): value is RecordedPedals | undefined {
  if (value === undefined) return true;
  if (!value || typeof value !== "object") return false;
  const v = value as RecordedPedals;
  if (
    v.version !== 1 ||
    !Array.isArray(v.events) ||
    !Array.isArray(v.noteOrder) ||
    v.noteOrder.length !== notes.length
  )
    return false;
  const orders = new Set<number>();
  const add = (order: number) =>
    Number.isSafeInteger(order) &&
    order >= 0 &&
    !orders.has(order) &&
    !!orders.add(order);
  let lastTime = -1,
    lastOrder = -1;
  for (const event of v.events) {
    if (
      !event ||
      !Number.isFinite(event.timeMs) ||
      event.timeMs < 0 ||
      event.timeMs < lastTime ||
      event.order <= lastOrder ||
      !add(event.order) ||
      !event.state ||
      [event.state.sustain, event.state.sostenuto, event.state.soft].some(
        (x) => typeof x !== "boolean",
      )
    )
      return false;
    lastTime = event.timeMs;
    lastOrder = event.order;
  }
  return v.noteOrder.every(
    (pair) => pair && add(pair.on) && add(pair.off) && pair.off > pair.on,
  );
}
export function copyPedals(
  value: RecordedPedals | undefined,
): RecordedPedals | undefined {
  return (
    value && {
      version: 1,
      events: value.events.map((e) => ({
        timeMs: e.timeMs,
        order: e.order,
        state: copyState(e.state),
      })),
      noteOrder: value.noteOrder.map((p) => ({ on: p.on, off: p.off })),
    }
  );
}
export type PerformanceBoundary = { time: number; order: number } & (
  | { kind: "on" | "off"; index: number }
  | { kind: "pedal"; state: PedalState }
);
export function performanceBoundaries(
  notes: readonly RecordedNote[],
  pedals?: RecordedPedals,
): PerformanceBoundary[] {
  if (!validRecordedPedals(pedals, notes))
    throw new RangeError("Invalid recorded pedals");
  if (
    notes.some(
      (n) =>
        !n ||
        ![n.startMs, n.durationMs, n.velocity, n.startMs + n.durationMs].every(
          Number.isFinite,
        ) ||
        n.startMs < 0 ||
        n.durationMs < 0 ||
        n.velocity < 0 ||
        n.velocity > 100,
    )
  )
    throw new RangeError("Invalid recorded note");
  const result: PerformanceBoundary[] = notes.flatMap((n, index) => [
    {
      time: n.startMs,
      order: pedals?.noteOrder[index].on ?? index * 2 + 1,
      kind: "on" as const,
      index,
    },
    {
      time: n.startMs + n.durationMs,
      order: pedals?.noteOrder[index].off ?? index * 2,
      kind: "off" as const,
      index,
    },
  ]);
  for (const e of pedals?.events ?? [])
    result.push({
      time: e.timeMs,
      order: e.order,
      kind: "pedal",
      state: copyState(e.state),
    });
  return result.sort(
    (a, b) =>
      a.time - b.time ||
      (pedals
        ? a.order - b.order
        : Number(a.kind === "on") - Number(b.kind === "on") ||
          a.order - b.order),
  );
}
