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
import { VisionCameraPipeline, type VisionResult } from "../../cv/visionCameraPipeline";
import { paperFits, paperOctaves, sameLayout, startingNotes, usableLayout, type KeyboardLayout } from "../../cv/keyboardLayout";
import { saveKeyboardLayout, subscribeKeyboardLayout } from "../../lib/keyboardSettings";
import {
  PROFILE_NAME_MAX,
  cleanName,
  deleteProfile,
  listProfiles,
  profileLayout,
  renameProfile,
  saveProfile,
  type CalibrationProfile,
  type ProfileResult,
} from "../../lib/calibrationProfiles";
import { useKeyboardLayout } from "../useKeyboardLayout";
import { midiToPitch } from "../../cv/noteMap";
import {
  LIGHTING_MESSAGES,
  MAX_BRIGHTNESS,
  MIN_BRIGHTNESS,
  readFrameBrightness,
  type LightingReading,
} from "../lighting";

import { cameraSignature, compatibleCalibration, validateCalibration, saveCalibration, loadCalibration,
  SHEET_ID, type CalibrationResult } from "../../cv/calibration";
const TOTAL_STEPS = 3;

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

const STEP_NAMES = ["Setup", "Lighting", "Reference"];

function profileError(result: Exclude<ProfileResult, { ok: true }>): string {
  switch (result.reason) {
    case "invalid-name": return "Enter a profile name.";
    case "invalid-layout": return "These keyboard settings cannot be saved as a profile.";
    case "duplicate-name": return "Another profile already uses that name.";
    case "not-found": return "That profile no longer exists.";
    case "quota": return "Browser storage is full. Free some space and retry.";
    default: return "Could not save profiles. Enable browser storage and retry.";
  }
}

const PAPER_HELP_TIPS = [
  "Keep the whole sheet in view, with all four corner markers showing.",
  "Remove your hands and other objects before capturing the reference.",
  "Lay it flat, with no folds or curled edges.",
  "Use even lighting, without glare or shadows on the markers.",
];

function PaperHelpIllustration() {
  const markers = [[52, 38], [252, 38], [252, 126], [52, 126]];
  const bracket = (x: number, y: number, dx: number, dy: number) =>
    `M${x} ${y + 14 * dy}V${y}H${x + 14 * dx}`;
  return (
    <svg role="img" aria-label="Paper sheet flat in the camera view with all four corner markers visible" viewBox="0 0 320 180" className="block w-full bg-surface-dark" style={{ aspectRatio: "16/9" }}>
      <rect x="40" y="26" width="240" height="128" rx="4" fill="var(--color-white)" />
      {Array.from({ length: 9 }, (_, i) => (
        <line key={i} x1={76 + i * 21} y1="62" x2={76 + i * 21} y2="138" stroke="var(--color-divider)" strokeWidth="1.5" />
      ))}
      <line x1="76" y1="138" x2="244" y2="138" stroke="var(--color-divider)" strokeWidth="1.5" />
      {markers.map(([x, y]) => (
        <g key={`${x}-${y}`}>
          <rect x={x} y={y} width="16" height="16" fill="var(--color-ink)" />
          <rect x={x + 4} y={y + 4} width="5" height="5" fill="var(--color-white)" />
          <rect x={x + 9} y={y + 9} width="3" height="3" fill="var(--color-white)" />
        </g>
      ))}
      <g fill="none" stroke="var(--color-success-soft)" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round">
        <path d={bracket(28, 14, 1, 1)} />
        <path d={bracket(292, 14, -1, 1)} />
        <path d={bracket(292, 166, -1, -1)} />
        <path d={bracket(28, 166, 1, -1)} />
      </g>
    </svg>
  );
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
  const [profiles, setProfiles] = useState<CalibrationProfile[]>([]);
  const [selectedProfileId, setSelectedProfileId] = useState("");
  const [profileDraft, setProfileDraft] = useState<{ mode: "save" | "rename"; name: string } | null>(null);
  const [profileStatus, setProfileStatus] = useState<string | null>(null);
  const [profileAlert, setProfileAlert] = useState<string | null>(null);
  const profileNameRef = useRef<HTMLInputElement>(null);

  const [sheetDetected, setSheetDetected] = useState(false);
  const [visionResult, setVisionResult] = useState<VisionResult | null>(null);
  const [showHelpModal, setShowHelpModal] = useState(false);
  const [captureError, setCaptureError] = useState<string | null>(null);
  const [sheetDetectorStatus, setSheetDetectorStatus] = useState<"loading" | "ready" | "error">("loading");
  const [captureMessage, setCaptureMessage] = useState("Clear the keyboard and show all four markers.");
  const [captureBusy, setCaptureBusy] = useState(false);
  const [attempt, setAttempt] = useState(0);
  const pipelineRef = useRef<VisionCameraPipeline | null>(null);
  const captureRequestedRef = useRef(false);
  // #13: the video element reports 0x0 until it has decoded a frame
  const [frameReady, setFrameReady] = useState(false);

  // #16: sampled from the live frame during step 2
  const [lighting, setLighting] = useState<LightingReading | null>(null);

  const resultRef = useRef<CalibrationResult | null>(null);
  const router = useRouter();
  const videoRef = useRef<HTMLVideoElement>(null);
  useEffect(() => registerCameraVideo(videoRef.current), []);
  const { stream, cameraReady } = useCamera();
  const brightnessCanvasRef = useRef<HTMLCanvasElement | null>(null);

  function clearCapture() {
    resultRef.current = null;
    captureRequestedRef.current = false;
    setSheetDetected(false);
    setVisionResult(null);
    setCaptureBusy(false);
  }

  useEffect(() => subscribeKeyboardLayout(() => {
    clearCapture();
    setStep(1);
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
    setCaptureError(null);
    setLighting(null);
  }

  function goToAdjacentStep(delta: -1 | 1) {
    if (delta === -1) clearCapture();
    resetInteractiveStepState();
    setSheetDetectorStatus("loading");
    setStep(step + delta);
  }

  useEffect(() => {
    const timer = setTimeout(() => setProfiles(listProfiles()), 0);
    return () => clearTimeout(timer);
  }, []);

  const selectedProfile = profiles.find(
    (p) => p.id === selectedProfileId && sameLayout(profileLayout(p), layout),
  ) ?? null;

  function changeLayout(patch: Partial<KeyboardLayout>): boolean {
    setProfileStatus(null);
    setProfileAlert(null);
    const octaves = patch.octaves ?? layout.octaves;
    const starts = startingNotes(octaves);
    const startingMidi = Math.min(patch.startingMidi ?? layout.startingMidi, starts.at(-1)!);
    const result = saveKeyboardLayout({ ...layout, paperOctaves: paperOctaves(layout),
      paperFitOverride: false, ...patch, octaves, startingMidi, whiteKeys: octaves * 7 + 1 });
    clearCapture();
    resetInteractiveStepState();
    if (!result.ok) setCaptureError("Could not save keyboard settings. Enable browser storage and retry.");
    return result.ok;
  }

  function applyProfile(id: string) {
    setProfileDraft(null);
    setSelectedProfileId(id);
    const profile = profiles.find((p) => p.id === id);
    if (!profile) return;
    const target = profileLayout(profile);
    const loaded = sameLayout(target, layout) || changeLayout({
      octaves: target.octaves,
      startingMidi: target.startingMidi,
      paperOctaves: paperOctaves(target),
      paperFitOverride: !!target.paperFitOverride,
    });
    if (loaded) setProfileStatus(`Loaded "${profile.name}". Step 3 still checks the paper.`);
  }

  function finishProfileChange(result: ProfileResult, success: (profile: CalibrationProfile) => string) {
    setProfiles(listProfiles());
    if (!result.ok) {
      setProfileStatus(null);
      setProfileAlert(profileError(result));
      return false;
    }
    setProfileAlert(null);
    setProfileStatus(success(result.profile));
    return true;
  }

  function submitProfileDraft(name: string) {
    if (!profileDraft) return;
    if (profileDraft.mode === "rename") {
      if (!selectedProfile) return setProfileDraft(null);
      if (finishProfileChange(renameProfile(selectedProfile.id, name), (p) => `Renamed to "${p.name}".`)) {
        setProfileDraft(null);
      }
      return;
    }
    const clash = profiles.find((p) => p.name.toLocaleLowerCase() === cleanName(name).toLocaleLowerCase());
    if (clash && clash.id !== selectedProfile?.id && !window.confirm(`Replace the "${clash.name}" profile?`)) return;
    const saved = loadCalibration();
    const corners = saved && sameLayout(saved.layout, layout) ? saved.corners : null;
    const result = saveProfile(name, layout, corners);
    if (finishProfileChange(result, (p) => `Saved "${p.name}".`)) {
      if (result.ok) setSelectedProfileId(result.profile.id);
      setProfileDraft(null);
    }
  }

  function removeSelectedProfile() {
    if (!selectedProfile || !window.confirm(`Delete the "${selectedProfile.name}" profile?`)) return;
    setProfileDraft(null);
    if (finishProfileChange(deleteProfile(selectedProfile.id), (p) => `Deleted "${p.name}".`)) {
      setSelectedProfileId("");
    }
  }

  useEffect(() => {
    if (!showHelpModal) return;
    const handleKeyDown = (e: KeyboardEvent) => { if (e.key === "Escape") setShowHelpModal(false); };
    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [showHelpModal]);

  // A calibration reference validates setup only. Home owns a separate worker
  // and asks for a fresh empty-keyboard reference before playing.
  useEffect(() => {
    if (step !== 3) return;
    let disposed = false;
    let animation = 0;
    resultRef.current = null;
    captureRequestedRef.current = false;
    const pipeline = new VisionCameraPipeline({
      video: () => videoRef.current,
      camera: () => cameraReady ? cameraSignature(stream, videoRef.current) : null,
      layout,
      sessionId: () => null,
      onUnavailable: () => { if (!disposed) clearCapture(); },
      onStatus: (message, error) => {
        if (disposed) return;
        setSheetDetectorStatus(error ? "error" : message.startsWith("Loading") ? "loading" : "ready");
        setCaptureMessage(message);
        if (error) setCaptureError(message);
      },
      onFrame: ({ result, camera }) => {
        if (disposed) return;
        setVisionResult(result);
        const savedSetup = resultRef.current;
        if (savedSetup && (!result.referenceReady || !result.homographyReady ||
            !compatibleCalibration(savedSetup, camera, result.geometry?.markerCenters ?? [], layout))) {
          clearCapture();
          setCaptureMessage("Sheet geometry changed. Clear the keyboard and capture again.");
          return;
        }
        if (!captureRequestedRef.current || result.referenceScan.status === "idle") return;
        captureRequestedRef.current = false;
        setCaptureBusy(false);
        if (result.referenceScan.status === "blocked") {
          setCaptureMessage("Reference not captured. Clear the keyboard, show all four markers, and retry.");
          return;
        }
        const saved = validateCalibration({
          version: 2, coordinates: "unmirrored-frame-pixels/marker-unit-square",
          sheet: SHEET_ID, camera, layout,
          corners: result.geometry?.markerCenters,
          detector: "vision-reference-v1",
        });
        if (!result.referenceReady || !result.homographyReady || !saved) {
          setCaptureError("Reference geometry is invalid. Capture again.");
          return;
        }
        resultRef.current = saved;
        setSheetDetected(true);
        setCaptureMessage("Sheet geometry validated. Continue to save your setup.");
      },
    });
    pipelineRef.current = pipeline;
    const startup = setTimeout(() => {
      clearCapture();
      setSheetDetectorStatus("loading");
      setCaptureError(null);
      pipeline.start();
    }, 0);
    const tick = () => { pipeline.tick(); animation = requestAnimationFrame(tick); };
    animation = requestAnimationFrame(tick);
    return () => {
      disposed = true;
      clearTimeout(startup);
      cancelAnimationFrame(animation);
      pipeline.dispose();
      pipelineRef.current = null;
    };
  }, [step, stream, cameraReady, layout, attempt]);

  useEffect(() => {
    const invalidate = () => {
      if (document.hidden) {
        pipelineRef.current?.reset();
        clearCapture();
      }
    };
    document.addEventListener("visibilitychange", invalidate);
    return () => document.removeEventListener("visibilitychange", invalidate);
  }, []);

  function captureReference() {
    clearCapture();
    setCaptureError(null);
    captureRequestedRef.current = true;
    setCaptureBusy(true);
    pipelineRef.current?.setReference();
  }

  const handleComplete = () => {
    const result = resultRef.current;
    const camera = cameraReady ? cameraSignature(stream, videoRef.current) : null;
    if (!result || !camera || !compatibleCalibration(result, camera, result.corners, layout)) {
      setCaptureError("Camera or keyboard settings changed. Restart calibration and capture again.");
      return;
    }
    if (!saveCalibration(result)) {
      setCaptureError("Could not save calibration. Enable browser storage and retry.");
      return;
    }
    router.push("/");
  };

  const lightingOk = lighting?.verdict === "ok";

  const canAdvance = () => {
    if (step === 1) return usableLayout(layout);
    if (step === 2) return lightingOk; // #16
    if (step === 3) return sheetDetected;
    return true;
  };

  const isComplete = step > TOTAL_STEPS;

  const canCapture = cameraReady && frameReady && sheetDetectorStatus === "ready";

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

    if (step === 3) return <>
      {sheetDetected && <div className="ms-pill ms-pill-success absolute top-4 left-1/2 -translate-x-1/2">Reference captured</div>}
      <button onClick={() => setShowHelpModal(true)} aria-label="Show help" className="ms-key ms-key-icon absolute bottom-4 right-4 z-20">?</button>
    </>;
    return null;
  };

  // ── Help modal ────────────────────────────────────────────────────────────
  const renderHelpModal = () => {
    if (!showHelpModal) return null;
    const title = "Show the whole paper like this";
    return (
      <div className="ms-backdrop absolute inset-0 z-50 flex items-center justify-center">
        <div role="dialog" aria-modal="true" aria-label={title} className="ms-dialog relative w-[88%] max-w-[640px] overflow-hidden rounded-[18px]">
          <PaperHelpIllustration />
          <div className="px-5 py-3.5">
            <p className="text-ink text-[15px] font-medium">{title}</p>
            {(
              <ul className="mt-1.5 list-disc pl-5 text-[14px] leading-6 text-ink-muted">
                {PAPER_HELP_TIPS.map((tip) => <li key={tip}>{tip}</li>)}
              </ul>
            )}
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
    clearCapture(); resetInteractiveStepState(); setStep(1);
  };

  const stepContent = (): { title: string; controls: React.ReactNode; status?: string | null; alert?: string | null } => {
    if (isComplete) {
      return {
        title: "Setup validated. Keep the camera and paper in place.",
        status: "Select Start Playing to save. On Home, clear the keyboard and select Set reference before enabling audio.",
        controls: (
          <>
            <SuccessBadge label="Setup validated" />
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
        alert: profileAlert ?? (fits
          ? null
          : `It does not fit ${paperOctaves(layout)} octave${paperOctaves(layout) === 1 ? "" : "s"} of paper. ${layout.paperFitOverride ? "It will go past the edge." : "Add more, or tick the box."}`),
        controls: (
          <>
            <div className="grid w-full grid-cols-[auto_1fr] items-center gap-x-3 gap-y-1.5">
              <label htmlFor="calibration-profile" className="text-[15px] text-ink-muted">Profile</label>
              <div className="relative">
                <select id="calibration-profile" value={selectedProfile?.id ?? ""} onChange={(e) => applyProfile(e.target.value)} className="ms-input w-full py-1.5">
                  <option value="">{profiles.length ? "Custom" : "No saved profiles"}</option>
                  {profiles.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
                </select>
                <div className="absolute right-3 top-1/2 -translate-y-1/2 pointer-events-none text-ink-muted"><ChevronDown /></div>
              </div>
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
            {profileDraft ? (
              <form
                key={profileDraft.mode}
                className="flex w-full flex-wrap items-center gap-2"
                onSubmit={(e) => {
                  e.preventDefault();
                  submitProfileDraft(profileNameRef.current?.value ?? "");
                }}
              >
                <input
                  ref={profileNameRef}
                  aria-label="Profile name"
                  autoFocus
                  maxLength={PROFILE_NAME_MAX}
                  defaultValue={profileDraft.name}
                  className="ms-input min-w-0 flex-1 py-1.5"
                />
                <button type="submit" className="ms-key ms-key-primary px-3 py-1.5 text-[14px]">
                  {profileDraft.mode === "rename" ? "Save name" : "Save"}
                </button>
                <button type="button" onClick={() => { setProfileDraft(null); setProfileAlert(null); }} className="ms-key ms-key-ghost px-3 py-1.5 text-[14px]">Cancel</button>
              </form>
            ) : (
              <div className="flex flex-wrap gap-2">
                <button type="button" onClick={() => setProfileDraft({ mode: "save", name: selectedProfile?.name ?? "" })} className="ms-key px-3 py-1.5 text-[14px]">Save profile</button>
                {selectedProfile && (
                  <>
                    <button type="button" onClick={() => setProfileDraft({ mode: "rename", name: selectedProfile.name })} className="ms-key ms-key-ghost px-3 py-1.5 text-[14px]">Rename</button>
                    <button type="button" onClick={removeSelectedProfile} className="ms-key ms-key-ghost ms-key-danger px-3 py-1.5 text-[14px]">Delete</button>
                  </>
                )}
              </div>
            )}
            {usableLayout(layout) && <SuccessBadge label={`${range} ready`} />}
          </>
        ),
        status: profileStatus,
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
        title: "Step 3: Capture the empty keyboard",
        controls: <>
          <p className="text-ink-muted">Show all four markers and remove your hands and other objects from the keyboard.</p>
          <button type="button" className="ms-key" onClick={captureReference} disabled={!canCapture || captureBusy}>
            {captureBusy ? "Capturing…" : "Capture reference"}
          </button>
          {sheetDetected && <SuccessBadge label="Sheet geometry validated" />}
          {sheetDetectorStatus === "error" && <button type="button" className="ms-key" onClick={() => { setSheetDetectorStatus("loading"); setAttempt(n => n + 1); }}>Reload tracker</button>}
        </>,
        status: captureMessage,
      };
    }

    return { title: "", controls: null };
  };

  // The data attributes let the deployment smoke test wait for detectors.
  return (
    <div className="flex-1 bg-surface flex flex-col" data-vision-calibration={sheetDetectorStatus}>
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
          {step === 3 && visionResult?.geometry && <svg aria-hidden="true"
            viewBox={`0 0 ${visionResult.width} ${visionResult.height}`} preserveAspectRatio="xMidYMid slice"
            className="absolute inset-0 z-10 h-full w-full scale-x-[-1] pointer-events-none">
            {visionResult.geometry.whiteKeyPolygons.map((polygon, i) => <polygon key={i}
              points={polygon.map(p => `${p.x},${p.y}`).join(" ")}
              fill="var(--color-white)" fillOpacity="0.3" stroke="var(--color-accent)" strokeWidth="2" />)}
          </svg>}
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
