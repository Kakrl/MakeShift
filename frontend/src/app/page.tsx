"use client";
import { DEFAULT_METER, DENOMINATORS, MIN_NUMERATOR, MAX_NUMERATOR, isMeter, restoreMeter, beatIntervalMs, formatMeter, type Meter } from "../lib/meter";

import { registerCameraVideo } from "../diagnostics/cameraVideo";

import { useCallback, useEffect, useRef, useState } from "react";
import dynamic from "next/dynamic";
import { useRouter } from "next/navigation";
import { useCamera } from "./CameraContext";
import CameraStatusOverlay from "./CameraStatusOverlay";
import SideNav from "./SideNav";
import PedalControls from "./PedalControls";
import PageTopBar from "./PageTopBar";
import {
  createRecorder,
  type Recorder,
  type Recording,
  type RecordingState,
} from "./midi/midiUtils";
import { trackAudioContext, closeTrackedAudioContext } from "../diagnostics/performanceMetrics";
import { browserAudio } from "./audio/audioEngine";
import { scheduleCountInClicks } from "./audio/countIn";
import { LiveSession } from "../events/liveSession";
import { loadCalibration } from "../cv/calibration";
import { connectPianoConsumers } from "../events/pianoConsumers";
import type { RecordingsLibraryHandle } from "./midi/RecordingsLibraryPanel";
import { readStored, writeStored } from "../lib/storage";
import { rainbow } from "./rainbow";
import { useDialogFocus } from "./useDialogFocus";
import { isDevMode } from "../debugFlags";
import { demoTake } from "./share/mockShareStore";

const RecordingsLibrary = dynamic(
  () => import("./midi/RecordingsLibraryPanel"),
  { ssr: false, loading: () => <p role="status">Loading recordings...</p> },
);

const MIN_TEMPO = 20;
const MAX_TEMPO = 300;
const SETTINGS_NAME = "playback-settings";
const SETTINGS_VERSION = 1;
type PlaybackSettings = { tempo: number; metronome: boolean; meter?: unknown };
const DEFAULT_SETTINGS: PlaybackSettings = { tempo: 60, metronome: true };

function isPlaybackSettings(value: unknown): value is PlaybackSettings {
  if (typeof value !== "object" || value === null) return false;
  const settings = value as Record<string, unknown>;
  return (
    typeof settings.tempo === "number" &&
    Number.isInteger(settings.tempo) &&
    settings.tempo >= MIN_TEMPO &&
    settings.tempo <= MAX_TEMPO &&
    typeof settings.metronome === "boolean"
  );
}

const CVOverlayCoordinator = dynamic(
  () => import("./CVOverlayCoordinator"),
  { ssr: false },
);

function RecordIcon() {
  return (
    <svg aria-hidden="true" width="22" height="22" viewBox="0 0 22 22" fill="none">
      <circle cx="11" cy="11" r="7" fill="var(--color-danger)" />
    </svg>
  );
}

function ResumeIcon() {
  return (
    <svg aria-hidden="true" width="22" height="22" viewBox="0 0 22 22" fill="none">
      <path d="M8 5.5v11l8.5-5.5L8 5.5Z" fill="var(--color-info)" stroke="var(--color-info)" strokeWidth="1.5" strokeLinejoin="round" />
    </svg>
  );
}

function PauseIcon() {
  return (
    <svg aria-hidden="true" width="22" height="22" viewBox="0 0 22 22" fill="none">
      <rect x="6" y="5" width="3.5" height="12" rx="1.25" fill="currentColor" />
      <rect x="12.5" y="5" width="3.5" height="12" rx="1.25" fill="currentColor" />
    </svg>
  );
}

function StopIcon() {
  return (
    <svg aria-hidden="true" width="22" height="22" viewBox="0 0 22 22" fill="none">
      <rect x="6" y="6" width="10" height="10" rx="2" fill="currentColor" />
    </svg>
  );
}

function SpeakerIcon() {
  return (
    <svg aria-hidden="true" width="18" height="18" viewBox="0 0 16 16" fill="none">
      <path d="M2.5 6v4h2.5l3.5 3V3L5 6H2.5Z" fill="currentColor" />
      <path d="M11 5.5a3.5 3.5 0 0 1 0 5M12.75 3.5a6 6 0 0 1 0 9" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" />
    </svg>
  );
}

function LockIcon() {
  return (
    <svg aria-hidden="true" width="14" height="14" viewBox="0 0 14 14" fill="none">
      <rect x="2.5" y="6" width="9" height="6.5" rx="1.75" fill="currentColor" />
      <path d="M4.5 6V4.5a2.5 2.5 0 0 1 5 0V6" stroke="currentColor" strokeWidth="1.5" />
    </svg>
  );
}

// A quick "nope" shake: big at first, settling fast.
const SHAKE: Keyframe[] = [
  { transform: "translateX(0)" },
  { transform: "translateX(-7px)" },
  { transform: "translateX(6px)" },
  { transform: "translateX(-4px)" },
  { transform: "translateX(3px)" },
  { transform: "translateX(-1px)" },
  { transform: "translateX(0)" },
];
// Reduced motion: a soft pulse instead of side-to-side movement.
const PULSE: Keyframe[] = [{ opacity: 1 }, { opacity: 0.5 }, { opacity: 1 }];

/**
 * Sits on top of a locked group of controls. It adds no layout, so nothing
 * moves when calibration unlocks the group. Hovering or pressing it shakes
 * the pill to say "not yet"; the camera card is where calibration starts.
 */
function CalibrateFirstLock({ label, className = "" }: { label: string; className?: string }) {
  const pill = useRef<HTMLSpanElement>(null);
  const shake = () => {
    const el = pill.current;
    if (!el?.animate) return;
    const reduce = window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
    // Restart from rest so repeated hovers and clicks always read clearly.
    el.getAnimations().forEach((animation) => animation.cancel());
    el.animate(reduce ? PULSE : SHAKE, { duration: reduce ? 320 : 420, easing: "ease-out" });
  };
  return (
    <button
      type="button"
      aria-label={label}
      onPointerEnter={(event) => { if (event.pointerType === "mouse") shake(); }}
      onClick={shake}
      className={`group absolute -inset-2 z-10 flex cursor-pointer items-center justify-center rounded-[14px] bg-white/60 focus-visible:outline-none ${className}`}
    >
      <span ref={pill} className="ms-lock-pill">
        <LockIcon />
        Calibrate first!
      </span>
    </button>
  );
}

/** A small keyboard with one key held down, used in the onboarding dialogs. */
function KeysIllustration() {
  const whites = [0, 1, 2, 3, 4, 5, 6];
  const blacks = [0, 1, 3, 4, 5];
  // A chord held down: three keys lit in the rainbow colors.
  const HELD: Record<number, string> = { 0: "var(--color-red)", 2: "var(--color-yellow)", 4: "var(--color-blue)" };
  return (
    <svg aria-hidden="true" width="112" height="56" viewBox="0 0 112 56" fill="none">
      <rect x="0.5" y="0.5" width="111" height="55" rx="9.5" fill="var(--color-well)" stroke="var(--color-divider)" />
      {whites.map((i) => (
        <rect
          key={i}
          x={5 + i * 14.6}
          y={HELD[i] ? 6 : 5}
          width="13.2"
          height={HELD[i] ? 45 : 46}
          rx="3"
          fill={HELD[i] ?? "var(--color-white)"}
          stroke={HELD[i] ? "var(--color-ink)" : "var(--color-divider)"}
          strokeOpacity={HELD[i] ? 0.25 : 1}
        />
      ))}
      {blacks.map((i) => (
        <rect key={i} x={14.4 + i * 14.6} y="5" width="8.4" height="27" rx="2.5" fill="var(--color-ink)" />
      ))}
    </svg>
  );
}

export default function Home() {
  const router = useRouter();
  const [session] = useState(() => new LiveSession(browserAudio));
  const [liveStatus, setLiveStatus] = useState(session.status);
  const [activePitches, setActivePitches] = useState<ReadonlySet<number>>(new Set());
  const recorderRef = useRef<Recorder | null>(null);
  if (recorderRef.current === null) {
    recorderRef.current = createRecorder();
  }
  const recorder = recorderRef.current;
  const recordingsLibraryRef = useRef<RecordingsLibraryHandle | null>(null);
  const [libraryLoaded, setLibraryLoaded] = useState(false);
  const [hasRecordings, setHasRecordings] = useState(false);
  // `?dev=1&demo=take` acts out a finished take once the library is ready,
  // to preview the post-recording save dialog without a sheet (#203).
  const demoTakePending = useRef(true);
  const updateLibraryStatus = useCallback((loaded: boolean, hasRecordings: boolean) => {
    setLibraryLoaded(loaded);
    setHasRecordings(hasRecordings);
    if (!loaded || !demoTakePending.current) return;
    demoTakePending.current = false;
    if (!isDevMode() || new URLSearchParams(window.location.search).get("demo") !== "take") return;
    const take = demoTake();
    recordingsLibraryRef.current?.completeTake(take);
    recordingsLibraryRef.current?.reviewTake(take.id);
    setShowRecordingComplete(true);
  }, []);
  // Every finished take is saved at once, then the library asks whether to
  // keep it, so closing the tab mid-question never loses a take. A take the
  // session stopped on its own (hidden tab, error) is kept without asking,
  // so a quick "No" can't delete something the person never chose to stop.
  const completeTake = useCallback((take: Recording, review = true) => {
    recordingsLibraryRef.current?.completeTake(take);
    if (review) recordingsLibraryRef.current?.reviewTake(take.id);
  }, []);

  // ── Tempo & time signature (controlled) ─────────────────────────────────
  const [tempo, setTempo] = useState(DEFAULT_SETTINGS.tempo);
  const [tempoInput, setTempoInput] = useState(String(DEFAULT_SETTINGS.tempo));
  const [tempoError, setTempoError] = useState<string | null>(null);
  const [meter, setMeter] = useState<Meter>(DEFAULT_METER);
  const [numeratorDraft, setNumeratorDraft] = useState("4");
  const [meterError, setMeterError] = useState<string | null>(null);
  const beatsPerMeasure = meter.numerator;
  function commitMeter(denominator = meter.denominator) {
    const next = { numerator: Number(numeratorDraft), denominator };
    if (!numeratorDraft.trim() || !isMeter(next)) {
      setNumeratorDraft(String(meter.numerator));
      setMeterError(`Use an integer from ${MIN_NUMERATOR} to ${MAX_NUMERATOR}. Restored ${formatMeter(meter)}.`);
      return;
    }
    setMeter(next);
    setMeterError(null);
  }

  // ── Metronome ────────────────────────────────────────────────────────────
  const [metronome, setMetronome] = useState(DEFAULT_SETTINGS.metronome);
  const [settingsLoaded, setSettingsLoaded] = useState(false);
  const audioCtxRef = useRef<AudioContext | null>(null);

  useEffect(() => {
    // Initial defaults must not overwrite preferences before restoration.
    if (!settingsLoaded) return;
    writeStored(SETTINGS_NAME, SETTINGS_VERSION, { tempo, metronome, meter });
  }, [settingsLoaded, tempo, metronome, meter]);

  // ── Count-in beat (1 → beatsPerMeasure, then recording starts) ──────────
  const [countInBeat, setCountInBeat] = useState<number | null>(null);
  const countInActionRef = useRef<"start" | "resume" | null>(null);
  const playRequestRef = useRef(0);
  const [countInRequest, setCountInRequest] = useState(0);

  useEffect(() => () => {
    // Ignore audio initialization that finishes after leaving this page.
    playRequestRef.current += 1;
  }, []);

  // ── Welcome modal (first visit only) ────────────────────────────────────
  const [showWelcome, setShowWelcome] = useState(false);
  const [showCalibrationIntro, setShowCalibrationIntro] = useState(false);
  const welcomeRef = useRef<HTMLDivElement>(null);
  const calibrationIntroRef = useRef<HTMLDivElement>(null);
  useDialogFocus(welcomeRef, showWelcome, () => setShowWelcome(false));
  useDialogFocus(calibrationIntroRef, showCalibrationIntro, () => setShowCalibrationIntro(false));

  // ── Recording state machine ──────────────────────────────────────────────
  //   countInBeat      → 1 … beatsPerMeasure (one measure count-in), then recording
  //   isRecording      → actively recording (or paused)
  //   isPaused         → recording paused mid-session
  //   hasRecordings → stop pressed; MIDI controls visible
  // The recorder owns capture state; this React snapshot triggers UI updates.
  // Reading getState() alone cannot rerender when the mutable recorder changes.
  const [recordingState, setRecordingState] = useState<RecordingState>(() => recorder.getState());
  const isRecording = recordingState !== "stopped";
  const isPaused = recordingState === "paused";
  const [showRecordingComplete, setShowRecordingComplete] = useState(false);

  // ── Export / delete ──────────────────────────────────────────────────────

  const videoRef = useRef<HTMLVideoElement>(null);
  useEffect(() => registerCameraVideo(videoRef.current), []);
  const { stream, cameraReady } = useCamera();
  // Drives the calibration prompt; live readiness stays with the session.
  // null until storage is read, so calibrated users never see the prompt flash.
  const [isCalibrated, setIsCalibrated] = useState<boolean | null>(null);
  const [devMode, setDevMode] = useState(false);

  useEffect(() => {
    if (stream && videoRef.current) videoRef.current.srcObject = stream;
  }, [stream]);

  useEffect(() => {
    const timer = setTimeout(() => {
      const saved = readStored(
        SETTINGS_NAME, SETTINGS_VERSION, DEFAULT_SETTINGS, isPlaybackSettings,
      );
      setTempo(saved.tempo);
      setTempoInput(String(saved.tempo));
      setMetronome(saved.metronome);
      const restored = restoreMeter(saved.meter);
      setMeter(restored);
      setNumeratorDraft(String(restored.numerator));
      setSettingsLoaded(true);
      const dev = isDevMode();
      setDevMode(dev);
      setIsCalibrated(dev || loadCalibration() !== null);
      // Show welcome modal only on the very first visit. Arriving from a
      // share link (`/play/<id>` → `?song=<id>`) opens that song instead; the
      // welcome waits for the next visit rather than stacking under it.
      const openingSharedSongs = new URLSearchParams(window.location.search).get("song") !== null;
      if (!dev && !openingSharedSongs) try {
        if (!localStorage.getItem("hasVisited")) {
          setShowWelcome(true);
          localStorage.setItem("hasVisited", "true");
        }
      } catch { /* Calibration displays storage recovery separately. */ }
    }, 0);
    return () => clearTimeout(timer);
  }, []);

  // One measure owns one audio schedule and one wall-clock origin. React
  // renders update the display only; they never trigger individual clicks.
  const countingIn = countInBeat !== null;
  useEffect(() => {
    if (!countingIn) return;
    let canceled = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let cancelClicks = () => {};
    const request = playRequestRef.current;
    const begin = () => {
      if (canceled || request !== playRequestRef.current || countInActionRef.current === null) return;
      const origin = performance.now();
      const intervalMs = beatIntervalMs(tempo, meter);
      if (metronome) cancelClicks = scheduleCountInClicks(audioCtxRef.current!, tempo, meter);
      const tick = () => {
        if (canceled || request !== playRequestRef.current || countInActionRef.current === null) return;
        const elapsed = performance.now() - origin;
        const beat = Math.min(beatsPerMeasure, Math.floor(elapsed / intervalMs));
        if (elapsed >= beatsPerMeasure * intervalMs) {
          if (session.status.state !== "playing") {
            session.interrupt("Readiness changed during count-in. Wait for tracking, then select Enable audio.");
            return;
          }
          setCountInBeat(null);
          session.flushNotes();
          if (countInActionRef.current === "resume") recorder.resumeRecording();
          else recorder.startRecording(tempo, undefined, meter);
          session.resumeInput();
          setRecordingState(recorder.getState());
          countInActionRef.current = null;
          return;
        }
        setCountInBeat(beat + 1);
        // A delayed callback skips stale display beats instead of moving the
        // remaining deadlines or emitting a burst of late clicks.
        timer = setTimeout(tick, Math.max(1, origin + (beat + 1) * intervalMs - performance.now()));
      };
      tick();
    };
    const failed = () => {
      if (!canceled && request === playRequestRef.current) {
        clearTimeout(timer);
        cancelClicks();
        session.interrupt("Count-in audio could not start. Select Enable audio to retry.");
      }
    };
    try {
      if (metronome) {
        if (!audioCtxRef.current) audioCtxRef.current = trackAudioContext(new AudioContext());
        const context = audioCtxRef.current;
        if (context.state === "suspended") void context.resume().then(begin).catch(failed);
        else begin();
      } else begin();
    } catch { failed(); }
    return () => {
      canceled = true;
      clearTimeout(timer);
      cancelClicks();
    };
  // Settings are locked throughout this measure. Only its lifetime, rather
  // than each displayed beat, should create or cancel the audio schedule.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [countingIn, countInRequest]);

  // Playing and recording share readiness, but have independent lifetimes.
  const canPlay = liveStatus.canStart;

  // ── Recording controls ───────────────────────────────────────────────────
  useEffect(() => {
    const detach = session.attach();
    const disconnectNotes = connectPianoConsumers(session, recorder, setActivePitches);
    let previousState = session.status.state;
    const unsubscribe = session.subscribe(() => {
      const status = session.status;
      setLiveStatus(status);
      const changed = previousState !== status.state;
      previousState = status.state;
      if (changed && (status.state === "interrupted" || status.state === "error")) {
        playRequestRef.current++;
        countInActionRef.current = null;
        setCountInBeat(null);
        session.flushNotes();
        const take = recorder.stopRecording();
        if (take) completeTake(take, false);
        setRecordingState(recorder.getState());
        setShowRecordingComplete(take !== null);
      }
    });
    const visibility = () => session.setHidden(document.hidden);
    const leave = () => session.setHidden(true);
    document.addEventListener("visibilitychange", visibility);
    window.addEventListener("pagehide", leave);
    visibility();
    return () => {
      unsubscribe();
      detach();
      session.flushNotes();
      disconnectNotes();
      recorder.stopRecording();
      if (audioCtxRef.current) void closeTrackedAudioContext(audioCtxRef.current);
      document.removeEventListener("visibilitychange", visibility);
      window.removeEventListener("pagehide", leave);
    };
  }, [session, recorder, completeTake]);
  const enableAudio = async () => {
    if (!canPlay) return false;
    if (session.status.state === "playing") return true;
    if (!await session.prepare()) return false;
    return session.play() !== null;
  };
  const handlePlay = async () => {
    if (countInActionRef.current !== null || session.status.state === "starting") return;
    if (isRecording && !isPaused) {
      session.flushNotes();
      recorder.pauseRecording();
      setRecordingState(recorder.getState());
      return;
    }
    if (!canPlay || !libraryLoaded) return;
    countInActionRef.current = isRecording && isPaused ? "resume" : "start";
    const request = ++playRequestRef.current;
    session.pauseInput();
    pedalClearRef.current?.();
    if (request !== playRequestRef.current) return;
    if (!await enableAudio() || request !== playRequestRef.current) {
      if (request === playRequestRef.current) {
        countInActionRef.current = null;
        session.resumeInput();
      }
      return;
    }
    if (countInBeat !== null) return; // already counting in
    setCountInRequest(request);
    if (isRecording && isPaused) {
      // Keep the existing take paused until the count-in finishes.
      countInActionRef.current = "resume";
      setCountInBeat(1);
      return;
    }
    // Start fresh, clear previous session and begin count-in
    setRecordingState(recorder.getState());
    setShowRecordingComplete(false);
    countInActionRef.current = "start";
    setCountInBeat(1);
  };

  const pedalClearRef = useRef<(() => void) | null>(null);
  const handleStop = () => {
    pedalClearRef.current?.();
    if (session.status.state === "starting") session.stop();
    session.flushNotes();
    playRequestRef.current += 1;
    countInActionRef.current = null;
    setCountInBeat(null);
    session.resumeInput();
    // An initial count-in has no take; a resume count-in does.
    if (!isRecording) return;
    const recording = recorder.stopRecording();
    if (recording) completeTake(recording);
    setRecordingState(recorder.getState());
    setShowRecordingComplete(recording !== null);
  };


  // ── Tempo input helper ───────────────────────────────────────────────────
  function applyTempo() {
    const text = tempoInput.trim();
    const parsed = Number(text);
    if (text === "" || !Number.isInteger(parsed) || parsed < MIN_TEMPO || parsed > MAX_TEMPO) {
      setTempoInput(String(tempo));
      setTempoError(`Enter a whole number from ${MIN_TEMPO} to ${MAX_TEMPO} BPM. Tempo unchanged.`);
      return;
    }
    setTempo(parsed);
    setTempoInput(String(parsed));
    setTempoError(null);
  }

  function cancelTempoEdit() {
    setTempoInput(String(tempo));
    setTempoError(null);
  }

  const recordLabel = isRecording && !isPaused ? "Pause" : isPaused ? "Resume" : "Record";
  const recordDisabled = !libraryLoaded || !canPlay || countInBeat !== null || liveStatus.state === "starting";
  const stopDisabled = !isRecording && countInBeat === null && liveStatus.state !== "starting";
  // Playback settings only matter once a calibration exists.
  const settingsLocked = !settingsLoaded || isCalibrated !== true || isRecording || countInBeat !== null || liveStatus.state === "starting";
  const needsCalibration = isCalibrated === false;
  const openCalibration = () => setShowCalibrationIntro(true);
  const settingLabel = settingsLocked ? "text-ink-muted" : "text-ink";
  const statusTone =
    liveStatus.state === "error" ? "bg-danger" :
    liveStatus.state === "playing" ? "bg-success" : "bg-control-inactive";

  return (
    <div className="flex-1 bg-surface flex flex-col">
      <PageTopBar>
        <p
          role={liveStatus.state === "error" ? "alert" : "status"}
          className={`flex items-start gap-2 pb-1 text-[13px] leading-5 ${liveStatus.state === "error" ? "text-danger" : "text-ink-muted"}`}
        >
          <span aria-hidden="true" className={`mt-[7px] size-1.5 shrink-0 rounded-full transition-colors duration-200 ${statusTone}`} />
          {liveStatus.message}
        </p>
      </PageTopBar>
      <div aria-live="polite" className="sr-only">
        {countInBeat !== null ? `Count-in — piano input paused. Beat ${countInBeat} of ${beatsPerMeasure}. Select Stop to cancel.` : isPaused ? "Recording paused" : isRecording ? "Recording started" : showRecordingComplete ? "Recording complete" : ""}
      </div>

      {/* ── Welcome Modal (first visit) ─────────────────────────────────────── */}
      {showWelcome && (
        <div className="ms-backdrop fixed inset-0 z-50 flex items-center justify-center p-4">
          <div ref={welcomeRef} tabIndex={-1} role="dialog" aria-modal="true" aria-labelledby="welcome-title" className="ms-dialog w-[540px] max-w-full max-h-[90dvh] overflow-y-auto focus:outline-none">
            <div className="px-6 sm:px-9 pt-8 sm:pt-9 pb-6 sm:pb-8">
              <KeysIllustration />
              <h2 id="welcome-title" className="mt-5 mb-2 font-display text-[26px] sm:text-[32px] font-bold leading-tight tracking-tight text-ink">
                Welcome to MakeShift
              </h2>
              <p className="text-[15px] text-ink-muted leading-relaxed mb-7">
                Turn paper and your webcam into a piano! Here&apos;s how:
              </p>

              <ol className="flex flex-col gap-4 mb-8">
                {[
                  { title: "Watch the tutorial", body: "See how it works." },
                  { title: "Calibrate", body: "Show MakeShift your paper piano." },
                  { title: "Play!", body: "Tap the paper keys to make music." },
                ].map(({ title, body }, i) => (
                  <li key={title} className="flex gap-3.5 items-start">
                    <span className={`ms-step ${rainbow(i * 2).fill}`}>{i + 1}</span>
                    <div>
                      <p className="text-[15px] font-semibold text-ink">{title}</p>
                      <p className="text-[14px] text-ink-muted leading-relaxed">{body}</p>
                    </div>
                  </li>
                ))}
              </ol>

              <div className="flex gap-3">
                <button
                  onClick={() => { setShowWelcome(false); router.push("/tutorial"); }}
                  className="ms-key flex-1 py-3"
                >
                  Read Tutorial
                </button>
                <button
                  onClick={() => { setShowWelcome(false); setShowCalibrationIntro(true); }}
                  className="ms-key ms-key-primary flex-1 py-3"
                >
                  Start Calibration
                </button>
              </div>

              <button
                onClick={() => setShowWelcome(false)}
                className="ms-key ms-key-ghost w-full mt-2 text-[13px]"
              >
                Skip for now
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ── Calibration Intro Modal ─────────────────────────────────────────── */}
      {showCalibrationIntro && (
        <div
          className="ms-backdrop fixed inset-0 z-50 flex items-center justify-center p-4"
          onClick={() => setShowCalibrationIntro(false)}
        >
          <div
            ref={calibrationIntroRef}
            tabIndex={-1}
            role="dialog"
            aria-modal="true"
            aria-labelledby="calibration-intro-title"
            className="ms-dialog w-[520px] max-w-full max-h-[90dvh] overflow-y-auto focus:outline-none"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="px-6 sm:px-8 pt-8 pb-6">
              <h2 id="calibration-intro-title" className="font-display text-[24px] sm:text-[28px] font-bold leading-tight tracking-tight text-ink">Before You Begin: Calibration</h2>
              <p className="mt-3 text-[15px] text-ink-muted leading-relaxed">
                Grab your paper piano and find a bright spot.
              </p>
            </div>
            <ol className="ms-well mx-4 sm:mx-6 p-4 flex flex-col gap-3">
              {[
                "Pick your keyboard",
                "Check the lighting",
                "Show the whole paper",
                "Hover your hands",
                "Touch the corners and middle",
              ].map((text, i) => (
                <li key={i} className="flex items-start gap-3">
                  <span className={`ms-step size-6 text-[12px] ${rainbow(i).fill}`}>{i + 1}</span>
                  <span className="text-[15px] text-ink leading-relaxed">{text}</span>
                </li>
              ))}
            </ol>
            <div className="px-6 sm:px-8 pt-6 pb-7 flex gap-3 justify-end">
              <button
                onClick={() => { setShowCalibrationIntro(false); router.push("/calibration"); }}
                className="ms-key ms-key-ghost px-5"
              >
                Skip
              </button>
              <button
                onClick={() => { setShowCalibrationIntro(false); router.push("/calibration"); }}
                className="ms-key ms-key-primary px-6 py-3"
              >
                Begin Calibration
              </button>
            </div>
          </div>
        </div>
      )}
      <div className="flex flex-col lg:flex-row pl-(--gutter-l) pr-(--gutter-r)">
        {/* Camera feed: 16:9 and sized like the calibration and about pages.
            self-start keeps the taller sidebar from stretching it. */}
        <div className="ms-stage w-full lg:w-auto lg:flex-1 lg:self-start aspect-video bg-surface-dark relative overflow-hidden">
          <video
            ref={videoRef}
            autoPlay
            playsInline
            muted
            className="absolute inset-0 w-full h-full object-cover scale-x-[-1]"
          />
          <CVOverlayCoordinator
            session={session}
            videoRef={videoRef}
            enabled={canPlay && liveStatus.state === "playing"}
            activePitches={activePitches}
          />
          <CameraStatusOverlay />
          {devMode && <p className="ms-pill absolute top-3 right-3 z-30 py-1.5 px-3 text-[12px] font-semibold">Dev mode: calibration skipped</p>}

          {/* Calibrate-first call to action: the first thing to do on this page */}
          {needsCalibration && cameraReady && (
            <div className="absolute inset-0 z-20 flex items-center justify-center p-3 pointer-events-none">
              <section
                aria-labelledby="calibrate-first-title"
                className="ms-dialog pointer-events-auto flex max-w-[440px] flex-col items-center gap-2 px-6 py-4 sm:px-9 sm:py-7 text-center"
              >
                <div className="hidden sm:block mb-1"><KeysIllustration /></div>
                <h2 id="calibrate-first-title" className="text-[24px] sm:text-[34px] font-bold leading-tight tracking-[-0.01em] text-ink">
                  Calibrate first!
                </h2>
                <p className="hidden sm:block text-[15px] leading-relaxed text-ink-muted">
                  Show MakeShift your paper piano. Then you can play!
                </p>
                <button onClick={openCalibration} className="ms-key ms-key-primary mt-2 px-7">
                  Start calibration
                </button>
              </section>
            </div>
          )}

          {/* Live recording indicator */}
          {isRecording && (
            <div aria-hidden="true" className="ms-pill absolute top-3 left-3 z-30 py-1.5 pl-3 pr-3.5 text-[12px] font-semibold tracking-[0.08em]">
              <span className={`size-2 rounded-full ${isPaused ? "bg-ink-inverse-muted" : "bg-danger ms-rec-dot"}`} />
              {isPaused ? "PAUSED" : "REC"}
            </div>
          )}

          {/* Count-in overlay, one measure of beats before recording */}
          {countInBeat !== null && (
            <div className="absolute inset-0 flex flex-col items-center justify-center bg-surface-dark/60 z-40 pointer-events-none">
              <p className="text-white">Count-in — piano input paused · Stop to cancel</p>
              <span
                key={countInBeat}
                className="ms-beat font-display text-white font-bold leading-none tabular-nums"
                style={{ fontSize: "clamp(80px,20vw,160px)" }}
              >
                {countInBeat}
              </span>
              <div className="flex flex-wrap justify-center max-w-[240px] items-center gap-2.5 mt-6">
                {Array.from({ length: beatsPerMeasure }, (_, i) => (
                  <div
                    key={i}
                    className={`size-2.5 rounded-full transition-[transform,background-color] duration-150 ease-out ${i + 1 <= countInBeat ? rainbow(i).fill : "bg-white/30"} ${i + 1 === countInBeat ? "scale-[1.4]" : ""}`}
                  />
                ))}
              </div>
            </div>
          )}

          {!canPlay && devMode && <p role="status" className="ms-pill absolute bottom-3 left-3 right-3 z-20 justify-center rounded-[14px] text-center text-[14px]"><span>Dev mode: show all four sheet markers and your hands to play.</span></p>}
          {!canPlay && !devMode && isCalibrated === true && <p role="status" className="ms-pill absolute bottom-3 left-3 right-3 z-20 justify-center rounded-[14px] text-center text-[14px]"><span>Show the calibrated sheet and camera, or <a href="/calibration" className="underline underline-offset-2 font-medium">calibrate again</a>. Saved data is checked before playing.</span></p>}
        </div>

        {/* Right sidebar (below the camera under lg) */}
        <SideNav onCalibrationClick={() => setShowCalibrationIntro(true)} calibrationDisabled={devMode}>
          <section aria-label="Playback settings" className="relative grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-1 gap-[23px] mt-6 lg:mt-[42px] lg:pl-[43px]">
            {/* Tempo */}
            <div className="flex flex-col gap-2">
              <label htmlFor="set-tempo" className={`ms-label transition-colors ${settingLabel}`}>Set Tempo</label>
              <div className="relative">
                <input
                  id="set-tempo"
                  type="number"
                  min={MIN_TEMPO}
                  max={MAX_TEMPO}
                  disabled={settingsLocked}
                  step={1}
                  value={tempoInput}
                  onChange={(event) => {
                    setTempoInput(event.target.value);
                    setTempoError(null);
                  }}
                  onBlur={applyTempo}
                  onKeyDown={(event) => {
                    if (event.key === "Enter") {
                      event.preventDefault();
                      applyTempo();
                    } else if (event.key === "Escape") {
                      event.preventDefault();
                      cancelTempoEdit();
                    }
                  }}
                  aria-invalid={tempoError !== null}
                  aria-describedby={tempoError ? "tempo-error" : undefined}
                  className="ms-input w-full pr-12 tabular-nums"
                />
                <span className="absolute right-3 top-1/2 -translate-y-1/2 pointer-events-none text-[12px] font-medium text-ink-muted">BPM</span>
              </div>
              {tempoError && <p id="tempo-error" role="alert">{tempoError}</p>}
            </div>

            {/* Time Signature */}
            <div className="flex flex-col gap-2">
              <label htmlFor="time-signature" className={`ms-label transition-colors ${settingLabel}`}>Time Signature numerator</label>
              <div className="flex items-center gap-2">
                <input id="time-signature" type="number" min={MIN_NUMERATOR} max={MAX_NUMERATOR} step={1}
                  disabled={settingsLocked} value={numeratorDraft}
                  onChange={(e) => { setNumeratorDraft(e.target.value); setMeterError(null); }}
                  onBlur={() => commitMeter()} onKeyDown={(e) => {
                    if (e.key === "Enter") { e.preventDefault(); commitMeter(); }
                    if (e.key === "Escape") { setNumeratorDraft(String(meter.numerator)); setMeterError(null); }
                  }} aria-invalid={meterError !== null} aria-describedby="meter-help meter-error"
                  className="ms-input w-full min-w-0" />
                <span aria-hidden="true">/</span>
                <select aria-label="Time signature denominator" disabled={settingsLocked}
                  value={meter.denominator} onChange={(e) => commitMeter(Number(e.target.value))}
                  className="ms-input w-full min-w-0">
                  {DENOMINATORS.map((d) => <option key={d} value={d}>{d}</option>)}
                </select>
              </div>
              <p id="meter-help" className="text-sm text-ink-muted">{formatMeter(meter)} · Numerator / denominator. Quarter-note BPM. Stop the take to change settings.</p>
              <p id="meter-error" role={meterError ? "alert" : undefined}>{meterError}</p>
            </div>

            {/* Metronome toggle */}
            <div className="col-span-2 sm:col-span-1 lg:col-span-1 flex items-center justify-between gap-3 sm:self-end lg:self-auto sm:h-[38px] lg:h-auto lg:pt-1">
              <span className={`text-[16px] whitespace-nowrap transition-colors ${settingLabel}`}>Metronome</span>
              <button
                onClick={() => setMetronome((enabled) => !enabled)}
                disabled={settingsLocked}
                aria-label="Toggle metronome"
                aria-pressed={metronome}
                className="ms-switch"
              >
                <span />
              </button>
            </div>
            {needsCalibration && (
              <CalibrateFirstLock label="Calibrate first to set tempo and metronome" className="lg:left-[35px]" />
            )}
          </section>

          <div className="mt-[23px] lg:pl-[43px]">
            <RecordingsLibrary ref={recordingsLibraryRef} onStatusChange={updateLibraryStatus} />
          </div>
        </SideNav>
      </div>

      <PedalControls active={liveStatus.state === "playing" && !countingIn} clearRef={pedalClearRef} />
      {/* Bottom: Listen (left) + transport (centre) */}
      <div className="flex items-center shrink-0 pl-(--gutter-l) pr-(--gutter-r) pb-[clamp(16px,3dvh,36px)] pt-[clamp(16px,2.5dvh,28px)]">
        <div className="flex-1 relative flex flex-wrap items-center justify-center gap-x-4 gap-y-3">
          {hasRecordings && (
            <button className="ms-key lg:absolute lg:left-0 px-5">
              Listen to Recording
            </button>
          )}

          <div className="relative flex flex-wrap items-center justify-center gap-x-4 gap-y-3">
          <button
            onClick={enableAudio}
            disabled={!canPlay || liveStatus.state === "starting" || liveStatus.state === "playing"}
            className="ms-key ms-transport-key"
          >
            <SpeakerIcon />
            Enable audio
          </button>

          {/* Record / Pause / Resume button */}
          <button
            onClick={handlePlay}
            aria-label={isRecording && !isPaused ? "Pause recording" : isPaused ? "Resume recording" : "Start recording"}
            disabled={recordDisabled}
            className={`ms-key ms-transport-key ${isRecording && !isPaused ? "ms-key-live" : ""} ${isPaused ? "text-info" : ""}`}
          >
            {isRecording && !isPaused
              ? <PauseIcon />
              : isPaused ? <ResumeIcon /> : <RecordIcon />}
            {recordLabel}
          </button>

          {/* Stop button */}
          <button
            onClick={handleStop}
            aria-label="Stop recording"
            disabled={stopDisabled}
            className="ms-key ms-transport-key"
          >
            <StopIcon />
            Stop
          </button>
          {needsCalibration && (
            <CalibrateFirstLock label="Calibrate first to record" />
          )}
          </div>
        </div>
        <div className="hidden lg:block w-[267px] shrink-0" />
      </div>
    </div>
  );
}
