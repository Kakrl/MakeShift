"use client";
import { useEffect, useId, useState, useSyncExternalStore } from "react";
import { browserAudio } from "./audio/audioEngine";
import { MAX_VOLUME, changeVolume, subscribeVolume, volumeSnapshot, serverVolumeSnapshot } from "./audio/volume";

export default function VolumeControl() {
  const id = useId();
  const volume = useSyncExternalStore(subscribeVolume, volumeSnapshot, serverVolumeSnapshot);
  const [feedback, setFeedback] = useState("");
  useEffect(() => {
    browserAudio.setVolume(volumeSnapshot());
  }, []);
  return <div className="ms-card flex shrink-0 flex-wrap items-center gap-3 p-4">
    <label htmlFor={id} className="ms-label">Piano volume</label>
    <input id={id} type="range" min="0" max={MAX_VOLUME} step="1"
      className="min-w-0 accent-[var(--color-accent)] focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-[var(--color-focus)]"
      value={volume} aria-valuetext={volume === 0 ? "Muted" : `${volume}%`}
      onChange={event => {
        const next = Number(event.target.value);
        browserAudio.setVolume(next);
        setFeedback(changeVolume(next).ok ? "" : "Volume changed for this visit; preference could not be saved.");
      }} />
    <output htmlFor={id}>{volume === 0 ? "Muted" : `${volume}%`}</output>
    {feedback && <span role="status">{feedback}</span>}
  </div>;
}
