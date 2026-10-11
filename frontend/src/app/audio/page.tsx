"use client";

import { useEffect, useRef, useState } from "react";
import { BrowserAudio } from "./audioEngine";

export default function AudioCheck() {
  const engine = useRef<BrowserAudio | null>(null);
  const [status, setStatus] = useState(
    "Select Enable audio, then play a test tone.",
  );
  const [ready, setReady] = useState(false);
  const held = useRef<NonNullable<ReturnType<BrowserAudio["noteOn"]>>[]>([]);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(
    () => () => {
      if (timer.current) clearTimeout(timer.current);
      void engine.current?.close();
    },
    [],
  );

  async function enable() {
    engine.current ??= new BrowserAudio();
    setReady(false);
    setStatus("Enabling audio…");
    try {
      await engine.current.initialize();
      setReady(true);
      setStatus("Audio enabled. Test tones last one second.");
    } catch (error) {
      setStatus(
        error instanceof Error
          ? error.message
          : "Could not enable audio. Try again.",
      );
    }
  }

  function play(notes: number[], velocity: number) {
    const audio = engine.current;
    if (!audio) return;
    for (const token of held.current) audio.noteOff(token);
    held.current = [];
    const tokens = notes.map((note) => audio.noteOn(note, velocity));
    if (tokens.some((token) => token === null)) {
      setReady(false);
      setStatus("Audio is unavailable. Select Enable audio to retry.");
      return;
    }
    if (timer.current) clearTimeout(timer.current);
    held.current = tokens.filter((token) => token !== null);
    timer.current = setTimeout(() => {
      for (const token of held.current) audio.noteOff(token);
      held.current = [];
    }, 1000);
    setStatus(
      notes.length === 1
        ? "Playing A4 (440 Hz)."
        : "Playing ten simultaneous tones.",
    );
  }

  return (
    <main className="flex-1 bg-surface overflow-auto pl-(--gutter-l) pr-(--gutter-r) pt-2 pb-10">
      <div className="ms-panel max-w-[640px] p-6 sm:p-8">
        <h1 className="font-display text-[28px] sm:text-[32px] font-bold leading-tight tracking-tight text-ink">Audio check</h1>
        <p className="mt-2 mb-6 text-[15px] leading-relaxed text-ink-muted">
          Test your sound first. Start with the volume low.
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
            onClick={() => play([48, 52, 55, 60, 64, 67, 72, 76, 79, 84], 0.5)}
          >
            Ten-note chord
          </button>
          <button
            className="ms-key ms-key-ghost ms-key-danger"
            onClick={() => {
              if (timer.current) clearTimeout(timer.current);
              held.current = [];
              engine.current?.releaseAll();
              setStatus("Stopped.");
            }}
          >
            Stop sound
          </button>
        </div>
        <p className="ms-well mt-6 px-4 py-3 text-[14px] text-ink-muted" role="status">
          {status}
        </p>
      </div>
    </main>
  );
}
