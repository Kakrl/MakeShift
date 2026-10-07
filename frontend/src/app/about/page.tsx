"use client";

import SideNav from "../SideNav";
import PageTopBar from "../PageTopBar";

const REPO_URL = "https://github.com/Kakrl/MakeShift";

function ExternalIcon() {
  return (
    <svg aria-hidden="true" width="14" height="14" viewBox="0 0 14 14" fill="none">
      <path d="M5.5 3H3.25A1.25 1.25 0 0 0 2 4.25v6.5A1.25 1.25 0 0 0 3.25 12h6.5A1.25 1.25 0 0 0 11 10.75V8.5M8 2h4v4M12 2 6.5 7.5" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

const FACTS: { label: string; color: string; body: string; link?: { href: string; text: string } }[] = [
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
    link: { href: REPO_URL, text: "See the code on GitHub" },
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
              {FACTS.map(({ label, color, body, link }) => (
                <div
                  key={label}
                  className="rounded-[16px] bg-white/5 p-4 shadow-[inset_0_0_0_0.5px_color-mix(in_srgb,var(--color-white)_14%,transparent)]"
                >
                  <p className={`${color} text-[12px] font-semibold uppercase tracking-[0.08em] mb-2`}>{label}</p>
                  <p className="text-ink-inverse-muted text-[15px] leading-relaxed">{body}</p>
                  {link && (
                    // New tab, so an active camera session here is not interrupted.
                    <a
                      href={link.href}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="mt-3 inline-flex items-center gap-1.5 rounded-[6px] text-[15px] font-medium text-white underline decoration-white/40 underline-offset-4 transition-[text-decoration-color] hover:decoration-white focus-visible:outline-none focus-visible:shadow-(--halo)"
                    >
                      {link.text}
                      <ExternalIcon />
                      <span className="sr-only"> (opens in a new tab)</span>
                    </a>
                  )}
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
