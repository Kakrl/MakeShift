"use client";

import dynamic from "next/dynamic";
import { useCallback, useState, type RefObject } from "react";
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
}: {
  videoRef: RefObject<HTMLVideoElement | null>;
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

  return (
    <>
      <MarkerTrackingOverlay videoRef={videoRef} fingertips={fingertips} />
      <HandTrackingOverlay
        videoRef={videoRef}
        onLandmarks={handleLandmarks}
      />
    </>
  );
}
