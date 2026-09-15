"use client";

import dynamic from "next/dynamic";
import type { RefObject } from "react";

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
  return (
    <>
      <MarkerTrackingOverlay videoRef={videoRef} />
      <HandTrackingOverlay videoRef={videoRef} />
    </>
  );
}
