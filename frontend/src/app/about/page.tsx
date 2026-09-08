"use client";

import Link from "next/link";

export default function About() {
  return (
    <div className="flex-1 bg-[#fffdf7] flex flex-col min-h-0 overflow-hidden">
      <div className="flex pl-[clamp(20px,4.2vw,61px)] pr-[clamp(12px,3.2vw,47px)]">
        {/* Content area — locked to 16:9 */}
        <div className="flex-1 aspect-video bg-[#090909] relative overflow-hidden">
          <div className="absolute inset-0 overflow-y-auto p-[48px]">
            <h1 className="text-white text-[40px] font-sans font-medium mb-[24px]">About MakeShift</h1>
            <p className="text-white/80 text-[18px] font-sans leading-relaxed mb-[32px] max-w-[560px]">
              MakeShift turns any flat surface into a virtual piano. Using computer vision and your webcam,
              it tracks your fingertips in real time and maps them to musical notes. No hardware required.
            </p>

            <div className="flex flex-col gap-[24px] max-w-[560px]">
              <div>
                <p className="text-[#b46eff] text-[14px] font-sans uppercase tracking-wider mb-2">Requirements</p>
                <p className="text-white/70 text-[16px] font-sans leading-relaxed">
                  A webcam, a flat sheet of paper, and decent lighting. That&apos;s all.
                </p>
              </div>
              <div>
                <p className="text-[#b46eff] text-[14px] font-sans uppercase tracking-wider mb-2">Output</p>
                <p className="text-white/70 text-[16px] font-sans leading-relaxed">
                  Export your performance as a standard MIDI file to use in any DAW.
                </p>
              </div>
              <div>
                <p className="text-[#b46eff] text-[14px] font-sans uppercase tracking-wider mb-2">Open Source</p>
                <p className="text-white/70 text-[16px] font-sans leading-relaxed">
                  MakeShift is open source. If you want to extend it, fix bugs, or build on top of it, contributions are welcome.
                </p>
              </div>
            </div>
          </div>
        </div>

        {/* Right sidebar */}
        <div className="w-[267px] relative flex flex-col shrink-0">
          {/* Piano key bars */}
          <div className="absolute left-0 top-[50px] flex flex-col gap-[24px] z-10 pointer-events-none">
            <div className="bg-black h-[46px] w-[140px] rounded-tr-[4px] rounded-br-[4px] shadow-[2px_1px_1px_0px_rgba(0,0,0,0.1)]" />
            <div className="bg-black h-[46px] w-[140px] rounded-tr-[4px] rounded-br-[4px] shadow-[2px_1px_1px_0px_rgba(0,0,0,0.1)]" />
          </div>

          {/* Nav tabs — About active */}
          <div className="flex flex-col">
            <Link
              href="/calibration"
              className="border border-black h-[72px] flex items-center justify-end pr-[19px] pl-[100px] rounded-tr-[8px] bg-[#fffdf7] relative shadow-[inset_0px_4px_0px_0px_rgba(255,255,255,0.25),inset_0px_-15px_17.6px_0px_rgba(53,21,21,0.07)] hover:bg-black/5 transition-colors"
            >
              <span className="text-[20px] text-black font-sans whitespace-nowrap">Calibration</span>
            </Link>
            <Link
              href="/tutorial"
              className="-mt-px border border-black h-[72px] flex items-center justify-end pr-[19px] pl-[100px] bg-[#fffdf7] relative shadow-[inset_0px_4px_0px_0px_rgba(255,255,255,0.25),inset_0px_-15px_17.6px_0px_rgba(53,21,21,0.07)] hover:bg-black/5 transition-colors"
            >
              <span className="text-[20px] text-black font-sans whitespace-nowrap">Tutorial</span>
            </Link>
            <div className="-mt-px border border-black h-[72px] flex items-center justify-end pr-[19px] pl-[100px] rounded-br-[8px] bg-[#e7d0ff] relative shadow-[inset_0px_4px_0px_0px_rgba(255,255,255,0.25),inset_0px_-15px_17.6px_0px_rgba(53,21,21,0.07)]">
              <span className="text-[20px] text-black font-sans whitespace-nowrap">About</span>
            </div>
          </div>
        </div>
      </div>

      <div className="pb-[clamp(12px,3dvh,36px)] pt-[clamp(8px,2dvh,24px)]" />
    </div>
  );
}
