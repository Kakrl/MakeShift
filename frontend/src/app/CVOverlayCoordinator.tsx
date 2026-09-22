"use client";

import dynamic from "next/dynamic";
import { useCallback, useEffect, useState, type RefObject } from "react";
import { audioNoteOff, audioNoteOn, releaseAllAudioNotes } from "./audio/audioEngine";
import { noteOff, noteOn, releaseAllNotes } from "./midi/midiUtils";
import { keyIndexToMidi, midiToPitch } from "../cv/noteMap";
import { getFingertips } from "../cv/collision";
import type { Fingertip, NormalizedLandmark } from "../cv/collision";

const MarkerTrackingOverlay = dynamic(
  () => import("./MarkerTrackingOverlay"),
  { ssr: false },
);

const HandTrackingOverlay = dynamic(
  () => import("./cv/HandTrackingOverlay"),
  { ssr: false },
);

export default function CVOverlayCoordinator({
  videoRef,
  enabled = false,
}: {
  videoRef: RefObject<HTMLVideoElement | null>;
  enabled?: boolean;
}) {
  const [fingertips, setFingertips] = useState<Fingertip[]>([]);

  const handleLandmarks = useCallback(
    (hands: readonly (readonly NormalizedLandmark[])[]) => {
      const video = videoRef.current;
      if (!video) return;

      setFingertips(
        getFingertips(hands, video.videoWidth, video.videoHeight),
      );
    },
    [videoRef],
  );

  const handleKeyTransitions = useCallback(
    (pressed: readonly number[], released: readonly number[]) => {
      console.log("handling key transitions");
      for (const keyIndex of released) {
        const midi = keyIndexToMidi(keyIndex);
        if (midi === null) continue;
        audioNoteOff(midi);
        noteOff(midiToPitch(midi));
      }
      if (!enabled) return;
      for (const keyIndex of pressed) {
        const midi = keyIndexToMidi(keyIndex);
        if (midi === null) continue;
        const pitch = midiToPitch(midi);
        audioNoteOn(midi);
        noteOn(pitch, 100);
      }
    },
    [enabled],
  );

  useEffect(() => {
    if (!enabled) {
      releaseAllAudioNotes();
      releaseAllNotes();
    }
  }, [enabled]);

  useEffect(() => () => releaseAllAudioNotes(), []);

  return (
    <>
      <MarkerTrackingOverlay
        videoRef={videoRef}
        fingertips={fingertips}
        onKeyTransitions={handleKeyTransitions}
        trackingEnabled={enabled}
      />
      <HandTrackingOverlay
        videoRef={videoRef}
        onLandmarks={handleLandmarks}
      />
    </>
  );
}
