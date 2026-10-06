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
      <h2 id="recordings-heading" className="font-medium">
        Recordings
      </h2>
      {libraryError && (
        <div role="alert" className="text-danger">
          <p>{libraryError}</p>
          <button type="button" className="underline" onClick={retrySaving}>
            Retry saving
          </button>
        </div>
      )}
      {recordings.length === 0 ? (
        <p>No recordings yet.</p>
      ) : (
        <ul>
          {recordings.map(({ recording, saved }) => (
            <li key={recording.id} className="my-3" aria-label={recording.name}>
              <p className="break-words">
                {recording.name}
                {!saved && " ? Not saved"}
              </p>
              {renamingId === recording.id ? (
                <form
                  onSubmit={(event) => {
                    event.preventDefault();
                    renameRecording(recording.id);
                  }}
                >
                  <label htmlFor={`name-${recording.id}`}>Name</label>
                  <input
                    id={`name-${recording.id}`}
                    value={recordingName}
                    onChange={(event) => setRecordingName(event.target.value)}
                    className="w-full border border-control-border bg-white text-ink"
                  />
                  <button
                    type="submit"
                    className="underline mr-3"
                    disabled={!recordingName.trim()}
                  >
                    Save name
                  </button>
                  <button
                    type="button"
                    className="underline"
                    onClick={() => setRenamingId(null)}
                  >
                    Cancel
                  </button>
                </form>
              ) : (
                <div className="flex flex-wrap gap-3">
                  <button
                    type="button"
                    className="underline"
                    onClick={() => {
                      setRenamingId(recording.id);
                      setRecordingName(recording.name);
                    }}
                  >
                    Rename
                  </button>
                  <button
                    type="button"
                    className="underline"
                    onClick={() => downloadMidi(recording)}
                  >
                    Download MIDI
                  </button>
                  <button
                    type="button"
                    className="underline text-danger"
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
