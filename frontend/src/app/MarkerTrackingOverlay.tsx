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
import {
  evaluateShadowContact,
  SHADOW_CUTOFF_OFFSET_Y,
  SHADOW_PRESS_ABSOLUTE_AREA_PIXELS,
  SHADOW_PRESS_AREA_RATIO,
} from "../cv/shadowHeuristics";
import type {
  ShadowContactEvaluation,
  ShadowContactState,
  ShadowMeasurement,
  ShadowObservation,
  ShadowState,
  ShadowWorkerRequest,
  ShadowWorkerResponse,
} from "../cv/shadowHeuristics";
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
const KNUCKLE_RANGE_TOLERANCE = 0.002;
const BOUNDARY_Y_TOLERANCE = 0.012;
const SHADOW_PREVIEW_RADIUS = 70;
const SHADOW_PREVIEW_SIZE = 280;
const SHADOW_DEBUG_INTERVAL_MS = 100;

function drawShadowSamplingGuides(
  context: CanvasRenderingContext2D,
  center: Point,
  scale = 1,
) {
  const style = getComputedStyle(context.canvas);
  const x = Math.round(center.x);
  const y = Math.round(center.y);
  context.save();
  context.lineWidth = 2 / scale;
  context.strokeStyle = style.getPropertyValue("--color-accent-light").trim();
  context.strokeRect(
    x - SHADOW_PREVIEW_RADIUS,
    y - SHADOW_PREVIEW_RADIUS,
    SHADOW_PREVIEW_RADIUS * 2,
    SHADOW_PREVIEW_RADIUS * 2,
  );
  context.setLineDash([6 / scale, 4 / scale]);
  context.beginPath();
  context.moveTo(x - SHADOW_PREVIEW_RADIUS, y + SHADOW_CUTOFF_OFFSET_Y);
  context.lineTo(x + SHADOW_PREVIEW_RADIUS, y + SHADOW_CUTOFF_OFFSET_Y);
  context.stroke();
  context.setLineDash([]);
  context.strokeStyle = style.getPropertyValue("--color-white").trim();
  context.beginPath();
  context.moveTo(center.x - 4 / scale, center.y);
  context.lineTo(center.x + 4 / scale, center.y);
  context.moveTo(center.x, center.y - 4 / scale);
  context.lineTo(center.x, center.y + 4 / scale);
  context.stroke();
  context.restore();
}

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
  shadow: ShadowState;
  shadowStrength: number | null;
  shadowLumaChange: number | null;
  shadowDarkArea: number | null;
  shadowContourArea: number | null;
  shadowContact: ShadowContactState;
  shadowPeakArea: number | null;
  shadowAreaRatio: number | null;
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
  const shadowPreviewCanvasRef = useRef<HTMLCanvasElement>(null);
  const shadowMaskCanvasRef = useRef<HTMLCanvasElement>(null);
  const shadowMaskSourceRef = useRef<HTMLCanvasElement>(null);
  const shadowLastFrameAtRef = useRef(-Infinity);
  const shadowWorkerRef = useRef<Worker | null>(null);
  const shadowWorkInFlightRef = useRef(false);
  const shadowActiveIdsRef = useRef<Set<string>>(new Set());
  const shadowPreviewIdRef = useRef<string | null>(null);
  const [shadowWorkerError, setShadowWorkerError] = useState<string | null>(null);
  const [shadowMaskCount, setShadowMaskCount] = useState(0);
  const [shadowPreviewMode, setShadowPreviewMode] = useState<"mask" | "camera">("mask");
  const homographyRef = useRef<Homography | null>(null);
  const projectedPianoCornersRef = useRef<Point[] | null>(null);
  const projectedWhiteKeysRef = useRef<Point[][] | null>(null);
  const previousKeysRef = useRef<Set<number>>(new Set());
  const fingerStatesRef = useRef<Map<string, FingerContactState>>(new Map());
  const shadowMeasurementsRef = useRef<Map<string, ShadowMeasurement>>(new Map());
  const shadowObservationsRef = useRef<Map<string, ShadowObservation>>(new Map());
  const shadowContactsRef = useRef<Map<string, ShadowContactEvaluation>>(new Map());
  const shadowKeyOverlapRef = useRef<Map<string, boolean>>(new Map());
  const geometryLockedRef = useRef(false);
  const [fingerDebug, setFingerDebug] = useState<FingerDebugState[]>([]);
  const shadowPreviewFinger =
    fingertips.find(
      (finger) =>
        finger.landmarkIndex === 8 &&
        hands[finger.handIndex]?.handedness === "Right",
    ) ?? fingertips.find((finger) => finger.landmarkIndex === 8);
  const shadowPreviewDebug = fingerDebug.find(
    (finger) => finger.id === shadowPreviewFinger?.id,
  );

  useEffect(() => {
    let cancelled = false;
    let worker: Worker;
    try {
      worker = new Worker(new URL("../cv/shadowWorker.ts", import.meta.url), {
        type: "module",
      });
    } catch (error) {
      // Worker startup failure is shown in the debug panel.
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setShadowWorkerError(error instanceof Error ? error.message : "Unable to start worker");
      return;
    }
    shadowWorkerRef.current = worker;
    worker.onmessage = ({ data }: MessageEvent<ShadowWorkerResponse>) => {
      if (cancelled) return;
      shadowWorkInFlightRef.current = false;
      for (const { id, observation, keyOverlap } of data.observations) {
        if (!shadowActiveIdsRef.current.has(id)) continue;
        const contact = evaluateShadowContact(
          observation.contour?.areaPixels ?? 0,
          data.frameAtMs,
          shadowContactsRef.current.get(id) ?? null,
          observation.measurement.available && keyOverlap &&
            shadowKeyOverlapRef.current.get(id) === true,
        );
        shadowContactsRef.current.set(id, contact);
        shadowMeasurementsRef.current.set(id, observation.measurement);
        shadowObservationsRef.current.set(id, observation);
        if (id !== shadowPreviewIdRef.current || !observation.mask) continue;
        const maskCanvas = shadowMaskCanvasRef.current;
        const source = shadowMaskSourceRef.current;
        const maskContext = maskCanvas?.getContext("2d");
        if (!maskCanvas || !source || !maskContext) continue;
        const mask = observation.mask;
        if (source.width !== mask.width) source.width = mask.width;
        if (source.height !== mask.height) source.height = mask.height;
        const sourceContext = source.getContext("2d");
        if (!sourceContext) continue;
        sourceContext.putImageData(mask, 0, 0);
        maskContext.clearRect(0, 0, maskCanvas.width, maskCanvas.height);
        maskContext.imageSmoothingEnabled = false;
        maskContext.drawImage(source, 0, 0, maskCanvas.width, maskCanvas.height);
        const style = getComputedStyle(maskCanvas);
        const scaleX = maskCanvas.width / mask.width;
        const scaleY = maskCanvas.height / mask.height;
        maskContext.save();
        maskContext.fillStyle = style.getPropertyValue(
          contact.state === "press candidate" ? "--color-success" : "--color-info",
        ).trim();
        for (const index of observation.contour?.boundary ?? []) {
          maskContext.fillRect(
            (index % mask.width) * scaleX,
            Math.floor(index / mask.width) * scaleY,
            scaleX,
            scaleY,
          );
        }
        maskContext.strokeStyle = style.getPropertyValue("--color-accent-light").trim();
        maskContext.lineWidth = 2;
        maskContext.setLineDash([6, 4]);
        const cutoffY = (mask.height / 2 + SHADOW_CUTOFF_OFFSET_Y) * scaleY;
        maskContext.beginPath();
        maskContext.moveTo(0, cutoffY);
        maskContext.lineTo(maskCanvas.width, cutoffY);
        maskContext.stroke();
        maskContext.restore();
        setShadowMaskCount((count) => count + 1);
      }
      setFingerDebug((current) =>
        current.map((finger) => {
          const observation = shadowObservationsRef.current.get(finger.id);
          const contact = shadowContactsRef.current.get(finger.id);
          return observation
            ? {
                ...finger,
                shadow: observation.state,
                shadowStrength: observation.measurement.shadowStrength,
                shadowLumaChange: observation.lumaChange,
                shadowDarkArea: observation.measurement.darkArea,
                shadowContourArea: observation.contour?.areaPixels ?? null,
                shadowContact: contact?.state ?? "unknown",
                shadowPeakArea: contact?.peakArea ?? null,
                shadowAreaRatio: contact?.areaRatio ?? null,
              }
            : finger;
        }),
      );
    };
    worker.onerror = (event) => {
      if (cancelled) return;
      worker.terminate();
      shadowWorkerRef.current = null;
      shadowWorkInFlightRef.current = false;
      shadowMeasurementsRef.current.clear();
      shadowObservationsRef.current.clear();
      shadowContactsRef.current.clear();
      shadowKeyOverlapRef.current.clear();
      setShadowWorkerError(event.message || "Worker failed without an error message");
    };
    return () => {
      cancelled = true;
      worker.terminate();
      shadowWorkerRef.current = null;
      shadowWorkInFlightRef.current = false;
    };
  }, []);

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
    const video = videoRef.current;
    const processingCanvas = processingCanvasRef.current;
    let imageData: ImageData | null = null;
    shadowActiveIdsRef.current = new Set(fingertips.map(({ id }) => id));
    shadowPreviewIdRef.current = shadowPreviewFinger?.id ?? null;
    const shadowFrameAt = performance.now();
    if (
      video &&
      processingCanvas &&
      shadowWorkerRef.current &&
      !shadowWorkInFlightRef.current &&
      fingertips.length > 0 &&
      video.readyState >= 2 &&
      shadowFrameAt - shadowLastFrameAtRef.current >= SHADOW_DEBUG_INTERVAL_MS &&
      video.videoWidth > 0 &&
      video.videoHeight > 0
    ) {
      processingCanvas.width = video.videoWidth;
      processingCanvas.height = video.videoHeight;
      const processingContext = processingCanvas.getContext("2d");
      if (processingContext) {
        processingContext.drawImage(
          video,
          0,
          0,
          video.videoWidth,
          video.videoHeight,
        );
        imageData = processingContext.getImageData(
          0,
          0,
          video.videoWidth,
          video.videoHeight,
        );
        shadowLastFrameAtRef.current = shadowFrameAt;
      }
    }

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
      shadowKeyOverlapRef.current.set(fingertip.id, keyOverlap);
      if (!keyOverlap) shadowContactsRef.current.delete(fingertip.id);
      const shadowContact = shadowContactsRef.current.get(fingertip.id);
      const shadowObservation =
        shadowObservationsRef.current.get(fingertip.id) ?? null;
      const shadow = shadowObservation?.state ?? "unknown";
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
          finger,
          knuckleDistance!,
          false,
          KNUCKLE_RANGE_TOLERANCE,
        );
        if (boundaryY !== null) {
          const previousState = fingerStatesRef.current.get(fingertip.id);
          const threshold =
            previousState === "press candidate"
              ? boundaryY - BOUNDARY_Y_TOLERANCE
              : boundaryY + BOUNDARY_Y_TOLERANCE;
          pressed = fingertipScreenY! >= threshold;
        }
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
        shadow,
        shadowStrength: shadowObservation?.measurement.shadowStrength ?? null,
        shadowLumaChange: shadowObservation?.lumaChange ?? null,
        shadowDarkArea: shadowObservation?.measurement.darkArea ?? null,
        shadowContourArea: shadowObservation?.contour?.areaPixels ?? null,
        shadowContact: shadowContact?.state ?? "unknown",
        shadowPeakArea: shadowContact?.peakArea ?? null,
        shadowAreaRatio: shadowContact?.areaRatio ?? null,
      });
    }

    const activeIds = new Set(nextDebug.map(({ id }) => id));
    for (const id of fingerStatesRef.current.keys()) {
      if (!activeIds.has(id)) fingerStatesRef.current.delete(id);
    }
    for (const id of shadowMeasurementsRef.current.keys()) {
      if (!activeIds.has(id)) shadowMeasurementsRef.current.delete(id);
    }
    for (const id of shadowObservationsRef.current.keys()) {
      if (!activeIds.has(id)) shadowObservationsRef.current.delete(id);
    }
    for (const id of shadowContactsRef.current.keys()) {
      if (!activeIds.has(id)) shadowContactsRef.current.delete(id);
    }
    for (const id of shadowKeyOverlapRef.current.keys()) {
      if (!activeIds.has(id)) shadowKeyOverlapRef.current.delete(id);
    }
    const preview = shadowPreviewCanvasRef.current;
    const previewContext = preview?.getContext("2d");
    if (preview && previewContext && (imageData || !shadowPreviewFinger)) {
      previewContext.clearRect(0, 0, preview.width, preview.height);
      if (imageData && processingCanvas && shadowPreviewFinger) {
        const center = shadowPreviewFinger.point;
        const scale = SHADOW_PREVIEW_SIZE / (SHADOW_PREVIEW_RADIUS * 2);
        previewContext.save();
        previewContext.imageSmoothingEnabled = false;
        previewContext.translate(preview.width / 2, preview.height / 2);
        previewContext.scale(scale, scale);
        previewContext.translate(-Math.round(center.x), -Math.round(center.y));
        // Use the same camera snapshot as the measurements; guides stay separate.
        previewContext.drawImage(processingCanvas, 0, 0);
        drawShadowSamplingGuides(previewContext, center, scale);
        previewContext.restore();
      }
    }
    const maskCanvas = shadowMaskCanvasRef.current;
    const maskContext = maskCanvas?.getContext("2d");
    if (maskCanvas && maskContext && (imageData || !shadowPreviewFinger)) {
      maskContext.clearRect(0, 0, maskCanvas.width, maskCanvas.height);
    }
    if (imageData && shadowWorkerRef.current) {
      const request: ShadowWorkerRequest = {
        imageData,
        radius: SHADOW_PREVIEW_RADIUS,
        frameAtMs: shadowFrameAt,
        previewFingerId: shadowPreviewIdRef.current,
        fingers: fingertips
          .filter((finger) => hands[finger.handIndex])
          .map((finger) => ({
            id: finger.id,
            point: finger.point,
            previous: shadowMeasurementsRef.current.get(finger.id) ?? null,
            keyOverlap: shadowKeyOverlapRef.current.get(finger.id) ?? false,
          })),
      };
      shadowWorkInFlightRef.current = true;
      shadowWorkerRef.current.postMessage(request, [imageData.data.buffer]);
    }
    // This state is the intentionally derived data shown in the prototype debug panel.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setFingerDebug(nextDebug);

    // Console logging is intentionally disabled while tuning the visual prototype.
  }, [
    depthCalibration,
    fingertips,
    hands,
    markerDetection,
    shadowPreviewFinger,
    videoRef,
  ]);

  useEffect(() => {
    const overlay = overlayCanvasRef.current;
    if (!overlay) return;
    const video = videoRef.current;
    if (video && video.videoWidth > 0 && video.videoHeight > 0) {
      if (overlay.width !== video.videoWidth) overlay.width = video.videoWidth;
      if (overlay.height !== video.videoHeight) overlay.height = video.videoHeight;
    }

    const context = overlay.getContext("2d");
    if (!context) return;

    context.clearRect(0, 0, overlay.width, overlay.height);

    context.lineWidth = 4;
    context.font = "bold 24px Arial";
    context.textBaseline = "bottom";

    markerDetection?.observations.forEach((observation) => {
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
              .filter(({ landmarkIndex }) =>
                [4, 8, 12, 16, 20].includes(landmarkIndex),
              )
              .forEach((fingertip) => {
                const keyOverlap = getKeyCollisions(
                  [fingertip],
                  projectedWhiteKeys,
                  8,
                ).length > 0;
                if (!keyOverlap) return;
                const hand = hands[fingertip.handIndex];
                const landmark = hand?.landmarks[fingertip.landmarkIndex];
                const knuckleDistance = hand
                  ? getKnuckleDistance(hand.landmarks)
                  : null;
                if (!landmark || knuckleDistance === null) return;
                const fingerIndex = [4, 8, 12, 16, 20].indexOf(
                  fingertip.landmarkIndex,
                );
                if (fingerIndex < 0) return;
                const finger = DEPTH_FINGERS[fingerIndex];
                const boundaryY = getKnuckleBoundaryY(
                  depthCalibration,
                  finger,
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
                const colors = [
                  "#ff9f0a",
                  "#ff375f",
                  "#bf5af2",
                  "#64d2ff",
                  "#30d158",
                ];
                const color = colors[fingerIndex];
                context.strokeStyle = color;
                context.fillStyle = color;
                context.lineWidth = 3;
                context.setLineDash([16, 10]);
                context.beginPath();
                context.moveTo(0, screenY);
                context.lineTo(overlay.width, screenY);
                context.stroke();
                context.setLineDash([]);
                context.font = "bold 18px Arial";
                context.fillText(
                  `${finger} knuckle boundary${outsideRange ? " (outside range)" : ""}`,
                  12,
                  screenY - 8,
                );
                context.restore();
              });
          }
    }
    if (shadowPreviewFinger) {
      drawShadowSamplingGuides(context, shadowPreviewFinger.point);
    }
  }, [
    depthCalibration,
    fingertips,
    hands,
    markerDetection,
    onKeyTransitions,
    shadowPreviewFinger,
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
      <canvas ref={shadowMaskSourceRef} className="hidden" />
      <div className="absolute left-4 top-4 rounded bg-black/70 px-3 py-2 text-sm text-white">
        {markerDetection === null
          ? "Loading ArUco detector…"
          : markerDetection.missingIds.length === 0
            ? "All four ArUco boards detected"
            : `Missing IDs: ${markerDetection.missingIds.join(", ")}`}
      </div>
      <div className="absolute right-4 top-4 z-20 max-h-[70vh] max-w-[430px] overflow-auto rounded bg-black/80 px-3 py-2 font-mono text-xs text-white">
        <div className="mb-1 font-bold">Finger debug</div>
        <div className="mb-3 border-b border-white/20 pb-2">
          <div className="mb-1 font-bold">
            Index k-means preview
            {shadowPreviewFinger ? ` (H${shadowPreviewFinger.handIndex})` : ""}
          </div>
          <div className="mb-2" role="status">
            {shadowWorkerError
              ? `Mask unavailable: ${shadowWorkerError}`
              : !shadowPreviewFinger
                ? "Show your index finger to start the mask."
                : shadowMaskCount === 0
                  ? "Waiting for the first mask…"
                  : `Mask active · ${shadowMaskCount} frames received`}
          </div>
          <div className="mb-2 flex gap-2">
            <button
              type="button"
              aria-pressed={shadowPreviewMode === "mask"}
              onClick={() => setShadowPreviewMode("mask")}
              className={`rounded px-2 py-1 ${shadowPreviewMode === "mask" ? "bg-white text-ink" : "bg-surface-dark text-white"}`}
            >
              Black / white
            </button>
            <button
              type="button"
              aria-pressed={shadowPreviewMode === "camera"}
              onClick={() => setShadowPreviewMode("camera")}
              className={`rounded px-2 py-1 ${shadowPreviewMode === "camera" ? "bg-white text-ink" : "bg-surface-dark text-white"}`}
            >
              Camera
            </button>
          </div>
          <canvas
            ref={shadowMaskCanvasRef}
            width={SHADOW_PREVIEW_SIZE}
            height={SHADOW_PREVIEW_SIZE}
            aria-label="Black and white mask of the darkest color cluster in the index fingertip crop"
            className={`${shadowPreviewMode === "mask" ? "block" : "hidden"} h-auto max-w-full bg-surface-dark`}
          />
          <canvas
            ref={shadowPreviewCanvasRef}
            width={SHADOW_PREVIEW_SIZE}
            height={SHADOW_PREVIEW_SIZE}
            aria-label="Magnified camera view of the index fingertip crop used for k-means"
            className={`${shadowPreviewMode === "camera" ? "block" : "hidden"} h-auto max-w-full bg-surface-dark`}
          />
          <div className="mt-1">Black: darkest color group. White: other groups.</div>
          <div>Above purple dashed line: ignored. Outline: blue hover, green candidate.</div>
          <div className="mt-1 font-bold">
            Contour area: {shadowPreviewDebug?.shadowContourArea ?? "—"} pixels
          </div>
          <div className="font-bold">
            Shadow: {shadowPreviewDebug && !shadowPreviewDebug.keyOverlap
              ? "outside key"
              : shadowPreviewDebug?.shadowContact ?? "unknown"}
          </div>
          <div>
            Peak: {shadowPreviewDebug?.shadowPeakArea ?? "—"} pixels · Ratio: {
              shadowPreviewDebug?.shadowAreaRatio == null
                ? "—"
                : `${(shadowPreviewDebug.shadowAreaRatio * 100).toFixed(1)}%`
            }
          </div>
          <div>
            Candidate: ratio ≤{SHADOW_PRESS_AREA_RATIO * 100}% or area &lt;{SHADOW_PRESS_ABSOLUTE_AREA_PIXELS} pixels.
          </div>
          <div>Ink and remaining skin may still appear black.</div>
          <div>Camera view: purple box marks the crop; cross marks the fingertip.</div>
        </div>
        <div className="mb-2 border-b border-white/20 pb-1">
          calibration={depthCalibration ? "ready" : "missing"} mapping={
            markerDetection?.missingIds.length === 0 ? "ready" : "waiting"
          }
          <br />
          knuckle TL={depthCalibration
            ? depthCalibration.knuckleDistances["top-left"].toFixed(5)
            : "n/a"} TR={depthCalibration
            ? depthCalibration.knuckleDistances["top-right"].toFixed(5)
            : "n/a"} BL={depthCalibration
            ? depthCalibration.knuckleDistances["bottom-left"].toFixed(5)
            : "n/a"} BR={depthCalibration
            ? depthCalibration.knuckleDistances["bottom-right"].toFixed(5)
            : "n/a"} C={depthCalibration
            ? depthCalibration.knuckleDistances.center.toFixed(5)
            : "n/a"} current={fingerDebug[0]?.knuckleDistance?.toFixed(5) ?? "n/a"}
        </div>
        {fingerDebug.length === 0 ? (
          <div>No hand data</div>
        ) : (
          fingerDebug.map((finger) => (
            <div key={finger.id} className="mb-1">
              H{finger.handIndex} {finger.finger}: {finger.keyOverlap ? finger.shadowContact : "outside key"}
              {finger.shadowStrength === null
                ? ""
                : ` (area ${finger.shadowContourArea ?? "—"} px, dark ${((finger.shadowDarkArea ?? 0) * 100).toFixed(0)}%, Δ${
                    finger.shadowLumaChange?.toFixed(1) ?? "—"
                  })`}
            </div>
          ))
        )}
      </div>
    </>
  );
}
