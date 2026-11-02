"use client";

import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import type { SharedRecording } from "../../lib/recordings";
import { downloadMidi, type Recording } from "../midi/midiUtils";
import {
  createPlaybackTimeline,
  type PlaybackState,
  type PlaybackTimeline,
} from "../midi/playbackTimeline";
import CopyLinkButton from "./CopyLinkButton";
import PianoRoll, { ROLL_HEIGHT, ROLL_MIN_HEIGHT, ROLL_PAPER, type PianoRollHandle } from "./PianoRoll";
import { shareUrl } from "./shareStore";

function asRecording(shared: SharedRecording): Recording {
  return {
    id: shared.id,
    name: shared.title,
    bpm: shared.bpm,
    createdAt: shared.createdAt,
    notes: shared.notes,
  };
}

function PlayIcon({ playing }: { playing: boolean }) {
  return (
    <svg aria-hidden="true" width="18" height="18" viewBox="0 0 18 18" fill="currentColor">
      {playing ? (
        <path d="M4.5 3h3v12h-3zM10.5 3h3v12h-3z" />
      ) : (
        <path d="M5 2.8v12.4a.6.6 0 0 0 .9.5l9.6-6.2a.6.6 0 0 0 0-1L5.9 2.3a.6.6 0 0 0-.9.5Z" />
      )}
    </svg>
  );
}

/**
 * Piano roll and transport for one song. Pass `null` while the notes load:
 * the same frame and keys render, disabled, so nothing moves on arrival.
 */
export default function SharedPlayer({
  recording,
  fill = false,
  shareActions = true,
  actions,
}: {
  recording: SharedRecording | null;
  /** Fill a flex column: the roll takes the free space, keys sit at the bottom. */
  fill?: boolean;
  /** Download MIDI and Copy link; off when previewing an unsaved take. */
  shareActions?: boolean;
  /** Extra keys after Play, e.g. a local take's Download, Share and Delete. */
  actions?: ReactNode;
}) {
  const [timeline, setTimeline] = useState<PlaybackTimeline | null>(null);
  const [state, setState] = useState<PlaybackState>("stopped");
  const [error, setError] = useState<string | null>(null);

  const rollRef = useRef<PianoRollHandle>(null);
  const frame = useRef(0);

  useEffect(() => {
    if (!recording) return;
    const created = createPlaybackTimeline(asRecording(recording));
    // The timeline is an external object owned by this effect's lifetime.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setTimeline(created);
    return () => {
      cancelAnimationFrame(frame.current);
      created.dispose();
    };
  }, [recording]);

  // One frame loop, and only while sound is playing: it mirrors the transport
  // state into React and asks the roll to draw. Idle, nothing runs per frame,
  // so the player never competes with the live camera loop.
  const sync = useCallback(() => {
    if (!timeline) return;
    const step = () => {
      const snapshot = timeline.getSnapshot();
      setState(snapshot.state);
      setError(snapshot.error);
      rollRef.current?.draw();
      if (snapshot.state === "playing" || snapshot.state === "loading")
        frame.current = requestAnimationFrame(step);
    };
    cancelAnimationFrame(frame.current);
    step();
  }, [timeline]);

  const playing = state === "playing" || state === "loading";
  const secondary = "ms-key px-4 py-2.5 text-[15px]";

  return (
    <div className={fill ? "flex min-h-0 flex-1 flex-col" : ""}>
      {recording && timeline ? (
        <PianoRoll ref={rollRef} notes={recording.notes} timeline={timeline} fill={fill} />
      ) : (
        // Mirrors PianoRoll: the roll, then the time row.
        <div aria-label="Loading notes" className={fill ? "flex min-h-0 flex-1 flex-col" : ""}>
          <div style={ROLL_PAPER} className={`ms-roll ${fill ? `flex-1 ${ROLL_MIN_HEIGHT}` : ROLL_HEIGHT} motion-safe:animate-pulse`} />
          <div className="mt-2 h-[19.5px]" />
        </div>
      )}
      {error && (
        <p role="alert" className="mt-3 text-[14px] text-danger">
          Sound could not start: {error}
        </p>
      )}
      <div className="mt-4 flex shrink-0 flex-wrap items-center gap-2">
        <button
          type="button"
          className="ms-key ms-key-primary ms-transport-key"
          disabled={!timeline}
          onClick={() => {
            if (!timeline) return;
            if (playing) timeline.pause();
            else void timeline.play().then(sync);
            sync();
          }}
        >
          <PlayIcon playing={playing} />
          {playing ? "Pause" : state === "ended" ? "Play again" : "Play"}
        </button>
        {shareActions && (
          <>
            <button
              type="button"
              className={secondary}
              disabled={!recording}
              onClick={() => recording && downloadMidi(asRecording(recording))}
            >
              Download MIDI
            </button>
            {recording ? (
              <CopyLinkButton url={shareUrl(recording.id)} className={`${secondary} min-w-[116px]`} />
            ) : (
              <button type="button" className={`${secondary} min-w-[116px]`} disabled>
                Copy link
              </button>
            )}
          </>
        )}
        {actions}
      </div>
    </div>
  );
}
