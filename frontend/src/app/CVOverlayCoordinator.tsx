"use client";

import dynamic from "next/dynamic";
import { useCallback, useEffect, useRef, useState, type RefObject } from "react";
import type { LiveSession } from "../events/liveSession";
import type { CameraSignature } from "../cv/calibration";
import type { Point } from "../cv/types";
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
  session,
  enabled = false,
  onNoteOn,
  onNoteOff,
  onReleaseAllNotes,
}: {
  videoRef: RefObject<HTMLVideoElement | null>;
  enabled?: boolean;
  session: LiveSession;
  onNoteOn: (pitch: string, velocity: number) => void;
  onNoteOff: (pitch: string) => void;
  onReleaseAllNotes: () => void;
}) {
  const producer = useRef({ id: "", press: 0, keys: new Map<number, number>() });
  const [fingertips, setFingertips] = useState<Fingertip[]>([]);

  const handleLandmarks = useCallback(
    (hands: readonly (readonly NormalizedLandmark[])[]) => {
      session.observeTracking();
      const video = videoRef.current;
      if (!video) return;

      setFingertips(
        getFingertips(hands, video.videoWidth, video.videoHeight),
      );
    },
    [videoRef, session],
  );

  const handleKeyTransitions = useCallback(
    (pressed: readonly number[], released: readonly number[]) => {
      const id = session.sessionId;
      if (!enabled || !id) return;
      if (producer.current.id !== id)
        producer.current = { id, press: 0, keys: new Map() };
      const source = producer.current;
      for (const keyIndex of released) {
        const midi = keyIndexToMidi(keyIndex);
        const pressId = source.keys.get(keyIndex);
        if (midi === null || pressId === undefined) continue;
        source.keys.delete(keyIndex);
        const result = session.noteOff(id, pressId, midi);
        if (result === "accepted") onNoteOff(midiToPitch(midi));
      }
      for (const keyIndex of pressed) {
        const midi = keyIndexToMidi(keyIndex);
        if (midi === null || source.keys.has(keyIndex)) continue;
        const pressId = ++source.press;
        source.keys.set(keyIndex, pressId);
        const result = session.noteOn(id, pressId, midi, 0.8);
        if (result === "accepted") onNoteOn(midiToPitch(midi), 100);
      }
    },
    [enabled, onNoteOn, onNoteOff, session],
  );
  const observeCalibration = useCallback((saved: unknown, camera: CameraSignature | null, corners: Point[] | null) => {
    return session.observeCalibration(saved, camera, corners);
  }, [session]);
  const trackingFailed = useCallback(() => session.trackingFailed(), [session]);
  useEffect(() => {
    if (!enabled) onReleaseAllNotes();
  }, [enabled, onReleaseAllNotes]);

  return (
    <>
      <MarkerTrackingOverlay
        videoRef={videoRef}
        fingertips={fingertips}
        onKeyTransitions={handleKeyTransitions}
        trackingEnabled={enabled}
        onCalibrationObservation={observeCalibration}
      />
      <HandTrackingOverlay
        videoRef={videoRef}
        onLandmarks={handleLandmarks}
        onTrackingFailure={trackingFailed}
      />
    </>
  );
}
