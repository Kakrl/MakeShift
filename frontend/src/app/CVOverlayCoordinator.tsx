"use client";

import { useEffect, useMemo, useRef, useState, type RefObject } from "react";
import { DEBUG_FLAGS, isDevMode } from "../debugFlags";
import type { LiveSession } from "../events/liveSession";
import { createChromaticKeyProducer } from "../events/chromaticKeyProducer";
import {
  cameraSignature,
  loadCalibration,
  type CameraSignature,
} from "../cv/calibration";
import {
  VisionCameraPipeline,
  type VisionResult,
} from "../cv/visionCameraPipeline";
import type { Homography } from "../cv/homography";
import { midiToPitch } from "../cv/noteMap";
import { useKeyboardLayout } from "./useKeyboardLayout";
import { useCamera } from "./CameraContext";
import FallingNotesLayer from "./cv/FallingNotesLayer";
import VisionKeyHighlights from "./cv/VisionKeyHighlights";
import SheetAlignment, { type AlignmentScan } from "./SheetAlignment";

export default function CVOverlayCoordinator({
  videoRef,
  session,
  enabled = false,
  activePitches,
}: {
  videoRef: RefObject<HTMLVideoElement | null>;
  session: LiveSession;
  enabled?: boolean;
  activePitches: ReadonlySet<number>;
}) {
  const layout = useKeyboardLayout();
  const { stream, cameraReady } = useCamera();
  const pipelineRef = useRef<VisionCameraPipeline | null>(null);
  const homographyRef = useRef<Homography | null>(null);
  const [result, setResult] = useState<VisionResult | null>(null);
  const [message, setMessage] = useState("Loading Vision…");
  const [failed, setFailed] = useState(false);
  const [ready, setReady] = useState(false);
  const [attempt, setAttempt] = useState(0);
  const [observedCamera, setObservedCamera] = useState<CameraSignature | null>(
    null,
  );
  const [scan, setScan] = useState<AlignmentScan | null>(null);
  const [devMode] = useState(isDevMode);
  const producer = useMemo(
    () => createChromaticKeyProducer(session),
    [session],
  );
  const [saved, setSaved] = useState(loadCalibration);

  useEffect(() => {
    let revision: number | null = null;
    let animation = 0;
    let disposed = false;
    const camera = () =>
      cameraReady ? cameraSignature(stream, videoRef.current) : null;
    const unavailable = () => {
      homographyRef.current = null;
      revision = null;
      session.observeCalibration(loadCalibration(), camera(), null);
      if (!disposed) {
        setResult(null);
        setScan(null);
        setObservedCamera(null);
      }
    };
    const pipeline = new VisionCameraPipeline({
      video: () => videoRef.current,
      camera,
      layout,
      sessionId: () => session.sessionId,
      onUnavailable: unavailable,
      onStatus: (text, error) => {
        if (disposed) return;
        setMessage(text);
        setFailed(error);
        setReady(!error && !text.startsWith("Loading"));
        if (error) session.trackingFailed();
      },
      onFrame: ({
        result: next,
        camera: observedCamera,
        timestampMs,
        sessionId,
      }) => {
        if (disposed) return;
        if (revision !== null && next.referenceRevision !== revision)
          producer([], timestampMs, sessionId);
        revision = next.referenceRevision;
        const calibration = loadCalibration();
        const corners = next.geometry?.markerCenters ?? null;
        const valid = devMode
          ? session.observeUncalibratedSheet(observedCamera, corners)
          : session.observeCalibration(calibration, observedCamera, corners);
        if (valid && next.referenceReady && next.homographyReady) {
          session.observeTracking();
          // Frame observation time and session identity were captured before worker processing.
          producer(next.pressedKeys, timestampMs, sessionId);
        }
        homographyRef.current = next.geometry?.sheetToFrame ?? null;
        // Musical delivery above never waits for this drawing snapshot.
        setResult(next);
        setObservedCamera(observedCamera);
        setSaved(calibration);
        if (next.referenceScan.status === "captured") {
          setMessage("Reference captured. Vision is tracking the keyboard.");
          setScan(
            corners
              ? { camera: observedCamera, corners, at: Date.now() }
              : null,
          );
        } else if (next.referenceScan.status === "blocked") {
          const reasons = {
            "markers-missing-or-invalid": "Show all four markers.",
            "active-presses": "Release all keys.",
            "fingertips-in-piano": "Clear your hands from the keyboard.",
          };
          setMessage(
            `Reference not captured. ${reasons[next.referenceScan.reason!] ?? "Clear the keyboard."} Select Set reference to retry.`,
          );
        }
      },
    });
    pipelineRef.current = pipeline;
    const initial = setTimeout(() => {
      setMessage("Loading Vision…");
      setFailed(false);
      setReady(false);
      pipeline.start();
    }, 0);
    const tick = () => {
      pipeline.tick();
      animation = requestAnimationFrame(tick);
    };
    animation = requestAnimationFrame(tick);
    const visibility = () => {
      if (document.hidden) pipeline.reset();
    };
    document.addEventListener("visibilitychange", visibility);
    return () => {
      disposed = true;
      clearTimeout(initial);
      cancelAnimationFrame(animation);
      document.removeEventListener("visibilitychange", visibility);
      pipeline.dispose();
      pipelineRef.current = null;
    };
  }, [
    videoRef,
    session,
    stream,
    cameraReady,
    layout,
    producer,
    devMode,
    attempt,
  ]);

  const points = (polygon: readonly { x: number; y: number }[]) =>
    polygon.map((p) => `${p.x},${p.y}`).join(" ");
  return (
    <>
      {result && (
        <svg
          aria-hidden="true"
          viewBox={`0 0 ${result.width} ${result.height}`}
          preserveAspectRatio="xMidYMid slice"
          className="pointer-events-none absolute inset-0 z-10 h-full w-full scale-x-[-1]"
        >
          <VisionKeyHighlights
            result={result}
            layout={layout}
            activePitches={activePitches}
            enabled={enabled}
          />
          {result.pressRanges.map((range, i) => (
            <polygon
              key={`press-${i}`}
              points={points(range.outline)}
              fill="var(--color-accent-light)"
              fillOpacity="0.3"
              stroke="var(--color-accent-light)"
              strokeWidth="2"
            />
          ))}
          {DEBUG_FLAGS.visualDebug &&
            result.fingertips.map((tip) => (
              <circle
                key={tip.id}
                cx={tip.point.x}
                cy={tip.point.y}
                r="5"
                fill={
                  tip.pressed
                    ? "var(--color-accent-light)"
                    : "var(--color-white)"
                }
              />
            ))}
        </svg>
      )}
      <FallingNotesLayer
        homographyRef={homographyRef}
        videoRef={videoRef}
        layout={layout}
      />
      <SheetAlignment
        saved={saved}
        camera={observedCamera}
        scan={scan}
        reason={session.status.reason}
      />
      <div
        className="absolute bottom-3 left-3 right-3 z-30 flex flex-wrap items-center gap-2 rounded-lg bg-surface px-3 py-2 text-xs text-ink"
        data-vision-state={failed ? "error" : ready ? "ready" : "loading"}
      >
        <button
          type="button"
          className="ms-key shrink-0"
          disabled={!ready || !cameraReady || failed}
          onClick={() => pipelineRef.current?.setReference()}
        >
          Set reference
        </button>
        {failed && (
          <button
            type="button"
            className="ms-key shrink-0"
            onClick={() => setAttempt((n) => n + 1)}
          >
            Reload tracker
          </button>
        )}
        <p data-vision-status>{message}</p>
        {enabled && activePitches.size > 0 && (
          <p aria-label="Sounding notes">
            {[...activePitches].map(midiToPitch).join(", ")}
          </p>
        )}
      </div>
    </>
  );
}
