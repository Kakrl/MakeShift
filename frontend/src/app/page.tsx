"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCamera } from "./CameraContext";

function ChevronDown() {
  return (
    <svg aria-hidden="true" width="16" height="16" viewBox="0 0 16 16" fill="none" xmlns="http://www.w3.org/2000/svg">
      <path d="M4 6L8 10L12 6" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

function PlayIcon({ color = "#1e1e1e" }: { color?: string }) {
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
      <circle cx="20" cy="20" r="18.5" stroke="#3b82f6" strokeWidth="1.5" />
      <rect x="13" y="13" width="5" height="14" rx="1.5" fill="#3b82f6" />
      <rect x="22" y="13" width="5" height="14" rx="1.5" fill="#3b82f6" />
    </svg>
  );
}

function StopIcon() {
  return (
    <svg aria-hidden="true" width="40" height="40" viewBox="0 0 40 40" fill="none" xmlns="http://www.w3.org/2000/svg">
      <circle cx="20" cy="20" r="18.5" stroke="#1e1e1e" strokeWidth="1.5" />
      <rect x="13" y="13" width="14" height="14" fill="#1e1e1e" />
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
  const { stream } = useCamera();

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
      } else {
        setCountInBeat((b) => (b !== null ? b + 1 : null));
      }
    }, intervalMs);
    return () => clearTimeout(timer);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [countInBeat]);

  // ── Recording controls ───────────────────────────────────────────────────
  const handlePlay = () => {
    if (!isCalibrated) return;
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
    if (!isCalibrated) return;
    if (countInBeat !== null) { setCountInBeat(null); return; } // cancel count-in
    if (!isRecording) return;
    setIsRecording(false);
    setIsPaused(false);
    setHasFinishedRecording(true);
    setShowRecordingComplete(true);
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
    <div className="flex-1 bg-[#fffdf7] flex flex-col min-h-0 overflow-hidden">
      <div aria-live="polite" className="sr-only">
        {isRecording ? "Recording started" : showRecordingComplete ? "Recording complete" : ""}
      </div>

      {/* ── Welcome Modal (first visit) ─────────────────────────────────────── */}
      {showWelcome && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50">
          <div className="bg-[#fffdf7] rounded-[20px] shadow-2xl w-[540px] max-w-[92vw] overflow-hidden">

            {/* Body */}
            <div className="px-10 pt-9 pb-8">
              {/* Piano icon */}
              <div className="flex items-center gap-3 mb-5">
                <svg width="36" height="36" viewBox="0 0 36 36" fill="none" aria-hidden="true">
                  <rect x="1" y="6" width="34" height="24" rx="3" fill="#1e1e1e" />
                  {/* White keys */}
                  {[4, 9, 14, 19, 24, 29].map((x) => (
                    <rect key={x} x={x} y="6" width="4" height="18" rx="1" fill="white" />
                  ))}
                  {/* Black keys */}
                  {[6.5, 11.5, 21.5, 26.5].map((x) => (
                    <rect key={x} x={x} y="6" width="3" height="11" rx="1" fill="#1e1e1e" />
                  ))}
                </svg>
                <h2 className="text-[28px] font-bold text-black font-sans tracking-tight">
                  Welcome to MakeShift
                </h2>
              </div>

              <p className="text-[15px] text-black/65 font-sans leading-relaxed mb-7">
                MakeShift turns a sheet of paper and your webcam into a playable piano, no hardware needed. Before you start, here&apos;s how to get going:
              </p>

              <div className="flex flex-col gap-4 mb-8">
                {[
                  {
                    num: "1",
                    color: "#b46eff",
                    title: "Read the Tutorial",
                    body: "Get familiar with the setup steps and how finger tracking works.",
                  },
                  {
                    num: "2",
                    color: "#b46eff",
                    title: "Run Calibration",
                    body: "Place a sheet of paper in view of your camera and walk through the 5-step calibration so MakeShift can map your keys.",
                  },
                  {
                    num: "3",
                    color: "#b46eff",
                    title: "Press Play and perform",
                    body: "Set your tempo, toggle the metronome, hit Play, and start tapping the paper to make music.",
                  },
                ].map(({ num, color, title, body }) => (
                  <div key={num} className="flex gap-4 items-start">
                    <span
                      className="shrink-0 w-7 h-7 rounded-full flex items-center justify-center text-white text-[13px] font-bold mt-0.5"
                      style={{ background: color }}
                    >
                      {num}
                    </span>
                    <div>
                      <p className="text-[15px] font-semibold text-black font-sans">{title}</p>
                      <p className="text-[14px] text-black/60 font-sans leading-relaxed">{body}</p>
                    </div>
                  </div>
                ))}
              </div>

              {/* CTA row */}
              <div className="flex gap-3">
                <button
                  onClick={() => { setShowWelcome(false); router.push("/tutorial"); }}
                  className="flex-1 border border-black bg-[#fffdf7] py-3 rounded-[10px] text-[15px] text-black font-sans hover:bg-black/5 active:scale-[0.97] transition-[background-color,transform]"
                >
                  Read Tutorial
                </button>
                <button
                  onClick={() => { setShowWelcome(false); setShowCalibrationIntro(true); }}
                  className="flex-1 border border-black bg-black py-3 rounded-[10px] text-[15px] text-white font-sans hover:bg-black/80 active:scale-[0.97] transition-[background-color,transform]"
                >
                  Start Calibration
                </button>
              </div>

              <button
                onClick={() => setShowWelcome(false)}
                className="w-full mt-3 py-2 text-[13px] text-black/40 font-sans hover:text-black/60 transition-colors"
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
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/50"
          onClick={() => setShowCalibrationIntro(false)}
        >
          <div
            className="bg-white rounded-[16px] shadow-2xl w-[520px] max-w-[90vw] overflow-hidden"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="px-8 pt-8 pb-5">
              <h2 className="text-[26px] font-bold text-black font-sans">Before You Begin: Calibration</h2>
            </div>
            <hr className="border-[#e5e5e5]" />
            <div className="px-8 py-6">
              <p className="text-[15px] text-black/70 font-sans mb-5 leading-relaxed">
                Calibration maps your paper keyboard to the screen. Make sure you have a sheet of paper, good lighting, and your webcam is unobstructed before starting.
              </p>
              <ol className="flex flex-col gap-3">
                {[
                  "Select the number of octaves and your starting note",
                  "Check your environment's lighting",
                  "Align the paper outline with your physical sheet",
                  "Hover both hands above the paper to detect fingertips",
                  "Place hands flat on the paper to set note boundaries",
                ].map((text, i) => (
                  <li key={i} className="flex items-start gap-3">
                    <span className="shrink-0 w-6 h-6 rounded-full bg-[#b46eff] flex items-center justify-center text-white text-[13px] font-bold mt-0.5">
                      {i + 1}
                    </span>
                    <span className="text-[15px] text-black/80 font-sans leading-relaxed">{text}</span>
                  </li>
                ))}
              </ol>
            </div>
            <div className="px-8 pb-8 flex gap-3 justify-end">
              <button
                onClick={() => { setShowCalibrationIntro(false); router.push("/calibration"); }}
                className="border border-black bg-[#fffdf7] px-6 py-3 rounded-[10px] text-[16px] text-black font-sans hover:bg-black/5 active:scale-[0.97] transition-[background-color,transform]"
              >
                Skip
              </button>
              <button
                onClick={() => { setShowCalibrationIntro(false); router.push("/calibration"); }}
                className="border border-black bg-black px-6 py-3 rounded-[10px] text-[16px] text-white font-sans hover:bg-black/80 active:scale-[0.97] transition-[background-color,transform]"
              >
                Begin Calibration
              </button>
            </div>
          </div>
        </div>
      )}

      <div className="flex pl-[clamp(20px,4.2vw,61px)] pr-[clamp(12px,3.2vw,47px)]">
        {/* Camera */}
        <div className="flex-1 aspect-video bg-[#090909] relative overflow-hidden">
          <video ref={videoRef} autoPlay playsInline muted className="absolute inset-0 w-full h-full object-cover" />

          {/* "Click Calibration to Begin" overlay */}
          {!isCalibrated && (
            <div className="absolute inset-0 flex items-start justify-center pt-[60px] pointer-events-none">
              <p className="text-white text-[32px] font-sans text-center px-8">Click &lsquo;Calibration&rsquo; to Begin</p>
            </div>
          )}

          {/* Count-in overlay — one measure of beats before recording */}
          {countInBeat !== null && (
            <div className="absolute inset-0 flex flex-col items-center justify-center bg-black/60 z-40 pointer-events-none">
              <span className="text-white font-bold drop-shadow-lg leading-none tabular-nums" style={{ fontSize: "clamp(80px,20vw,160px)" }}>
                {countInBeat}
              </span>
              <div className="flex items-center gap-2 mt-6">
                {Array.from({ length: beatsPerMeasure }, (_, i) => (
                  <div
                    key={i}
                    className="rounded-full transition-all duration-75"
                    style={{
                      width:  i + 1 === countInBeat ? 14 : 8,
                      height: i + 1 === countInBeat ? 14 : 8,
                      background: i + 1 <= countInBeat ? "#ffffff" : "rgba(255,255,255,0.3)",
                    }}
                  />
                ))}
              </div>
            </div>
          )}

          {/* Recording Complete banner */}
          {showRecordingComplete && (
            <div className="absolute inset-0 flex items-center justify-center z-50 bg-black/30">
              <div className="bg-white rounded-[14px] px-12 py-8 shadow-2xl flex flex-col items-center gap-3">
                <div className="flex items-center gap-3">
                  <svg width="32" height="32" viewBox="0 0 32 32" fill="none" aria-hidden="true"><circle cx="16" cy="16" r="15" fill="#6dd99a"/><path d="M9 16L13.5 21L23 11" stroke="white" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"/></svg>
                  <p className="text-[28px] font-bold text-black font-sans">Recording Complete!</p>
                </div>
                <p className="text-[14px] text-black/50 font-sans">Use the sidebar to export or delete</p>
                <button
                  onClick={() => setShowRecordingComplete(false)}
                  className="mt-1 border border-black/20 px-6 py-2 rounded-[8px] text-[15px] text-black font-sans hover:bg-black/5 active:scale-[0.97] transition-[background-color,transform]"
                >
                  Dismiss
                </button>
              </div>
            </div>
          )}

          {/* Delete confirmation dialog */}
          {showDeleteConfirm && (
            <div className="absolute inset-0 flex items-center justify-center z-50 bg-black/30">
              <div className="bg-white rounded-[14px] px-10 py-8 shadow-2xl flex flex-col items-center gap-5 w-[360px]">
                <p className="text-[20px] font-sans font-medium text-black text-center">Delete this MIDI recording?</p>
                <p className="text-[14px] text-black/50 font-sans text-center -mt-2">This cannot be undone.</p>
                <div className="flex gap-4 w-full">
                  <button
                    onClick={() => setShowDeleteConfirm(false)}
                    className="flex-1 border border-black bg-[#fffdf7] py-3 rounded-[8px] text-[16px] text-black font-sans hover:bg-black/5 active:scale-[0.97] transition-[background-color,transform]"
                  >
                    Cancel
                  </button>
                  <button
                    onClick={confirmDelete}
                    className="flex-1 border border-[#e05c5c] bg-[#e05c5c] py-3 rounded-[8px] text-[16px] text-white font-sans hover:bg-[#c94f4f] active:scale-[0.97] transition-[background-color,transform]"
                  >
                    Delete
                  </button>
                </div>
              </div>
            </div>
          )}
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
              className="border border-black h-[72px] flex items-center justify-end pr-[19px] pl-[100px] rounded-tr-[8px] bg-[#fffdf7] relative shadow-[inset_0px_4px_0px_0px_rgba(255,255,255,0.25),inset_0px_-15px_17.6px_0px_rgba(53,21,21,0.07)] hover:bg-black/5 transition-colors"
            >
              <span className="text-[20px] text-black font-sans whitespace-nowrap">Calibration</span>
            </button>
            <Link href="/tutorial" className="-mt-px border border-black h-[72px] flex items-center justify-end pr-[19px] pl-[100px] bg-[#fffdf7] relative shadow-[inset_0px_4px_0px_0px_rgba(255,255,255,0.25),inset_0px_-15px_17.6px_0px_rgba(53,21,21,0.07)] hover:bg-black/5 transition-colors">
              <span className="text-[20px] text-black font-sans whitespace-nowrap">Tutorial</span>
            </Link>
            <Link href="/about" className="-mt-px border border-black h-[72px] flex items-center justify-end pr-[19px] pl-[100px] rounded-br-[8px] bg-[#fffdf7] relative shadow-[inset_0px_4px_0px_0px_rgba(255,255,255,0.25),inset_0px_-15px_17.6px_0px_rgba(53,21,21,0.07)] hover:bg-black/5 transition-colors">
              <span className="text-[20px] text-black font-sans whitespace-nowrap">About</span>
            </Link>
          </div>

          {/* Controls */}
          <div className="flex flex-col gap-[23px] mt-[42px] pl-[43px]">
            {/* Tempo */}
            <div className="flex flex-col gap-2">
              <label htmlFor="set-tempo" className="text-[16px] text-[#1e1e1e] font-sans leading-[1.4]">Set Tempo</label>
              <div className="flex items-center gap-2">
                <input
                  id="set-tempo"
                  type="number"
                  min={20}
                  max={300}
                  value={tempo}
                  onChange={(e) => handleTempoChange(e.target.value)}
                  className="border border-[#d9d9d9] rounded-[8px] px-4 py-3 text-[16px] text-[#1e1e1e] bg-white w-[80px] leading-none focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-black/20"
                />
                <span className="text-[13px] text-black/50 font-sans">BPM</span>
              </div>
            </div>

            {/* Time Signature */}
            <div className="flex flex-col gap-2">
              <label htmlFor="time-signature" className="text-[16px] text-[#1e1e1e] font-sans leading-[1.4]">Time Signature</label>
              <div className="relative w-[120px]">
                <select
                  id="time-signature"
                  value={timeSignature}
                  onChange={(e) => setTimeSignature(e.target.value)}
                  className="border border-[#d9d9d9] rounded-[8px] pl-4 pr-8 py-[10px] text-[16px] text-[#1e1e1e] bg-white w-full appearance-none leading-none cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-black/20"
                >
                  <option>4/4</option>
                  <option>3/4</option>
                  <option>6/8</option>
                </select>
                <div className="absolute right-3 top-1/2 -translate-y-1/2 pointer-events-none text-[#1e1e1e]"><ChevronDown /></div>
              </div>
            </div>

            {/* Metronome toggle */}
            <div className="flex items-center gap-3">
              <span className="text-[16px] text-[#1e1e1e] font-sans leading-[1.4] whitespace-nowrap">Metronome</span>
              <button
                onClick={() => setMetronome(!metronome)}
                aria-label="Toggle metronome"
                aria-pressed={metronome}
                className={`relative w-[40px] h-[24px] rounded-full overflow-hidden transition-colors ${metronome ? "bg-[#1e1e1e]" : "bg-[#d9d9d9]"}`}
              >
                <span className={`absolute top-[2px] left-0 w-[20px] h-[20px] rounded-full bg-white shadow transition-transform duration-150 ease-out ${metronome ? "translate-x-[18px]" : "translate-x-[2px]"}`} />
              </button>
            </div>

            {/* MIDI controls — only visible after Stop is pressed */}
            {hasFinishedRecording && (
              <div className="flex flex-col gap-[10px] pt-[6px] border-t border-[#d9d9d9]">
                <button
                  onClick={() => setShowExportDialog(!showExportDialog)}
                  className="border border-black bg-[#fffdf7] px-4 py-[10px] rounded-[8px] text-[14px] text-black font-sans hover:bg-black/5 active:scale-[0.97] transition-[background-color,transform] text-left"
                >
                  Export .MIDI Recording
                </button>
                <button
                  onClick={() => setShowDeleteConfirm(true)}
                  className="border border-[#e05c5c] bg-[#fffdf7] px-4 py-[10px] rounded-[8px] text-[14px] text-[#e05c5c] font-sans hover:bg-red-50 active:scale-[0.97] transition-[background-color,transform] text-left"
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
            <p className="text-[15px] text-black/60 font-sans mb-6">Choose where to save the MIDI file.</p>
            <label htmlFor="export-path" className="text-[14px] font-medium text-black font-sans block mb-2">Save location</label>
            <input
              id="export-path"
              type="text"
              value={exportPath}
              onChange={(e) => setExportPath(e.target.value)}
              className="w-full border border-[#d9d9d9] rounded-[8px] px-4 py-3 text-[16px] text-black bg-white mb-6 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-black/20"
            />
            <div className="flex gap-3 justify-end">
              <button
                onClick={() => setShowExportDialog(false)}
                className="border border-black bg-white px-6 py-3 rounded-[10px] text-[16px] text-black font-sans hover:bg-black/5 active:scale-[0.97] transition-[background-color,transform]"
              >
                Cancel
              </button>
              <button
                onClick={() => setShowExportDialog(false)}
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
            <button className="absolute left-0 border-[1.5px] border-black bg-[#fffdf7] px-5 py-2 rounded-[8px] text-[17px] text-black font-sans hover:bg-black/5 active:scale-[0.97] transition-[background-color,transform]">
              Listen to Recording
            </button>
          )}

          {/* Play / Pause / Resume button */}
          <button
            onClick={handlePlay}
            aria-label={isRecording && !isPaused ? "Pause recording" : isPaused ? "Resume recording" : "Start recording"}
            disabled={!isCalibrated || countInBeat !== null}
            className={`flex flex-col items-center gap-1 transition-[opacity,transform] active:scale-[0.97] ${!isCalibrated || countInBeat !== null ? "opacity-30 cursor-not-allowed" : "hover:opacity-70"}`}
          >
            {isRecording && !isPaused
              ? <PauseIcon />
              : <PlayIcon color={isPaused ? "#3b82f6" : "#1e1e1e"} />}
            <span className={`text-[13px] font-sans select-none ${isPaused ? "text-[#3b82f6]" : "text-[#1e1e1e]"}`}>
              {isRecording && !isPaused ? "Pause" : isPaused ? "Resume" : "Play"}
            </span>
          </button>

          {/* Stop button */}
          <button
            onClick={handleStop}
            aria-label="Stop recording"
            disabled={!isCalibrated || (!isRecording && countInBeat === null)}
            className={`flex flex-col items-center gap-1 transition-[opacity,transform] active:scale-[0.97] ${!isCalibrated || (!isRecording && countInBeat === null) ? "opacity-30 cursor-not-allowed" : "hover:opacity-70"}`}
          >
            <StopIcon />
            <span className="text-[13px] text-[#1e1e1e] font-sans select-none">Stop</span>
          </button>
        </div>
        <div className="w-[267px] shrink-0" />
      </div>
    </div>
  );
}
