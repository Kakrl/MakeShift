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
  updateKeyTransitions,
} from "../cv/collision";
import type { Fingertip } from "../cv/collision";
import type { HandObservation } from "../cv/collision";
import {
  getKnuckleBoundaryY,
  getKnuckleDistance,
  DEPTH_FINGERS,
} from "../cv/depthCalibration";
import type { PersistedDepthCalibration } from "../cv/depthCalibration";
import { MarkerDetector } from "../cv/markerDetector";
import {
  computeHomography,
  invertHomography,
  projectPoint,
  type Homography,
} from "../cv/homography";
import type { MarkerDetectionResult } from "../cv/types";
import type { Point } from "../cv/types";
import { recordMarkerDetection } from "../cv/performanceMetrics";

const PAGE_CORNERS: Point[] = [
  { x: 0, y: 0 },
  { x: 1, y: 0 },
  { x: 1, y: 1 },
  { x: 0, y: 1 },
];

const INITIAL_MARKER_CHECK_INTERVAL_MS = 100;
const LOCKED_MARKER_CHECK_INTERVAL_MS = 10_000;
const KNUCKLE_LANDMARK_INDICES = [5, 9, 13, 17] as const;

type FingerContactState = "invalid" | "hover" | "press candidate";

interface FingerDebugState {
  id: string;
  handIndex: number;
  finger: string;
  state: FingerContactState;
  keyOverlap: boolean;
  fingertipVideo: Point;
  fingertipSheet: Point | null;
  fingertipZ: number | undefined;
  knuckleDistance: number | null;
  knuckles: Point[];
}

export default function MarkerTrackingOverlay({
  videoRef,
  fingertips,
  hands = [],
  depthCalibration = null,
  onKeyTransitions,
  trackingEnabled = false,
}: {
  videoRef: React.RefObject<HTMLVideoElement | null>;
  fingertips: readonly Fingertip[];
  hands?: readonly HandObservation[];
  depthCalibration?: PersistedDepthCalibration | null;
  onKeyTransitions?: (pressed: readonly number[], released: readonly number[]) => void;
  trackingEnabled?: boolean;
}) {
  const [markerDetection, setMarkerDetection] =
    useState<MarkerDetectionResult | null>(null);
  const processingCanvasRef = useRef<HTMLCanvasElement>(null);
  const overlayCanvasRef = useRef<HTMLCanvasElement>(null);
  const homographyRef = useRef<Homography | null>(null);
  const projectedPianoCornersRef = useRef<Point[] | null>(null);
  const projectedWhiteKeysRef = useRef<Point[][] | null>(null);
  const previousKeysRef = useRef<Set<number>>(new Set());
  const fingerStatesRef = useRef<Map<string, FingerContactState>>(new Map());
  const geometryLockedRef = useRef(false);
  const [fingerDebug, setFingerDebug] = useState<FingerDebugState[]>([]);

  useEffect(() => {
    if (!trackingEnabled && previousKeysRef.current.size > 0) {
      onKeyTransitions?.([], [...previousKeysRef.current]);
      // Resume treats currently held keys as fresh presses for the new segment.
      previousKeysRef.current = new Set();
      fingerStatesRef.current.clear();
    }
  }, [onKeyTransitions, trackingEnabled]);

  useEffect(() => {
    let cancelled = false;
    let animationFrame = 0;
    let detector: MarkerDetector | null = null;
    let lastDetectionTime = 0;

    const detect = (time: number) => {
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

            const markerCheckInterval = geometryLockedRef.current
              ? LOCKED_MARKER_CHECK_INTERVAL_MS
              : INITIAL_MARKER_CHECK_INTERVAL_MS;
            if (time - lastDetectionTime >= markerCheckInterval) {
              const context = processingCanvas.getContext("2d");
              if (context && detector) {
                context.drawImage(
                  video,
                  0,
                  0,
                  processingCanvas.width,
                  processingCanvas.height,
                );
                const detectionStartedAt = performance.now();
                const detection = detector.detect(processingCanvas);
                recordMarkerDetection(
                  performance.now() - detectionStartedAt,
                  detection.missingIds.length === 0,
                );
                setMarkerDetection(detection);
                lastDetectionTime = time;
              }
            }
          }
        }
        animationFrame = requestAnimationFrame(detect);
      }
    };

    MarkerDetector.create()
      .then((createdDetector) => {
        if (cancelled) {
          createdDetector.dispose();
          return;
        }
        detector = createdDetector;
        animationFrame = requestAnimationFrame(detect);
      })
      .catch((error: unknown) => {
        console.error("Unable to initialize ArUco marker detector", error);
        setMarkerDetection(null);
      });
    return () => {
      cancelled = true;
      cancelAnimationFrame(animationFrame);
      detector?.dispose();
    };
  }, [videoRef]);

  useEffect(() => {
    if (!markerDetection || markerDetection.missingIds.length > 0) {
      return;
    }

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

    if (!topLeft || !topRight || !bottomRight || !bottomLeft) return;

    const homography = computeHomography(PAGE_CORNERS, [
      topLeft,
      topRight,
      bottomRight,
      bottomLeft,
    ]);
    if (!homography) return;

    const projectedPianoCorners = PIANO_CORNERS.map((corner) =>
      projectPoint(homography, corner),
    ).filter((corner): corner is Point => corner !== null);
    const projectedWhiteKeys = getWhiteKeyPolygons().map((key) =>
      key
        .map((corner) => projectPoint(homography, corner))
        .filter((corner): corner is Point => corner !== null),
    );

    if (
      projectedPianoCorners.length !== PIANO_CORNERS.length ||
      !projectedWhiteKeys.every((key) => key.length === 4)
    ) {
      return;
    }

    homographyRef.current = homography;
    projectedPianoCornersRef.current = projectedPianoCorners;
    projectedWhiteKeysRef.current = projectedWhiteKeys;
    geometryLockedRef.current = true;
  }, [markerDetection]);

  useEffect(() => {
    const inverseHomography = homographyRef.current
      ? invertHomography(homographyRef.current)
      : null;
    const nextDebug: FingerDebugState[] = [];

    for (const fingertip of fingertips) {
      const hand = hands[fingertip.handIndex];
      const fingerIndex = [4, 8, 12, 16, 20].indexOf(
        fingertip.landmarkIndex,
      );
      if (!hand || fingerIndex < 0) continue;

      const landmark = hand.landmarks[fingertip.landmarkIndex];
      const knuckles = KNUCKLE_LANDMARK_INDICES.map((index) => ({
        x: hand.landmarks[index]?.x ?? 0,
        y: hand.landmarks[index]?.y ?? 0,
      }));
      const knuckleDistance = getKnuckleDistance(hand.landmarks);
      const fingertipSheet = inverseHomography
        ? projectPoint(inverseHomography, fingertip.point)
        : null;
      const video = videoRef.current;
      const fingertipScreenY =
        video && video.videoHeight > 0
          ? fingertip.point.y / video.videoHeight
          : null;
      const keyOverlap = projectedWhiteKeysRef.current
        ? getKeyCollisions([fingertip], projectedWhiteKeysRef.current, 8).some(
            ({ fingertips: ids }) => ids.includes(fingertip.id),
          )
        : false;
      const finger = DEPTH_FINGERS[fingerIndex];
      const canEvaluate = Boolean(
        depthCalibration &&
          keyOverlap &&
          landmark &&
          knuckleDistance !== null &&
          fingertipScreenY !== null,
      );
      let pressed = false;
      if (canEvaluate) {
        const boundaryY = getKnuckleBoundaryY(
          depthCalibration!,
          knuckleDistance!,
        );
        pressed =
          boundaryY !== null && fingertipScreenY! >= boundaryY;
      }
      const state: FingerContactState = !canEvaluate
        ? "invalid"
        : pressed
          ? "press candidate"
          : "hover";
      fingerStatesRef.current.set(fingertip.id, state);
      nextDebug.push({
        id: fingertip.id,
        handIndex: fingertip.handIndex,
        finger,
        state,
        keyOverlap,
        fingertipVideo: fingertip.point,
        fingertipSheet,
        fingertipZ: landmark?.z,
        knuckleDistance,
        knuckles,
      });
    }

    const activeIds = new Set(nextDebug.map(({ id }) => id));
    for (const id of fingerStatesRef.current.keys()) {
      if (!activeIds.has(id)) fingerStatesRef.current.delete(id);
    }
    setFingerDebug(nextDebug);

    // Console logging is intentionally disabled while tuning the visual prototype.
  }, [depthCalibration, fingertips, hands, markerDetection]);

  useEffect(() => {
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

    const projectedPianoCorners = projectedPianoCornersRef.current;
    const projectedWhiteKeys = projectedWhiteKeysRef.current;

    if (projectedPianoCorners && projectedWhiteKeys) {
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
          const contactCollisions = depthCalibration
            ? collisions.flatMap((collision) => {
                const hasCandidate = collision.fingertips.some(
                  (id) => fingerStatesRef.current.get(id) === "press candidate",
                );
                return hasCandidate ? [collision] : [];
              })
            : [];
          const collidedKeys = getCollidedKeyIndexes(contactCollisions);
          if (trackingEnabled) {
            const transitions = updateKeyTransitions(
              previousKeysRef.current,
              collidedKeys,
            );

            if (transitions.pressed.length || transitions.released.length) {
              onKeyTransitions?.(transitions.pressed, transitions.released);
            }
            previousKeysRef.current = collidedKeys;
          }

          projectedWhiteKeys.forEach((key, index) => {
            if (collidedKeys.has(index)) pressWhiteKey(context, key);
            else releaseWhiteKey(context, key);
          });

          if (depthCalibration && videoRef.current?.videoHeight) {
            fingertips
              .filter(({ landmarkIndex }) => landmarkIndex === 8)
              .forEach((fingertip) => {
                const keyOverlap = getKeyCollisions(
                  [fingertip],
                  projectedWhiteKeys,
                  8,
                ).length > 0;
                if (!keyOverlap) return;
                const hand = hands[fingertip.handIndex];
                const landmark = hand?.landmarks[8];
                const knuckleDistance = hand
                  ? getKnuckleDistance(hand.landmarks)
                  : null;
                if (!landmark || knuckleDistance === null) return;
                const boundaryY = getKnuckleBoundaryY(
                  depthCalibration,
                  knuckleDistance,
                  true,
                );
                if (boundaryY === null) return;

                const screenY =
                  boundaryY * videoRef.current!.videoHeight;
                const calibrationDistances = Object.values(
                  depthCalibration.knuckleDistances,
                );
                const outsideRange =
                  knuckleDistance < Math.min(...calibrationDistances) ||
                  knuckleDistance > Math.max(...calibrationDistances);
                context.save();
                context.strokeStyle = "#ff66cc";
                context.fillStyle = "#ff66cc";
                context.lineWidth = 5;
                context.setLineDash([16, 10]);
                context.beginPath();
                context.moveTo(0, screenY);
                context.lineTo(overlay.width, screenY);
                context.stroke();
                context.setLineDash([]);
                context.font = "bold 18px Arial";
                context.fillText(
                  `index knuckle boundary${outsideRange ? " (outside range)" : ""}`,
                  12,
                  screenY - 8,
                );
                context.restore();
              });
          }
    }
  }, [
    depthCalibration,
    fingertips,
    hands,
    markerDetection,
    onKeyTransitions,
    trackingEnabled,
    videoRef,
  ]);

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
      <div className="absolute right-4 top-4 max-h-[70vh] max-w-[430px] overflow-auto rounded bg-black/80 px-3 py-2 font-mono text-xs text-white">
        <div className="mb-1 font-bold">Finger debug</div>
        <div className="mb-2 border-b border-white/20 pb-1">
          calibration={depthCalibration ? "ready" : "missing"} mapping={
            homographyRef.current ? "ready" : "waiting"
          }
          <br />
          knuckle front={depthCalibration
            ? depthCalibration.knuckleDistances.front.toFixed(5)
            : "n/a"} middle={depthCalibration
            ? depthCalibration.knuckleDistances.middle.toFixed(5)
            : "n/a"} back={depthCalibration
            ? depthCalibration.knuckleDistances.back.toFixed(5)
            : "n/a"} current={fingerDebug[0]?.knuckleDistance?.toFixed(5) ?? "n/a"}
        </div>
        {fingerDebug.length === 0 ? (
          <div>No hand data</div>
        ) : (
          fingerDebug.map((finger) => (
            <div key={finger.id} className="mb-1">
              H{finger.handIndex} {finger.finger}: {finger.state}
            </div>
          ))
        )}
      </div>
    </>
  );
}
