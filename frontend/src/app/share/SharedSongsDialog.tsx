"use client";

import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import type { RecordingSummary, SharedRecording } from "../../lib/recordings";
import { rainbow } from "../rainbow";
import { useDialogFocus } from "../useDialogFocus";
import SharedPlayer from "./SharedPlayer";
import { formatDate, formatDuration, mockShareStore, PAGE_SIZE } from "./mockShareStore";

type ListStatus = "loading" | "ready" | "error";
type SongLoad = "loading" | "missing" | "error" | SharedRecording;

function CloseIcon() {
  return (
    <svg aria-hidden="true" width="16" height="16" viewBox="0 0 16 16" fill="none">
      <path d="M3.5 3.5l9 9M12.5 3.5l-9 9" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
    </svg>
  );
}

function BackIcon() {
  return (
    <svg aria-hidden="true" width="16" height="16" viewBox="0 0 16 16" fill="none">
      <path d="M10 3.5 5.5 8l4.5 4.5" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

/**
 * Shared songs over the play screen. The dialog has a fixed height, so
 * switching views or finishing a load never resizes it; the body scrolls. The list and a song's player live in
 * one dialog: picking a song pushes in from the right, Back returns the way
 * it came, and the list keeps its pages and scroll position.
 */
export default function SharedSongsDialog({
  initialSongId = null,
  onClose,
}: {
  /** Opens straight to this song (a share link); Back still leads to the list. */
  initialSongId?: string | null;
  onClose: () => void;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const bodyRef = useRef<HTMLDivElement>(null);
  const headingRef = useRef<HTMLHeadingElement>(null);
  const listScroll = useRef(0);
  const sentinelRef = useRef<HTMLDivElement>(null);
  useDialogFocus(ref, true, onClose);

  const [recordings, setRecordings] = useState<RecordingSummary[]>([]);
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [status, setStatus] = useState<ListStatus>("loading");
  const [loadingMore, setLoadingMore] = useState(false);
  // The list row's summary when picked from the list; null for a share link
  // until the song loads, so the header shows placeholders of the same size.
  const [open, setOpen] = useState<{ id: string; summary: RecordingSummary | null } | null>(
    initialSongId ? { id: initialSongId, summary: null } : null,
  );
  const openId = open?.id ?? null;
  const [song, setSong] = useState<SongLoad>("loading");
  // Which way the body last moved, so Back mirrors the push.
  const [direction, setDirection] = useState<"push" | "pop" | null>(null);

  const load = useCallback(async (cursor: string | null) => {
    if (cursor) setLoadingMore(true);
    else setStatus("loading");
    try {
      const page = await mockShareStore.list(cursor);
      setRecordings((current) => (cursor ? [...current, ...page.recordings] : page.recordings));
      setNextCursor(page.nextCursor);
      setStatus("ready");
    } catch {
      setStatus("error");
    } finally {
      setLoadingMore(false);
    }
  }, []);

  useEffect(() => {
    void load(null);
  }, [load]);

  // Infinite scroll inside the dialog body. A page that fits without
  // scrolling keeps the sentinel visible, so the next page follows at once.
  useEffect(() => {
    const sentinel = sentinelRef.current;
    if (!sentinel || openId || !nextCursor || loadingMore) return;
    const observer = new IntersectionObserver(
      ([entry]) => {
        if (entry.isIntersecting) void load(nextCursor);
      },
      { root: bodyRef.current, rootMargin: "0px 0px 240px 0px" },
    );
    observer.observe(sentinel);
    return () => observer.disconnect();
  }, [openId, nextCursor, loadingMore, load]);

  useEffect(() => {
    if (!openId) return;
    let current = true;
    mockShareStore
      .get(openId)
      .then((recording) => current && setSong(recording ?? "missing"))
      .catch(() => current && setSong("error"));
    return () => {
      current = false;
    };
  }, [openId]);

  // After each move, put focus on the new view's heading and restore the
  // list's scroll position when returning to it.
  useLayoutEffect(() => {
    if (!direction) return;
    if (bodyRef.current) bodyRef.current.scrollTop = openId ? 0 : listScroll.current;
    headingRef.current?.focus();
  }, [openId, direction]);

  function openSong(summary: RecordingSummary) {
    listScroll.current = bodyRef.current?.scrollTop ?? 0;
    setSong("loading");
    setDirection("push");
    setOpen({ id: summary.id, summary });
  }

  function back() {
    setDirection("pop");
    setOpen(null);
  }

  const motion = direction === "push" ? "ms-push" : direction === "pop" ? "ms-pop" : "";

  return createPortal(
    <div className="ms-backdrop fixed inset-0 z-50 flex items-center justify-center p-4" onClick={onClose}>
      <div
        ref={ref}
        tabIndex={-1}
        role="dialog"
        aria-modal="true"
        aria-label="Shared songs"
        className="ms-dialog flex w-[640px] max-w-full h-[min(90dvh,640px)] flex-col overflow-hidden text-ink focus:outline-none"
        onClick={(event) => event.stopPropagation()}
      >
        {/* Fixed-height row: the title and the back key swap in place, so
            nothing beside or below them moves when a song opens. */}
        {/* Top padding plus the 40px row's own inset puts the label as far from the
            top edge as the bottom keys are from the bottom (pb-6 / sm:pb-7). */}
        <div className="flex shrink-0 items-center gap-2 px-5 pt-3.5 sm:px-7 sm:pt-5">
          <div key={openId ? "back" : "title"} className={`flex h-10 min-w-0 items-center ${motion}`}>
            {openId ? (
              <button type="button" className="ms-key ms-key-ghost -ml-3 gap-1 px-2.5 py-2 text-[15px]" onClick={back}>
                <BackIcon />
                Shared songs
              </button>
            ) : (
              <h2 className="font-display text-[24px] sm:text-[28px] font-bold leading-tight tracking-tight">
                Shared songs
              </h2>
            )}
          </div>
          <button type="button" className="ms-key ms-key-ghost ms-key-icon ml-auto -mr-2" aria-label="Close" onClick={onClose}>
            <CloseIcon />
          </button>
        </div>

        {/* Content fades out under the header instead of being cut by a hard edge. */}
        <div
          ref={bodyRef}
          className="min-h-0 flex-1 overflow-y-auto px-5 pt-3 pb-6 sm:px-7 sm:pb-7 [mask-image:linear-gradient(to_bottom,transparent,black_14px)]"
        >
          {/* A song fills the body so its keys sit on the bottom edge. */}
          <div key={openId ?? "list"} className={`${motion} ${open ? "flex h-full flex-col" : ""}`}>
            {open ? (
              <SongView
                summary={open.summary ?? (typeof song === "object" ? song : null)}
                song={song}
                headingRef={headingRef}
                onBack={back}
              />
            ) : (
              <>
                <h3 ref={headingRef} tabIndex={-1} className="sr-only">Song list</h3>
                <p className="mb-4 text-[15px] text-ink-muted leading-relaxed">
                  Songs other players made on paper pianos. Pick one to listen.
                </p>
                {status === "loading" && (
                  <ul aria-label="Loading shared songs" className="grid gap-2 sm:grid-cols-2">
                    {Array.from({ length: PAGE_SIZE }, (_, i) => <SongCardSkeleton key={i} />)}
                  </ul>
                )}
                {status === "error" && (
                  <div role="alert" className="ms-well p-4 text-[15px]">
                    <p className="mb-3">We couldn&apos;t load shared songs. Check your connection and try again.</p>
                    <button type="button" className="ms-key px-4 py-2 text-[14px]" onClick={() => void load(null)}>
                      Try again
                    </button>
                  </div>
                )}
                {status === "ready" && recordings.length === 0 && (
                  <p className="ms-well px-4 py-6 text-center text-[15px] text-ink-muted">
                    No one has shared a song yet. Record one and share it from your recordings!
                  </p>
                )}
                {status === "ready" && recordings.length > 0 && (
                  <>
                    <ul className="grid gap-2 sm:grid-cols-2">
                      {recordings.map((recording, index) => (
                        // Stagger restarts per page, so scrolled-in items rise in too.
                        <li key={recording.id} className="ms-rise" style={{ "--i": index % PAGE_SIZE } as React.CSSProperties}>
                          <button
                            type="button"
                            onClick={() => openSong(recording)}
                            className={`${CARD} transition-[background-color,transform] duration-150 ease-(--ease-out) hover:bg-well active:scale-[0.98] focus-visible:outline-none focus-visible:shadow-[var(--ring),var(--halo)]`}
                          >
                            <span aria-hidden="true" className="w-1.5 shrink-0 rounded-full" style={{ background: rainbow(index).color }} />
                            <span className="min-w-0 flex-1">
                              <span className="block text-[16px] font-medium leading-snug break-words">{recording.title}</span>
                              <span className="block text-[14px] text-ink-muted mt-0.5">by {recording.authorName}</span>
                              <span className="mt-1.5 flex flex-wrap gap-x-3 gap-y-1 text-[13px] text-ink-muted tabular-nums">
                                <span>{formatDuration(recording.durationMs)}</span>
                                <span>{recording.noteCount} notes</span>
                                <span>{formatDate(recording.createdAt)}</span>
                              </span>
                            </span>
                          </button>
                        </li>
                      ))}
                      {loadingMore &&
                        Array.from({ length: 2 }, (_, i) => <SongCardSkeleton key={`more-${i}`} />)}
                    </ul>
                    {/* Loads the next page as it nears view; no button to press. */}
                    {nextCursor && <div ref={sentinelRef} aria-hidden="true" className="h-px" />}
                  </>
                )}
              </>
            )}
          </div>
        </div>
      </div>
    </div>,
    document.body,
  );
}

const CARD =
  "flex w-full items-stretch gap-3 rounded-[14px] bg-white p-3.5 text-left shadow-[var(--ring),var(--shadow-1)]";

/** Same box and line heights as a song card, so cards replace it in place. */
function SongCardSkeleton() {
  const bar = "inline-block rounded-full bg-well align-middle";
  return (
    <li aria-hidden="true" className={`${CARD} motion-safe:animate-pulse`}>
      <span className="w-1.5 shrink-0 rounded-full bg-well" />
      <span className="min-w-0 flex-1">
        <span className="block text-[16px] leading-snug"><span className={`${bar} h-3.5 w-2/3`} /></span>
        <span className="block text-[14px] mt-0.5"><span className={`${bar} h-3 w-1/3`} /></span>
        <span className="mt-1.5 block text-[13px]"><span className={`${bar} h-3 w-1/2`} /></span>
      </span>
    </li>
  );
}

/** A loading bar that sits on a text line without changing its height. */
function TextBar({ width }: { width: string }) {
  return (
    <span aria-hidden="true" className={`inline-block h-[0.7em] ${width} rounded-full bg-well align-middle motion-safe:animate-pulse`}>
      {"\u00a0"}
    </span>
  );
}

function SongView({
  summary,
  song,
  headingRef,
  onBack,
}: {
  summary: RecordingSummary | null;
  song: SongLoad;
  headingRef: React.RefObject<HTMLHeadingElement | null>;
  onBack: () => void;
}) {
  return (
    <div className="flex min-h-0 flex-1 flex-col">
      {/* Drawn from the list row at once; only the notes wait for the fetch.
          From a share link, bars of the same line heights hold the space. */}
      <h3 ref={headingRef} tabIndex={-1} className="font-display text-[24px] sm:text-[30px] font-bold leading-[1.1] tracking-tight break-words focus:outline-none">
        {summary ? summary.title : <TextBar width="w-1/2" />}
      </h3>
      <p className="mt-1.5 mb-5 text-[14px] text-ink-muted tabular-nums">
        {summary ? (
          <>
            by <span className="text-ink font-medium">{summary.authorName}</span>
            {" · "}
            {formatDuration(summary.durationMs)} · {summary.noteCount} notes · {formatDate(summary.createdAt)}
          </>
        ) : (
          <TextBar width="w-2/5" />
        )}
      </p>
      {song === "missing" || song === "error" ? (
        <div role="alert" className="ms-well p-4 text-[15px]">
          <p className="font-medium mb-1">{song === "missing" ? "Song not found" : "Something went wrong"}</p>
          <p className="mb-3 text-ink-muted">
            {song === "missing" ? "This song was removed." : "We couldn't load this song. Try again."}
          </p>
          <button type="button" className="ms-key px-4 py-2 text-[14px]" onClick={onBack}>
            Back to songs
          </button>
        </div>
      ) : (
        <SharedPlayer recording={song === "loading" ? null : song} fill />
      )}
    </div>
  );
}
