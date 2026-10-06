"use client";

import SideNav from "../SideNav";
import PageTopBar from "../PageTopBar";

const FACTS = [
  {
    label: "Requirements",
    color: "text-yellow-light",
    body: "A webcam, paper and good light.",
  },
  {
    label: "Output",
    color: "text-green-light",
    body: "Save your songs as MIDI files.",
  },
  {
    label: "Open Source",
    color: "text-red-light",
    body: "Anyone can help build MakeShift.",
  },
];

export default function About() {
  return (
    <div className="flex-1 bg-surface flex flex-col">
      <PageTopBar />
      <div className="flex flex-col lg:flex-row pl-(--gutter-l) pr-(--gutter-r)">
        {/* Content area: locked to 16:9 from lg up, grows with its text below that */}
        <div className="ms-stage lg:flex-1 lg:aspect-video bg-surface-dark relative overflow-hidden">
          <div className="lg:absolute lg:inset-0 overflow-y-auto p-6 sm:p-[48px]">
            <h1 className="font-display text-white text-[30px] sm:text-[44px] font-bold leading-[1.05] tracking-tight mb-[20px]">About MakeShift</h1>
            <p className="text-ink-inverse text-[17px] sm:text-[18px] leading-relaxed mb-[32px] max-w-[560px]">
              MakeShift turns paper into a piano. Your webcam watches your fingers and plays the notes.
            </p>

            <div className="grid gap-3 sm:grid-cols-3 max-w-[760px]">
              {FACTS.map(({ label, color, body }) => (
                <div
                  key={label}
                  className="rounded-[16px] bg-white/5 p-4 shadow-[inset_0_0_0_0.5px_color-mix(in_srgb,var(--color-white)_14%,transparent)]"
                >
                  <p className={`${color} text-[12px] font-semibold uppercase tracking-[0.08em] mb-2`}>{label}</p>
                  <p className="text-ink-inverse-muted text-[15px] leading-relaxed">{body}</p>
                </div>
              ))}
            </div>
          </div>
        </div>

        <SideNav active="about" />
      </div>

      <div className="pb-[clamp(12px,3dvh,36px)] pt-[clamp(8px,2dvh,24px)]" />
    </div>
  );
}
