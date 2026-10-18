"use client";

import { useEffect, useState } from "react";

/** Copies `url`; the label crossfades to "Copied!" and back. */
export default function CopyLinkButton({ url, className }: { url: string; className: string }) {
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    if (!copied) return;
    const timer = setTimeout(() => setCopied(false), 1600);
    return () => clearTimeout(timer);
  }, [copied]);

  async function copy() {
    try {
      await navigator.clipboard.writeText(url);
      setCopied(true);
    } catch {
      // Clipboard can be blocked (insecure origin, denied permission); fall back to a prompt.
      window.prompt("Copy this link:", url);
    }
  }

  return (
    <button type="button" className={className} onClick={() => void copy()}>
      {/* Keyed so each label change replays the swap. */}
      <span key={String(copied)} className="ms-swap">
        {copied ? "Copied!" : "Copy link"}
      </span>
      <span className="sr-only" role="status">
        {copied ? "Link copied" : ""}
      </span>
    </button>
  );
}
