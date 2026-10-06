import type { Metadata } from "next";
import { Fredoka, Geist_Mono } from "next/font/google";
import Image from "next/image";
import Link from "next/link";
import "./globals.css";
import { DEBUG_FLAGS } from "../debugFlags";
import PipelineDiagnostics from "./PipelineDiagnostics";
import { CameraProvider } from "./CameraContext";

// Rounded UI face; friendly for kids and close to the hand-drawn logo.
const fredoka = Fredoka({
  variable: "--font-fredoka",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "MakeShift",
  description: "Your virtual piano.",
};

function SpeakerIcon() {
  return (
    <svg aria-hidden="true" width="16" height="16" viewBox="0 0 16 16" fill="none">
      <path d="M2.5 6v4h2.5l3.5 3V3L5 6H2.5Z" fill="currentColor" />
      <path d="M11 5.5a3.5 3.5 0 0 1 0 5M12.75 3.5a6 6 0 0 1 0 9" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" />
    </svg>
  );
}

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html
      lang="en"
      className={`${fredoka.variable} ${geistMono.variable} h-full antialiased bg-surface`}
    >
      <body className="min-h-dvh flex flex-col bg-surface">
        {/* Rainbow stripe across the top, one band per brand color */}
        <div aria-hidden="true" className="flex h-1.5 shrink-0">
          <span className="flex-1 bg-red" />
          <span className="flex-1 bg-yellow" />
          <span className="flex-1 bg-green" />
          <span className="flex-1 bg-blue" />
          <span className="flex-1 bg-purple" />
        </div>
        {/* Shared header, same height on every page, so camera position never shifts */}
        <header className="h-16 shrink-0 flex items-center pl-(--gutter-l) pr-(--gutter-r) bg-surface">
          <Link
            href="/"
            className="-ml-1.5 rounded-[10px] transition-[opacity,transform] duration-150 ease-out hover:opacity-70 active:scale-[0.97] focus-visible:outline-none focus-visible:shadow-(--halo)"
          >
            {/* The artwork has a small inset; -ml-1.5 lines the mark up with the gutter. */}
            <Image
              src="/makeshift-logo.svg"
              alt="MakeShift"
              width={409}
              height={76}
              priority
              className="h-[30px] sm:h-[34px] w-auto select-none"
              draggable={false}
            />
          </Link>
          <Link href="/audio" className="ms-key ms-key-ghost ml-auto text-[14px] px-3 py-2">
            <SpeakerIcon />
            Audio check
          </Link>
        </header>
        <CameraProvider>
          <div className="flex-1 flex flex-col">{children}</div>
          {DEBUG_FLAGS.pipelineDiagnostics && <PipelineDiagnostics />}
        </CameraProvider>
      </body>
    </html>
  );
}
