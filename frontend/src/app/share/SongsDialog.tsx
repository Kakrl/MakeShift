"use client";

import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { RECORDING_LIMITS, recordingDurationMs, type RecordingSummary, type SharedRecording } from "../../lib/recordings";
import { downloadMidi, type Recording } from "../midi/midiUtils";
import { startPlayAlong } from "../midi/playAlong";
import type { LibraryEntry } from "../midi/recordingsLibrary";
import type { WriteResult } from "../../lib/storage";
import { rainbow } from "../rainbow";
import { useDialogFocus } from "../useDialogFocus";
import CopyLinkButton from "./CopyLinkButton";
import DeviceProfilePanel from "../midi/DeviceProfilePanel";
import { AuthorNameField, BackIcon, CloseIcon, SharedConfirmation, SharingAs } from "./ShareParts";
import SharedPlayer from "./SharedPlayer";
import {
  asSharedRecording,
  formatDate,
  formatDuration,
  loadShareName,
  PAGE_SIZE,
  shareStore,
  shareUrl,
  uploadTake,
  type KeepShare,
  type TakeShare,
} from "./shareStore";

export type SongsTab = "shared" | "mine";

/** The local library, owned by the Recordings panel and edited from here. */
export type MyRecordings = {
  entries: LibraryEntry[];
  shares: Record<string, TakeShare>;
  rename(id: string, name: string): boolean;
  /** Asks first, and stops any share before deleting; false when the person backs out or it fails. */
  remove(id: string): Promise<boolean>;
  keepShare(id: string, share: TakeShare | null): WriteResult;
  /** Asks first; false when the person backs out or it fails. */
  stopSharing(id: string): Promise<boolean>;
  /** The last failed change, shown in the dialog as well as the panel. */
  error: string | null;
};

type ListStatus = "loading" | "ready" | "error";
type SongLoad = "loading" | "missing" | "error" | SharedRecording;
type View =
  | { kind: "list" }
  | { kind: "shared"; id: string; summary: RecordingSummary | null }
  | { kind: "mine"; id: string }
  | { kind: "share"; id: string };

const TABS: { value: SongsTab; label: string }[] = [
  { value: "shared", label: "Shared" },
  { value: "mine", label: "My recordings" },
];

/**
 * Every song in one place, over the play screen: a Shared tab and a My
 * recordings tab. Picking a song pushes its player in from the right and
 * Back returns the way it came; sharing a take is one more step in the
 * same dialog, never a dialog on a dialog. The dialog has a fixed height,
 * so switching views or finishing a load never resizes it.
 */
export default function SongsDialog({
  initialTab = "shared",
  initialSongId = null,
  mine,
  onClose,
}: {
  initialTab?: SongsTab;
  /** Opens straight to this shared song (a share link); Back leads to the list. */
  initialSongId?: string | null;
  mine: MyRecordings;
  onClose: () => void;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const bodyRef = useRef<HTMLDivElement>(null);
  const headingRef = useRef<HTMLHeadingElement>(null);
  const listScroll = useRef(0);
  const sentinelRef = useRef<HTMLDivElement>(null);
  useDialogFocus(ref, true, onClose);
  const playAlong = (recording: Recording) => {
    startPlayAlong(recording);
    onClose();
  };

  const [tab, setTab] = useState<SongsTab>(initialTab);
  const [recordings, setRecordings] = useState<RecordingSummary[]>([]);
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [status, setStatus] = useState<ListStatus>("loading");
  const [loadingMore, setLoadingMore] = useState(false);
  const [view, setView] = useState<View>(
    initialSongId ? { kind: "shared", id: initialSongId, summary: null } : { kind: "list" },
  );
  const [song, setSong] = useState<SongLoad>("loading");
  // Which way the body last moved, so Back mirrors the push.
  const [direction, setDirection] = useState<"push" | "pop" | null>(null);
  const sharedId = view.kind === "shared" ? view.id : null;

  const load = useCallback(async (cursor: string | null) => {
    if (cursor) setLoadingMore(true);
    else setStatus("loading");
    try {
      const page = await shareStore.list(cursor);
      setRecordings((current) => (cursor ? [...current, ...page.recordings] : page.recordings));
      setNextCursor(page.nextCursor);
      setStatus("ready");
    } catch {
      setStatus("error");
    } finally {
      setLoadingMore(false);
    }
  }, []);

  // Sharing or unsharing a take changes the Shared list, so it reloads.
  useEffect(() => {
    void load(null);
  }, [load, mine.shares]);

  // Infinite scroll inside the dialog body. A page that fits without
  // scrolling keeps the sentinel visible, so the next page follows at once.
  const listingShared = view.kind === "list" && tab === "shared";
  useEffect(() => {
    const sentinel = sentinelRef.current;
    if (!sentinel || !listingShared || !nextCursor || loadingMore) return;
    const observer = new IntersectionObserver(
      ([entry]) => {
        if (entry.isIntersecting) void load(nextCursor);
      },
      { root: bodyRef.current, rootMargin: "0px 0px 240px 0px" },
    );
    observer.observe(sentinel);
    return () => observer.disconnect();
  }, [listingShared, nextCursor, loadingMore, load]);

  useEffect(() => {
    if (!sharedId) return;
    let current = true;
    shareStore
      .get(sharedId)
      .then((recording) => current && setSong(recording ?? "missing"))
      .catch(() => current && setSong("error"));
    return () => {
      current = false;
    };
  }, [sharedId]);

  // After each move, put focus on the new view's heading and restore the
  // list's scroll position when returning to it.
  useLayoutEffect(() => {
    if (!direction) return;
    if (bodyRef.current) bodyRef.current.scrollTop = view.kind === "list" ? listScroll.current : 0;
    headingRef.current?.focus();
  }, [view, direction]);

  function push(next: View) {
    if (view.kind === "list") listScroll.current = bodyRef.current?.scrollTop ?? 0;
    // Never show the last song's notes under the next song's title.
    if (next.kind === "shared") setSong("loading");
    setDirection("push");
    setView(next);
  }

  function back() {
    setDirection("pop");
    setView(view.kind === "share" ? { kind: "mine", id: view.id } : { kind: "list" });
  }

  function switchTab(next: SongsTab) {
    if (next === tab) return;
    setTab(next);
    listScroll.current = 0;
    if (bodyRef.current) bodyRef.current.scrollTop = 0;
  }

  const motion = direction === "push" ? "ms-push" : direction === "pop" ? "ms-pop" : "";
  const backLabel =
    view.kind === "shared" ? "Shared songs" : view.kind === "mine" ? "My recordings" : "Back";
  const viewKey = view.kind === "list" ? "list" : `${view.kind}-${view.id}`;
  const take = view.kind === "mine" || view.kind === "share"
    ? mine.entries.find(({ recording }) => recording.id === view.id)
    : undefined;

  return createPortal(
    <div className="ms-backdrop fixed inset-0 z-50 flex items-center justify-center p-4" onClick={onClose}>
      <div
        ref={ref}
        tabIndex={-1}
        role="dialog"
        aria-modal="true"
        aria-label="Songs"
        className="ms-dialog flex w-[640px] max-w-full h-[min(90dvh,640px)] flex-col overflow-hidden text-ink focus:outline-none"
        onClick={(event) => event.stopPropagation()}
      >
        {/* Fixed-height row: the title and the back key swap in place, so
            nothing beside or below them moves when a song opens. Top padding
            plus the row's own inset matches the bottom keys' distance. */}
        <div className="flex shrink-0 items-center gap-2 px-5 pt-3.5 sm:px-7 sm:pt-5">
          <div key={view.kind === "list" ? "title" : "back"} className={`flex h-10 min-w-0 items-center ${motion}`}>
            {view.kind === "list" ? (
              <h2 className="font-display text-[24px] sm:text-[28px] font-bold leading-tight tracking-tight">Songs</h2>
            ) : (
              <button type="button" className="ms-key ms-key-ghost -ml-3 gap-1 px-2.5 py-2 text-[15px]" onClick={back}>
                <BackIcon />
                {backLabel}
              </button>
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
          <div key={viewKey} className={`${motion} ${view.kind === "list" ? "" : "flex h-full flex-col"}`}>
            {view.kind === "list" && (
              <>
                <h3 ref={headingRef} tabIndex={-1} className="sr-only">Song list</h3>
                <Tabs tab={tab} onChange={switchTab} />
                <div role="tabpanel" id={`songs-panel-${tab}`} aria-labelledby={`songs-tab-${tab}`} className="mt-4">
                  {tab === "shared" ? (
                    <SharedList
                      recordings={recordings}
                      status={status}
                      loadingMore={loadingMore}
                      hasMore={nextCursor !== null}
                      sentinelRef={sentinelRef}
                      onRetry={() => void load(null)}
                      onOpen={(summary) => push({ kind: "shared", id: summary.id, summary })}
                    />
                  ) : (
                    <>
                      <DeviceProfilePanel />
                      <MineList mine={mine} onOpen={(id) => push({ kind: "mine", id })} />
                    </>
                  )}
                </div>
              </>
            )}
            {view.kind === "shared" && (
              <SharedSongView
                summary={view.summary ?? (typeof song === "object" ? song : null)}
                song={song}
                headingRef={headingRef}
                onBack={back}
                onPlayAlong={playAlong}
              />
            )}
            {view.kind === "mine" && take && (
              <MySongView
                entry={take}
                share={mine.shares[take.recording.id] ?? null}
                mine={mine}
                headingRef={headingRef}
                onShare={() => push({ kind: "share", id: take.recording.id })}
                onDeleted={back}
                onPlayAlong={playAlong}
              />
            )}
            {view.kind === "share" && take && (
              <ShareTakeView
                take={take.recording}
                headingRef={headingRef}
                keepShare={(share) => mine.keepShare(take.recording.id, share)}
                onDone={back}
              />
            )}
          </div>
        </div>
      </div>
    </div>,
    document.body,
  );
}

/** Two tabs with a pill that slides between them (transform only). */
function Tabs({ tab, onChange }: { tab: SongsTab; onChange: (tab: SongsTab) => void }) {
  return (
    <div role="tablist" aria-label="Songs" className="ms-well relative grid grid-cols-2 rounded-full p-1">
      <span
        aria-hidden="true"
        className="absolute inset-y-1 left-1 w-[calc(50%-4px)] rounded-full bg-white shadow-[var(--ring),var(--shadow-1)] transition-transform duration-200 ease-(--ease-out)"
        style={{ transform: tab === "mine" ? "translateX(100%)" : "translateX(0)" }}
      />
      {TABS.map(({ value, label }) => (
        <button
          key={value}
          type="button"
          role="tab"
          id={`songs-tab-${value}`}
          aria-selected={tab === value}
          aria-controls={`songs-panel-${value}`}
          onClick={() => onChange(value)}
          className={`relative z-10 rounded-full px-3 py-2 text-[15px] transition-colors duration-150 focus-visible:outline-none focus-visible:shadow-(--halo) ${tab === value ? "text-ink font-medium" : "text-ink-muted hover:text-ink"}`}
        >
          {label}
        </button>
      ))}
    </div>
  );
}

const CARD =
  "flex w-full items-stretch gap-3 rounded-[14px] bg-white p-3.5 text-left shadow-[var(--ring),var(--shadow-1)]";
const PRESSABLE_CARD = `${CARD} transition-[background-color,transform] duration-150 ease-(--ease-out) hover:bg-well active:scale-[0.98] focus-visible:outline-none focus-visible:shadow-[var(--ring),var(--halo)]`;

function SharedList({
  recordings,
  status,
  loadingMore,
  hasMore,
  sentinelRef,
  onRetry,
  onOpen,
}: {
  recordings: RecordingSummary[];
  status: ListStatus;
  loadingMore: boolean;
  hasMore: boolean;
  sentinelRef: React.RefObject<HTMLDivElement | null>;
  onRetry: () => void;
  onOpen: (summary: RecordingSummary) => void;
}) {
  if (status === "loading")
    return (
      <ul aria-label="Loading shared songs" className="grid gap-2 sm:grid-cols-2">
        {Array.from({ length: PAGE_SIZE }, (_, i) => <SongCardSkeleton key={i} />)}
      </ul>
    );
  if (status === "error")
    return (
      <div role="alert" className="ms-well p-4 text-[15px]">
        <p className="mb-3">We couldn&apos;t load shared songs. Check your connection and try again.</p>
        <button type="button" className="ms-key px-4 py-2 text-[14px]" onClick={onRetry}>
          Try again
        </button>
      </div>
    );
  if (recordings.length === 0)
    return (
      <p className="ms-well px-4 py-6 text-center text-[15px] text-ink-muted">
        No one has shared a song yet. Record one and share it from My recordings!
      </p>
    );
  return (
    <>
      <ul className="grid gap-2 sm:grid-cols-2">
        {recordings.map((recording, index) => (
          // Stagger restarts per page, so scrolled-in items rise in too.
          <li key={recording.id} className="ms-rise" style={{ "--i": index % PAGE_SIZE } as React.CSSProperties}>
            <button type="button" onClick={() => onOpen(recording)} className={PRESSABLE_CARD}>
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
        {loadingMore && Array.from({ length: 2 }, (_, i) => <SongCardSkeleton key={`more-${i}`} />)}
      </ul>
      {/* Loads the next page as it nears view; no button to press. */}
      {hasMore && <div ref={sentinelRef} aria-hidden="true" className="h-px" />}
    </>
  );
}

function MineList({ mine, onOpen }: { mine: MyRecordings; onOpen: (id: string) => void }) {
  if (mine.entries.length === 0)
    return (
      <p className="ms-well px-4 py-6 text-center text-[15px] text-ink-muted">
        No recordings yet. Hit Record to make one!
      </p>
    );
  return (
    <ul className="grid gap-2 sm:grid-cols-2">
      {mine.entries.map(({ recording, saved }, index) => (
        <li key={recording.id} className="ms-rise" style={{ "--i": index } as React.CSSProperties}>
          <button type="button" onClick={() => onOpen(recording.id)} className={PRESSABLE_CARD}>
            <span aria-hidden="true" className="w-1.5 shrink-0 rounded-full" style={{ background: rainbow(index).color }} />
            <span className="min-w-0 flex-1">
              <span className="block text-[16px] font-medium leading-snug break-words">{recording.name}</span>
              <span className="mt-1 flex flex-wrap items-center gap-1.5">
                {!saved && <span className="ms-chip ms-chip-danger px-2 py-0.5 text-[11px]">Not saved</span>}
                {mine.shares[recording.id] ? (
                  <span className="ms-chip ms-chip-success px-2 py-0.5 text-[11px]">Shared</span>
                ) : (
                  <span className="text-[14px] text-ink-muted">Only me</span>
                )}
              </span>
              <span className="mt-1.5 flex flex-wrap gap-x-3 gap-y-1 text-[13px] text-ink-muted tabular-nums">
                <span>{formatDuration(recordingDurationMs(recording.notes))}</span>
                <span>{recording.notes.length} notes</span>
                <span>{formatDate(recording.createdAt)}</span>
              </span>
            </span>
          </button>
        </li>
      ))}
    </ul>
  );
}

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
      {" "}
    </span>
  );
}

const SONG_TITLE =
  "font-display text-[24px] sm:text-[30px] font-bold leading-[1.1] tracking-tight break-words focus:outline-none";

function SharedSongView({
  summary,
  song,
  headingRef,
  onBack,
  onPlayAlong,
}: {
  summary: RecordingSummary | null;
  song: SongLoad;
  headingRef: React.RefObject<HTMLHeadingElement | null>;
  onBack: () => void;
  onPlayAlong: (recording: Recording) => void;
}) {
  return (
    <div className="flex min-h-0 flex-1 flex-col">
      {/* Drawn from the list row at once; only the notes wait for the fetch.
          From a share link, bars of the same line heights hold the space. */}
      <h3 ref={headingRef} tabIndex={-1} className={SONG_TITLE}>
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
        <SharedPlayer recording={song === "loading" ? null : song} fill onPlayAlong={onPlayAlong} />
      )}
    </div>
  );
}

const KEY = "ms-key px-4 py-2.5 text-[15px]";

/** One of your takes: rename in place, listen, download, share and delete. */
function MySongView({
  entry,
  share,
  mine,
  headingRef,
  onShare,
  onDeleted,
  onPlayAlong,
}: {
  entry: LibraryEntry;
  share: TakeShare | null;
  mine: MyRecordings;
  headingRef: React.RefObject<HTMLHeadingElement | null>;
  onShare: () => void;
  onDeleted: () => void;
  onPlayAlong: (recording: Recording) => void;
}) {
  const { recording, saved } = entry;
  const [preview] = useState(() => asSharedRecording(recording));
  const [renaming, setRenaming] = useState(false);
  const [draft, setDraft] = useState(recording.name);
  const [stopping, setStopping] = useState(false);
  // Enter or Escape already ended the edit; the blur from unmounting the
  // field must not commit again (or commit a cancelled draft).
  const editEnded = useRef(false);

  function commitRename() {
    if (editEnded.current) return;
    const name = draft.trim();
    if (name && name !== recording.name && !mine.rename(recording.id, name)) return;
    editEnded.current = true;
    setRenaming(false);
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      {/* The title edits in place: the field keeps the heading's size and
          line height, so nothing below it moves while renaming. */}
      <div className="flex items-center gap-2">
        {renaming ? (
          <input
            aria-label="Recording name"
            value={draft}
            maxLength={RECORDING_LIMITS.titleLength.max}
            onChange={(event) => setDraft(event.target.value)}
            onBlur={commitRename}
            onKeyDown={(event) => {
              if (event.key === "Enter") commitRename();
              if (event.key === "Escape") {
                // Cancel the rename without closing the whole dialog.
                event.stopPropagation();
                editEnded.current = true;
                setDraft(recording.name);
                setRenaming(false);
              }
            }}
            className={`${SONG_TITLE} -mx-1.5 min-w-0 flex-1 rounded-[8px] bg-well px-1.5 shadow-(--sunk)`}
            autoFocus
          />
        ) : (
          <>
            <h3 ref={headingRef} tabIndex={-1} className={`${SONG_TITLE} min-w-0`}>
              {recording.name}
            </h3>
            <button
              type="button"
              className="ms-key ms-key-ghost shrink-0 px-2 py-1 text-[14px]"
              onClick={() => {
                editEnded.current = false;
                setDraft(recording.name);
                setRenaming(true);
              }}
            >
              Rename
            </button>
          </>
        )}
      </div>
      <p className="mt-1.5 mb-5 flex flex-wrap items-center gap-x-2 gap-y-1 text-[14px] text-ink-muted tabular-nums">
        <span>
          {formatDuration(preview.durationMs)} · {preview.noteCount} notes · {formatDate(recording.createdAt)}
        </span>
        {!saved && <span className="ms-chip ms-chip-danger px-2 py-0.5 text-[11px]">Not saved</span>}
        {share && (
          <>
            <span className="ms-chip ms-chip-success px-2 py-0.5 text-[11px]">Shared</span>
            <button
              type="button"
              className="rounded-[6px] text-ink-muted underline decoration-ink-muted/40 underline-offset-4 hover:text-ink focus-visible:outline-none focus-visible:shadow-(--halo) disabled:opacity-50"
              disabled={stopping}
              onClick={async () => {
                setStopping(true);
                await mine.stopSharing(recording.id);
                setStopping(false);
              }}
            >
              {stopping ? "Stopping..." : "Stop sharing"}
            </button>
          </>
        )}
      </p>
      {mine.error && <p role="alert" className="-mt-3 mb-4 text-[14px] text-danger">{mine.error}</p>}
      <SharedPlayer
        recording={preview}
        fill
        shareActions={false}
        onPlayAlong={onPlayAlong}
        actions={
          <>
            <button type="button" className={KEY} onClick={() => downloadMidi(recording)}>
              Download MIDI
            </button>
            {share ? (
              <CopyLinkButton url={shareUrl(share.id, share.mock === true)} className={`${KEY} min-w-[116px]`} />
            ) : (
              <button type="button" className={KEY} onClick={onShare}>
                Share
              </button>
            )}
            <button
              type="button"
              className="ms-key ms-key-ghost ms-key-danger ml-auto px-3 py-2.5 text-[15px]"
              onClick={async () => {
                if (await mine.remove(recording.id)) onDeleted();
              }}
            >
              Delete
            </button>
          </>
        }
      />
    </div>
  );
}

/** Names a take for Shared songs, uploads it, then shows its link in place. */
function ShareTakeView({
  take,
  headingRef,
  keepShare,
  onDone,
}: {
  take: Recording;
  headingRef: React.RefObject<HTMLHeadingElement | null>;
  keepShare: KeepShare;
  onDone: () => void;
}) {
  const [title, setTitle] = useState(take.name);
  const [authorName, setAuthorName] = useState(() => loadShareName());
  const [askName] = useState(() => authorName === "");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [shared, setShared] = useState<TakeShare | null>(null);
  const ready = title.trim().length > 0 && authorName.trim().length > 0 && take.notes.length > 0;

  async function share() {
    setPending(true);
    setError(null);
    try {
      const result = await uploadTake(take, title, authorName, keepShare);
      setShared(result);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Sharing failed. Try again.");
    } finally {
      setPending(false);
    }
  }

  if (shared)
    return (
      <div className="ms-swap flex flex-1 flex-col">
        <SharedConfirmation
          heading={<h3 ref={headingRef} tabIndex={-1} className={SONG_TITLE}>Your song is shared!</h3>}
          shareId={shared.id}
          onDone={onDone}
        />
      </div>
    );

  return (
    <form
      className="flex flex-1 flex-col"
      onSubmit={(event) => {
        event.preventDefault();
        if (ready && !pending) void share();
      }}
    >
      <h3 ref={headingRef} tabIndex={-1} className={SONG_TITLE}>Share this song</h3>
      <p className="mt-2 mb-5 text-[15px] text-ink-muted leading-relaxed">
        It goes in Shared songs with a link anyone can open. You can stop sharing any time.
      </p>
      <label htmlFor="share-song-title" className="ms-label">Song name</label>
      <input
        id="share-song-title"
        value={title}
        maxLength={RECORDING_LIMITS.titleLength.max}
        onChange={(event) => setTitle(event.target.value)}
        className="ms-input mt-1.5 mb-4 w-full"
      />
      {askName ? (
        <AuthorNameField id="share-author" value={authorName} onChange={setAuthorName} />
      ) : (
        <SharingAs name={authorName} />
      )}
      {take.notes.length === 0 && (
        <p className="mt-3 text-[14px] text-ink-muted">This take has no notes yet, so there&apos;s nothing to share.</p>
      )}
      {error && <p role="alert" className="mt-3 text-[14px] text-danger">{error}</p>}
      <div className="mt-auto flex shrink-0 gap-2 pt-5">
        <button type="submit" className="ms-key ms-key-primary flex-1 px-4 py-2.5 text-[15px]" disabled={!ready || pending}>
          {pending ? "Sharing..." : "Share"}
        </button>
      </div>
    </form>
  );
}
