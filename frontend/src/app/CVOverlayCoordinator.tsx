"use client";

import { useEffect, useRef, useState, type RefObject } from "react";
import { DEBUG_FLAGS, isDevMode } from "../debugFlags";
import { useCamera } from "./CameraContext";
import { useKeyboardLayout } from "./useKeyboardLayout";
import { cameraSignature, loadCalibration, markerCorners, PAGE_CORNERS } from "../cv/calibration";
import { MarkerDetector } from "../cv/markerDetector";
import { MarkerGeometryPolicy } from "../cv/markerGeometryPolicy";
import { computeHomography, invertHomography, projectPoint, type Homography } from "../cv/homography";
import { getWhiteKeyPolygons, pressWhiteKey, releaseWhiteKey } from "../cv/keyboardGeometry";
import { keyIndexToMidi } from "../cv/noteMap";
import {
  detectShadowBaseline, shadowAnalysisSize, ShadowKeyTransitions,
  SHADOW_BASELINE_CUTOFFS, type ShadowBaselineCutoff,
} from "../cv/liveShadowBaseline";
import { createKeyEventProducer } from "../events/keyEventProducer";
import type { LiveSession } from "../events/liveSession";
import { pipelineMetrics, recordMarkerDetection, recordCameraFrame } from "../diagnostics/performanceMetrics";

export default function CVOverlayCoordinator({ videoRef, session, activePitches }: {
  videoRef: RefObject<HTMLVideoElement | null>;
  session: LiveSession;
  activePitches: ReadonlySet<number>;
}) {
  const { stream, cameraReady } = useCamera();
  const layout = useKeyboardLayout();
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [devMode] = useState(isDevMode);
  const [cutoff, setCutoff] = useState<ShadowBaselineCutoff>(20);
  const [detectorStatus, setDetectorStatus] = useState("loading");
  const [status, setStatus] = useState("Loading sheet detector…");
  const controls = useRef({ activePitches, cutoff });
  useEffect(() => { controls.current = { activePitches, cutoff }; }, [activePitches, cutoff]);

  useEffect(() => {
    let cancelled = false;
    let raf = 0;
    let detector: MarkerDetector | null = null;
    let reference: ImageData | null = null;
    let cameraKey = "";
    let lastVideoTime = -1;
    let lastScan = -Infinity;
    let producerId: string | null = null;
    let producer: ReturnType<typeof createKeyEventProducer> | null = null;
    const transitions = new ShadowKeyTransitions();
    const policy = new MarkerGeometryPolicy<Homography>();
    const capture = document.createElement("canvas");
    const analysis = document.createElement("canvas");
    const captureContext = capture.getContext("2d", { willReadFrequently: true });
    const analysisContext = analysis.getContext("2d", { willReadFrequently: true });
    const release = () => {
      const changes = transitions.reset();
      producer?.(changes.pressed, changes.released, performance.now());
    };
    const reset = () => {
      release();
      reference = null;
      policy.reset();
      cameraKey = "";
      lastVideoTime = -1;
      lastScan = -Infinity;
      canvasRef.current?.getContext("2d")?.clearRect(0, 0, capture.width, capture.height);
    };
    // Session invalidation releases through NoteSession; discard local key state too.
    const unsubscribe = session.subscribe(() => {
      if (session.status.state !== "playing") transitions.reset();
    });
    const visibilityChanged = () => { if (document.hidden) reset(); };
    document.addEventListener("visibilitychange", visibilityChanged);

    const frame = (now: number) => {
      if (cancelled) return;
      raf = requestAnimationFrame(frame);
      if (document.hidden) return;
      const video = videoRef.current;
      const camera = cameraReady ? cameraSignature(stream, video) : null;
      if (!camera || !video || !captureContext || !analysisContext) {
        if (reference) { reset(); session.trackingFailed(); }
        return;
      }
      const nextCameraKey = JSON.stringify(camera);
      if (cameraKey && cameraKey !== nextCameraKey) { reset(); session.trackingFailed(); }
      cameraKey = nextCameraKey;
      // Process only a fresh decoded frame. Synchronous work has no pending queue.
      if (video.currentTime === lastVideoTime) return;
      lastVideoTime = video.currentTime;
      recordCameraFrame(performance.now());
      try {
        if (capture.width !== camera.width || capture.height !== camera.height) {
          capture.width = camera.width; capture.height = camera.height;
          const size = shadowAnalysisSize(camera.width, camera.height);
          analysis.width = size.width; analysis.height = size.height;
        }
        captureContext.drawImage(video, 0, 0, capture.width, capture.height);
        analysisContext.drawImage(capture, 0, 0, analysis.width, analysis.height);
        if (now - lastScan >= policy.checkIntervalMs && detector) {
          lastScan = now;
          const started = pipelineMetrics.enabled ? performance.now() : null;
          const detection = detector.detect(capture);
          if (started !== null) recordMarkerDetection(performance.now() - started);
          const corners = markerCorners(detection, camera);
          if (corners) {
            // Complete markers are deliberately assumed to mean no hands.
            const transform = computeHomography(corners, PAGE_CORNERS);
            const valid = devMode
              ? session.observeUncalibratedSheet(camera, corners)
              : session.observeCalibration(loadCalibration(), camera, corners);
            if (valid && transform) {
              policy.observe(transform);
              reference = analysisContext.getImageData(0, 0, analysis.width, analysis.height);
              setStatus("Sheet reference ready");
            } else {
              release(); reference = null; policy.clearGeometry();
              setStatus("Calibrate the current camera and sheet before playing.");
            }
          }
          // Marker misses retain the last geometry/reference and 10 s cadence.
        }
        const transform = policy.lastGoodGeometry;
        if (!reference || !transform) return;
        const started = pipelineMetrics.enabled ? performance.now() : null;
        const result = detectShadowBaseline(
          analysisContext.getImageData(0, 0, analysis.width, analysis.height), reference,
          camera.width, camera.height, transform, layout, controls.current.cutoff,
        );
        if (started !== null) pipelineMetrics.record("detection", performance.now() - started);
        session.observeTracking(); // Empty successful frames also keep readiness fresh.
        const id = session.sessionId;
        if (id !== producerId) {
          transitions.reset(); producerId = id;
          producer = id ? createKeyEventProducer(session, id) : null;
        }
        const currentKeys = session.status.state === "playing"
          ? result.pressedKeys : new Set<number>();
        const changes = transitions.update(currentKeys);
        // Audio dispatch precedes all drawing and React status updates.
        producer?.(changes.pressed, changes.released, performance.now());
        const canvas = canvasRef.current;
        const context = canvas?.getContext("2d");
        const sheetToFrame = invertHomography(transform);
        if (!canvas || !context || !sheetToFrame) return;
        if (canvas.width !== camera.width) canvas.width = camera.width;
        if (canvas.height !== camera.height) canvas.height = camera.height;
        context.clearRect(0, 0, canvas.width, canvas.height);
        const style = getComputedStyle(canvas);
        const accent = style.getPropertyValue("--color-accent").trim();
        context.strokeStyle = accent; context.lineWidth = 2;
        getWhiteKeyPolygons(layout).forEach((key, index) => {
          const polygon = key.map(point => projectPoint(sheetToFrame, point));
          if (polygon.some(point => !point)) return;
          const draw = result.pressedKeys.has(index) || controls.current.activePitches.has(keyIndexToMidi(index, layout)!) ? pressWhiteKey : releaseWhiteKey;
          draw(context, polygon as NonNullable<typeof polygon[number]>[], accent);
        });
        if (DEBUG_FLAGS.visualDebug) {
          context.fillStyle = style.getPropertyValue("--color-danger").trim();
          for (const candidate of result.candidates) {
            context.beginPath();
            context.arc(candidate.x * camera.width / analysis.width, candidate.y * camera.height / analysis.height, 5, 0, Math.PI * 2);
            context.fill();
          }
        }
      } catch {
        reset(); session.trackingFailed();
        setStatus("Camera analysis failed. Show the sheet markers to retry.");
      }
    };
    MarkerDetector.create().then(created => {
      if (cancelled) { created.dispose(); return; }
      detector = created;
      setDetectorStatus("ready");
      setStatus("Show all four sheet markers.");
      raf = requestAnimationFrame(frame);
    }).catch(() => {
      if (!cancelled) { setDetectorStatus("error"); session.trackingFailed(); setStatus("Sheet detector unavailable. Reload to retry."); }
    });
    return () => {
      cancelled = true; cancelAnimationFrame(raf); release(); unsubscribe();
      document.removeEventListener("visibilitychange", visibilityChanged);
      detector?.dispose();
      session.trackingFailed();
    };
  }, [stream, cameraReady, videoRef, session, layout, devMode]);

  return <>
    <canvas data-sheet-detector={detectorStatus} ref={canvasRef} className="absolute inset-0 z-10 h-full w-full object-cover scale-x-[-1] pointer-events-none" aria-label="Live shadow keyboard feedback" />
    {DEBUG_FLAGS.visualDebug && <div className="ms-pill absolute top-3 left-3 z-20 flex gap-3 text-[12px]">
      <span role="status">{status}</span>
      <label>DFS cutoff <select aria-label="DFS cutoff" className="ms-input" value={cutoff}
        onChange={event => setCutoff(Number(event.target.value) as ShadowBaselineCutoff)}>
        {SHADOW_BASELINE_CUTOFFS.map(value => <option key={value}>{value}</option>)}
      </select></label>
    </div>}
  </>;
}
