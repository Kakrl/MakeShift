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
import { downloadMidi, type Recording } from "./midiUtils";
import type { WriteResult } from "../../lib/storage";

export type RecordingsLibraryHandle = { completeTake(take: Recording): void };
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
  const [renamingId, setRenamingId] = useState<string | null>(null);
  const [recordingName, setRecordingName] = useState("");

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
    }),
    [library, refreshLibrary],
  );

  useEffect(() => {
    onStatusChange(true, recordings.length > 0);
  }, [recordings.length, onStatusChange]);

  function renameRecording(id: string) {
    if (!library) return;
    const result = library.renameRecording(id, recordingName);
    refreshLibrary(result);
    if (result.ok) setRenamingId(null);
  }

  function deleteRecording(id: string) {
    if (window.confirm("Delete this recording?")) {
      refreshLibrary(library.deleteRecording(id));
    }
  }

  function retrySaving() {
    refreshLibrary(library.retrySaving());
  }

  return (
    <section aria-labelledby="recordings-heading" className="w-full text-ink">
      <div className="flex items-baseline justify-between mb-3">
        <h2 id="recordings-heading" className="ms-label">
          Recordings
        </h2>
        {recordings.length > 0 && (
          <span className="text-[12px] text-ink-muted tabular-nums">{recordings.length}</span>
        )}
      </div>
      {libraryError && (
        <div role="alert" className="mb-3 rounded-[10px] bg-danger/5 p-3 text-[13px] leading-relaxed text-danger">
          <p>{libraryError}</p>
          <button type="button" className="ms-key ms-key-ghost ms-key-danger mt-2 -ml-2 px-2 py-1 text-[13px]" onClick={retrySaving}>
            Retry saving
          </button>
        </div>
      )}
      {recordings.length === 0 ? (
        <p className="ms-well px-3 py-4 text-center text-[13px] text-ink-muted">No recordings yet.</p>
      ) : (
        <ul className="flex flex-col gap-2 max-h-[320px] overflow-y-auto -mx-1 px-1 py-1">
          {recordings.map(({ recording, saved }) => (
            <li key={recording.id} className="ms-well p-3" aria-label={recording.name}>
              <p className="flex flex-wrap items-center gap-x-2 gap-y-1 text-[14px] font-medium break-words">
                {recording.name}
                {!saved && (
                  <span className="ms-chip ms-chip-danger px-2 py-0.5 text-[11px]">Not saved</span>
                )}
              </p>
              {renamingId === recording.id ? (
                <form
                  className="mt-2 flex flex-col gap-2"
                  onSubmit={(event) => {
                    event.preventDefault();
                    renameRecording(recording.id);
                  }}
                >
                  <label htmlFor={`name-${recording.id}`} className="ms-label">Name</label>
                  <input
                    id={`name-${recording.id}`}
                    value={recordingName}
                    onChange={(event) => setRecordingName(event.target.value)}
                    className="ms-input w-full"
                    autoFocus
                  />
                  <div className="flex gap-2">
                    <button
                      type="submit"
                      className="ms-key ms-key-primary flex-1 px-3 py-1.5 text-[13px]"
                      disabled={!recordingName.trim()}
                    >
                      Save name
                    </button>
                    <button
                      type="button"
                      className="ms-key flex-1 px-3 py-1.5 text-[13px]"
                      onClick={() => setRenamingId(null)}
                    >
                      Cancel
                    </button>
                  </div>
                </form>
              ) : (
                <div className="mt-2 flex flex-wrap gap-1.5">
                  <button
                    type="button"
                    className="ms-key px-2.5 py-1.5 text-[13px]"
                    onClick={() => {
                      setRenamingId(recording.id);
                      setRecordingName(recording.name);
                    }}
                  >
                    Rename
                  </button>
                  <button
                    type="button"
                    className="ms-key px-2.5 py-1.5 text-[13px]"
                    onClick={() => downloadMidi(recording)}
                  >
                    Download MIDI
                  </button>
                  <button
                    type="button"
                    className="ms-key ms-key-ghost ms-key-danger px-2.5 py-1.5 text-[13px]"
                    onClick={() => deleteRecording(recording.id)}
                  >
                    Delete
                  </button>
                </div>
              )}
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
