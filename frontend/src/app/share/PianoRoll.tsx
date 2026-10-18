"use client";

import { useCallback, useEffect, useImperativeHandle, useMemo, useRef, type Ref } from "react";
import { pitchToMidi } from "../../cv/noteMap";
import type { RecordedNote } from "../midi/midiUtils";
import type { PlaybackTimeline } from "../midi/playbackTimeline";
import { formatDuration } from "./mockShareStore";

const ROW = 10;
// The deep rainbow fills (yellow-strong, not bright yellow) so every color
// stays visible on the white roll.
const NOTE_COLORS = [
  "var(--color-red)",
  "var(--color-yellow-strong)",
  "var(--color-green)",
  "var(--color-blue)",
  "var(--color-purple)",
];
const KEY_STEP_MS = 1000;
/** Roll height, shared with the loading placeholder so nothing shifts when notes arrive. */
export const ROLL_HEIGHT = "h-[clamp(120px,22vw,200px)]";
export const ROLL_MIN_HEIGHT = "min-h-[140px]";
/** The roll is always white paper, like the printed sheet's keys. */
export const ROLL_PAPER = { background: "var(--color-white)" } as const;

export type PianoRollHandle = { draw(): void };

/**
 * Notes over time with a playhead. The playhead and lit notes are written
 * straight to the DOM by `draw()`, so playback never re-renders React.
 * Dragging seeks 1:1 under the pointer; arrow keys step by a second.
 */
export default function PianoRoll({
  notes,
  timeline,
  fill = false,
  ref,
}: {
  notes: readonly RecordedNote[];
  timeline: PlaybackTimeline;
  /** Grow to fill a flex column instead of using the fixed roll height. */
  fill?: boolean;
  ref?: Ref<PianoRollHandle>;
}) {
  const rollRef = useRef<HTMLDivElement>(null);
  const playheadRef = useRef<HTMLDivElement>(null);
  const timeRef = useRef<HTMLSpanElement>(null);
  const rectRefs = useRef<(SVGRectElement | null)[]>([]);
  const durationMs = timeline.getSnapshot().durationMs;

  const layout = useMemo(() => {
    const midi = notes.map((note) => pitchToMidi(note.pitch) ?? 60);
    // An empty take still draws an empty roll around middle C.
    const low = Math.min(60, ...midi) - 1;
    const high = Math.max(60, ...midi) + 1;
    // A faint line under every C marks the octaves, like the printed sheet.
    const octaveLines: number[] = [];
    for (let m = low; m <= high; m++) if (m % 12 === 0) octaveLines.push((high - m + 1) * ROW);
    return {
      rows: high - low + 1,
      octaveLines,
      notes: notes.map((note, index) => ({
        x: note.startMs,
        width: Math.max(note.durationMs, durationMs / 400),
        y: (high - midi[index]) * ROW,
        // Color by pitch class, so every C is the same color.
        color: NOTE_COLORS[(((midi[index] % 12) + 12) % 12) % NOTE_COLORS.length],
      })),
    };
  }, [notes, durationMs]);

  // Writes the playhead, time and lit notes straight to the DOM. The player
  // calls this each frame only while playing; a seek or pause draws once.
  const draw = useCallback(() => {
    const { positionMs } = timeline.getSnapshot();
    const progress = durationMs > 0 ? positionMs / durationMs : 0;
    if (playheadRef.current) playheadRef.current.style.transform = `translateX(${progress * 100}%)`;
    if (timeRef.current) timeRef.current.textContent = formatDuration(positionMs);
    rollRef.current?.setAttribute("aria-valuenow", String(Math.round(positionMs)));
    rollRef.current?.setAttribute("aria-valuetext", formatDuration(positionMs));
    notes.forEach((note, index) => {
      const lit = positionMs >= note.startMs && positionMs < note.startMs + note.durationMs;
      rectRefs.current[index]?.setAttribute("opacity", lit ? "1" : "0.45");
    });
  }, [timeline, notes, durationMs]);

  useImperativeHandle(ref, () => ({ draw }), [draw]);
  useEffect(draw, [draw]);

  function seekToPointer(clientX: number) {
    const box = rollRef.current?.getBoundingClientRect();
    if (!box || box.width === 0) return;
    const ratio = Math.min(1, Math.max(0, (clientX - box.left) / box.width));
    timeline.seek(ratio * durationMs);
    draw();
  }

  return (
    <div className={fill ? "flex min-h-0 flex-1 flex-col" : ""}>
      <div
        ref={rollRef}
        role="slider"
        tabIndex={0}
        aria-label="Song position"
        aria-valuemin={0}
        aria-valuemax={Math.round(durationMs)}
        aria-valuenow={0}
        style={ROLL_PAPER}
        className={`ms-roll relative overflow-hidden ${fill ? `flex-1 ${ROLL_MIN_HEIGHT}` : ROLL_HEIGHT}`}
        onPointerDown={(event) => {
          // Seek on press, not release, and keep tracking outside the roll.
          event.currentTarget.setPointerCapture(event.pointerId);
          seekToPointer(event.clientX);
        }}
        onPointerMove={(event) => {
          if (event.currentTarget.hasPointerCapture(event.pointerId)) seekToPointer(event.clientX);
        }}
        onKeyDown={(event) => {
          const { positionMs } = timeline.getSnapshot();
          const target =
            event.key === "ArrowRight" ? positionMs + KEY_STEP_MS
            : event.key === "ArrowLeft" ? positionMs - KEY_STEP_MS
            : event.key === "Home" ? 0
            : event.key === "End" ? durationMs
            : null;
          if (target === null) return;
          event.preventDefault();
          timeline.seek(target);
          draw();
        }}
      >
        <svg
          aria-hidden="true"
          className="absolute inset-0 block h-full w-full"
          viewBox={`0 0 ${Math.max(durationMs, 1)} ${layout.rows * ROW}`}
          preserveAspectRatio="none"
        >
          {layout.octaveLines.map((y) => (
            <line
              key={y}
              x1={0}
              x2={durationMs}
              y1={y}
              y2={y}
              stroke="color-mix(in srgb, var(--color-ink) 10%, transparent)"
              strokeWidth={1}
              vectorEffect="non-scaling-stroke"
            />
          ))}
          {layout.notes.map((note, index) => (
            <rect
              key={index}
              ref={(element) => {
                rectRefs.current[index] = element;
              }}
              x={note.x}
              y={note.y + 1}
              width={note.width}
              height={ROW - 2}
              rx={2}
              fill={note.color}
              opacity={0.45}
            />
          ))}
        </svg>
        {/* Full-width layer moved by its own width; the line sits on its left edge. */}
        <div ref={playheadRef} aria-hidden="true" className="ms-playhead pointer-events-none absolute inset-0">
          <div className="absolute inset-y-0 left-0 w-0.5 -ml-px rounded-full bg-ink" />
        </div>
      </div>
      <div className="mt-2 flex justify-between text-[13px] tabular-nums text-ink-muted">
        <span ref={timeRef}>0:00</span>
        <span>{formatDuration(durationMs)}</span>
      </div>
    </div>
  );
}
