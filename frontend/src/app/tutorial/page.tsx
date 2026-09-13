"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";

export default function Tutorial() {
  const router = useRouter();

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") router.back();
    };
    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [router]);

  const steps = [
    {
      step: "1",
      title: "Run Calibration",
      body: "Click Calibration in the sidebar. Set your octave range and starting note, verify your lighting, align your paper in view of the camera, then hover and place your hands to complete setup.",
    },
    {
      step: "2",
      title: "Position your paper",
      body: "Lay a sheet of paper flat on a surface directly in front of the webcam. Make sure the whole sheet is visible and well-lit. This is your virtual keyboard.",
    },
    {
      step: "3",
      title: "Hover your hands",
      body: "Hold both hands just above the paper. MakeShift detects your fingertips in real time and maps each finger to a piano key across your selected octave range.",
    },
    {
      step: "4",
      title: "Press Play and perform",
      body: "Hit Play on the home screen. Tap your fingers onto the paper surface to trigger notes. Use the Metronome toggle and BPM setting to stay in time.",
    },
    {
      step: "5",
      title: "Record and export",
      body: "Press Play while recording to capture your performance as MIDI. When finished, click Export .MIDI Recording in the sidebar to save the file to your computer.",
    },
  ];

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm"
      onClick={() => router.back()}
    >
      {/* Modal card */}
      <div
        className="relative bg-[#fffdf7] rounded-[16px] shadow-2xl w-full max-w-[740px] mx-6 overflow-hidden"
        style={{ maxHeight: "88vh" }}
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between px-8 pt-8 pb-4">
          <h1 className="text-[32px] font-sans font-medium text-black">Tutorial</h1>
          <button
            onClick={() => router.back()}
            className="w-9 h-9 flex items-center justify-center rounded-full hover:bg-black/8 active:scale-[0.97] transition-[background-color,transform] text-[22px] text-black leading-none focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-black/20"
            aria-label="Close tutorial"
          >
            ×
          </button>
        </div>

        <div className="overflow-y-auto overscroll-contain px-8 pb-8" style={{ maxHeight: "calc(88vh - 80px)" }}>
          {/* Video placeholder */}
          <div className="w-full aspect-video bg-black rounded-[10px] flex items-center justify-center mb-8">
            <div className="flex flex-col items-center gap-3 opacity-40">
              <svg aria-hidden="true" width="56" height="56" viewBox="0 0 56 56" fill="none" xmlns="http://www.w3.org/2000/svg">
                <circle cx="28" cy="28" r="26.5" stroke="white" strokeWidth="2" />
                <path d="M22 20L38 28L22 36V20Z" fill="white" />
              </svg>
              <span className="text-white text-[14px] font-sans">Video coming soon</span>
            </div>
          </div>

          {/* Step-by-step guide */}
          <div className="flex flex-col gap-[20px] mb-8">
            {steps.map((s) => (
              <div key={s.step} className="flex gap-4">
                <div className="shrink-0 w-[30px] h-[30px] rounded-full bg-[#b46eff] flex items-center justify-center text-white text-[14px] font-bold mt-[1px]">
                  {s.step}
                </div>
                <div>
                  <p className="text-black text-[18px] font-sans font-medium mb-[4px]">{s.title}</p>
                  <p className="text-black/65 text-[15px] font-sans leading-relaxed">{s.body}</p>
                </div>
              </div>
            ))}
          </div>

          {/* PDF download */}
          <div className="border border-[#d9d9d9] rounded-[10px] flex items-center justify-between px-6 py-4">
            <div className="flex items-center gap-3">
              <svg aria-hidden="true" width="28" height="32" viewBox="0 0 28 32" fill="none" xmlns="http://www.w3.org/2000/svg">
                <rect x="0.75" y="0.75" width="26.5" height="30.5" rx="3.25" stroke="#1e1e1e" strokeWidth="1.5" />
                <text x="4" y="22" fontSize="10" fontWeight="bold" fill="#1e1e1e" fontFamily="sans-serif">PDF</text>
              </svg>
              <div>
                <p className="text-black text-[16px] font-sans font-medium">MakeShift Quick-Start Guide</p>
                <p className="text-black/50 text-[13px] font-sans">PDF · Coming soon</p>
              </div>
            </div>
            <a
              href="/tutorial/makeshift-guide.pdf"
              download
              className="border-[1.5px] border-black bg-[#fffdf7] px-5 py-2 rounded-[8px] text-[15px] text-black font-sans hover:bg-black/5 active:scale-[0.97] transition-[background-color,transform] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-black/20 focus-visible:ring-offset-1"
            >
              Download
            </a>
          </div>
        </div>
      </div>
    </div>
  );
}
