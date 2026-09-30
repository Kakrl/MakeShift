"use client";

import dynamic from "next/dynamic";
import { useCallback, useMemo, useState, type RefObject } from "react";
import type { LiveSession } from "../events/liveSession";
import type { CameraSignature } from "../cv/calibration";
import type { Point } from "../cv/types";
import { createKeyEventProducer } from "../events/keyEventProducer";
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
  activePitches,
}: {
  videoRef: RefObject<HTMLVideoElement | null>;
  enabled?: boolean;
  session: LiveSession;
  activePitches: ReadonlySet<number>;
}) {
  const id = session.sessionId;
  const producer = useMemo(() => id ? createKeyEventProducer(session, id) : null, [session, id]);
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
      if (!enabled || !producer) return;
      // Legacy overlap preview has no measured contact velocity (#34).
      producer(pressed.map((keyIndex) => ({ keyIndex, velocity: 0.8 })), released, performance.now());
    },
    [enabled, producer],
  );
  const observeCalibration = useCallback((saved: unknown, camera: CameraSignature | null, corners: Point[] | null) => {
    return session.observeCalibration(saved, camera, corners);
  }, [session]);
  const trackingFailed = useCallback(() => session.trackingFailed(), [session]);

  return (
    <>
      <MarkerTrackingOverlay
        videoRef={videoRef}
        fingertips={fingertips}
        activePitches={activePitches}
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
