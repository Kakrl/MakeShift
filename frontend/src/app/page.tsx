"use client";

import { registerCameraVideo } from "../diagnostics/cameraVideo";

import { useCallback, useEffect, useRef, useState } from "react";
import dynamic from "next/dynamic";
import { useRouter } from "next/navigation";
import { useCamera } from "./CameraContext";
import CameraStatusOverlay from "./CameraStatusOverlay";
import SideNav from "./SideNav";
import {
  createRecorder,
  type Recorder,
  type Recording,
} from "./midi/midiUtils";
import { trackAudioContext, closeTrackedAudioContext } from "../diagnostics/performanceMetrics";
import { browserAudio } from "./audio/audioEngine";
import { LiveSession } from "../events/liveSession";
import { loadCalibration } from "../cv/calibration";
import { connectPianoConsumers } from "../events/pianoConsumers";
import type { RecordingsLibraryHandle } from "./midi/RecordingsLibraryPanel";
import { readStored, writeStored } from "../lib/storage";

const RecordingsLibrary = dynamic(
  () => import("./midi/RecordingsLibraryPanel"),
  { ssr: false, loading: () => <p role="status">Loading recordings...</p> },
);

const MIN_TEMPO = 20;
const MAX_TEMPO = 300;
const SETTINGS_NAME = "playback-settings";
const SETTINGS_VERSION = 1;
type PlaybackSettings = { tempo: number; metronome: boolean };
const DEFAULT_SETTINGS: PlaybackSettings = { tempo: 120, metronome: true };

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

function ChevronDown() {
  return (
    <svg aria-hidden="true" width="16" height="16" viewBox="0 0 16 16" fill="none" xmlns="http://www.w3.org/2000/svg">
      <path d="M4 6L8 10L12 6" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

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

function CheckBadge({ size = 28 }: { size?: number }) {
  return (
    <svg aria-hidden="true" width={size} height={size} viewBox="0 0 28 28" fill="none">
      <circle cx="14" cy="14" r="13" fill="var(--color-success)" />
      <path d="M8.5 14.5L12 18L19.5 10.5" stroke="var(--color-white)" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

/** A small keyboard with one key held down, used in the onboarding dialogs. */
function KeysIllustration() {
  const whites = [0, 1, 2, 3, 4, 5, 6];
  const blacks = [0, 1, 3, 4, 5];
  return (
    <svg aria-hidden="true" width="112" height="56" viewBox="0 0 112 56" fill="none">
      <rect x="0.5" y="0.5" width="111" height="55" rx="9.5" fill="var(--color-well)" stroke="var(--color-divider)" />
      {whites.map((i) => (
        <rect
          key={i}
          x={5 + i * 14.6}
          y={i === 2 ? 6 : 5}
          width="13.2"
          height={i === 2 ? 45 : 46}
          rx="3"
          fill={i === 2 ? "var(--color-accent-soft)" : "var(--color-white)"}
          stroke={i === 2 ? "var(--color-accent)" : "var(--color-divider)"}
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
  const consumersRef = useRef<ReturnType<typeof connectPianoConsumers> | null>(null);
  const recordingsLibraryRef = useRef<RecordingsLibraryHandle | null>(null);
  const [libraryLoaded, setLibraryLoaded] = useState(false);
  const [hasRecordings, setHasRecordings] = useState(false);
  const updateLibraryStatus = useCallback((loaded: boolean, hasRecordings: boolean) => {
    setLibraryLoaded(loaded);
    setHasRecordings(hasRecordings);
  }, []);
  const completeTake = useCallback((take: Recording) => {
    recordingsLibraryRef.current?.completeTake(take);
  }, []);

  // ── Tempo & time signature (controlled) ─────────────────────────────────
  const [tempo, setTempo] = useState(DEFAULT_SETTINGS.tempo);
  const [timeSignature, setTimeSignature] = useState("4/4");
  const beatsPerMeasure = parseInt(timeSignature.split("/")[0]);

  // ── Metronome ────────────────────────────────────────────────────────────
  const [metronome, setMetronome] = useState(DEFAULT_SETTINGS.metronome);
  const [settingsLoaded, setSettingsLoaded] = useState(false);
  const audioCtxRef = useRef<AudioContext | null>(null);

  useEffect(() => {
    // Initial defaults must not overwrite preferences before restoration.
    if (!settingsLoaded) return;
    writeStored(SETTINGS_NAME, SETTINGS_VERSION, { tempo, metronome });
  }, [settingsLoaded, tempo, metronome]);

  // ── Count-in beat (1 → beatsPerMeasure, then recording starts) ──────────
  const [countInBeat, setCountInBeat] = useState<number | null>(null);
  const countInActionRef = useRef<"start" | "resume" | null>(null);
  const playRequestRef = useRef(0);

  useEffect(() => () => {
    // Ignore audio initialization that finishes after leaving this page.
    playRequestRef.current += 1;
  }, []);

  // ── Welcome modal (first visit only) ────────────────────────────────────
  const [showWelcome, setShowWelcome] = useState(false);
  const [showCalibrationIntro, setShowCalibrationIntro] = useState(false);

  // ── Recording state machine ──────────────────────────────────────────────
  //   countInBeat      → 1 … beatsPerMeasure (one measure count-in), then recording
  //   isRecording      → actively recording (or paused)
  //   isPaused         → recording paused mid-session
  //   hasRecordings → stop pressed; MIDI controls visible
  const [isRecording, setIsRecording] = useState(false);
  const [isPaused, setIsPaused] = useState(false);
  const [showRecordingComplete, setShowRecordingComplete] = useState(false);

  // ── Export / delete ──────────────────────────────────────────────────────

  const videoRef = useRef<HTMLVideoElement>(null);
  useEffect(() => registerCameraVideo(videoRef.current), []);
  const { stream, cameraReady } = useCamera();
  // Drives the calibration prompt; live readiness stays with the session.
  const [isCalibrated, setIsCalibrated] = useState(false);

  useEffect(() => {
    if (stream && videoRef.current) videoRef.current.srcObject = stream;
  }, [stream]);

  useEffect(() => {
    const timer = setTimeout(() => {
      const saved = readStored(
        SETTINGS_NAME, SETTINGS_VERSION, DEFAULT_SETTINGS, isPlaybackSettings,
      );
      setTempo(saved.tempo);
      setMetronome(saved.metronome);
      setSettingsLoaded(true);
      setIsCalibrated(loadCalibration() !== null);
      // Show welcome modal only on the very first visit
      try {
        if (!localStorage.getItem("hasVisited")) {
          setShowWelcome(true);
          localStorage.setItem("hasVisited", "true");
        }
      } catch { /* Calibration displays storage recovery separately. */ }
    }, 0);
    return () => clearTimeout(timer);
  }, []);

  // ── Audio click (used only for count-in) ────────────────────────────────
  const playClick = useCallback((accent: boolean) => {
    if (!audioCtxRef.current) audioCtxRef.current = trackAudioContext(new AudioContext());
    const ctx = audioCtxRef.current;
    if (ctx.state === "suspended") ctx.resume();
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.connect(gain);
    gain.connect(ctx.destination);
    osc.type = "sine";
    osc.frequency.value = accent ? 1050 : 820;
    gain.gain.setValueAtTime(accent ? 0.65 : 0.38, ctx.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.055);
    osc.start(ctx.currentTime);
    osc.stop(ctx.currentTime + 0.06);
  }, []);

  // ── Beat-based count-in (1 measure at current tempo) ────────────────────
  useEffect(() => {
    if (countInBeat === null) return;
    // Play click for this beat (accent on beat 1)
    if (metronome) playClick(countInBeat === 1);
    const intervalMs = (60 / tempo) * 1000;
    const timer = setTimeout(() => {
      if (countInActionRef.current === null) return;
      if (countInBeat >= beatsPerMeasure) {
        // Measure complete — start recording
        if (session.status.state !== "playing") {
          session.interrupt("Readiness changed during count-in. Wait for tracking, then select Enable audio.");
          return;
        }
        setCountInBeat(null);
        setIsRecording(true);
        setIsPaused(false);

        session.flushNotes();
        // Resume keeps the existing take and excludes the count-in time.
        if (countInActionRef.current === "resume") {
          recorder.resumeRecording();
        } else {
          recorder.startRecording(tempo);
        }
        consumersRef.current?.captureHeld();
        countInActionRef.current = null;
      } else {
        setCountInBeat((b) => (b !== null ? b + 1 : null));
      }
    }, intervalMs);
    return () => clearTimeout(timer);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [countInBeat]);

  // Playing and recording share readiness, but have independent lifetimes.
  const canPlay = liveStatus.canStart;

  // ── Recording controls ───────────────────────────────────────────────────
  useEffect(() => {
    const detach = session.attach();
    const disconnectNotes = connectPianoConsumers(session, recorder, setActivePitches);
    consumersRef.current = disconnectNotes;
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
        if (take) completeTake(take);
        setIsRecording(false);
        setIsPaused(false);
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
      consumersRef.current = null;
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
    if (countInBeat !== null || session.status.state === "starting") return;
    if (isRecording && !isPaused) {
      session.flushNotes();
      recorder.pauseRecording();
      setIsPaused(true);
      return;
    }
    if (!canPlay || !libraryLoaded) return;
    const request = ++playRequestRef.current;
    if (!await enableAudio() || request !== playRequestRef.current) return;
    if (countInBeat !== null) return; // already counting in
    if (isRecording && isPaused) {
      // Keep the existing take paused until the count-in finishes.
      countInActionRef.current = "resume";
      setCountInBeat(1);
      return;
    }
    // Start fresh — clear previous session and begin count-in
    setIsRecording(false);
    setIsPaused(false);
    setShowRecordingComplete(false);
    countInActionRef.current = "start";
    setCountInBeat(1);
  };

  const handleStop = () => {
    if (session.status.state === "starting") session.stop();
    session.flushNotes();
    playRequestRef.current += 1;
    countInActionRef.current = null;
    setCountInBeat(null);
    // An initial count-in has no take; a resume count-in does.
    if (!isRecording) return;
    const recording = recorder.stopRecording();
    if (recording) completeTake(recording);
    setIsRecording(false);
    setIsPaused(false);
    setShowRecordingComplete(recording !== null);
  };


  // ── Tempo input helper ───────────────────────────────────────────────────
  const handleTempoChange = (raw: string) => {
    const parsed = parseInt(raw);
    if (!isNaN(parsed)) setTempo(Math.max(MIN_TEMPO, Math.min(MAX_TEMPO, parsed)));
  };

  const recordLabel = isRecording && !isPaused ? "Pause" : isPaused ? "Resume" : "Record";
  const recordDisabled = !libraryLoaded || !canPlay || countInBeat !== null || liveStatus.state === "starting";
  const stopDisabled = !isRecording && countInBeat === null && liveStatus.state !== "starting";
  const statusTone =
    liveStatus.state === "error" ? "bg-danger" :
    liveStatus.state === "playing" ? "bg-success" : "bg-control-inactive";

  return (
    <div className="flex-1 bg-surface flex flex-col">
      <p
        role={liveStatus.state === "error" ? "alert" : "status"}
        className={`flex items-start gap-2 pl-(--gutter-l) pr-(--gutter-r) pb-3 text-[13px] ${liveStatus.state === "error" ? "text-danger" : "text-ink-muted"}`}
      >
        <span aria-hidden="true" className={`mt-[7px] size-1.5 shrink-0 rounded-full transition-colors duration-200 ${statusTone}`} />
        {liveStatus.message}
      </p>
      <div aria-live="polite" className="sr-only">
        {isRecording ? "Recording started" : showRecordingComplete ? "Recording complete" : ""}
      </div>

      {/* ── Welcome Modal (first visit) ─────────────────────────────────────── */}
      {showWelcome && (
        <div className="ms-backdrop fixed inset-0 z-50 flex items-center justify-center p-4">
          <div role="dialog" aria-modal="true" aria-labelledby="welcome-title" className="ms-dialog w-[540px] max-w-full max-h-[90dvh] overflow-y-auto">
            <div className="px-6 sm:px-9 pt-8 sm:pt-9 pb-6 sm:pb-8">
              <KeysIllustration />
              <h2 id="welcome-title" className="mt-5 mb-2 font-display text-[26px] sm:text-[32px] font-bold leading-tight tracking-tight text-ink">
                Welcome to MakeShift
              </h2>
              <p className="text-[15px] text-ink-muted leading-relaxed mb-7">
                MakeShift turns a sheet of paper and your webcam into a playable piano, no hardware needed. Before you start, here&apos;s how to get going:
              </p>

              <ol className="flex flex-col gap-4 mb-8">
                {[
                  { title: "Read the Tutorial", body: "Get familiar with the setup steps and how finger tracking works." },
                  { title: "Run Calibration", body: "Place a sheet of paper in view of your camera and walk through the 5-step calibration so MakeShift can map your keys." },
                  { title: "Press Play and perform", body: "Set your tempo, toggle the metronome, hit Play, and start tapping the paper to make music." },
                ].map(({ title, body }, i) => (
                  <li key={title} className="flex gap-3.5 items-start">
                    <span className="ms-step">{i + 1}</span>
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
            role="dialog"
            aria-modal="true"
            aria-labelledby="calibration-intro-title"
            className="ms-dialog w-[520px] max-w-full max-h-[90dvh] overflow-y-auto"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="px-6 sm:px-8 pt-8 pb-6">
              <p className="ms-label mb-2">Calibration</p>
              <h2 id="calibration-intro-title" className="font-display text-[24px] sm:text-[28px] font-bold leading-tight tracking-tight text-ink">Before You Begin: Calibration</h2>
              <p className="mt-3 text-[15px] text-ink-muted leading-relaxed">
                Calibration maps your paper keyboard to the screen. Make sure you have a sheet of paper, good lighting, and your webcam is unobstructed before starting.
              </p>
            </div>
            <ol className="ms-well mx-4 sm:mx-6 p-4 flex flex-col gap-3">
              {[
                "Select the number of octaves and your starting note",
                "Check your environment's lighting",
                "Align the paper outline with your physical sheet",
                "Hover both hands above the paper to detect fingertips",
                "Place hands flat on the paper to set note boundaries",
              ].map((text, i) => (
                <li key={i} className="flex items-start gap-3">
                  <span className="ms-step size-6 rounded-[7px] text-[12px]">{i + 1}</span>
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
            className="absolute inset-0 w-full h-full object-cover"
          />
          <CVOverlayCoordinator
            session={session}
            videoRef={videoRef}
            enabled={canPlay && liveStatus.state === "playing"}
            activePitches={activePitches}
          />
          <CameraStatusOverlay />

          {/* "Click Calibration to Begin" overlay */}
          {!isCalibrated && cameraReady && (
            <div className="absolute inset-0 flex items-start justify-center pt-6 sm:pt-[56px] pointer-events-none">
              <p className="ms-pill font-display text-[18px] sm:text-[24px] font-semibold px-5 sm:px-7 py-2.5 sm:py-3 text-center">Click &lsquo;Calibration&rsquo; to Begin</p>
            </div>
          )}

          {/* Live recording indicator */}
          {isRecording && (
            <div aria-hidden="true" className="ms-pill absolute top-3 left-3 z-30 py-1.5 pl-3 pr-3.5 text-[12px] font-semibold tracking-[0.08em]">
              <span className={`size-2 rounded-full ${isPaused ? "bg-ink-inverse-muted" : "bg-danger ms-rec-dot"}`} />
              {isPaused ? "PAUSED" : "REC"}
            </div>
          )}

          {/* Count-in overlay — one measure of beats before recording */}
          {countInBeat !== null && (
            <div className="absolute inset-0 flex flex-col items-center justify-center bg-surface-dark/60 z-40 pointer-events-none">
              <span
                key={countInBeat}
                className="ms-beat font-display text-white font-bold leading-none tabular-nums"
                style={{ fontSize: "clamp(80px,20vw,160px)" }}
              >
                {countInBeat}
              </span>
              <div className="flex items-center gap-2.5 mt-6">
                {Array.from({ length: beatsPerMeasure }, (_, i) => (
                  <div
                    key={i}
                    className={`size-2.5 rounded-full transition-[transform,background-color] duration-150 ease-out ${i + 1 <= countInBeat ? "bg-white" : "bg-white/30"} ${i + 1 === countInBeat ? "scale-[1.4]" : ""}`}
                  />
                ))}
              </div>
            </div>
          )}

          {/* Recording Complete banner */}
          {showRecordingComplete && (
            <div className="ms-backdrop absolute inset-0 flex items-center justify-center z-50">
              <div className="ms-dialog px-6 sm:px-10 py-6 sm:py-7 max-w-[90%] flex flex-col items-center gap-2 text-center">
                <CheckBadge size={36} />
                <p className="mt-1 font-display text-[22px] sm:text-[26px] font-bold tracking-tight text-ink">Recording Complete!</p>
                <p className="text-[14px] text-ink-muted">Manage takes in the recordings list</p>
                <button
                  onClick={() => setShowRecordingComplete(false)}
                  className="ms-key mt-3 px-6"
                >
                  Dismiss
                </button>
              </div>
            </div>
          )}

          {!canPlay && <p role="status" className="ms-pill absolute bottom-3 left-3 right-3 z-20 justify-center rounded-[14px] text-center text-[14px]"><span>Show the calibrated sheet and camera, or <a href="/calibration" className="underline underline-offset-2 font-medium">calibrate again</a>. Saved data is checked before playing.</span></p>}
        </div>

        {/* Right sidebar (below the camera under lg) */}
        <SideNav onCalibrationClick={() => setShowCalibrationIntro(true)}>
          <section aria-label="Playback settings" className="ms-panel p-4 grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-1 gap-4">
            {/* Tempo */}
            <div className="flex flex-col gap-2">
              <label htmlFor="set-tempo" className="ms-label">Set Tempo</label>
              <div className="relative">
                <input
                  id="set-tempo"
                  type="number"
                  min={MIN_TEMPO}
                  max={MAX_TEMPO}
                  disabled={!settingsLoaded}
                  value={tempo}
                  onChange={(e) => handleTempoChange(e.target.value)}
                  className="ms-input w-full pr-12 tabular-nums"
                />
                <span className="absolute right-3 top-1/2 -translate-y-1/2 pointer-events-none text-[12px] font-medium text-ink-muted">BPM</span>
              </div>
            </div>

            {/* Time Signature */}
            <div className="flex flex-col gap-2">
              <label htmlFor="time-signature" className="ms-label">Time Signature</label>
              <div className="relative">
                <select
                  id="time-signature"
                  value={timeSignature}
                  onChange={(e) => setTimeSignature(e.target.value)}
                  className="ms-input w-full"
                >
                  <option>4/4</option>
                  <option>3/4</option>
                  <option>6/8</option>
                </select>
                <div className="absolute right-3 top-1/2 -translate-y-1/2 pointer-events-none text-ink-muted"><ChevronDown /></div>
              </div>
            </div>

            {/* Metronome toggle */}
            <div className="col-span-2 sm:col-span-1 lg:col-span-1 flex items-center justify-between gap-3 sm:self-end lg:self-auto sm:h-[38px] lg:h-auto lg:pt-1">
              <span className="text-[15px] font-medium text-ink whitespace-nowrap">Metronome</span>
              <button
                onClick={() => setMetronome((enabled) => !enabled)}
                disabled={!settingsLoaded}
                aria-label="Toggle metronome"
                aria-pressed={metronome}
                className="ms-switch"
              >
                <span />
              </button>
            </div>
          </section>

          <div className="ms-panel p-4">
            <RecordingsLibrary ref={recordingsLibraryRef} onStatusChange={updateLibraryStatus} />
          </div>
        </SideNav>
      </div>

      {/* Bottom: Listen (left) + transport (centre) */}
      <div className="flex items-center shrink-0 pl-(--gutter-l) pr-(--gutter-r) pb-[clamp(16px,3dvh,36px)] pt-[clamp(16px,2.5dvh,28px)]">
        <div className="flex-1 relative flex flex-wrap items-end justify-center gap-x-5 gap-y-3">
          {hasRecordings && (
            <button className="ms-key self-center lg:absolute lg:left-0 px-5">
              Listen to Recording
            </button>
          )}

          <button
            onClick={enableAudio}
            disabled={!canPlay || liveStatus.state === "starting" || liveStatus.state === "playing"}
            className="ms-transport"
          >
            <span className="ms-transport-face text-ink"><SpeakerIcon /></span>
            <span className="ms-transport-label">Enable audio</span>
          </button>

          {/* Record / Pause / Resume button */}
          <button
            onClick={handlePlay}
            aria-label={isRecording && !isPaused ? "Pause recording" : isPaused ? "Resume recording" : "Start recording"}
            disabled={recordDisabled}
            data-live={isRecording && !isPaused ? "" : undefined}
            className="ms-transport ms-transport-main"
          >
            <span className="ms-transport-face">
              {isRecording && !isPaused
                ? <PauseIcon />
                : isPaused ? <ResumeIcon /> : <RecordIcon />}
            </span>
            <span className={`ms-transport-label ${isPaused ? "text-info" : ""}`}>
              {recordLabel}
            </span>
          </button>

          {/* Stop button */}
          <button
            onClick={handleStop}
            aria-label="Stop recording"
            disabled={stopDisabled}
            className="ms-transport"
          >
            <span className="ms-transport-face text-ink"><StopIcon /></span>
            <span className="ms-transport-label">Stop</span>
          </button>
        </div>
        <div className="hidden lg:block w-[267px] shrink-0" />
      </div>
    </div>
  );
}
