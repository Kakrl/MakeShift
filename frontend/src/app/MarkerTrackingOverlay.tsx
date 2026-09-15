"use client";

import { useEffect, useRef, useState } from "react";
import {
  getWhiteKeyPolygons,
  PIANO_CORNERS,
  pressWhiteKey,
  releaseWhiteKey,
} from "../cv/keyboardGeometry";
import {
  getCollidedKeyIndexes,
  getKeyCollisions,
} from "../cv/collision";
import type { Fingertip } from "../cv/collision";
import { MarkerDetector } from "../cv/markerDetector";
import { computeHomography, projectPoint } from "../cv/homography";
import type { MarkerDetectionResult } from "../cv/types";
import type { Point } from "../cv/types";

const PAGE_CORNERS: Point[] = [
  { x: 0, y: 0 },
  { x: 1, y: 0 },
  { x: 1, y: 1 },
  { x: 0, y: 1 },
];

export default function MarkerTrackingOverlay({
  videoRef,
  fingertips,
}: {
  videoRef: React.RefObject<HTMLVideoElement | null>;
  fingertips: readonly Fingertip[];
}) {
  const [markerDetection, setMarkerDetection] =
    useState<MarkerDetectionResult | null>(null);
  const processingCanvasRef = useRef<HTMLCanvasElement>(null);
  const overlayCanvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    let cancelled = false;
    let animationFrame = 0;
    let detector: MarkerDetector | null = null;
    let lastDetectionTime = 0;

    const detect = (time: number) => {
      console.log("detect")
      const video = videoRef.current;
      const processingCanvas = processingCanvasRef.current;

      if (!cancelled) {
        if (video && processingCanvas && video.readyState >= 2) {
          if (video.videoWidth > 0 && video.videoHeight > 0) {
          if (
            processingCanvas.width !== video.videoWidth ||
            processingCanvas.height !== video.videoHeight
          ) {
            processingCanvas.width = video.videoWidth;
            processingCanvas.height = video.videoHeight;
          }

          const overlayCanvas = overlayCanvasRef.current;
          if (overlayCanvas) {
            if (
              overlayCanvas.width !== video.videoWidth ||
              overlayCanvas.height !== video.videoHeight
            ) {
              overlayCanvas.width = video.videoWidth;
              overlayCanvas.height = video.videoHeight;
            }
          }

            if (time - lastDetectionTime >= 100) {
              const context = processingCanvas.getContext("2d");
              if (context && detector) {
                context.drawImage(
                  video,
                  0,
                  0,
                  processingCanvas.width,
                  processingCanvas.height,
                );
                setMarkerDetection(detector.detect(processingCanvas));
                lastDetectionTime = time;
              }
            }
          }
        }
        animationFrame = requestAnimationFrame(detect);
      }
    };

    console.log("hello world")
    MarkerDetector.create()
      .then((createdDetector) => {
        if (cancelled) {
          createdDetector.dispose();
          return;
        }
        console.log("on animation frame, detect!")
        detector = createdDetector;
        animationFrame = requestAnimationFrame(detect);
      })
      .catch((error: unknown) => {
        console.error("Unable to initialize ArUco marker detector", error);
        setMarkerDetection(null);
      });
      
    console.log("MarkerDetector created?", markerDetection)

    return () => {
      cancelled = true;
      cancelAnimationFrame(animationFrame);
      detector?.dispose();
    };
  }, [videoRef]);

  useEffect(() => {
    console.log("marker detection changed")
    const overlay = overlayCanvasRef.current;
    if (!overlay) return;

    const context = overlay.getContext("2d");
    if (!context) return;

    context.clearRect(0, 0, overlay.width, overlay.height);
    if (!markerDetection) return;

    context.lineWidth = 4;
    context.font = "bold 24px Arial";
    context.textBaseline = "bottom";

    markerDetection.observations.forEach((observation) => {
      context.strokeStyle = "#00ff88";
      context.fillStyle = "#00ff88";
      context.beginPath();
      observation.corners.forEach((corner, index) => {
        if (index === 0) context.moveTo(corner.x, corner.y);
        else context.lineTo(corner.x, corner.y);
      });
      context.closePath();
      context.stroke();
      context.fillText(
        `ID ${observation.id}`,
        observation.center.x + 8,
        observation.center.y,
      );
    });

    const markerCenters = new Map(
      markerDetection.observations.map((observation) => [
        observation.id,
        observation.center,
      ]),
    );
    const topLeft = markerCenters.get(0);
    const topRight = markerCenters.get(1);
    const bottomRight = markerCenters.get(2);
    const bottomLeft = markerCenters.get(3);

    if (topLeft && topRight && bottomRight && bottomLeft) {
      const homography = computeHomography(PAGE_CORNERS, [
        topLeft,
        topRight,
        bottomRight,
        bottomLeft,
      ]);

      if (homography) {
        const projectedPianoCorners = PIANO_CORNERS.map((corner) =>
          projectPoint(homography, corner),
        ).filter((corner): corner is Point => corner !== null);
        const projectedWhiteKeys = getWhiteKeyPolygons().map((key) =>
          key
            .map((corner) => projectPoint(homography, corner))
            .filter((corner): corner is Point => corner !== null),
        );

        if (
          projectedPianoCorners.length === PIANO_CORNERS.length &&
          projectedWhiteKeys.every((key) => key.length === 4)
        ) {
          context.beginPath();
          projectedPianoCorners.forEach((corner, index) => {
            if (index === 0) context.moveTo(corner.x, corner.y);
            else context.lineTo(corner.x, corner.y);
          });
          context.closePath();
          context.fillStyle = "rgba(255, 255, 255, 0.18)";
          context.strokeStyle = "#ffd60a";
          context.lineWidth = 6;
          context.fill();
          context.stroke();

          context.strokeStyle = "rgba(255, 255, 255, 0.9)";
          context.lineWidth = 3;
          const collisions = getKeyCollisions(
            fingertips,
            projectedWhiteKeys,
            8,
          );
          const collidedKeys = getCollidedKeyIndexes(collisions);

          projectedWhiteKeys.forEach((key, index) => {
            if (collidedKeys.has(index)) pressWhiteKey(context, key);
            else releaseWhiteKey(context, key);
          });
        }
      }
    }
  }, [fingertips, markerDetection]);

  return (
    <>
      <canvas
        ref={overlayCanvasRef}
        width={1920}
        height={1080}
        className="absolute inset-0 z-10 h-full w-full object-cover pointer-events-none"
      />
      <canvas ref={processingCanvasRef} className="hidden" />
      <div className="absolute left-4 top-4 rounded bg-black/70 px-3 py-2 text-sm text-white">
        {markerDetection === null
          ? "Loading ArUco detector…"
          : markerDetection.missingIds.length === 0
            ? "All four ArUco boards detected"
            : `Missing IDs: ${markerDetection.missingIds.join(", ")}`}
      </div>
    </>
  );
}
