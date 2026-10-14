"use client";

import {
  useCallback,
  useEffect,
  useImperativeHandle,
  useState,
  type Ref,
} from "react";
import {
  createRecordingsLibrary,
  type LibraryEntry,
} from "./recordingsLibrary";
import type { Recording } from "./midiUtils";
import type { WriteResult } from "../../lib/storage";
import SongsDialog, { type MyRecordings, type SongsTab } from "../share/SongsDialog";
import SaveTakeDialog from "../share/SaveTakeDialog";
import {
  loadTakeShares,
  mockShareStore,
  saveTakeShare,
} from "../share/mockShareStore";

export type RecordingsLibraryHandle = {
  completeTake(take: Recording): void;
  /** Asks whether to keep a just-finished take, then names and shares it. */
  reviewTake(takeId: string): void;
};
type Props = {
  ref: Ref<RecordingsLibraryHandle>;
  onStatusChange: (loaded: boolean, hasRecordings: boolean) => void;
};

export default function RecordingsLibrary({ ref, onStatusChange }: Props) {
  const [library] = useState(() => createRecordingsLibrary());
  const [recordings, setRecordings] = useState<LibraryEntry[]>(() =>
    library.list(),
  );
  const [libraryError, setLibraryError] = useState<string | null>(null);
  const [shares, setShares] = useState(() => loadTakeShares());
  const [reviewingTake, setReviewingTake] = useState<Recording | null>(null);
  // A share link (`/play/<id>` redirects to `?song=<id>`) opens that song.
  const [linkedSongId, setLinkedSongId] = useState(() => new URLSearchParams(window.location.search).get("song"));
  const [songsTab, setSongsTab] = useState<SongsTab | null>(linkedSongId !== null ? "shared" : null);

  const refreshLibrary = useCallback(
    (result: WriteResult) => {
      setRecordings(library.list());
      setLibraryError(
        result.ok
          ? null
          : result.reason === "quota"
            ? "Storage is full. Unsaved recordings will be lost when you leave. Download them or free space and retry."
            : "The change could not be saved. Download any unsaved recordings before leaving.",
      );
    },
    [library],
  );

  useImperativeHandle(
    ref,
    () => ({
      completeTake(take: Recording) {
        refreshLibrary(library.completeTake(take));
      },
      reviewTake(takeId: string) {
        const entry = library.list().find(({ recording }) => recording.id === takeId);
        if (entry) setReviewingTake(entry.recording);
      },
    }),
    [library, refreshLibrary],
  );

  useEffect(() => {
    onStatusChange(true, recordings.length > 0);
  }, [recordings.length, onStatusChange]);

  function retrySaving() {
    refreshLibrary(library.retrySaving());
  }

  // The songs dialog edits the library through these; the panel stays the
  // single owner of takes and their shares.
  const mine: MyRecordings = {
    entries: recordings,
    shares,
    rename(id, name) {
      const result = library.renameRecording(id, name);
      refreshLibrary(result);
      return result.ok;
    },
    remove(id) {
      if (!window.confirm("Delete this recording?")) return false;
      refreshLibrary(library.deleteRecording(id));
      return true;
    },
    shared(id, share) {
      setShares(saveTakeShare(id, share));
    },
    async stopSharing(id) {
      const share = shares[id];
      if (!share || !window.confirm("Stop sharing? The link will stop working. Your recording stays here.")) return false;
      try {
        await mockShareStore.remove(share.id, share.deleteToken);
        setShares(saveTakeShare(id, null));
        return true;
      } catch {
        setLibraryError("Sharing could not be stopped. Try again.");
        return false;
      }
    },
  };

  const unsaved = recordings.filter(({ saved }) => !saved).length;

  return (
    <section aria-labelledby="recordings-heading" className="w-full text-ink">
      <div className="flex items-baseline justify-between mb-1.5">
        <h2 id="recordings-heading" className="ms-label">
          Recordings
        </h2>
      </div>
      <p className="mb-3 flex flex-wrap items-center gap-x-2 gap-y-1 text-[13px] text-ink-muted tabular-nums">
        {recordings.length === 0
          ? "No recordings yet."
          : `${recordings.length} recording${recordings.length === 1 ? "" : "s"}`}
        {unsaved > 0 && <span className="ms-chip ms-chip-danger px-2 py-0.5 text-[11px]">{unsaved} not saved</span>}
      </p>
      {/* Storage problems stay out here, where they can't be missed. */}
      {libraryError && (
        <div role="alert" className="mb-3 rounded-[10px] bg-danger/5 p-3 text-[13px] leading-relaxed text-danger">
          <p>{libraryError}</p>
          <button type="button" className="ms-key ms-key-ghost ms-key-danger mt-2 -ml-2 px-2 py-1 text-[13px]" onClick={retrySaving}>
            Retry saving
          </button>
        </div>
      )}
      <div className="flex flex-wrap gap-2">
        <button type="button" className="ms-key flex-1 px-3 py-2 text-[14px] whitespace-nowrap" onClick={() => setSongsTab("mine")}>
          My recordings
        </button>
        <button type="button" className="ms-key flex-1 px-3 py-2 text-[14px] whitespace-nowrap" onClick={() => setSongsTab("shared")}>
          Shared songs
        </button>
      </div>
      {reviewingTake && (
        <SaveTakeDialog
          take={reviewingTake}
          onSave={(name, share) => {
            const id = reviewingTake.id;
            refreshLibrary(library.renameRecording(id, name));
            if (share) setShares(saveTakeShare(id, share));
          }}
          onDelete={() => {
            if (!window.confirm("Delete this recording? This can't be undone.")) return false;
            refreshLibrary(library.deleteRecording(reviewingTake.id));
            return true;
          }}
          onClose={() => setReviewingTake(null)}
        />
      )}
      {songsTab && (
        <SongsDialog
          initialTab={songsTab}
          initialSongId={linkedSongId}
          mine={mine}
          onClose={() => {
            setSongsTab(null);
            // Used once; the buttons open the lists from now on.
            setLinkedSongId(null);
          }}
        />
      )}
    </section>
  );
}
