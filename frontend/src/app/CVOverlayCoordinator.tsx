"use client";

import { DEBUG_FLAGS } from "../debugFlags";

import dynamic from "next/dynamic";
import { useCallback, useEffect, useMemo, useState, type RefObject } from "react";
import type { LiveSession } from "../events/liveSession";
import type { CameraSignature } from "../cv/calibration";
import type { Point } from "../cv/types";
import { createKeyEventProducer } from "../events/keyEventProducer";
import { getFingertips } from "../cv/collision";
import type { Fingertip, HandObservation } from "../cv/collision";
import {
  DEPTH_CALIBRATION_STORAGE_KEY,
  parsePersistedDepthCalibration,
} from "../cv/depthCalibration";
import type { PersistedDepthCalibration } from "../cv/depthCalibration";
import { useKeyboardLayout } from "./useKeyboardLayout";
import { subscribeKeyboardLayout } from "../lib/keyboardSettings";

function readDepthCalibration() {
  try {
    return typeof window === "undefined" ? null : parsePersistedDepthCalibration(
      window.localStorage.getItem(DEPTH_CALIBRATION_STORAGE_KEY));
  } catch { return null; }
}

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
  const layout = useKeyboardLayout();
  const id = session.sessionId;
  const producer = useMemo(() => id ? createKeyEventProducer(session, id) : null, [session, id]);
  const [fingertips, setFingertips] = useState<Fingertip[]>([]);
  const [hands, setHands] = useState<HandObservation[]>([]);
  const [depthCalibration, setDepthCalibration] = useState<PersistedDepthCalibration | null>(readDepthCalibration);
  useEffect(() => subscribeKeyboardLayout(() => setDepthCalibration(readDepthCalibration())), []);

  const handleLandmarks = useCallback(
    (observations: readonly HandObservation[]) => {
      session.observeTracking();
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
    [videoRef, session],
  );

  const handleKeyTransitions = useCallback(
    (pressed: readonly number[], released: readonly number[]) => {
      if (!enabled || !producer) return;
      producer(pressed.map((keyIndex) => ({ keyIndex, velocity: 0.8 })), released, performance.now());
    },
    [enabled, producer],
  );
  const observeCalibration = useCallback((saved: unknown, camera: CameraSignature | null, corners: Point[] | null) => {
    const valid = session.observeCalibration(saved, camera, corners);
    if (valid) setDepthCalibration(current => {
      const next = readDepthCalibration();
      return JSON.stringify(current) === JSON.stringify(next) ? current : next;
    });
    return valid;
  }, [session]);
  const trackingFailed = useCallback(() => session.trackingFailed(), [session]);

  return (
    <>
      <MarkerTrackingOverlay
        layout={layout}
        videoRef={videoRef}
        fingertips={fingertips}
        hands={hands}
        depthCalibration={depthCalibration}
        showVisualDebug={DEBUG_FLAGS.visualDebug}
        debugShowSheetWithoutCalibration={DEBUG_FLAGS.showSheetWithoutCalibration}
        activePitches={activePitches}
        onKeyTransitions={handleKeyTransitions}
        trackingEnabled={enabled}
        onCalibrationObservation={observeCalibration}
      />
      <HandTrackingOverlay
        videoRef={videoRef}
        onLandmarks={handleLandmarks}
        showVisualDebug={DEBUG_FLAGS.visualDebug}
        onTrackingFailure={trackingFailed}
      />
    </>
  );
}
