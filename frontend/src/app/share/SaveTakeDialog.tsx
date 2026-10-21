"use client";

import { useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { RECORDING_LIMITS } from "../../lib/recordings";
import type { Recording } from "../midi/midiUtils";
import { useDialogFocus } from "../useDialogFocus";
import { AuthorNameField, BackIcon, CloseIcon, SharedConfirmation, SharingAs } from "./ShareParts";
import SharedPlayer from "./SharedPlayer";
import {
  asSharedRecording,
  formatDuration,
  loadShareName,
  uploadTake,
  type KeepShare,
  type TakeShare,
} from "./shareStore";

type Step = "review" | "details" | "shared";
type Audience = "private" | "public";

const AUDIENCES: { value: Audience; label: string; hint: string }[] = [
  { value: "private", label: "Only me", hint: "Saved on this device" },
  { value: "public", label: "Everyone", hint: "In Shared songs, with a link" },
];

/**
 * Shown after Stop. The take is already kept in Recordings (so closing the
 * tab never loses it); this asks whether to keep it, then names it and
 * picks who can hear it. The dialog keeps one size across steps, with its
 * keys on the bottom edge, so nothing jumps between steps.
 */
export default function SaveTakeDialog({
  take,
  onSave,
  keepShare,
  onDelete,
  onClose,
}: {
  take: Recording;
  onSave: (name: string) => void;
  keepShare: KeepShare;
  /** Returns false when the person backs out of the confirmation. */
  onDelete: () => boolean;
  onClose: () => void;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const headingRef = useRef<HTMLHeadingElement>(null);
  const [step, setStep] = useState<Step>("review");
  const [direction, setDirection] = useState<"push" | "pop" | null>(null);
  const [name, setName] = useState(take.name === "Untitled recording" ? "" : take.name);
  const [audience, setAudience] = useState<Audience>("private");
  const [authorName, setAuthorName] = useState(() => loadShareName());
  // The sharing name is asked for once; after that it lives in My recordings.
  const [askName] = useState(() => authorName === "");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [shared, setShared] = useState<TakeShare | null>(null);
  const [preview] = useState(() => asSharedRecording(take));
  // The recordings API needs at least one note, so an empty take stays private.
  const shareable = take.notes.length > 0;
  useDialogFocus(ref, true, onClose);

  useLayoutEffect(() => {
    if (direction) headingRef.current?.focus();
  }, [step, direction]);

  function go(next: Step, way: "push" | "pop") {
    setDirection(way);
    setStep(next);
  }

  async function save() {
    const title = name.trim();
    if (audience === "private") {
      onSave(title);
      onClose();
      return;
    }
    setPending(true);
    setError(null);
    try {
      const share = await uploadTake(take, title, authorName, keepShare);
      onSave(title);
      setShared(share);
      go("shared", "push");
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Sharing failed. Try again.");
    } finally {
      setPending(false);
    }
  }

  const ready = name.trim().length > 0 && (audience === "private" || authorName.trim().length > 0);
  const motion = direction === "push" ? "ms-push" : direction === "pop" ? "ms-pop" : "";
  const heading = "font-display text-[24px] sm:text-[28px] font-bold leading-tight tracking-tight focus:outline-none";

  return createPortal(
    <div className="ms-backdrop fixed inset-0 z-50 flex items-center justify-center p-4" onClick={onClose}>
      <div
        ref={ref}
        tabIndex={-1}
        role="dialog"
        aria-modal="true"
        aria-labelledby="save-take-title"
        className="ms-dialog flex w-[600px] max-w-full h-[min(90dvh,600px)] flex-col overflow-hidden text-ink focus:outline-none"
        onClick={(event) => event.stopPropagation()}
      >
        {/* Fixed-height row: Back appears in place without moving anything. */}
        <div className="flex h-10 shrink-0 items-center justify-between px-5 mt-3.5 sm:px-7 sm:mt-5">
          {step === "details" ? (
            <button type="button" className={`ms-key ms-key-ghost -ml-3 gap-1 px-2.5 py-2 text-[15px] ${motion}`} onClick={() => go("review", "pop")}>
              <BackIcon />
              Listen again
            </button>
          ) : (
            <span />
          )}
          <button type="button" className="ms-key ms-key-ghost ms-key-icon -mr-2" aria-label="Close" onClick={onClose}>
            <CloseIcon />
          </button>
        </div>

        <div key={step} className={`flex min-h-0 flex-1 flex-col overflow-y-auto px-5 pt-1 pb-6 sm:px-7 sm:pb-7 ${motion}`}>
          {step === "review" && (
            <>
              <h2 id="save-take-title" ref={headingRef} tabIndex={-1} className={heading}>
                Would you like to save your recording?
              </h2>
              <p className="mt-1.5 mb-5 text-[14px] text-ink-muted tabular-nums">
                {formatDuration(preview.durationMs)}
              </p>
              <SharedPlayer recording={preview} fill shareActions={false} />
              <div className="mt-5 flex shrink-0 gap-2 border-t border-divider-subtle pt-5">
                <button type="button" className="ms-key ms-key-primary flex-1 px-4 py-2.5 text-[15px]" onClick={() => go("details", "push")}>
                  Yes, save it
                </button>
                <button
                  type="button"
                  className="ms-key ms-key-ghost ms-key-danger flex-1 px-4 py-2.5 text-[15px]"
                  onClick={() => {
                    if (onDelete()) onClose();
                  }}
                >
                  No, delete it
                </button>
              </div>
            </>
          )}

          {step === "details" && (
            <form
              className="flex flex-1 flex-col"
              onSubmit={(event) => {
                event.preventDefault();
                if (ready && !pending) void save();
              }}
            >
              <h2 id="save-take-title" ref={headingRef} tabIndex={-1} className={heading}>
                Save your recording
              </h2>
              <label htmlFor="save-take-name" className="ms-label mt-5">Recording name</label>
              <input
                id="save-take-name"
                value={name}
                maxLength={RECORDING_LIMITS.titleLength.max}
                placeholder="My first song"
                onChange={(event) => setName(event.target.value)}
                className="ms-input mt-1.5 w-full"
                autoFocus
              />

              <fieldset className="mt-5">
                <legend className="ms-label">Who can hear it?</legend>
                <div className="mt-1.5 grid grid-cols-2 gap-2">
                  {AUDIENCES.map((option) => {
                    const disabled = option.value === "public" && !shareable;
                    return (
                      <label
                        key={option.value}
                        className="cursor-pointer has-disabled:cursor-not-allowed has-disabled:opacity-50 rounded-[12px] bg-white p-3 shadow-[var(--ring),var(--shadow-1)] transition-[background-color,box-shadow,transform] duration-150 ease-(--ease-out) active:scale-[0.98] has-checked:bg-accent-soft has-checked:shadow-[inset_0_0_0_1.5px_var(--color-accent)] has-focus-visible:shadow-[var(--ring),var(--halo)]"
                      >
                        <input
                          type="radio"
                          name="save-take-audience"
                          value={option.value}
                          checked={audience === option.value}
                          disabled={disabled}
                          onChange={() => setAudience(option.value)}
                          className="sr-only"
                        />
                        <span className="block text-[15px] font-medium">{option.label}</span>
                        <span className="block text-[13px] text-ink-muted mt-0.5">
                          {disabled ? "Play a note first to share" : option.hint}
                        </span>
                      </label>
                    );
                  })}
                </div>
              </fieldset>

              {/* Only a public song needs a name to show; a private one never asks. */}
              {audience === "public" && (
                <div className="ms-rise mt-5">
                  {askName ? (
                    <AuthorNameField id="save-take-author" value={authorName} onChange={setAuthorName} />
                  ) : (
                    <SharingAs name={authorName} />
                  )}
                </div>
              )}

              {error && <p role="alert" className="mt-3 text-[14px] text-danger">{error}</p>}
              <div className="mt-auto flex shrink-0 gap-2 pt-5">
                <button type="submit" className="ms-key ms-key-primary flex-1 px-4 py-2.5 text-[15px]" disabled={!ready || pending}>
                  {pending ? "Sharing..." : audience === "public" ? "Save and share" : "Save"}
                </button>
              </div>
            </form>
          )}

          {step === "shared" && shared && (
            <SharedConfirmation
              heading={
                <h2 id="save-take-title" ref={headingRef} tabIndex={-1} className={heading}>
                  Your song is shared!
                </h2>
              }
              shareId={shared.id}
              onDone={onClose}
            />
          )}
        </div>
      </div>
    </div>,
    document.body,
  );
}
