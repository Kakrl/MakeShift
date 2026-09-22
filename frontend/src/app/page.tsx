"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import dynamic from "next/dynamic";
import { useRouter } from "next/navigation";
import { useCamera } from "./CameraContext";
import CameraStatusOverlay from "./CameraStatusOverlay";
import {
  startRecording,
  stopRecording,
  downloadMidi,
} from "./midi/midiUtils";

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

function PlayIcon({ color = "var(--color-ink)" }: { color?: string }) {
  return (
    <svg aria-hidden="true" width="40" height="40" viewBox="0 0 40 40" fill="none" xmlns="http://www.w3.org/2000/svg">
      <circle cx="20" cy="20" r="18.5" stroke={color} strokeWidth="1.5" style={{ transition: "stroke 120ms ease" }} />
      <path d="M16 14L28 20L16 26V14Z" fill={color} style={{ transition: "fill 120ms ease" }} />
    </svg>
  );
}

function PauseIcon() {
  return (
    <svg aria-hidden="true" width="40" height="40" viewBox="0 0 40 40" fill="none" xmlns="http://www.w3.org/2000/svg">
      <circle cx="20" cy="20" r="18.5" stroke="var(--color-info)" strokeWidth="1.5" />
      <rect x="13" y="13" width="5" height="14" rx="1.5" fill="var(--color-info)" />
      <rect x="22" y="13" width="5" height="14" rx="1.5" fill="var(--color-info)" />
    </svg>
  );
}

function StopIcon() {
  return (
    <svg aria-hidden="true" width="40" height="40" viewBox="0 0 40 40" fill="none" xmlns="http://www.w3.org/2000/svg">
      <circle cx="20" cy="20" r="18.5" stroke="var(--color-ink)" strokeWidth="1.5" />
      <rect x="13" y="13" width="14" height="14" fill="var(--color-ink)" />
    </svg>
  );
}

export default function Home() {
  const router = useRouter();

  // ── Tempo & time signature (controlled) ─────────────────────────────────
  const [tempo, setTempo] = useState(120);
  const [timeSignature, setTimeSignature] = useState("4/4");
  const beatsPerMeasure = parseInt(timeSignature.split("/")[0]);

  // ── Metronome ────────────────────────────────────────────────────────────
  const [metronome, setMetronome] = useState(true);
  const audioCtxRef = useRef<AudioContext | null>(null);

  // ── Count-in beat (1 → beatsPerMeasure, then recording starts) ──────────
  const [countInBeat, setCountInBeat] = useState<number | null>(null);

  // ── Welcome modal (first visit only) ────────────────────────────────────
  const [showWelcome, setShowWelcome] = useState(false);

  // ── Auth / calibration ───────────────────────────────────────────────────
  const [isCalibrated, setIsCalibrated] = useState(false);
  const [showCalibrationIntro, setShowCalibrationIntro] = useState(false);

  // ── Recording state machine ──────────────────────────────────────────────
  //   countInBeat      → 1 … beatsPerMeasure (one measure count-in), then recording
  //   isRecording      → actively recording (or paused)
  //   isPaused         → recording paused mid-session
  //   hasFinishedRecording → stop pressed; MIDI controls visible
  const [isRecording, setIsRecording] = useState(false);
  const [isPaused, setIsPaused] = useState(false);
  const [hasFinishedRecording, setHasFinishedRecording] = useState(false);
  const [showRecordingComplete, setShowRecordingComplete] = useState(false);

  // ── Export / delete ──────────────────────────────────────────────────────
  const [showExportDialog, setShowExportDialog] = useState(false);
  const [exportPath, setExportPath] = useState("~/Downloads");
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);

  const videoRef = useRef<HTMLVideoElement>(null);
  const { stream, cameraReady } = useCamera();

  useEffect(() => {
    if (stream && videoRef.current) videoRef.current.srcObject = stream;
  }, [stream]);

  useEffect(() => {
    const timer = setTimeout(() => {
      setIsCalibrated(localStorage.getItem("isCalibrated") === "true");
      // Show welcome modal only on the very first visit
      if (!localStorage.getItem("hasVisited")) {
        setShowWelcome(true);
        localStorage.setItem("hasVisited", "true");
      }
    }, 0);
    const handleBeforeUnload = () => localStorage.removeItem("isCalibrated");
    window.addEventListener("beforeunload", handleBeforeUnload);
    return () => { clearTimeout(timer); window.removeEventListener("beforeunload", handleBeforeUnload); };
  }, []);

  // ── Audio click (used only for count-in) ────────────────────────────────
  const playClick = useCallback((accent: boolean) => {
    if (!audioCtxRef.current) audioCtxRef.current = new AudioContext();
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
      if (countInBeat >= beatsPerMeasure) {
        // Measure complete — start recording
        setCountInBeat(null);
        setIsRecording(true);
        setIsPaused(false);

        // Start recording session (MIDI capture)
        startRecording(tempo);
      } else {
        setCountInBeat((b) => (b !== null ? b + 1 : null));
      }
    }, intervalMs);
    return () => clearTimeout(timer);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [countInBeat]);

  // Recording needs both a stored calibration and a live camera feed.
  const canRecord = isCalibrated && cameraReady;

  // ── Recording controls ───────────────────────────────────────────────────
  const handlePlay = () => {
    if (!canRecord) return;
    if (countInBeat !== null) return; // already counting in
    if (isRecording && !isPaused) {
      // Pause
      setIsPaused(true);
      return;
    }
    if (isRecording && isPaused) {
      // Resume via count-in
      setIsPaused(false);
      setIsRecording(false);
      setCountInBeat(1);
      return;
    }
    // Start fresh — clear previous session and begin count-in
    setIsRecording(false);
    setIsPaused(false);
    setHasFinishedRecording(false);
    setShowRecordingComplete(false);
    setShowExportDialog(false);
    setShowDeleteConfirm(false);
    setCountInBeat(1);
  };

  const handleStop = () => {
    if (!canRecord) return;
    if (countInBeat !== null) { setCountInBeat(null); return; } // cancel count-in
    if (!isRecording) return;
    setIsRecording(false);
    setIsPaused(false);
    setHasFinishedRecording(true);
    setShowRecordingComplete(true);

    // Stop recording session (MIDI capture)
    stopRecording();
  };

  const confirmDelete = () => {
    setHasFinishedRecording(false);
    setShowRecordingComplete(false);
    setShowExportDialog(false);
    setShowDeleteConfirm(false);
  };

  // ── Tempo input helper ───────────────────────────────────────────────────
  const handleTempoChange = (raw: string) => {
    const parsed = parseInt(raw);
    if (!isNaN(parsed)) setTempo(Math.max(20, Math.min(300, parsed)));
  };

  return (
    <div className="flex-1 bg-[#fffdf7] flex flex-col">
      <div className="flex flex-1 pt-[115px] pl-[61px] pr-[47px] pb-[226px]">
        {/* Camera feed */}
        <div className="flex-1 bg-[#090909] relative overflow-hidden">
          <video
            ref={videoRef}
            autoPlay
            playsInline
            muted
            className="absolute inset-0 w-full h-full object-cover"
          />
          <CVOverlayCoordinator videoRef={videoRef} />
        </div>

        {/* Right sidebar */}
        <div className="w-[267px] relative flex flex-col shrink-0">
          {/* Piano key bars */}
          <div className="absolute left-0 top-[50px] flex flex-col gap-[24px] z-10 pointer-events-none">
            <div className="bg-black h-[46px] w-[140px] rounded-tr-[4px] rounded-br-[4px] shadow-[2px_1px_1px_0px_rgba(0,0,0,0.1)]" />
            <div className="bg-black h-[46px] w-[140px] rounded-tr-[4px] rounded-br-[4px] shadow-[2px_1px_1px_0px_rgba(0,0,0,0.1)]" />
          </div>

          {/* Nav tabs */}
          <div className="flex flex-col">
            <button
              onClick={() => setShowCalibrationIntro(true)}
              className="border border-black h-[72px] flex items-center justify-end pr-[19px] pl-[100px] rounded-tr-[8px] bg-surface relative shadow-[inset_0px_4px_0px_0px_rgba(255,255,255,0.25),inset_0px_-15px_17.6px_0px_rgba(53,21,21,0.07)] hover:bg-black/5 transition-colors"
            >
              <span className="text-[20px] text-black font-sans whitespace-nowrap">Calibration</span>
            </button>
            <Link href="/tutorial" className="-mt-px border border-black h-[72px] flex items-center justify-end pr-[19px] pl-[100px] bg-surface relative shadow-[inset_0px_4px_0px_0px_rgba(255,255,255,0.25),inset_0px_-15px_17.6px_0px_rgba(53,21,21,0.07)] hover:bg-black/5 transition-colors">
              <span className="text-[20px] text-black font-sans whitespace-nowrap">Tutorial</span>
            </Link>
            <Link href="/about" className="-mt-px border border-black h-[72px] flex items-center justify-end pr-[19px] pl-[100px] rounded-br-[8px] bg-surface relative shadow-[inset_0px_4px_0px_0px_rgba(255,255,255,0.25),inset_0px_-15px_17.6px_0px_rgba(53,21,21,0.07)] hover:bg-black/5 transition-colors">
              <span className="text-[20px] text-black font-sans whitespace-nowrap">About</span>
            </Link>
          </div>

          {/* Controls */}
          <div className="flex flex-col gap-[23px] mt-[42px] pl-[43px]">
            {/* Tempo */}
            <div className="flex flex-col gap-2">
              <label htmlFor="set-tempo" className="text-[16px] text-ink font-sans leading-[1.4]">Set Tempo</label>
              <div className="flex items-center gap-2">
                <input
                  id="set-tempo"
                  type="number"
                  min={20}
                  max={300}
                  value={tempo}
                  onChange={(e) => handleTempoChange(e.target.value)}
                  className="border border-control-border rounded-[8px] px-4 py-3 text-[16px] text-ink bg-white w-[80px] leading-none focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-black"
                />
                <span className="text-[13px] text-ink-muted font-sans">BPM</span>
              </div>
            </div>

            {/* Time Signature */}
            <div className="flex flex-col gap-2">
              <label htmlFor="time-signature" className="text-[16px] text-ink font-sans leading-[1.4]">Time Signature</label>
              <div className="relative w-[120px]">
                <select
                  id="time-signature"
                  value={timeSignature}
                  onChange={(e) => setTimeSignature(e.target.value)}
                  className="border border-control-border rounded-[8px] pl-4 pr-8 py-[10px] text-[16px] text-ink bg-white w-full appearance-none leading-none cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-black"
                >
                  <option>4/4</option>
                  <option>3/4</option>
                  <option>6/8</option>
                </select>
                <div className="absolute right-3 top-1/2 -translate-y-1/2 pointer-events-none text-ink"><ChevronDown /></div>
              </div>
            </div>

            {/* Metronome toggle */}
            <div className="flex items-center gap-3">
              <span className="text-[16px] text-ink font-sans leading-[1.4] whitespace-nowrap">Metronome</span>
              <button
                onClick={() => setMetronome(!metronome)}
                aria-label="Toggle metronome"
                aria-pressed={metronome}
                className={`relative w-[40px] h-[24px] rounded-full overflow-hidden transition-colors ${metronome ? "bg-ink" : "bg-control-inactive"}`}
              >
                <span className={`absolute top-[2px] left-0 w-[20px] h-[20px] rounded-full bg-white shadow transition-transform duration-150 ease-out ${metronome ? "translate-x-[18px]" : "translate-x-[2px]"}`} />
              </button>
            </div>

            {/* MIDI controls — only visible after Stop is pressed */}
            {hasFinishedRecording && (
              <div className="flex flex-col gap-[10px] pt-[6px] border-t border-divider">
                <button
                  onClick={() => setShowExportDialog(!showExportDialog)}
                  className="border border-black bg-surface px-4 py-[10px] rounded-[8px] text-[14px] text-black font-sans hover:bg-black/5 active:scale-[0.97] transition-[background-color,transform] text-left"
                >
                  Export .MIDI Recording
                </button>
                <button
                  onClick={() => setShowDeleteConfirm(true)}
                  className="border border-danger bg-surface px-4 py-[10px] rounded-[8px] text-[14px] text-danger font-sans hover:bg-red-50 active:scale-[0.97] transition-[background-color,transform] text-left"
                >
                  Delete .MIDI Recording
                </button>
              </div>
            )}
          </div>
        </div>
      </div>

      {/* ── Export Modal ────────────────────────────────────────────────────── */}
      {showExportDialog && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/50"
          onClick={() => setShowExportDialog(false)}
        >
          <div
            className="bg-white rounded-[16px] shadow-2xl w-[480px] max-w-[90vw] p-8"
            onClick={(e) => e.stopPropagation()}
          >
            <h2 className="text-[22px] font-bold text-black font-sans mb-2">Export MIDI Recording</h2>
            <p className="text-[15px] text-ink-subtle font-sans mb-6">Choose where to save the MIDI file.</p>
            <label htmlFor="export-path" className="text-[14px] font-medium text-black font-sans block mb-2">Save location</label>
            <input
              id="export-path"
              type="text"
              value={exportPath}
              onChange={(e) => setExportPath(e.target.value)}
              className="w-full border border-control-border rounded-[8px] px-4 py-3 text-[16px] text-black bg-white mb-6 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-black"
            />
            <div className="flex gap-3 justify-end">
              <button
                onClick={() => setShowExportDialog(false)}
                className="border border-black bg-white px-6 py-3 rounded-[10px] text-[16px] text-black font-sans hover:bg-black/5 active:scale-[0.97] transition-[background-color,transform]"
              >
                Cancel
              </button>
              <button
                onClick={() => {
                  setShowExportDialog(false)
                  downloadMidi()
                }}
                className="border border-black bg-black px-6 py-3 rounded-[10px] text-[16px] text-white font-sans hover:bg-black/80 active:scale-[0.97] transition-[background-color,transform]"
              >
                Export
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Bottom: Listen (left) + Play/Stop (centre) */}
      <div className="flex items-center shrink-0 pl-[clamp(20px,4.2vw,61px)] pr-[clamp(12px,3.2vw,47px)] pb-[clamp(12px,3dvh,36px)] pt-[clamp(8px,2dvh,24px)]">
        <div className="flex-1 relative flex items-center justify-center gap-[27px]">
          {hasFinishedRecording && (
            <button className="absolute left-0 border-[1.5px] border-black bg-surface px-5 py-2 rounded-[8px] text-[17px] text-black font-sans hover:bg-black/5 active:scale-[0.97] transition-[background-color,transform]">
              Listen to Recording
            </button>
          )}

          {/* Play / Pause / Resume button */}
          <button
            onClick={handlePlay}
            aria-label={isRecording && !isPaused ? "Pause recording" : isPaused ? "Resume recording" : "Start recording"}
            disabled={!canRecord || countInBeat !== null}
            className={`flex flex-col items-center gap-1 transition-[opacity,transform] active:scale-[0.97] ${!canRecord || countInBeat !== null ? "opacity-30 cursor-not-allowed" : "hover:opacity-70"}`}
          >
            {isRecording && !isPaused
              ? <PauseIcon />
              : <PlayIcon color={isPaused ? "var(--color-info)" : "var(--color-ink)"} />}
            <span className={`text-[13px] font-sans select-none ${isPaused ? "text-info" : "text-ink"}`}>
              {isRecording && !isPaused ? "Pause" : isPaused ? "Resume" : "Play"}
            </span>
          </button>

          {/* Stop button */}
          <button
            onClick={handleStop}
            aria-label="Stop recording"
            disabled={!canRecord || (!isRecording && countInBeat === null)}
            className={`flex flex-col items-center gap-1 transition-[opacity,transform] active:scale-[0.97] ${!canRecord || (!isRecording && countInBeat === null) ? "opacity-30 cursor-not-allowed" : "hover:opacity-70"}`}
          >
            <StopIcon />
            <span className="text-[13px] text-ink font-sans select-none">Stop</span>
          </button>
        </div>
        <div className="w-[267px] shrink-0" />
      </div>
    </div>
  );
}
