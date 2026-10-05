# Local recordings library (#124)

The non-UI API lives beside the recorder in
`frontend/src/app/midi/recordingsLibrary.ts`. The home page loads the owner after mount and lists saved and unsaved takes.
Bare-bones controls provide rename, confirmed delete, MIDI download and retry.

`createRecordingsLibrary()` loads validated `Recording` objects using the shared
storage module at `makeshift:recordings:v1`. Its `list()` returns independent
copies with a UI-facing `saved` flag. Create the owner on the client after mount;
do not initialize browser storage during server rendering.

- `completeTake(take)` saves a finished take once per ID. Failed saves retain
  an unsaved in-memory copy for download or retry. Repeated completion of an
  unsaved take retries without duplicating it.
- `renameRecording(id, name)` trims the name and persists before committing the
  change. Empty names and unknown IDs are rejected.
- `deleteRecording(id)` persists deletion of saved takes before changing the
  list. Unsaved takes can be discarded without storage. Deleting a saved take
  does not attempt to save pending takes, so quota recovery remains possible.
- `retrySaving()` attempts to persist the entire current list.

Operations return the existing `WriteResult` (`ok`, or `quota`, `unavailable`,
`error`). The page displays failures and unsaved status. In-memory
unsaved takes do not survive navigation/reload. No successful-save claim should
be shown for a failed operation. Loading missing, corrupt, unsupported-version,
or unreadable data returns an empty list, following the storage module contract.

Persist note lists rather than MIDI bytes. `downloadMidi` builds MIDI on demand
and now derives a bounded ASCII filename from the recording name. Storage writes
belong at completion or explicit library actions, never on the per-note path.

Tests cover persistence across new owner instances, mutations, quota recovery,
invalid data and snapshot isolation. Home-page tests exercise Stop, visible quota feedback, retry, rename/delete and
remount persistence. Production browser tests cover seeded takes across reload,
rename/delete and real downloads. A full browser restart, cross-browser coverage
and Listen/playback remain outside this verification.

The `midi/RecordingsLibraryPanel.tsx` component owns library loading, display, rename,
delete, retry, and error state. The home page forwards completed takes through
its `completeTake` handle and receives loading/availability status for controls.
Recording session and count-in coordination remain in the home page.

The panel is imported with server rendering disabled because it reads browser
storage. Its controller and displayed list initialize with lazy `useState`
initializers; no initialization effect or timer is needed. The import displays
a loading placeholder until the browser component is available.
