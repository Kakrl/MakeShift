"use client";

import SideNav from "../SideNav";

export default function About() {
  return (
    <div className="flex-1 bg-surface flex flex-col">
      <div className="flex flex-col lg:flex-row pl-[clamp(20px,4.2vw,61px)] pr-[clamp(12px,3.2vw,47px)]">
        {/* Content area: locked to 16:9 from lg up, grows with its text below that */}
        <div className="lg:flex-1 lg:aspect-video bg-surface-dark relative overflow-hidden">
          <div className="lg:absolute lg:inset-0 overflow-y-auto p-6 sm:p-[48px]">
            <h1 className="text-white text-[28px] sm:text-[40px] font-sans font-medium mb-[24px]">About MakeShift</h1>
            <p className="text-ink-inverse text-[18px] font-sans leading-relaxed mb-[32px] max-w-[560px]">
              MakeShift turns any flat surface into a virtual piano. Using computer vision and your webcam,
              it tracks your fingertips in real time and maps them to musical notes. No hardware required.
            </p>

            <div className="flex flex-col gap-[24px] max-w-[560px]">
              <div>
                <p className="text-accent-light text-[14px] font-sans uppercase tracking-wider mb-2">Requirements</p>
                <p className="text-ink-inverse-muted text-[16px] font-sans leading-relaxed">
                  A webcam, a flat sheet of paper, and decent lighting. That&apos;s all.
                </p>
              </div>
              <div>
                <p className="text-accent-light text-[14px] font-sans uppercase tracking-wider mb-2">Output</p>
                <p className="text-ink-inverse-muted text-[16px] font-sans leading-relaxed">
                  Export your performance as a standard MIDI file to use in any DAW.
                </p>
              </div>
              <div>
                <p className="text-accent-light text-[14px] font-sans uppercase tracking-wider mb-2">Open Source</p>
                <p className="text-ink-inverse-muted text-[16px] font-sans leading-relaxed">
                  MakeShift is open source. If you want to extend it, fix bugs, or build on top of it, contributions are welcome.
                </p>
              </div>
            </div>
          </div>
        </div>

        <SideNav active="about" />
      </div>

      <div className="pb-[clamp(12px,3dvh,36px)] pt-[clamp(8px,2dvh,24px)]" />
    </div>
  );
}
