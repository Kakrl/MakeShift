"use client";

import type { ReactNode } from "react";
import { RECORDING_LIMITS } from "../../lib/recordings";
import CopyLinkButton from "./CopyLinkButton";
import { shareUrl } from "./mockShareStore";

export function CloseIcon() {
  return (
    <svg aria-hidden="true" width="16" height="16" viewBox="0 0 16 16" fill="none">
      <path d="M3.5 3.5l9 9M12.5 3.5l-9 9" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
    </svg>
  );
}

export function BackIcon() {
  return (
    <svg aria-hidden="true" width="16" height="16" viewBox="0 0 16 16" fill="none">
      <path d="M10 3.5 5.5 8l4.5 4.5" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

/** The last step of every share: the link, Copy link and Done on the bottom edge. */
export function SharedConfirmation({ heading, shareId, onDone }: { heading: ReactNode; shareId: string; onDone: () => void }) {
  const url = shareUrl(shareId);
  return (
    <div className="flex flex-1 flex-col">
      {heading}
      <p className="mt-2 text-[15px] text-ink-muted leading-relaxed">
        It&apos;s in Shared songs, and anyone with this link can listen.
      </p>
      <p className="ms-well mt-4 px-3 py-2.5 text-[14px] break-all select-all">{url}</p>
      <div className="mt-auto flex shrink-0 gap-2 pt-5">
        <CopyLinkButton url={url} className="ms-key ms-key-primary flex-1 px-4 py-2.5 text-[15px]" />
        <button type="button" className="ms-key flex-1 px-4 py-2.5 text-[15px]" onClick={onDone}>
          Done
        </button>
      </div>
    </div>
  );
}

/** The public name field both share forms ask for. */
export function AuthorNameField({ id, value, onChange }: { id: string; value: string; onChange: (value: string) => void }) {
  return (
    <>
      <label htmlFor={id} className="ms-label">Your name</label>
      <input
        id={id}
        value={value}
        maxLength={RECORDING_LIMITS.authorNameLength.max}
        placeholder="First name or nickname"
        onChange={(event) => onChange(event.target.value)}
        className="ms-input mt-1.5 w-full"
        autoComplete="nickname"
      />
      <p className="mt-1.5 text-[13px] text-ink-muted">Shown next to your song. Don&apos;t use your full name.</p>
    </>
  );
}
