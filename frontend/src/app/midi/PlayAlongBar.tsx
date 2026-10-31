"use client";

import { useEffect, useState, useSyncExternalStore } from "react";
import { FALL_LEAD_MS } from "../../cv/fallingNotes";
import { formatDuration } from "../share/shareStore";
import { useKeyboardLayout } from "../useKeyboardLayout";
import { getPlayAlong, stopPlayAlong, subscribePlayAlong } from "./playAlong";

/** Title, time and transport for the song falling onto the keyboard (#131). */
export default function PlayAlongBar() {
  const playAlong = useSyncExternalStore(subscribePlayAlong, getPlayAlong, () => null);
  const layout = useKeyboardLayout();
  const [snapshot, setSnapshot] = useState(() => playAlong?.timeline.getSnapshot() ?? null);

  // Four updates a second is plenty for a clock; the notes draw elsewhere.
  useEffect(() => {
    if (!playAlong) return;
    const update = () => setSnapshot(playAlong.timeline.getSnapshot());
    update();
    const timer = setInterval(update, 250);
    return () => clearInterval(timer);
  }, [playAlong]);

  if (!playAlong || !snapshot) return null;
  const top = layout.startingMidi + 12 * layout.octaves;
  const outside = playAlong.notes.filter((note) => note.midi < layout.startingMidi || note.midi > top).length;
  const playing = snapshot.state === "playing" || snapshot.state === "loading";
  const ended = snapshot.state === "ended";
  const leadLeft = FALL_LEAD_MS - snapshot.positionMs;
  const time = leadLeft > 0 && playing
    ? `Starts in ${Math.ceil(leadLeft / 1000)}`
    : `${formatDuration(Math.max(0, -leadLeft))} / ${formatDuration(snapshot.durationMs - FALL_LEAD_MS)}`;

  return (
    <section
      aria-label="Play along"
      className="ms-pill absolute top-3 left-1/2 z-30 flex max-w-[calc(100%-1.5rem)] -translate-x-1/2 items-center gap-3 py-1.5 pl-4 pr-1.5 text-[14px]"
    >
      <span className="min-w-0 truncate font-semibold">{playAlong.title}</span>
      <span className="shrink-0 tabular-nums text-ink-muted">{time}</span>
      {outside > 0 && (
        <span className="hidden shrink-0 text-ink-muted sm:inline">
          {outside} {outside === 1 ? "note is" : "notes are"} off your keyboard
        </span>
      )}
      <button
        type="button"
        className="ms-key shrink-0 px-3 py-1 text-[13px]"
        onClick={() => {
          if (playing) playAlong.timeline.pause();
          else void playAlong.timeline.play();
          setSnapshot(playAlong.timeline.getSnapshot());
        }}
      >
        {playing ? "Pause" : ended ? "Play again" : "Resume"}
      </button>
      <button type="button" className="ms-key ms-key-icon size-8 shrink-0" aria-label="Stop playing along" onClick={stopPlayAlong}>
        <svg aria-hidden="true" width="12" height="12" viewBox="0 0 14 14" fill="none">
          <path d="M3 3l8 8M11 3l-8 8" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" />
        </svg>
      </button>
    </section>
  );
}
