"use client";

import dynamic from "next/dynamic";
import { useCallback, useEffect, useState, type RefObject } from "react";
import { audioNoteOff, audioNoteOn, releaseAllAudioNotes } from "./audio/audioEngine";
import { keyIndexToMidi, midiToPitch } from "../cv/noteMap";
import { getFingertips } from "../cv/collision";
import type { Fingertip, HandObservation } from "../cv/collision";
import {
  DEPTH_CALIBRATION_STORAGE_KEY,
  parsePersistedDepthCalibration,
} from "../cv/depthCalibration";
import type { PersistedDepthCalibration } from "../cv/depthCalibration";

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
  onNoteOn,
  onNoteOff,
  onReleaseAllNotes,
}: {
  videoRef: RefObject<HTMLVideoElement | null>;
  enabled?: boolean;
  onNoteOn: (pitch: string, velocity: number) => void;
  onNoteOff: (pitch: string) => void;
  onReleaseAllNotes: () => void;
}) {
  const [fingertips, setFingertips] = useState<Fingertip[]>([]);
  const [hands, setHands] = useState<HandObservation[]>([]);
  const [depthCalibration] = useState<PersistedDepthCalibration | null>(() =>
    typeof window === "undefined"
      ? null
      : parsePersistedDepthCalibration(
          window.localStorage.getItem(DEPTH_CALIBRATION_STORAGE_KEY),
        ),
  );

  const handleLandmarks = useCallback(
    (observations: readonly HandObservation[]) => {
      const video = videoRef.current;
      if (!video) return;

      setHands([...observations]);
      setFingertips(
        getFingertips(
          observations.map(({ landmarks }) => landmarks),
          video.videoWidth,
          video.videoHeight,
        ),
      );
    },
    [videoRef],
  );

  const handleKeyTransitions = useCallback(
    (pressed: readonly number[], released: readonly number[]) => {
      for (const keyIndex of released) {
        const midi = keyIndexToMidi(keyIndex);
        if (midi === null) continue;
        audioNoteOff(midi);
        onNoteOff(midiToPitch(midi));
      }
      if (!enabled) return;
      for (const keyIndex of pressed) {
        const midi = keyIndexToMidi(keyIndex);
        if (midi === null) continue;
        const pitch = midiToPitch(midi);
        audioNoteOn(midi);
        onNoteOn(pitch, 100);
      }
    },
    [enabled, onNoteOn, onNoteOff],
  );

  useEffect(() => {
    if (!enabled) {
      releaseAllAudioNotes();
      onReleaseAllNotes();
    }
  }, [enabled, onReleaseAllNotes]);

  useEffect(() => () => releaseAllAudioNotes(), []);

  return (
    <>
      <MarkerTrackingOverlay
        videoRef={videoRef}
        fingertips={fingertips}
        hands={hands}
        depthCalibration={depthCalibration}
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
