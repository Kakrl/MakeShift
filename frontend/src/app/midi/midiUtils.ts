import MidiWriter from "midi-writer-js";

export type RecordedNote = {
  pitch: string;
  // Preserve the existing MIDI writer's velocity convention.
  velocity: number;
  startMs: number;
  durationMs: number;
};

export type Recording = {
  id: string;
  name: string;
  bpm: number;
  createdAt: string;
  notes: RecordedNote[];
};

type RecordingState = "stopped" | "recording" | "paused";
type ActiveNote = { startMs: number; velocity: number };

export function millisecondsToTicks(milliseconds: number, bpm: number): number {
  return Math.round((milliseconds * 128 * bpm) / 60000);
}

export function createRecorder() {
  let recording: Recording | null = null;
  let recordingState: RecordingState = "stopped";
  let recordingStartTime = 0;
  let pausedAt: number | null = null;
  let excludedPausedMs = 0;
  const activeNotes = new Map<string, ActiveNote>();

  function currentRecordingMs(now: number): number {
    const endTime = pausedAt ?? now;
    return Math.max(0, endTime - recordingStartTime - excludedPausedMs);
  }

  function startRecording(bpm: number, name = "Untitled recording"): void {
    if (!Number.isFinite(bpm) || bpm <= 0) {
      throw new RangeError("Recording BPM must be positive.");
    }
    recording = {
      id: crypto.randomUUID(),
      name,
      bpm,
      createdAt: new Date().toISOString(),
      notes: [],
    };
    activeNotes.clear();
    recordingStartTime = performance.now();
    pausedAt = null;
    excludedPausedMs = 0;
    recordingState = "recording";
  }

  function noteOn(pitch: string, velocity: number): void {
    if (recordingState !== "recording" || activeNotes.has(pitch)) return;
    activeNotes.set(pitch, {
      startMs: currentRecordingMs(performance.now()),
      velocity,
    });
  }

  function finishNote(pitch: string, endMs: number): void {
    const activeNote = activeNotes.get(pitch);
    if (recording === null || activeNote === undefined) return;
    recording.notes.push({
      pitch,
      velocity: activeNote.velocity,
      startMs: activeNote.startMs,
      durationMs: Math.max(0, endMs - activeNote.startMs),
    });
    activeNotes.delete(pitch);
  }

  function finishActiveNotes(endMs: number): void {
    for (const pitch of activeNotes.keys()) finishNote(pitch, endMs);
  }

  function noteOff(pitch: string): void {
    if (recordingState !== "recording") return;
    finishNote(pitch, currentRecordingMs(performance.now()));
  }

  function releaseAllNotes(): void {
    if (recordingState !== "recording") return;
    finishActiveNotes(currentRecordingMs(performance.now()));
  }

  function pauseRecording(): void {
    if (recordingState !== "recording") return;
    const now = performance.now();
    finishActiveNotes(currentRecordingMs(now));
    pausedAt = now;
    recordingState = "paused";
  }

  function resumeRecording(): void {
    if (recordingState !== "paused" || pausedAt === null) return;
    excludedPausedMs += performance.now() - pausedAt;
    pausedAt = null;
    recordingState = "recording";
  }

  function stopRecording(): Recording | null {
    if (recording === null) return null;
    if (recordingState !== "stopped") {
      finishActiveNotes(currentRecordingMs(performance.now()));
      recordingState = "stopped";
    }
    // Copy each note so callers and subsequent takes cannot mutate one another.
    return {
      ...recording,
      notes: recording.notes
        .map((note) => ({ ...note }))
        .sort((a, b) => a.startMs - b.startMs),
    };
  }

  return {
    startRecording,
    noteOn,
    noteOff,
    releaseAllNotes,
    pauseRecording,
    resumeRecording,
    stopRecording,
  };
}

export type Recorder = ReturnType<typeof createRecorder>;

export function downloadMidi(recording: Recording): void {
  const track = new MidiWriter.Track();
  track.setTempo(recording.bpm);
  for (const note of recording.notes) {
    const startTick = millisecondsToTicks(note.startMs, recording.bpm);
    const endTick = millisecondsToTicks(
      note.startMs + note.durationMs,
      recording.bpm,
    );
    track.addEvent(
      new MidiWriter.NoteEvent({
        pitch: note.pitch,
        velocity: note.velocity,
        tick: startTick,
        duration: `T${Math.max(0, endTick - startTick)}`,
      }),
    );
  }
  const writer = new MidiWriter.Writer(track);
  const link = document.createElement("a");
  link.href = writer.dataUri();
  link.download = "recording.mid";
  link.click();
}
