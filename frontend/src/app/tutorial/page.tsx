"use client";

import { useRef } from "react";
import { useRouter } from "next/navigation";
import { rainbow } from "../rainbow";
import { useDialogFocus } from "../useDialogFocus";

export default function Tutorial() {
  const router = useRouter();
  // The tutorial is always a modal: focus moves in, Tab stays inside, Escape goes back.
  const dialogRef = useRef<HTMLDivElement>(null);
  useDialogFocus(dialogRef, true, () => router.back());

  const steps = [
    {
      step: "1",
      title: "Run Calibration",
      body: "Click Calibration and follow the 5 steps.",
    },
    {
      step: "2",
      title: "Position your paper",
      body: "Lay it flat where the camera can see all of it.",
    },
    {
      step: "3",
      title: "Hover your hands",
      body: "Hold them just above the paper.",
    },
    {
      step: "4",
      title: "Play!",
      body: "Press Enable audio, then tap the paper keys.",
    },
    {
      step: "5",
      title: "Record your song",
      // Covers start, pause/resume, stop and export (RVTM 6.3.1 to 6.3.3).
      body: "Press Record and play after the count-in. Press Pause for a break, then Resume to keep going. Press Stop when you're done, then Download MIDI next to your take.",
    },
  ];

  return (
    <div
      className="ms-backdrop fixed inset-0 z-50 flex items-center justify-center p-4"
      onClick={() => router.back()}
    >
      {/* Modal card */}
      <div
        ref={dialogRef}
        tabIndex={-1}
        role="dialog"
        aria-modal="true"
        aria-labelledby="tutorial-title"
        className="ms-dialog relative w-full max-w-[740px] overflow-hidden flex flex-col focus:outline-none"
        style={{ maxHeight: "88dvh" }}
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-start justify-between gap-4 px-6 sm:px-8 pt-7 pb-4">
          <div>
            <h1 id="tutorial-title" className="font-display text-[30px] sm:text-[34px] font-bold leading-none tracking-tight text-ink">Tutorial</h1>
          </div>
          <button
            onClick={() => router.back()}
            className="ms-key ms-key-icon shrink-0"
            aria-label="Close tutorial"
          >
            <svg aria-hidden="true" width="14" height="14" viewBox="0 0 14 14" fill="none">
              <path d="M3 3l8 8M11 3l-8 8" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" />
            </svg>
          </button>
        </div>

        <div className="overflow-y-auto overscroll-contain px-6 sm:px-8 pb-8">
          {/* Video placeholder */}
          <div className="w-full aspect-video bg-surface-dark rounded-[16px] flex items-center justify-center mb-8 shadow-(--ring)">
            <div className="flex flex-col items-center gap-3">
              <span className="flex size-14 items-center justify-center rounded-full bg-white/10 shadow-[inset_0_0_0_0.5px_color-mix(in_srgb,var(--color-white)_25%,transparent)]">
                <svg aria-hidden="true" width="22" height="22" viewBox="0 0 22 22" fill="none">
                  <path d="M7.5 5v12l9.5-6-9.5-6Z" fill="var(--color-white)" stroke="var(--color-white)" strokeWidth="1.5" strokeLinejoin="round" />
                </svg>
              </span>
              <span className="text-ink-inverse-muted text-[14px]">Video coming soon</span>
            </div>
          </div>

          {/* Step-by-step guide */}
          <ol className="flex flex-col gap-5 mb-8">
            {steps.map((s, i) => (
              <li key={s.step} className="flex gap-4">
                <span className={`ms-step mt-[1px] ${rainbow(i).fill}`}>{s.step}</span>
                <div>
                  <p className="text-ink text-[17px] font-semibold mb-[4px]">{s.title}</p>
                  <p className="text-ink-muted text-[15px] leading-relaxed">{s.body}</p>
                </div>
              </li>
            ))}
          </ol>

          {/* PDF download */}
          <div className="ms-well flex flex-wrap items-center justify-between gap-4 px-5 py-4">
            <div className="flex items-center gap-3">
              <svg aria-hidden="true" width="28" height="32" viewBox="0 0 28 32" fill="none" xmlns="http://www.w3.org/2000/svg">
                <rect x="0.75" y="0.75" width="26.5" height="30.5" rx="5" fill="var(--color-white)" stroke="var(--color-divider)" strokeWidth="1.5" />
                <text x="4.5" y="21" fontSize="9" fontWeight="bold" fill="var(--color-danger)" fontFamily="sans-serif">PDF</text>
              </svg>
              <div>
                <p className="text-ink text-[15px] font-semibold">MakeShift Quick-Start Guide</p>
                <p className="text-ink-muted text-[13px]">PDF · Coming soon</p>
              </div>
            </div>
            <a href="/tutorial/makeshift-guide.pdf" download className="ms-key px-5">
              Download
            </a>
          </div>
        </div>
      </div>
    </div>
  );
}
