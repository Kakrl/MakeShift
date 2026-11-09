"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { midiToPitch } from "../../cv/noteMap";
import { BrowserAudio } from "./audioEngine";

const LOWEST_KEY = 21;
const HIGHEST_KEY = 108;
const PIANO_KEYS = Array.from(
  { length: HIGHEST_KEY - LOWEST_KEY + 1 },
  (_, index) => LOWEST_KEY + index,
);
const UNAVAILABLE = "Audio is unavailable. Select Enable audio to retry.";

export default function AudioCheck() {
  const engine = useRef<BrowserAudio | null>(null);
  const [status, setStatus] = useState(
    "Select Enable audio, then play a test tone.",
  );
  const [ready, setReady] = useState(false);
  const [selectedNote, setSelectedNote] = useState(60);
  const held = useRef<NonNullable<ReturnType<BrowserAudio["noteOn"]>>[]>([]);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const clearTimer = useCallback(() => {
    if (timer.current !== null) clearTimeout(timer.current);
    timer.current = null;
  }, []);

  useEffect(() => {
    const audio = new BrowserAudio();
    engine.current = audio;
    const unsubscribe = audio.subscribeInvalidation(() => {
      clearTimer();
      held.current = [];
      if (audio.status === "suspended" || audio.status === "error") {
        setReady(false);
        setStatus(UNAVAILABLE);
      }
    });
    return () => {
      unsubscribe();
      clearTimer();
      held.current = [];
      engine.current = null;
      void audio.close();
    };
  }, [clearTimer]);

  async function enable() {
    const audio = engine.current;
    if (!audio) return;
    setReady(false);
    setStatus("Enabling audio…");
    try {
      await audio.initialize();
      if (engine.current !== audio) return;
      setReady(true);
      setStatus("Audio enabled. Choose a note, chord or sweep.");
    } catch (error) {
      if (engine.current !== audio) return;
      setStatus(
        error instanceof Error
          ? error.message
          : "Could not enable audio. Try again.",
      );
    }
  }

  function play(
    notes: number[],
    velocity: number,
    duration = 1000,
    next?: () => void,
  ) {
    const audio = engine.current;
    if (!audio) return;
    clearTimer();
    for (const token of held.current) audio.noteOff(token);
    held.current = [];
    for (const note of notes) {
      const token = audio.noteOn(note, velocity);
      if (!token) {
        audio.releaseAll();
        setReady(false);
        setStatus(UNAVAILABLE);
        return;
      }
      held.current.push(token);
    }
    timer.current = setTimeout(() => {
      timer.current = null;
      for (const token of held.current) audio.noteOff(token);
      held.current = [];
      next?.();
    }, duration);
    if (next) return;
    setStatus(
      notes.length === 1
        ? `Playing ${midiToPitch(notes[0])} (MIDI ${notes[0]}) on the sampled piano.`
        : "Playing ten simultaneous tones.",
    );
  }

  function sweep() {
    setStatus("Playing all 88 keys from A0 to C8.");
    function step(note: number) {
      play([note], 0.6, 300, () => {
        if (note < HIGHEST_KEY) step(note + 1);
        else setStatus("A0 to C8 sweep complete.");
      });
    }
    step(LOWEST_KEY);
  }

  return (
    <main className="flex-1 bg-surface overflow-auto pl-(--gutter-l) pr-(--gutter-r) pt-2 pb-10">
      <div className="ms-panel max-w-[640px] p-6 sm:p-8">
        <h1 className="font-display text-[28px] sm:text-[32px] font-bold leading-tight tracking-tight text-ink">
          Audio check
        </h1>
        <p className="mt-2 mb-6 text-[15px] leading-relaxed text-ink-muted">
          Test your sound first. Start with the volume low.
        </p>
        <p className="mb-4 text-[15px] text-ink-muted">
          Recorded grand piano with +6 dB bass presence. Compare registers at
          the same velocity (0.6) using the C2, C4 and C6 buttons.
        </p>
        <div className="flex flex-wrap gap-2.5">
          <button className="ms-key ms-key-primary" onClick={enable}>
            Enable audio
          </button>
          <button
            className="ms-key"
            disabled={!ready}
            onClick={() => play([69], 0.25)}
          >
            Soft A4
          </button>
          <button
            className="ms-key"
            disabled={!ready}
            onClick={() => play([69], 0.75)}
          >
            Loud A4
          </button>
          <button
            className="ms-key"
            disabled={!ready}
            onClick={() => play([21, 28, 36, 48, 55, 60, 67, 76, 96, 108], 0.5)}
          >
            Ten-note chord
          </button>
          <button
            className="ms-key ms-key-ghost ms-key-danger"
            onClick={() => {
              clearTimer();
              held.current = [];
              engine.current?.releaseAll();
              setStatus("Stopped.");
            }}
          >
            Stop sound
          </button>
          {[
            { note: LOWEST_KEY, label: "Lowest A0" },
            { note: 36, label: "Bass C2" },
            { note: 60, label: "Middle C4" },
            { note: 84, label: "High C6" },
            { note: HIGHEST_KEY, label: "Highest C8" },
          ].map(({ note, label }) => (
            <button
              key={note}
              className="ms-key"
              disabled={!ready}
              onClick={() => play([note], 0.6)}
            >
              {label}
            </button>
          ))}
        </div>
        <div className="mt-4 flex flex-wrap items-end gap-2.5">
          <label className="text-[14px] text-ink-muted">
            Piano key
            <select
              className="ms-input mt-1 block"
              value={selectedNote}
              onChange={(event) => setSelectedNote(Number(event.target.value))}
            >
              {PIANO_KEYS.map((note) => (
                <option key={note} value={note}>
                  {midiToPitch(note)}
                </option>
              ))}
            </select>
          </label>
          <button
            className="ms-key"
            disabled={!ready}
            onClick={() => play([selectedNote], 0.6)}
          >
            Play selected key
          </button>
          <button className="ms-key" disabled={!ready} onClick={sweep}>
            Play all 88 keys
          </button>
        </div>
        <p className="mt-2 text-[14px] text-ink-muted">
          Individual notes hold for one second. The sweep takes about 26
          seconds.
        </p>
        <p
          className="ms-well mt-6 px-4 py-3 text-[14px] text-ink-muted"
          role="status"
        >
          {status}
        </p>
        <p className="mt-4 text-[13px] text-ink-muted">
          Salamander Grand Piano recordings by Alexander Holm, licensed under{" "}
          <a className="underline" href="/audio/piano-samples/NOTICE.md">
            CC BY 3.0 — credits
          </a>
          .
        </p>
      </div>
    </main>
  );
}
