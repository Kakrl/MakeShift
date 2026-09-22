"use client";

import { useEffect, useRef, useState } from "react";
import { BrowserAudio } from "./audioEngine";

export default function AudioCheck() {
  const engine = useRef<BrowserAudio | null>(null);
  const [status, setStatus] = useState(
    "Select Enable audio, then play a test tone.",
  );
  const [ready, setReady] = useState(false);
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
    const tokens = notes.map((note) => audio.noteOn(note, velocity));
    if (tokens.some((token) => token === null)) {
      setReady(false);
      setStatus("Audio is unavailable. Select Enable audio to retry.");
      return;
    }
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => audio.releaseAll(), 1000);
    setStatus(
      notes.length === 1
        ? "Playing A4 (440 Hz)."
        : "Playing ten simultaneous tones.",
    );
  }

  return (
    <main className="p-8 text-ink bg-surface overflow-auto">
      <h1 className="text-2xl font-bold">Audio check</h1>
      <p className="my-4">
        Check sound before using the printed keyboard. Start with a comfortable
        device volume.
      </p>
      <div className="flex flex-wrap gap-4">
        <button
          className="border border-control-border rounded p-3"
          onClick={enable}
        >
          Enable audio
        </button>
        <button
          className="border border-control-border rounded p-3 disabled:opacity-50"
          disabled={!ready}
          onClick={() => play([69], 0.25)}
        >
          Soft A4
        </button>
        <button
          className="border border-control-border rounded p-3 disabled:opacity-50"
          disabled={!ready}
          onClick={() => play([69], 0.75)}
        >
          Loud A4
        </button>
        <button
          className="border border-control-border rounded p-3 disabled:opacity-50"
          disabled={!ready}
          onClick={() => play([48, 52, 55, 60, 64, 67, 72, 76, 79, 84], 0.5)}
        >
          Ten-note chord
        </button>
        <button
          className="border border-control-border rounded p-3"
          onClick={() => {
            engine.current?.releaseAll();
            setStatus("Stopped.");
          }}
        >
          Stop sound
        </button>
      </div>
      <p className="mt-4" role="status">
        {status}
      </p>
    </main>
  );
}
