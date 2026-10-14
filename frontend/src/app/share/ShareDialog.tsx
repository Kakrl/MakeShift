"use client";

import { useRef, useState } from "react";
import { createPortal } from "react-dom";
import { RECORDING_LIMITS } from "../../lib/recordings";
import type { Recording } from "../midi/midiUtils";
import { useDialogFocus } from "../useDialogFocus";
import CopyLinkButton from "./CopyLinkButton";
import { loadShareName, shareUrl, uploadTake, type TakeShare } from "./mockShareStore";

/**
 * Asks for a title and display name, uploads the take, then shows its link
 * in place, so sharing and copying the link happen in one dialog.
 */
export default function ShareDialog({
  take,
  onShared,
  onClose,
}: {
  take: Recording;
  onShared: (share: TakeShare) => void;
  onClose: () => void;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const [title, setTitle] = useState(take.name);
  const [authorName, setAuthorName] = useState(() => loadShareName());
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [shared, setShared] = useState<TakeShare | null>(null);
  useDialogFocus(ref, true, onClose);

  async function share() {
    setPending(true);
    setError(null);
    try {
      const result = await uploadTake(take, title, authorName);
      setShared(result);
      onShared(result);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Sharing failed. Try again.");
    } finally {
      setPending(false);
    }
  }

  const ready = title.trim().length > 0 && authorName.trim().length > 0;

  return createPortal(
    <div className="ms-backdrop fixed inset-0 z-50 flex items-center justify-center p-4" onClick={onClose}>
      <div
        ref={ref}
        tabIndex={-1}
        role="dialog"
        aria-modal="true"
        aria-labelledby="share-title"
        className="ms-dialog w-[440px] max-w-full p-6 sm:p-8 text-ink focus:outline-none"
        onClick={(event) => event.stopPropagation()}
      >
        {shared ? (
          <div className="ms-swap">
            <h2 id="share-title" className="font-display text-[26px] font-bold leading-tight tracking-tight">
              Your song is shared!
            </h2>
            <p className="mt-2 text-[15px] text-ink-muted leading-relaxed">
              Anyone with this link can listen and download it.
            </p>
            <p className="ms-well mt-4 px-3 py-2.5 text-[14px] break-all select-all">{shareUrl(shared.id)}</p>
            <div className="mt-5 flex gap-2">
              <CopyLinkButton url={shareUrl(shared.id)} className="ms-key ms-key-primary flex-1 px-4 py-2.5 text-[15px]" />
              <button type="button" className="ms-key flex-1 px-4 py-2.5 text-[15px]" onClick={onClose}>
                Done
              </button>
            </div>
          </div>
        ) : (
          <form
            onSubmit={(event) => {
              event.preventDefault();
              if (ready && !pending) void share();
            }}
          >
            <h2 id="share-title" className="font-display text-[26px] font-bold leading-tight tracking-tight">
              Share this song
            </h2>
            <p className="mt-2 mb-5 text-[15px] text-ink-muted leading-relaxed">
              It gets a link anyone can open. You can stop sharing any time.
            </p>
            <label htmlFor="share-song-title" className="ms-label">Song name</label>
            <input
              id="share-song-title"
              value={title}
              maxLength={RECORDING_LIMITS.titleLength.max}
              onChange={(event) => setTitle(event.target.value)}
              className="ms-input mt-1.5 mb-4 w-full"
            />
            <label htmlFor="share-author" className="ms-label">Your name</label>
            <input
              id="share-author"
              value={authorName}
              maxLength={RECORDING_LIMITS.authorNameLength.max}
              placeholder="First name or nickname"
              onChange={(event) => setAuthorName(event.target.value)}
              className="ms-input mt-1.5 w-full"
              autoComplete="nickname"
            />
            <p className="mt-1.5 text-[13px] text-ink-muted">Shown next to your song. Don&apos;t use your full name.</p>
            {error && (
              <p role="alert" className="mt-3 text-[14px] text-danger">{error}</p>
            )}
            <div className="mt-6 flex gap-2">
              <button type="submit" className="ms-key ms-key-primary flex-1 px-4 py-2.5 text-[15px]" disabled={!ready || pending}>
                {pending ? "Sharing..." : "Share"}
              </button>
              <button type="button" className="ms-key flex-1 px-4 py-2.5 text-[15px]" onClick={onClose}>
                Cancel
              </button>
            </div>
          </form>
        )}
      </div>
    </div>,
    document.body,
  );
}
