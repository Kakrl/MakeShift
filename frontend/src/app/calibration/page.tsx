"use client";

import { registerCameraVideo } from "../../diagnostics/cameraVideo";

import { useState, useEffect, useRef } from "react";
import Link from "next/link";
import SideNav from "../SideNav";
import PageTopBar from "../PageTopBar";
import { useRouter } from "next/navigation";
import { useCamera } from "../CameraContext";
import CameraStatusOverlay from "../CameraStatusOverlay";
import { rainbow } from "../rainbow";
import { MarkerDetector } from "../../cv/markerDetector";
import { getWhiteKeyPolygons, getPianoCorners } from "../../cv/keyboardGeometry";
import { paperFits, paperOctaves, startingNotes, usableLayout, type KeyboardLayout } from "../../cv/keyboardLayout";
import { saveKeyboardLayout, subscribeKeyboardLayout } from "../../lib/keyboardSettings";
import { useKeyboardLayout } from "../useKeyboardLayout";
import { midiToPitch } from "../../cv/noteMap";
import { computeHomography, projectPoint } from "../../cv/homography";
import type { Homography } from "../../cv/homography";
import type { MarkerDetectionResult, Point } from "../../cv/types";
import {
  LIGHTING_MESSAGES,
  MAX_BRIGHTNESS,
  MIN_BRIGHTNESS,
  readFrameBrightness,
  type LightingReading,
} from "../lighting";

import { cameraSignature, markerCorners, compatibleCalibration, validateCalibration, saveCalibration, MARKER_ACQUIRE_INTERVAL_MS, MARKER_CHECK_INTERVAL_MS,
  SHEET_ID, type CameraSignature } from "../../cv/calibration";
const TOTAL_STEPS = 3;

const PAGE_CORNERS: [Point, Point, Point, Point] = [
  { x: 0, y: 0 },
  { x: 1, y: 0 },
  { x: 1, y: 1 },
  { x: 0, y: 1 },
];


const OCTAVE_OPTIONS = [1, 2, 3];

function ChevronDown() {
  return (
    <svg aria-hidden="true" width="16" height="16" viewBox="0 0 16 16" fill="none" xmlns="http://www.w3.org/2000/svg">
      <path d="M4 6L8 10L12 6" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

function AlertTriangle() {
  return (
    <svg aria-hidden="true" width="20" height="20" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
      <path d="M12 4L22 20H2L12 4Z" fill="var(--color-danger)" stroke="var(--color-danger)" strokeWidth="2" strokeLinejoin="round" />
      <line x1="12" y1="10" x2="12" y2="15" stroke="var(--color-white)" strokeWidth="2" strokeLinecap="round" />
      <circle cx="12" cy="17.75" r="1" fill="var(--color-white)" />
    </svg>
  );
}

function SuccessBadge({ label }: { label: string }) {
  return (
    <div className="ms-chip ms-chip-success">
      <svg width="16" height="16" viewBox="0 0 16 16" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
        <circle cx="8" cy="8" r="7" fill="var(--color-success)" />
        <path d="M4.5 8L6.8 10.5L11.5 5.5" stroke="var(--color-white)" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
      <span>{label}</span>
    </div>
  );
}

const STEP_NAMES = ["Setup", "Lighting", "Paper"];

function getCalibrationSettingsError(
  captured: { camera: CameraSignature; layout: KeyboardLayout } | null,
  camera: CameraSignature,
  layout: KeyboardLayout,
): string | null {
  if (!captured) {
    return "Camera and keyboard settings were not recorded at the paper step. Go back to Check paper and try again.";
  }
  if (
    captured.camera.deviceId !== camera.deviceId ||
    captured.camera.width !== camera.width ||
    captured.camera.height !== camera.height ||
    captured.camera.facingMode !== camera.facingMode
  ) {
    return "Camera settings changed during calibration. Go back to Check paper and try again.";
  }
  if (
    captured.layout.octaves !== layout.octaves ||
    captured.layout.startingMidi !== layout.startingMidi ||
    captured.layout.whiteKeys !== layout.whiteKeys ||
    paperOctaves(captured.layout) !== paperOctaves(layout) ||
    !!captured.layout.paperFitOverride !== !!layout.paperFitOverride
  ) {
    return "Keyboard settings changed during calibration. Go back to Check paper and try again.";
  }
  if (!usableLayout(layout)) {
    return "Keyboard settings are invalid or the selected range does not fit the paper.";
  }
  return null;
}

/** Labeled stepper above the camera. Each step has its own rainbow color;
 * done steps are checked and each line segment fills solid in its step's color. */
function ProgressBar({ current, complete }: { current: number; complete: boolean }) {
  const total = STEP_NAMES.length;
  return (
    <div
      role="progressbar"
      aria-label="Calibration progress"
      aria-valuenow={current}
      aria-valuemin={1}
      aria-valuemax={total}
      aria-valuetext={complete ? "Calibration complete" : `Step ${current} of ${total}: ${STEP_NAMES[current - 1]}`}
      className="flex items-center pb-[22px]"
    >
      {STEP_NAMES.map((name, i) => {
        const stepNum = i + 1;
        const done = complete || stepNum < current;
        const isCurrent = !complete && stepNum === current;
        const hue = rainbow(i);
        const align = i === 0 ? "left-0" : i === total - 1 ? "right-0" : "left-1/2 -translate-x-1/2";
        return (
          <div key={name} className="flex flex-1 items-center last:flex-none">
            <div className="relative shrink-0">
              <span
                aria-hidden="true"
                className={`flex size-6 items-center justify-center rounded-full text-[12px] font-semibold tabular-nums transition-[background-color,color,box-shadow] duration-200 ease-out ${
                  done || isCurrent
                    ? hue.fill
                    : "bg-white text-ink-muted shadow-[inset_0_0_0_1.5px_var(--color-divider)]"
                }`}
                style={isCurrent ? { boxShadow: `0 0 0 4px color-mix(in srgb, ${hue.color} 28%, transparent)` } : undefined}
              >
                {done ? (
                  <svg width="12" height="12" viewBox="0 0 12 12" fill="none"><path d="M2.5 6.25L5 8.5L9.5 3.5" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" /></svg>
                ) : stepNum}
              </span>
              <span
                aria-hidden="true"
                className={`absolute top-[30px] ${align} whitespace-nowrap text-[12px] transition-colors duration-200 ${isCurrent ? "font-semibold text-ink" : done ? "text-ink" : "text-ink-muted"}`}
              >
                {name}
              </span>
            </div>
            {i < total - 1 && (
              <div aria-hidden="true" className="mx-1.5 h-1 flex-1 overflow-hidden rounded-full bg-divider">
                <div
                  className="h-full w-full origin-left rounded-full transition-transform duration-300 ease-out"
                  style={{
                    background: hue.color,
                    transform: `scaleX(${done ? 1 : 0})`,
                  }}
                />
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}

export default function Calibration() {
  const [step, setStep] = useState(1);

  // Step 1
  const layout = useKeyboardLayout();

  const [sheetDetected, setSheetDetected] = useState(false);
  const [markerDetection, setMarkerDetection] =
    useState<MarkerDetectionResult | null>(null);
  const [sheetGeometry, setSheetGeometry] = useState<{
    pianoCorners: Point[];
    whiteKeys: Point[][];
    homography: Homography;
  } | null>(null);
  const [showHelpModal, setShowHelpModal] = useState(false);
  const [paperError, setPaperError] = useState(false);
  const [captureError, setCaptureError] = useState<string | null>(null);
  const [sheetDetectorStatus, setSheetDetectorStatus] =
    useState<"loading" | "ready" | "error">("loading");

  // #13: the video element reports 0x0 until it has decoded a frame
  const [frameReady, setFrameReady] = useState(false);

  // #16: sampled from the live frame during step 2
  const [lighting, setLighting] = useState<LightingReading | null>(null);

  const [corners, setCorners] = useState<Point[] | null>(null);
  const calibrationSettingsRef = useRef<{
    camera: CameraSignature;
    layout: KeyboardLayout;
  } | null>(null);
  const detectorRef = useRef<MarkerDetector | null>(null);
  const router = useRouter();
  const videoRef = useRef<HTMLVideoElement>(null);
  useEffect(() => registerCameraVideo(videoRef.current), []);
  const sheetDetectionCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const sheetOverlayCanvasRef = useRef<HTMLCanvasElement>(null);
  const { stream, cameraReady } = useCamera();
  const brightnessCanvasRef = useRef<HTMLCanvasElement | null>(null);

  useEffect(() => subscribeKeyboardLayout(() => {
    // Covers both local controls and another tab changing settings mid-capture.
    calibrationSettingsRef.current = null;
    setStep(1);
    setCorners(null);
    setSheetGeometry(null);
    setSheetDetected(false);
  }), []);

  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;

    const update = () =>
      setFrameReady(
        video.readyState >= HTMLMediaElement.HAVE_CURRENT_DATA &&
          video.videoWidth > 0 &&
          video.videoHeight > 0,
      );

    // A remounted or retried stream may already be decoding, in which case no
    // further events fire; poll once on the next frame to catch that case.
    const raf = requestAnimationFrame(update);
    for (const evt of ["loadedmetadata", "loadeddata", "playing", "emptied"]) {
      video.addEventListener(evt, update);
    }
    return () => {
      cancelAnimationFrame(raf);
      for (const evt of ["loadedmetadata", "loadeddata", "playing", "emptied"]) {
        video.removeEventListener(evt, update);
      }
    };
  }, [stream]);

  useEffect(() => {
    if (stream && videoRef.current) {
      videoRef.current.srcObject = stream;
    }
  }, [stream]);

  // #16: poll the live frame only while the lighting step is visible
  useEffect(() => {
    if (step !== 2 || !cameraReady || !frameReady) return;

    if (!brightnessCanvasRef.current) {
      brightnessCanvasRef.current = document.createElement("canvas");
    }
    const scratch = brightnessCanvasRef.current;

    const sample = () => {
      const video = videoRef.current;
      if (!video) return;
      const reading = readFrameBrightness(video, scratch);
      if (reading) setLighting(reading);
    };

    const raf = requestAnimationFrame(sample);
    const interval = setInterval(sample, 400);
    return () => {
      cancelAnimationFrame(raf);
      clearInterval(interval);
    };
  }, [step, cameraReady, frameReady]);

  function resetInteractiveStepState() {
    setShowHelpModal(false);
    setPaperError(false);
    setCaptureError(null);
    setLighting(null);
  }

  function goToAdjacentStep(delta: -1 | 1) {
    resetInteractiveStepState();
    setStep(step + delta);
  }

  function changeLayout(patch: Partial<KeyboardLayout>) {
    const octaves = patch.octaves ?? layout.octaves;
    const starts = startingNotes(octaves);
    const startingMidi = Math.min(patch.startingMidi ?? layout.startingMidi, starts.at(-1)!);
    const result = saveKeyboardLayout({ ...layout, paperOctaves: paperOctaves(layout),
      paperFitOverride: false, ...patch, octaves, startingMidi, whiteKeys: octaves * 7 + 1 });
    calibrationSettingsRef.current = null;
    setCorners(null);
    setSheetGeometry(null);
    setSheetDetected(false);
    resetInteractiveStepState();
    if (!result.ok) setCaptureError("Could not save keyboard settings. Enable browser storage and retry.");
  }

  useEffect(() => {
    if (!showHelpModal) return;
    const handleKeyDown = (e: KeyboardEvent) => { if (e.key === "Escape") setShowHelpModal(false); };
    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [showHelpModal]);

  useEffect(() => {
    let cancelled = false;
    MarkerDetector.create().then(detector => {
      if (cancelled) { detector.dispose(); return; }
      detectorRef.current = detector;
      setSheetDetectorStatus("ready");
    }).catch(() => {
      if (cancelled) return;
      setSheetDetectorStatus("error");
      setCaptureError("Sheet detector unavailable. Reload to retry.");
    });
    return () => { cancelled = true; detectorRef.current?.dispose(); detectorRef.current = null; };
  }, []);

  useEffect(() => {
    calibrationSettingsRef.current = null;
  }, [stream]);

  function readSheet() {
    const video = videoRef.current;
    const camera = cameraSignature(stream, video);
    const detector = detectorRef.current;
    if (!video || !camera || !detector) throw new Error("Wait for the camera and sheet detector, then retry.");
    const canvas = document.createElement("canvas");
    canvas.width = camera.width; canvas.height = camera.height;
    const context = canvas.getContext("2d");
    if (!context) throw new Error("Unable to read the camera frame.");
    context.drawImage(video, 0, 0);
    const observed = markerCorners(detector.detect(canvas), camera);
    if (!observed) throw new Error("Show all four sheet markers in a clear, flat rectangle, then retry.");
    return { camera, corners: observed };
  }

  function checkPaper() {
    try {
      const observed = readSheet();
      calibrationSettingsRef.current = {
        camera: observed.camera,
        layout: { ...layout },
      };
      setCorners(observed.corners);
      setSheetDetected(true);
      setPaperError(false); setCaptureError(null);
    } catch (error) {
      setCorners(null); setPaperError(true); setSheetDetected(false);
      setCaptureError(error instanceof Error ? error.message : "Unable to detect the sheet.");
    }
  }

  useEffect(() => {
    if (step !== 3 || !cameraReady || !frameReady || sheetDetectorStatus !== "ready") return;

    calibrationSettingsRef.current = null;
    setSheetDetected(false);
    setMarkerDetection(null);
    setSheetGeometry(null);
    setCorners(null);
    let cancelled = false;
    const detector = detectorRef.current;
    let acquired = false;
    let timeout: number | undefined;
    const canvas =
      sheetDetectionCanvasRef.current ?? document.createElement("canvas");
    sheetDetectionCanvasRef.current = canvas;

    const checkSheet = () => {
      if (cancelled || !detector) return;
      let nextCheckInterval = acquired ? MARKER_CHECK_INTERVAL_MS : MARKER_ACQUIRE_INTERVAL_MS;
      const video = videoRef.current;
      if (video && video.videoWidth > 0 && video.videoHeight > 0) {
        canvas.width = video.videoWidth;
        canvas.height = video.videoHeight;
        const context = canvas.getContext("2d");
        if (context) {
          context.drawImage(video, 0, 0, canvas.width, canvas.height);
          let detection: MarkerDetectionResult;
          try { detection = detector.detect(canvas); } catch {
            setCaptureError("Could not read the sheet. Check paper to retry.");
            timeout = window.setTimeout(checkSheet, nextCheckInterval);
            return;
          }
          setMarkerDetection(detection);
          if (detection.missingIds.length === 0) {
            nextCheckInterval = MARKER_CHECK_INTERVAL_MS;
            const markerCenters = new Map(
              detection.observations.map((observation) => [
                observation.id,
                observation.center,
              ]),
            );
            const targetCorners = [0, 1, 2, 3].map((id) =>
              markerCenters.get(id),
            );
            const homography = targetCorners.every(
              (corner): corner is Point => corner !== undefined,
            )
              ? computeHomography(PAGE_CORNERS, targetCorners)
              : null;
            if (homography) {
              const pianoCorners = getPianoCorners(layout).map((corner) =>
                projectPoint(homography, corner),
              );
              const whiteKeys = getWhiteKeyPolygons(layout).map((key) =>
                key.map((corner) => projectPoint(homography, corner)),
              );
              if (
                pianoCorners.every((corner): corner is Point => corner !== null) &&
                whiteKeys.every((key) =>
                  key.every((corner): corner is Point => corner !== null),
                )
              ) {
                const camera = cameraSignature(stream, video);
                const observedCorners = camera
                  ? markerCorners(detection, camera)
                  : null;
                if (observedCorners) {
                  if (!calibrationSettingsRef.current && camera) {
                    calibrationSettingsRef.current = {
                      camera,
                      layout: { ...layout },
                    };
                  }
                  acquired = true;
                  setCorners(observedCorners);
                  setSheetDetected(true);
                  setSheetGeometry({
                    pianoCorners,
                    whiteKeys,
                    homography,
                  });
                }
              }
            }
          }
        }
      }
      timeout = window.setTimeout(checkSheet, nextCheckInterval);
    };

    checkSheet();

    return () => {
      cancelled = true;
      if (timeout !== undefined) window.clearTimeout(timeout);
    };
  }, [cameraReady, frameReady, step, stream, layout, sheetDetectorStatus]);

  useEffect(() => {
    const canvas = sheetOverlayCanvasRef.current;
    const video = videoRef.current;
    if (!canvas || !video) {
      return;
    }

    if (!sheetGeometry && !markerDetection) {
      canvas?.getContext("2d")?.clearRect(0, 0, canvas.width, canvas.height);
      return;
    }

    canvas.width = video.videoWidth;
    canvas.height = video.videoHeight;
    const context = canvas.getContext("2d");
    if (!context) return;

    const accent =
      getComputedStyle(document.documentElement)
        .getPropertyValue("--color-accent")
        .trim() || "var(--color-accent)";
    const white =
      getComputedStyle(document.documentElement)
        .getPropertyValue("--color-white")
        .trim() || "var(--color-white)";

    context.clearRect(0, 0, canvas.width, canvas.height);
    if (sheetGeometry) {
      context.lineWidth = 3;
      context.strokeStyle = accent;
      context.beginPath();
      sheetGeometry.pianoCorners.forEach((corner, index) => {
        if (index === 0) context.moveTo(corner.x, corner.y);
        else context.lineTo(corner.x, corner.y);
      });
      context.closePath();
      context.stroke();

      context.lineWidth = 1.5;
      context.strokeStyle = accent;
      context.fillStyle = white;
      sheetGeometry.whiteKeys.forEach((key) => {
        context.beginPath();
        key.forEach((corner, index) => {
          if (index === 0) context.moveTo(corner.x, corner.y);
          else context.lineTo(corner.x, corner.y);
        });
        context.closePath();
        context.globalAlpha = 0.32;
        context.fill();
        context.globalAlpha = 1;
        context.stroke();
      });
    }

    if (step === 3 && markerDetection) {
      context.lineWidth = 3;
      context.strokeStyle = accent;
      context.fillStyle = accent;
      context.font = "bold 24px sans-serif";
      for (const marker of markerDetection.observations) {
        context.beginPath();
        marker.corners.forEach((corner, index) => {
          if (index === 0) context.moveTo(corner.x, corner.y);
          else context.lineTo(corner.x, corner.y);
        });
        context.closePath();
        context.stroke();
        context.fillText(`ID ${marker.id}`, marker.center.x + 8, marker.center.y);
      }
    }
  }, [frameReady, markerDetection, sheetGeometry, step]);

  const handleComplete = () => {
    try {
      const currentCamera = cameraSignature(stream, videoRef.current);
      if (!currentCamera) {
        throw new Error("Camera settings are unavailable. Check the camera connection and retry.");
      }
      const settingsError = getCalibrationSettingsError(
        calibrationSettingsRef.current,
        currentCamera,
        layout,
      );
      if (settingsError) throw new Error(settingsError);
      const observed = readSheet();
      if (!compatibleCalibration({
        version: 2, coordinates: "unmirrored-frame-pixels/marker-unit-square",
        sheet: SHEET_ID, camera: currentCamera, layout, corners: corners ?? [],
        contact: { model: "filtered-directional-shadow-v1" },
      }, observed.camera, observed.corners, layout)) {
        throw new Error("The camera or sheet moved. Return to Check paper and retry.");
      }
      const result = validateCalibration({
        version: 2, coordinates: "unmirrored-frame-pixels/marker-unit-square",
        sheet: SHEET_ID, camera: currentCamera, layout, corners: observed.corners,
        contact: { model: "filtered-directional-shadow-v1" },
      });
      if (!result || !saveCalibration(result)) {
        throw new Error("Could not save calibration. Enable browser storage and retry.");
      }
      router.push("/");
    } catch (error) { setCaptureError(error instanceof Error ? error.message : "Please retry calibration."); }
  };

  const lightingOk = lighting?.verdict === "ok";

  const canAdvance = () => {
    if (step === 1) return usableLayout(layout);
    if (step === 2) return lightingOk; // #16
    if (step === 3) return sheetDetected;
    return true;
  };

  const isComplete = step > TOTAL_STEPS;

  // Counting down right now?
  const showPreviousStep = !isComplete && step > 1;
  const showExitCalibration = step === 1;
  // Step 1 is settings only; every later step asks the user to judge the camera feed.
  const showNextStep =
    !isComplete && canAdvance() && (step === 1 || cameraReady);

  // ── Camera overlays per step ──────────────────────────────────────────────
  const renderCameraOverlay = () => {
    if (isComplete) return null;

    if (step === 1) return null;

    // ── Step 2: lighting ──
    if (step === 2) {
      if (!lighting) {
        return (
          <div className="ms-pill absolute top-4 left-1/2 -translate-x-1/2 max-w-[92%] w-max pointer-events-none">
            <span>Measuring lighting…</span>
          </div>
        );
      }
      return lighting.verdict === "ok" ? (
        <div className="ms-pill ms-pill-success absolute top-4 left-1/2 -translate-x-1/2 max-w-[92%] w-max pointer-events-none">
          <svg width="18" height="18" viewBox="0 0 18 18" fill="none" aria-hidden="true"><circle cx="9" cy="9" r="8" fill="var(--color-white)"/><path d="M5.5 9.25L7.75 11.5L12.5 6.5" stroke="var(--color-success-strong)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/></svg>
          <span>{LIGHTING_MESSAGES.ok}</span>
        </div>
      ) : (
        <div className="ms-pill absolute top-4 left-1/2 -translate-x-1/2 max-w-[92%] w-max pointer-events-none">
          <AlertTriangle />
          <p>{LIGHTING_MESSAGES[lighting.verdict]}</p>
        </div>
      );
    }

    // ── Step 3: align paper ──
    if (step === 3) {
      return (
        <div className="absolute inset-0">
          {/* Paper error banner */}
          {paperError && (
            <div className="ms-dialog absolute top-4 left-1/2 -translate-x-1/2 z-20 rounded-[16px] px-5 py-4 flex items-start gap-3 w-[480px] max-w-[90%]">
              {/* Red triangle icon */}
              <svg className="shrink-0 mt-0.5" width="28" height="28" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
                <path d="M12 3L22 20H2L12 3Z" fill="var(--color-danger)" />
                <line x1="12" y1="9" x2="12" y2="14" stroke="var(--color-white)" strokeWidth="2" strokeLinecap="round" />
                <circle cx="12" cy="17" r="1" fill="var(--color-white)" />
              </svg>
              <div className="flex flex-col gap-0.5">
                <p className="text-[15px] font-semibold text-danger">Hmm, that doesn&apos;t look right</p>
                <p className="text-[14px] text-ink-muted">Fix the paper, or press ? for help.</p>
              </div>
              <button
                onClick={() => setPaperError(false)}
                aria-label="Dismiss error"
                className="ms-key ms-key-ghost ms-key-icon ml-auto -mr-2 -mt-1.5 size-8 shrink-0"
              >
                <svg aria-hidden="true" width="12" height="12" viewBox="0 0 14 14" fill="none"><path d="M3 3l8 8M11 3l-8 8" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" /></svg>
              </button>
            </div>
          )}

          {/* Marker-detection status */}
          {!paperError && sheetDetected && (
            <div className="ms-pill ms-pill-success absolute top-4 left-1/2 -translate-x-1/2 max-w-[92%] w-max pointer-events-none">
              <svg width="18" height="18" viewBox="0 0 18 18" fill="none" aria-hidden="true"><circle cx="9" cy="9" r="8" fill="var(--color-white)"/><path d="M5.5 9.25L7.75 11.5L12.5 6.5" stroke="var(--color-success-strong)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/></svg>
              <span>Paper found!</span>
            </div>
          )}

          {!paperError && !sheetDetected && (
            <div className="ms-pill absolute bottom-4 left-1/2 -translate-x-1/2 max-w-[92%] w-max pointer-events-none text-center">
              <p>
                Detected: {markerDetection?.observations.map(({ id }) => id).join(", ") || "none"}
                {" · "}
                Missing: {markerDetection?.missingIds.join(", ") || "0, 1, 2, 3"}
              </p>
            </div>
          )}
          {/* Help button */}
          <button onClick={() => setShowHelpModal(true)} aria-label="Show help" className="ms-key ms-key-icon absolute bottom-4 right-4 z-20 text-[17px] font-bold">?</button>
        </div>
      );
    }

    return null;
  };

  // ── Help modal ────────────────────────────────────────────────────────────
  const renderHelpModal = () => {
    if (!showHelpModal) return null;
    return (
      <div className="ms-backdrop absolute inset-0 z-50 flex items-center justify-center">
        <div className="ms-dialog relative w-[88%] max-w-[640px] overflow-hidden rounded-[18px]">
          <div className="px-5 py-3.5 flex items-center justify-between">
            <p className="text-ink text-[15px] font-medium">Keep the sheet flat with all four markers visible</p>
          </div>
          <button onClick={() => setShowHelpModal(false)} aria-label="Close" className="ms-key ms-key-glass ms-key-icon absolute top-3 right-3 size-9 rounded-full">
            <svg aria-hidden="true" width="12" height="12" viewBox="0 0 14 14" fill="none"><path d="M3 3l8 8M11 3l-8 8" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" /></svg>
          </button>
        </div>
      </div>
    );
  };

  // ── Bottom bar step content ───────────────────────────────────────────────
  // Every step fills the same three fixed rows (title, controls, status) so
  // moving between steps, or a badge or message appearing, never shifts the
  // layout below.
  const restartCalibration = () => {
    setCorners(null); resetInteractiveStepState(); setStep(1);
  };

  const stepContent = (): { title: string; controls: React.ReactNode; status?: string | null; alert?: string | null } => {
    if (isComplete) {
      return {
        title: "All set! Don't move the camera or paper.",
        controls: (
          <>
            <SuccessBadge label="Sheet ready" />
            <button className="ms-key" onClick={restartCalibration}>Restart calibration</button>
          </>
        ),
      };
    }

    if (step === 1) {
      const range = `${midiToPitch(layout.startingMidi)}–${midiToPitch(layout.startingMidi + 12 * layout.octaves)}`;
      const fits = paperFits(layout);
      return {
        title: "Step 1: Pick your keyboard",
        // Lives in the reserved message line, so the warning never pushes the buttons.
        alert: fits
          ? null
          : `It does not fit ${paperOctaves(layout)} octave${paperOctaves(layout) === 1 ? "" : "s"} of paper. ${layout.paperFitOverride ? "It will go past the edge." : "Add more, or tick the box."}`,
        controls: (
          <>
            <div className="grid w-full grid-cols-[auto_1fr] items-center gap-x-3 gap-y-1.5">
              <label htmlFor="octave-count" className="text-[15px] text-ink-muted">Octaves</label>
              <div className="relative">
                <select id="octave-count" value={layout.octaves} onChange={(e) => changeLayout({ octaves: Number(e.target.value) })} className="ms-input w-full py-1.5">
                  {OCTAVE_OPTIONS.map((o) => <option key={o}>{o}</option>)}
                </select>
                <div className="absolute right-3 top-1/2 -translate-y-1/2 pointer-events-none text-ink-muted"><ChevronDown /></div>
              </div>
              <label htmlFor="starting-note" className="text-[15px] text-ink-muted">Lowest C</label>
              <div className="relative">
                <select id="starting-note" value={layout.startingMidi} onChange={(e) => changeLayout({ startingMidi: Number(e.target.value) })} className="ms-input w-full py-1.5">
                  {startingNotes(layout.octaves).map((midi) => <option key={midi} value={midi}>{midiToPitch(midi)}</option>)}
                </select>
                <div className="absolute right-3 top-1/2 -translate-y-1/2 pointer-events-none text-ink-muted"><ChevronDown /></div>
              </div>
              <label htmlFor="paper-octaves" className="text-[15px] text-ink-muted">Paper octaves</label>
              <div className="relative">
                <select id="paper-octaves" value={paperOctaves(layout)} onChange={(e) => changeLayout({ paperOctaves: Number(e.target.value) })} className="ms-input w-full py-1.5">
                  {OCTAVE_OPTIONS.map((o) => <option key={o}>{o}</option>)}
                </select>
                <div className="absolute right-3 top-1/2 -translate-y-1/2 pointer-events-none text-ink-muted"><ChevronDown /></div>
              </div>
            </div>
            {!fits && (
              <label className="flex items-start gap-2 text-[13px] leading-snug text-ink">
                <input type="checkbox" className="mt-0.5 accent-(--color-focus)" checked={!!layout.paperFitOverride} onChange={(e) => changeLayout({ paperFitOverride: e.target.checked })} />
                Allow the full keyboard to extend beyond my paper
              </label>
            )}
            {usableLayout(layout) && <SuccessBadge label={`${range} ready`} />}
          </>
        ),
      };
    }

    if (step === 2) {
      const pct = lighting ? Math.round(lighting.brightness * 100) : null;
      return {
        title: "Step 2: Check your lighting",
        controls: (
          <>
            <span className="min-w-[190px] text-[15px] text-ink-muted tabular-nums" aria-live="polite">
              Current: {pct === null ? "measuring…" : `${pct}% brightness`}
            </span>
            <span className="text-[15px] text-ink-muted tabular-nums">
              Target: {Math.round(MIN_BRIGHTNESS * 100)}–{Math.round(MAX_BRIGHTNESS * 100)}%
            </span>
            {lightingOk ? (
              <SuccessBadge label="Lighting OK" />
            ) : lighting ? (
              <div className="ms-chip ms-chip-danger">
                <span>{LIGHTING_MESSAGES[lighting.verdict]}</span>
              </div>
            ) : null}
          </>
        ),
      };
    }

    if (step === 3) {
      return {
        title: "Step 3: Show the whole paper",
        controls: (
          <>
            <button onClick={checkPaper} className="ms-key ms-key-primary px-5">Check paper</button>
            {corners && <SuccessBadge label="Sheet geometry validated" />}
          </>
        ),
      };
    }

    return { title: "", controls: null };
  };

  // The data attributes let the deployment smoke test wait for detectors.
  return (
    <div className="flex-1 bg-surface flex flex-col" data-sheet-detector={sheetDetectorStatus}>
      {/* Stepper: top of the page, as wide as the camera */}
      <PageTopBar>
        <div className="px-1">
          <ProgressBar current={isComplete ? TOTAL_STEPS : step} complete={isComplete} />
        </div>
      </PageTopBar>

      {/* Main area */}
      <div className="flex flex-col lg:flex-row pl-(--gutter-l) pr-(--gutter-r)">
        {/* Camera */}
        <div className="ms-stage w-full lg:w-auto lg:flex-1 lg:self-start aspect-video bg-surface-dark relative overflow-hidden">
          <video ref={videoRef} autoPlay playsInline muted className="absolute inset-0 w-full h-full object-cover scale-x-[-1]" />
          <canvas
            ref={sheetOverlayCanvasRef}
            className="absolute inset-0 z-10 h-full w-full object-cover scale-x-[-1] pointer-events-none"
            style={{
              display:
                step >= 3 && step <= TOTAL_STEPS
                  ? "block"
                  : "none",
            }}
          />
          {cameraReady && renderCameraOverlay()}
          <CameraStatusOverlay />
          {renderHelpModal()}
        </div>

        {/* Step panel lives beside the camera, so calibration never needs a
            scroll. Below lg it moves above the nav keys, right under the feed. */}
        <SideNav active="calibration">
          {(() => {
            const { title, controls, status, alert } = stepContent();
            return (
              <section
                aria-label="Calibration step"
                className="order-first lg:order-none flex flex-1 flex-col pt-4 lg:pt-6 lg:pl-6"
              >
                <div data-step-body className="flex min-h-[280px] flex-col">
                <p className="text-[18px] leading-[1.3] font-semibold tracking-[-0.01em] text-ink">
                  {title}
                </p>
                <div className="mt-3 flex flex-col items-start gap-3">{controls}</div>
                <div className="mt-2 min-h-[2lh] text-[14px] leading-5">
                  {captureError || alert ? (
                    <p role="alert" className="text-danger">{captureError ?? alert}</p>
                  ) : status ? (
                    <p className="text-ink-muted" aria-live="polite">{status}</p>
                  ) : null}
                </div>
                </div>

                {/* Pinned to the bottom of the sidebar, level with the camera. */}
                <div className="mt-auto grid grid-cols-2 gap-3 pt-4 pb-1">
                  <div className="flex">
                    {showExitCalibration ? (
                      <Link href="/" aria-label="Exit Calibration" className="ms-key w-full px-2 text-[15px] whitespace-nowrap">Exit</Link>
                    ) : showPreviousStep ? (
                      <button onClick={() => goToAdjacentStep(-1)} aria-label="Previous Step" className="ms-key w-full px-2 text-[15px] whitespace-nowrap">Back</button>
                    ) : null}
                  </div>
                  <div className="flex">
                    {isComplete ? (
                      <button onClick={handleComplete} className="ms-key ms-key-primary w-full px-2 text-[15px] whitespace-nowrap">Start Playing</button>
                    ) : showNextStep ? (
                      <button onClick={() => goToAdjacentStep(1)} className="ms-key ms-key-primary w-full px-2 text-[15px] whitespace-nowrap">Next Step</button>
                    ) : null}
                  </div>
                </div>
              </section>
            );
          })()}
        </SideNav>
      </div>

      <div className="pb-[clamp(8px,2dvh,36px)]" />
    </div>
  );
}
