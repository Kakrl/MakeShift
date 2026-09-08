import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import Link from "next/link";
import "./globals.css";
import { CameraProvider } from "./CameraContext";

const geistSans = Geist({
  variable: "--font-geist-sans",
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

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html
      lang="en"
      className={`${geistSans.variable} ${geistMono.variable} h-full antialiased bg-[#fffdf7]`}
    >
      <body className="h-dvh flex flex-col overflow-hidden bg-[#fffdf7]">
        {/* Shared header — same height on every page, so camera position never shifts */}
        <header className="h-14 shrink-0 flex items-center pl-[clamp(20px,4.2vw,61px)] pr-[clamp(12px,3.2vw,47px)] bg-[#fffdf7]">
          <Link
            href="/"
            className="text-[22px] font-bold text-[#1e1e1e] font-sans tracking-tight hover:opacity-60 transition-opacity select-none"
          >
            MakeShift
          </Link>
        </header>
        <CameraProvider>
          <div className="flex-1 min-h-0 flex flex-col">{children}</div>
        </CameraProvider>
      </body>
    </html>
  );
}
