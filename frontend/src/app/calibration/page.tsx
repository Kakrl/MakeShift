"use client";

import { useState, useEffect, useRef, useCallback } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCamera } from "../CameraContext";
import CameraStatusOverlay from "../CameraStatusOverlay";
import { useHandLandmarker } from "../useHandLandmarker";
import {
  LIGHTING_MESSAGES,
  MAX_BRIGHTNESS,
  MIN_BRIGHTNESS,
  readFrameBrightness,
  type LightingReading,
} from "../lighting";

const TOTAL_STEPS = 5;

const OCTAVE_OPTIONS = ["1", "2", "3", "4"];
const NOTE_OPTIONS = ["A0", "A1", "A2", "A3", "A4", "A5"];

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
      <path d="M12 4L22 20H2L12 4Z" stroke="white" strokeWidth="2" strokeLinejoin="round" />
      <line x1="12" y1="11" x2="12" y2="16" stroke="white" strokeWidth="2" strokeLinecap="round" />
      <circle cx="12" cy="18.5" r="1" fill="white" />
    </svg>
  );
}

function SuccessBadge({ label }: { label: string }) {
  return (
    <div className="flex items-center gap-2 px-3 py-1.5 rounded-full bg-success-soft border border-success">
      <svg width="16" height="16" viewBox="0 0 16 16" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
        <circle cx="8" cy="8" r="7" fill="var(--color-success)" />
        <path d="M4.5 8L6.8 10.5L11.5 5.5" stroke="white" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
      <span className="text-[13px] font-sans text-success-strong whitespace-nowrap">{label}</span>
    </div>
  );
}

function ProgressBar({ total, current }: { total: number; current: number }) {
  return (
    <div className="flex flex-1 items-center" role="progressbar" aria-valuenow={current} aria-valuemin={1} aria-valuemax={total}>
      {Array.from({ length: total }, (_, i) => {
        const stepNum = i + 1;
        const circleFilled = stepNum <= current;
        const barFilled = stepNum < current;
        return (
          <div key={i} className="flex flex-1 items-center last:flex-none">
            <div className={`shrink-0 size-[20px] rounded-full border-2 transition-colors duration-200 ${circleFilled ? "bg-accent border-accent" : "bg-control-inactive border-control-inactive"}`} />
            {i < total - 1 && (
              <div className={`flex-1 h-[10px] transition-colors duration-200 ${barFilled ? "bg-accent" : "bg-control-inactive"}`} />
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
  const [octaves, setOctaves] = useState("2");
  const [startingNote, setStartingNote] = useState("A0");

  // Steps 4 & 5 — shared countdown
  const [countdown, setCountdown] = useState<number | null>(null);
  const [hasStarted, setHasStarted] = useState(false);
  const [fingersShown, setFingersShown] = useState(false);
  const [showingImage, setShowingImage] = useState(false);
  const [step5Success, setStep5Success] = useState(false);
  const [showHelpModal, setShowHelpModal] = useState(false);
  const [paperError, setPaperError] = useState(false);
  const [captureError, setCaptureError] = useState<string | null>(null);

  // #13 — the video element reports 0x0 until it has decoded a frame
  const [frameReady, setFrameReady] = useState(false);

  // #16 — sampled from the live frame during step 2
  const [lighting, setLighting] = useState<LightingReading | null>(null);

  const router = useRouter();
  const videoRef = useRef<HTMLVideoElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const { stream, cameraReady } = useCamera();
  const brightnessCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const { status: landmarkerStatus, detect, reload: reloadLandmarker } =
    useHandLandmarker();

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

  // #16 — poll the live frame only while the lighting step is visible
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
    setCountdown(null);
    setHasStarted(false);
    setFingersShown(false);
    setShowingImage(false);
    setStep5Success(false);
    setShowHelpModal(false);
    setPaperError(false);
    setCaptureError(null);
    // Drop the previous reading so re-entering step 2 cannot advance on a
    // stale measurement before the first fresh sample lands.
    setLighting(null);
  }

  function goToAdjacentStep(delta: -1 | 1) {
    resetInteractiveStepState();
    setStep((s) => s + delta);
  }

  useEffect(() => {
    if (!showHelpModal) return;
    const handleKeyDown = (e: KeyboardEvent) => { if (e.key === "Escape") setShowHelpModal(false); };
    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [showHelpModal]);

  // Press 'i' in step 3 to simulate a paper-not-accepted error (prototype trigger)
  useEffect(() => {
    if (step !== 3) return;
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "i" || e.key === "I") setPaperError(true);
    };
    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [step]);

  function canvasToImage(canvas: HTMLCanvasElement): Promise<HTMLImageElement> {
    return new Promise((resolve, reject) => {
      const img = new Image();
      img.onload = () => resolve(img);
      img.onerror = reject;
      img.src = canvas.toDataURL("image/png");
    });
  }

  const capture = useCallback(async function capture() {
    const video = videoRef.current;
    const canvas = canvasRef.current;
    if (!video || !canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    // #13 — a 0x0 canvas throws on toDataURL and silently breaks detection
    if (!video.videoWidth || !video.videoHeight) return;
    canvas.width = video.videoWidth;
    canvas.height = video.videoHeight;
    ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
    return canvasToImage(canvas);
  }, []);

  function detectFingers(image: HTMLImageElement) {
    const res = detect(image);
    const canvas = canvasRef.current;
    if (!res || !canvas) {
      setCaptureError("Hand detection is unavailable. Try again.");
      return;
    }
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    let fingertips = 0;
    for (const hand of res.landmarks ?? []) {
      for (const idx of [4, 8, 12, 16, 20]) {
        const pt = hand[idx];
        ctx.beginPath();
        ctx.arc(pt.x * canvas.width, pt.y * canvas.height, 20, 0, 2 * Math.PI);
        ctx.fillStyle = "red";
        ctx.fill();
        fingertips++;
      }
    }
    if (fingertips > 0) setFingersShown(true);
    setShowingImage(true);
  }

  // Single countdown tick — behaviour at 0 differs per step
  useEffect(() => {
    if (countdown === null || countdown < 0) return;
    if (countdown === 0) {
      if (step === 4) {
        capture()
          .then((image) => {
            if (image) {
              detectFingers(image);
            } else {
              // #13 — no usable frame; stay on the live preview so Retry works
              setCaptureError("The camera was not ready. Try again.");
              setShowingImage(false);
            }
          })
          .catch(() => {
            setCaptureError("Could not read a frame from the camera. Try again.");
            setShowingImage(false);
          });
      } else if (step === 5) {
        setStep5Success(true);
      }
      return;
    }
    const timer = setTimeout(() => setCountdown((c) => (c !== null ? c - 1 : null)), 1000);
    return () => clearTimeout(timer);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [countdown, step]);

  const handleStartCountdown = () => {
    setHasStarted(true);
    setCountdown(3);
    setShowingImage(false);
    setFingersShown(false);
    setStep5Success(false);
    setCaptureError(null);
  };

  const handleComplete = () => {
    if (typeof window !== "undefined") localStorage.setItem("isCalibrated", "true");
    router.push("/");
  };

  const lightingOk = lighting?.verdict === "ok";

  const canAdvance = () => {
    if (step === 2) return lightingOk; // #16
    if (step === 4) return fingersShown;
    if (step === 5) return step5Success;
    return true;
  };

  const isComplete = step > TOTAL_STEPS;

  // Start is only meaningful once there is a frame to capture and a detector
  // to run on it (#12, #13).
  const canCapture = cameraReady && frameReady && landmarkerStatus === "ready";

  // Counting down right now?
  const isCounting = countdown !== null && countdown > 0;
  const isInteractiveStep = step === 2 || step === 4 || step === 5;
  const showPreviousStep = !isComplete && step > 1 && !isCounting;
  const showExitCalibration = step === 1;
  // Step 1 is settings only; every later step asks the user to judge the camera feed.
  const showNextStep =
    !isComplete && (!isInteractiveStep || canAdvance()) && (step === 1 || cameraReady);

  // ── Camera overlays per step ──────────────────────────────────────────────
  const renderCameraOverlay = () => {
    // Completion screen — same paper outline as steps 3-5
    if (isComplete) {
      return (
        <div className="absolute pointer-events-none" style={{ bottom: "18%", left: "10%", right: "10%" }}>
          <div className="relative w-full" style={{ height: 60, transform: "skewX(-8deg)" }}>
            <div className="absolute inset-0 border-2 border-danger bg-white/90" />
          </div>
        </div>
      );
    }

    if (step === 1) return null;

    // ── Step 2: lighting ──
    if (step === 2) {
      if (!lighting) {
        return (
          <div className="absolute top-5 left-1/2 -translate-x-1/2 bg-surface-dark px-4 py-2 rounded-full pointer-events-none">
            <span className="text-white text-[16px] font-sans">Measuring lighting…</span>
          </div>
        );
      }
      return lighting.verdict === "ok" ? (
        <div className="absolute top-5 left-1/2 -translate-x-1/2 flex items-center gap-2 bg-success-strong px-4 py-2 rounded-full pointer-events-none">
          <svg width="18" height="18" viewBox="0 0 18 18" fill="none" aria-hidden="true"><circle cx="9" cy="9" r="8" fill="var(--color-success)"/><path d="M5 9L7.5 12L13 6" stroke="white" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/></svg>
          <span className="text-white text-[16px] font-sans">{LIGHTING_MESSAGES.ok}</span>
        </div>
      ) : (
        <div className="absolute top-5 left-1/2 -translate-x-1/2 flex items-center gap-3 bg-surface-dark px-4 py-2 rounded-full pointer-events-none">
          <AlertTriangle />
          <p className="text-white text-[18px] font-sans">{LIGHTING_MESSAGES[lighting.verdict]}</p>
        </div>
      );
    }

    // ── Step 3: align paper ──
    if (step === 3) {
      return (
        <div className="absolute inset-0">
          {/* Paper error banner */}
          {paperError && (
            <div className="absolute top-5 left-1/2 -translate-x-1/2 z-20 bg-white rounded-[10px] shadow-xl px-5 py-4 flex items-start gap-3 w-[480px] max-w-[90%]">
              {/* Red triangle icon */}
              <svg className="shrink-0 mt-0.5" width="28" height="28" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
                <path d="M12 3L22 20H2L12 3Z" fill="var(--color-danger)" />
                <line x1="12" y1="9" x2="12" y2="14" stroke="white" strokeWidth="2" strokeLinecap="round" />
                <circle cx="12" cy="17" r="1" fill="white" />
              </svg>
              <div className="flex flex-col gap-0.5">
                <p className="text-[15px] font-bold text-danger font-sans">ERROR: Paper position is not accepted</p>
                <p className="text-[14px] text-ink-subtle font-sans">Impossible placement. Click the &lsquo;?&rsquo; button for help</p>
              </div>
              <button
                onClick={() => setPaperError(false)}
                aria-label="Dismiss error"
                className="ml-auto shrink-0 text-ink-subtle hover:text-black text-[20px] leading-none transition-colors"
              >×</button>
            </div>
          )}

          {/* Paper outline */}
          <div className="absolute pointer-events-none" style={{ bottom: "18%", left: "10%", right: "10%" }}>
            <div className="relative w-full" style={{ height: 60, transform: "skewX(-8deg)" }}>
              <div className="absolute inset-0 border-2 border-danger bg-white/90" />
              {([{ top: -6, left: -6 }, { top: -6, right: -6 }, { bottom: -6, left: -6 }, { bottom: -6, right: -6 }] as React.CSSProperties[]).map((pos, i) => (
                <div key={i} className="absolute w-3 h-3 rounded-full bg-danger" style={pos} />
              ))}
            </div>
          </div>
          {/* Hint */}
          {!paperError && (
            <div className="absolute bottom-4 left-1/2 -translate-x-1/2 bg-surface-dark px-5 py-2 rounded-full pointer-events-none">
              <p className="text-white text-[15px] font-sans">Align the red outline with your paper, then click Next Step</p>
            </div>
          )}
          {/* Help button */}
          {!isCounting && !fingersShown && (
            <button onClick={() => setShowHelpModal(true)} aria-label="Show help" className="absolute bottom-4 right-4 w-10 h-10 bg-white rounded-[6px] flex items-center justify-center text-black text-[18px] font-bold shadow hover:bg-gray-100 transition-colors">?</button>
          )}
        </div>
      );
    }

    // ── Step 4: hover hands ──
    if (step === 4) {
      const handNotDetected = showingImage && !fingersShown;
      return (
        <>
          {/* Paper + hover dots */}
          <div className="absolute pointer-events-none" style={{ bottom: "18%", left: "10%", right: "10%" }}>
            <div className="relative w-full" style={{ height: 60, transform: "skewX(-8deg)" }}>
              <div className="absolute inset-0 border-2 border-danger bg-white/90" />
              {[20, 28, 36, 44, 50, 58, 66, 72, 80, 88].map((pct, i) => (
                <div key={i} className="absolute w-2 h-2 rounded-full bg-danger" style={{ bottom: "100%", left: `${pct}%`, marginBottom: 4 + (i % 3) * 6 }} />
              ))}
            </div>
          </div>

          {/* Instruction pill — only before countdown starts */}
          {!hasStarted && (
            <div className="absolute top-[35%] left-1/2 -translate-x-1/2 flex items-center gap-2 bg-surface-dark px-5 py-2 rounded-full pointer-events-none">
              <span className="text-white text-[16px] font-sans">Hover hands above the paper, then press Start</span>
            </div>
          )}

          {/* Success overlay */}
          {fingersShown && (
            <div className="absolute inset-0 flex flex-col items-center justify-start pt-[14%] gap-3 pointer-events-none">
              <div className="flex items-center gap-3 bg-surface-dark px-6 py-3 rounded-full">
                <svg width="28" height="28" viewBox="0 0 28 28" fill="none" aria-hidden="true"><circle cx="14" cy="14" r="13" fill="var(--color-success)"/><path d="M8 14L11.5 18L20 10" stroke="white" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"/></svg>
                <span className="text-white text-[26px] font-sans font-medium">Hands detected!</span>
              </div>
              <p className="rounded-full bg-surface-dark px-4 py-1 text-white text-[15px] font-sans">Click Next Step to continue</p>
            </div>
          )}

          {/* Status banner: capture failure, detector failure, or no hands */}
          {(captureError || landmarkerStatus === "error" || handNotDetected) && (
            <div className="absolute top-5 left-1/2 -translate-x-1/2 flex items-center gap-3 bg-surface-dark px-4 py-2 rounded-full">
              <AlertTriangle />
              <p className="text-white text-[18px] font-sans pointer-events-none">
                {captureError ??
                  (landmarkerStatus === "error"
                    ? "Hand detection failed to load."
                    : "No hands detected. Try again")}
              </p>
              {landmarkerStatus === "error" && (
                <button
                  onClick={reloadLandmarker}
                  className="rounded-[6px] border border-white px-3 py-1 text-[15px] font-sans text-white transition-[background-color,transform] hover:bg-white/15 active:scale-[0.97]"
                >
                  Reload
                </button>
              )}
            </div>
          )}

          {/* Waiting on the detector or the first decoded frame */}
          {!hasStarted && landmarkerStatus === "loading" && (
            <div className="absolute top-5 left-1/2 -translate-x-1/2 bg-surface-dark px-4 py-2 rounded-full pointer-events-none">
              <p className="text-white text-[16px] font-sans">Loading hand detection…</p>
            </div>
          )}
          {!hasStarted && landmarkerStatus === "ready" && cameraReady && !frameReady && (
            <div className="absolute top-5 left-1/2 -translate-x-1/2 bg-surface-dark px-4 py-2 rounded-full pointer-events-none">
              <p className="text-white text-[16px] font-sans">Waiting for the camera…</p>
            </div>
          )}

          {/* Help button */}
          {!isCounting && !step5Success && (
            <button onClick={() => setShowHelpModal(true)} aria-label="Show help" className="absolute bottom-4 right-4 w-10 h-10 bg-white rounded-[6px] flex items-center justify-center text-black text-[18px] font-bold shadow hover:bg-gray-100 transition-colors">?</button>
          )}
        </>
      );
    }

    // ── Step 5: hands on paper ──
    if (step === 5) {
      return (
        <>
          {/* Paper + fingertip dots on surface */}
          <div className="absolute pointer-events-none" style={{ bottom: "18%", left: "10%", right: "10%" }}>
            <div className="relative w-full" style={{ height: 60, transform: "skewX(-8deg)" }}>
              <div className="absolute inset-0 border-2 border-danger bg-white/90" />
              {[15, 22, 32, 42, 54, 62, 70, 78, 86, 92].map((pct, i) => (
                <div key={i} className="absolute w-2 h-2 rounded-full bg-danger" style={{ top: "30%", left: `${pct}%` }} />
              ))}
            </div>
          </div>

          {/* Instruction pill — before countdown starts */}
          {!hasStarted && !step5Success && (
            <div className="absolute top-[35%] left-1/2 -translate-x-1/2 flex items-center gap-2 bg-surface-dark px-5 py-2 rounded-full pointer-events-none">
              <span className="text-white text-[16px] font-sans">Place hands flat on the paper, then press Start</span>
            </div>
          )}

          {/* Waiting pill — while counting (not success yet) */}
          {isCounting && !step5Success && (
            <div className="absolute top-[35%] left-1/2 -translate-x-1/2 flex items-center gap-2 bg-surface-dark px-5 py-2 rounded-full pointer-events-none">
              <span className="text-white text-[16px] font-sans">Hold still...</span>
            </div>
          )}

          {/* Success overlay */}
          {step5Success && (
            <div className="absolute inset-0 flex flex-col items-center justify-start pt-[14%] gap-3 pointer-events-none">
              <div className="flex items-center gap-3 bg-surface-dark px-6 py-3 rounded-full">
                <svg width="28" height="28" viewBox="0 0 28 28" fill="none" aria-hidden="true"><circle cx="14" cy="14" r="13" fill="var(--color-success)"/><path d="M8 14L11.5 18L20 10" stroke="white" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"/></svg>
                <span className="text-white text-[26px] font-sans font-medium">Success!</span>
              </div>
              <p className="rounded-full bg-surface-dark px-4 py-1 text-white text-[15px] font-sans">Click Next Step to finish calibration</p>
            </div>
          )}

          {/* Help button */}
          <button onClick={() => setShowHelpModal(true)} aria-label="Show help" className="absolute bottom-4 right-4 w-10 h-10 bg-white rounded-[6px] flex items-center justify-center text-black text-[18px] font-bold shadow hover:bg-gray-100 transition-colors">?</button>
        </>
      );
    }

    return null;
  };

  // ── Single fullscreen countdown (steps 4 & 5) ────────────────────────────
  const renderCountdown = () => {
    if (!isCounting || isComplete) return null;
    if (step !== 4 && step !== 5) return null;
    return (
      <div className="absolute inset-0 flex items-center justify-center bg-black/50 z-40 pointer-events-none">
        <span className="text-white font-bold drop-shadow-lg" style={{ fontSize: "clamp(80px,20vw,150px)" }}>
          {countdown}
        </span>
      </div>
    );
  };

  // ── Help modal ────────────────────────────────────────────────────────────
  const renderHelpModal = () => {
    if (!showHelpModal) return null;
    return (
      <div className="absolute inset-0 z-50 flex items-center justify-center bg-black/60">
        <div className="relative w-[88%] max-w-[640px] overflow-hidden rounded-[8px] shadow-2xl">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src="/hand-reference.png" alt="Hand positioning reference" className="w-full block" style={{ aspectRatio: "16/9", objectFit: "cover" }} />
          <div className="absolute bottom-0 left-0 right-0 bg-black/75 px-5 py-3 flex items-center justify-between">
            <p className="text-white text-[17px] font-sans">Position your hands on the paper like this</p>
            <div aria-hidden="true" className="w-8 h-8 bg-white rounded-[4px] flex items-center justify-center text-black text-[14px] font-bold">?</div>
          </div>
          <button onClick={() => setShowHelpModal(false)} aria-label="Close" className="absolute top-3 right-3 w-8 h-8 flex items-center justify-center text-white text-[24px] font-bold hover:opacity-70 transition-opacity leading-none">×</button>
        </div>
      </div>
    );
  };

  // ── Bottom bar step content ───────────────────────────────────────────────
  const renderStepContent = () => {
    if (isComplete) {
      return (
        <div className="flex items-center gap-4">
          <svg width="28" height="28" viewBox="0 0 28 28" fill="none" aria-hidden="true"><circle cx="14" cy="14" r="13" fill="var(--color-success)"/><path d="M8 14L11.5 18L20 10" stroke="white" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"/></svg>
          <p className="text-[24px] text-black font-sans">Calibration complete! You&apos;re ready to play.</p>
        </div>
      );
    }

    if (step === 1) {
      return (
        <div className="flex items-center gap-5 flex-wrap">
          <p className="text-[24px] text-black font-sans shrink-0">Step 1: Select octaves &amp; starting note</p>
          <div className="flex items-end gap-4 shrink-0">
            <div className="flex flex-col gap-1">
              <label htmlFor="octave-count" className="text-[13px] text-black font-sans"># of Octaves</label>
              <div className="relative">
                <select id="octave-count" value={octaves} onChange={(e) => setOctaves(e.target.value)} className="border border-control-border rounded-[8px] pl-3 pr-8 py-2 text-[15px] text-ink bg-white appearance-none cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-black">
                  {OCTAVE_OPTIONS.map((o) => <option key={o}>{o}</option>)}
                </select>
                <div className="absolute right-2 top-1/2 -translate-y-1/2 pointer-events-none"><ChevronDown /></div>
              </div>
            </div>
            <div className="flex flex-col gap-1">
              <label htmlFor="starting-note" className="text-[13px] text-black font-sans">Starting Octave</label>
              <div className="relative">
                <select id="starting-note" value={startingNote} onChange={(e) => setStartingNote(e.target.value)} className="border border-control-border rounded-[8px] pl-3 pr-8 py-2 text-[15px] text-ink bg-white appearance-none cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-black">
                  {NOTE_OPTIONS.map((n) => <option key={n}>{n}</option>)}
                </select>
                <div className="absolute right-2 top-1/2 -translate-y-1/2 pointer-events-none"><ChevronDown /></div>
              </div>
            </div>
            <SuccessBadge label="Settings ready" />
          </div>
        </div>
      );
    }

    if (step === 2) {
      const pct = lighting ? Math.round(lighting.brightness * 100) : null;
      return (
        <div className="flex items-center gap-5 flex-wrap">
          <p className="text-[24px] text-black font-sans shrink-0">Step 2: Check your lighting</p>
          <div className="flex items-center gap-6 shrink-0">
            <span className="text-[14px] text-ink-muted font-sans" aria-live="polite">
              Current: {pct === null ? "measuring…" : `${pct}% brightness`}
            </span>
            <span className="text-[14px] text-ink-muted font-sans">
              Target: {Math.round(MIN_BRIGHTNESS * 100)}–{Math.round(MAX_BRIGHTNESS * 100)}%
            </span>
            {lightingOk ? (
              <SuccessBadge label="Lighting OK" />
            ) : lighting ? (
              <div className="flex items-center gap-2 px-3 py-1.5 rounded-full bg-red-50 border border-red-300">
                <span className="text-[13px] text-red-600">{LIGHTING_MESSAGES[lighting.verdict]}</span>
              </div>
            ) : null}
          </div>
        </div>
      );
    }

    if (step === 3) {
      return <p className="text-[24px] text-black font-sans">Step 3: Align your paper</p>;
    }

    if (step === 4) {
      return (
        <div className="flex items-center gap-4">
          <p className="text-[24px] text-black font-sans shrink-0">Step 4: Hover hands above paper for 3 s</p>
          {!fingersShown && (
            <button onClick={handleStartCountdown} disabled={isCounting || !canCapture} className="shrink-0 border-[1.5px] border-black bg-surface px-5 py-2 rounded-[8px] text-[20px] text-black font-sans hover:bg-black/5 active:scale-[0.97] transition-[background-color,transform] disabled:opacity-40 disabled:cursor-not-allowed">
              {hasStarted && !isCounting ? "Retry" : "Start"}
            </button>
          )}
          {!fingersShown && !canCapture && (
            <span className="text-[14px] text-ink-muted font-sans" aria-live="polite">
              {landmarkerStatus === "loading"
                ? "Loading hand detection…"
                : landmarkerStatus === "error"
                  ? "Hand detection unavailable"
                  : "Waiting for the camera…"}
            </span>
          )}
          {fingersShown && <SuccessBadge label="Hands detected" />}
        </div>
      );
    }

    if (step === 5) {
      return (
        <div className="flex items-center gap-4">
          <p className="text-[24px] text-black font-sans shrink-0">Step 5: Place hands on paper for 3 s</p>
          {!step5Success && (
            <button onClick={handleStartCountdown} disabled={isCounting || !canCapture} className="shrink-0 border-[1.5px] border-black bg-surface px-5 py-2 rounded-[8px] text-[20px] text-black font-sans hover:bg-black/5 active:scale-[0.97] transition-[background-color,transform] disabled:opacity-40 disabled:cursor-not-allowed">
              {hasStarted && !isCounting ? "Retry" : "Start"}
            </button>
          )}
          {step5Success && <SuccessBadge label="Calibrated!" />}
        </div>
      );
    }

    return null;
  };

  return (
    <div className="flex-1 bg-surface flex flex-col min-h-0 overflow-hidden">
      {/* Main area */}
      <div className="flex pl-[clamp(20px,4.2vw,61px)] pr-[clamp(12px,3.2vw,47px)]">
        {/* Camera */}
        <div className="flex-1 aspect-video bg-surface-dark relative overflow-hidden">
          <video ref={videoRef} autoPlay playsInline muted className="absolute inset-0 w-full h-full object-cover" style={{ display: showingImage ? "none" : "block" }} />
          <canvas ref={canvasRef} className="absolute inset-0 w-full h-full object-cover" style={{ display: showingImage ? "block" : "none" }} />
          {renderCountdown()}
          {cameraReady && renderCameraOverlay()}
          <CameraStatusOverlay />
          {renderHelpModal()}
        </div>

        {/* Right sidebar — nav only */}
        <div className="w-[267px] relative flex flex-col shrink-0">
          <div className="absolute left-0 top-[50px] flex flex-col gap-[24px] z-10 pointer-events-none">
            <div className="bg-black h-[46px] w-[140px] rounded-tr-[4px] rounded-br-[4px] shadow-[2px_1px_1px_0px_rgba(0,0,0,0.1)]" />
            <div className="bg-black h-[46px] w-[140px] rounded-tr-[4px] rounded-br-[4px] shadow-[2px_1px_1px_0px_rgba(0,0,0,0.1)]" />
          </div>
          <div className="flex flex-col">
            <div aria-current="page" className="border border-black h-[72px] flex items-center justify-end pr-[19px] pl-[100px] rounded-tr-[8px] bg-accent-soft relative shadow-[inset_0px_4px_0px_0px_rgba(255,255,255,0.25),inset_0px_-15px_17.6px_0px_rgba(53,21,21,0.07)]">
              <span className="text-[20px] text-black font-sans whitespace-nowrap">Calibration</span>
            </div>
            <Link href="/tutorial" className="-mt-px border border-black h-[72px] flex items-center justify-end pr-[19px] pl-[100px] bg-surface relative shadow-[inset_0px_4px_0px_0px_rgba(255,255,255,0.25),inset_0px_-15px_17.6px_0px_rgba(53,21,21,0.07)] hover:bg-black/5 transition-colors">
              <span className="text-[20px] text-black font-sans whitespace-nowrap">Tutorial</span>
            </Link>
            <Link href="/about" className="-mt-px border border-black h-[72px] flex items-center justify-end pr-[19px] pl-[100px] rounded-br-[8px] bg-surface relative shadow-[inset_0px_4px_0px_0px_rgba(255,255,255,0.25),inset_0px_-15px_17.6px_0px_rgba(53,21,21,0.07)] hover:bg-black/5 transition-colors">
              <span className="text-[20px] text-black font-sans whitespace-nowrap">About</span>
            </Link>
          </div>
        </div>
      </div>

      {/* Step content row */}
      <div className="flex items-center gap-4 shrink-0 pl-[clamp(20px,4.2vw,61px)] pr-[clamp(12px,3.2vw,47px)] pt-[clamp(8px,2dvh,28px)] pb-[clamp(6px,1.5dvh,16px)]">
        {renderStepContent()}
      </div>

      {/* Bottom nav */}
      <div className="flex items-center gap-6 shrink-0 pl-[clamp(20px,3.8vw,56px)] pr-[clamp(12px,3.2vw,47px)] pb-[clamp(10px,2.5dvh,30px)]">
        {showExitCalibration ? (
          <Link href="/" className="shrink-0 border-[1.5px] border-black bg-surface px-6 py-3 rounded-[8px] text-[22px] text-black font-sans hover:bg-black/5 active:scale-[0.97] transition-[background-color,transform]">Exit Calibration</Link>
        ) : showPreviousStep ? (
          <button onClick={() => goToAdjacentStep(-1)} className="shrink-0 border-[1.5px] border-black bg-surface px-6 py-3 rounded-[8px] text-[22px] text-black font-sans hover:bg-black/5 active:scale-[0.97] transition-[background-color,transform]">Previous Step</button>
        ) : <div aria-hidden="true" />}

        <ProgressBar total={TOTAL_STEPS} current={isComplete ? TOTAL_STEPS : step} />

        {isComplete ? (
          <button onClick={handleComplete} className="shrink-0 border-[1.5px] border-black bg-surface px-6 py-3 rounded-[8px] text-[22px] text-black font-sans hover:bg-black/5 active:scale-[0.97] transition-[background-color,transform]">Start Playing</button>
        ) : showNextStep ? (
          <button onClick={() => goToAdjacentStep(1)} className="shrink-0 border-[1.5px] border-black bg-surface px-6 py-3 rounded-[8px] text-[22px] text-black font-sans transition-[background-color,transform] hover:bg-black/5 active:scale-[0.97]">
            Next Step
          </button>
        ) : <div aria-hidden="true" />}
      </div>
    </div>
  );
}
