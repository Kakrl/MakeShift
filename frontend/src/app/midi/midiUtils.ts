import { pitchToMidi } from "../../cv/noteMap";
import { copyPedals, pedalsOff, performanceBoundaries, type RecordedPedals } from "./recordedPedals";
import type { PedalState } from "../audio/audioEngine";
import { DEFAULT_METER, isMeter, restoreMeter, type Meter } from "../../lib/meter";
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
  meter?: Meter;
  createdAt: string;
  notes: RecordedNote[];
  pedals?: RecordedPedals;
};

export type RecordingState = "stopped" | "recording" | "paused";
type ActiveNote = { pitch: string; startMs: number; velocity: number; order: number };

export function millisecondsToTicks(milliseconds: number, bpm: number): number {
  return Math.round((milliseconds * 128 * bpm) / 60000);
}

export function createRecorder() {
  let recording: Recording | null = null;
  let recordingState: RecordingState = "stopped";
  let recordingStartTime = 0;
  let pausedAt: number | null = null;
  let excludedPausedMs = 0;
  let order = 0;
  let pedalState = pedalsOff();
  const noteOrders = new Map<RecordedNote, { on: number; off: number }>();
  let pedalEvents: RecordedPedals["events"] = [];
  const activeNotes = new Map<string, ActiveNote>();

  function currentRecordingMs(now: number): number {
    const endTime = pausedAt ?? now;
    return Math.max(0, endTime - recordingStartTime - excludedPausedMs);
  }

  function startRecording(bpm: number, name = "Untitled recording", meter: Meter = DEFAULT_METER): void {
    if (!Number.isFinite(bpm) || bpm <= 0) {
      throw new RangeError("Recording BPM must be positive.");
    }
    if (!isMeter(meter)) throw new RangeError("Invalid meter");
    recording = {
      id: crypto.randomUUID(),
      name,
      bpm,
      meter: { ...meter },
      createdAt: new Date().toISOString(),
      notes: [],
    };
    activeNotes.clear();
    order = 0; pedalState = pedalsOff(); noteOrders.clear(); pedalEvents = [];
    recordingStartTime = performance.now();
    pausedAt = null;
    excludedPausedMs = 0;
    recordingState = "recording";
  }

  function noteOn(pitch: string, velocity: number, timestampMs = performance.now(), identity = pitch): void {
    if (recordingState !== "recording" || activeNotes.has(identity)) return;
    activeNotes.set(identity, {
      pitch,
      startMs: currentRecordingMs(timestampMs),
      velocity,
      order: order++,
    });
  }

  function finishNote(pitch: string, endMs: number): void {
    const activeNote = activeNotes.get(pitch);
    if (recording === null || activeNote === undefined) return;
    const note: RecordedNote = {
      pitch: activeNote.pitch,
      velocity: activeNote.velocity,
      startMs: activeNote.startMs,
      durationMs: Math.max(0, endMs - activeNote.startMs),
    };
    recording.notes.push(note);
    noteOrders.set(note, { on: activeNote.order, off: order++ });
    activeNotes.delete(pitch);
  }

  function finishActiveNotes(endMs: number): void {
    for (const pitch of activeNotes.keys()) finishNote(pitch, endMs);
  }

  function noteOff(pitch: string, timestampMs = performance.now(), identity = pitch): void {
    if (recordingState !== "recording") return;
    finishNote(identity, currentRecordingMs(timestampMs));
  }

  function releaseAllNotes(timestampMs = performance.now()): void {
    if (recordingState !== "recording") return;
    finishActiveNotes(currentRecordingMs(timestampMs));
    pedals(pedalsOff(), timestampMs);
  }

  function pedals(state: PedalState, timestampMs = performance.now()): void {
    if (recordingState !== "recording" || Object.keys(pedalState).every(k => pedalState[k as keyof PedalState] === state[k as keyof PedalState])) return;
    pedalState = { ...state };
    pedalEvents.push({ timeMs: currentRecordingMs(timestampMs), order: order++, state: { ...state } });
  }

  function pauseRecording(): void {
    if (recordingState !== "recording") return;
    const now = performance.now();
    finishActiveNotes(currentRecordingMs(now));
    pedals(pedalsOff(), now);
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
      pedals(pedalsOff());
      recordingState = "stopped";
    }
    // Copy each note so callers and subsequent takes cannot mutate one another.
    const sorted = [...recording.notes].sort((a, b) => a.startMs - b.startMs);
    return {
      ...recording,
      ...(pedalEvents.length ? { pedals: copyPedals({ version: 1, events: pedalEvents, noteOrder: sorted.map(n => noteOrders.get(n)!) }) } : {}),
      meter: restoreMeter(recording.meter),
      notes: sorted.map((note) => ({ ...note })),
    };
  }

  return {
    getState: (): RecordingState => recordingState,
    startRecording,
    noteOn,
    noteOff,
    releaseAllNotes,
    pedals,
    pauseRecording,
    resumeRecording,
    stopRecording,
  };
}

export type Recorder = ReturnType<typeof createRecorder>;

export function downloadMidi(recording: Recording): void {
  const track = new MidiWriter.Track();
  track.setTempo(recording.bpm);
  if (recording.meter !== undefined && !isMeter(recording.meter)) throw new RangeError("Invalid meter");
  const meter = restoreMeter(recording.meter);
  track.setTimeSignature(meter.numerator, meter.denominator, 24, 8);
  if (recording.pedals !== undefined) {
    let previousTick = 0;
    const emit = (tick: number, bytes: number[]) => {
      const delta = tick - previousTick;
      previousTick = tick;
      track.addEvent({ name: "OrderedPerformanceEvent", delta, data: [...MidiWriter.Utils.numberToVariableLength(delta), ...bytes] });
    };
    let state = pedalsOff();
    // Isolate press identities on melodic channels (never percussion channel 10).
    // Retired but physically held presses reserve their channel until note-off.
    const channels = [0,1,2,3,4,5,6,7,8,10,11,12,13,14,15];
    for (const channel of channels) for (const cc of [64, 66, 67]) emit(0, [0xb0 | channel, cc, 0]);
    const voices = new Map<number, { channel: number; held: boolean; captured: boolean; retired: boolean }>();
    for (const event of performanceBoundaries(recording.notes, recording.pedals)) {
      const tick = millisecondsToTicks(event.time, recording.bpm);
      if (event.kind === "pedal") {
        for (const [id, cc] of [["sustain", 64], ["sostenuto", 66], ["soft", 67]] as const) {
          if (state[id] !== event.state[id]) for (const channel of channels) emit(tick, [0xb0 | channel, cc, event.state[id] ? 127 : 0]);
        }
        for (const voice of voices.values()) {
          if (!state.sostenuto && event.state.sostenuto) voice.captured = voice.held && !voice.retired;
          if (!event.state.sostenuto) voice.captured = false;
        }
        state = event.state;
        for (const [index, voice] of voices) if (!voice.held && (voice.retired || !(state.sustain || voice.captured))) voices.delete(index);
      } else if (event.kind === "on") {
        const sounding = [...voices.values()].filter(v => !v.retired);
        if (sounding.length >= 10) {
          const oldest = sounding[0];
          emit(tick, [0xb0 | oldest.channel, 120, 0]);
          oldest.retired = true; oldest.captured = false;
          for (const [index, voice] of voices) if (voice === oldest && !voice.held) voices.delete(index);
        }
        const channel = channels.find(c => ![...voices.values()].some(v => v.channel === c));
        if (channel === undefined) throw new RangeError("MIDI export supports at most fifteen simultaneous physical presses");
        // Clear an old envelope/capture before reusing a channel. Set CC66 before
        // the strike so an already-down sostenuto cannot capture the new press.
        emit(tick, [0xb0 | channel, 120, 0]);
        emit(tick, [0xb0 | channel, 66, 0]);
        if (state.sostenuto) emit(tick, [0xb0 | channel, 66, 127]);
        const note = recording.notes[event.index];
        const pitch = pitchToMidi(note.pitch);
        if (pitch === null) throw new RangeError("Invalid MIDI pitch");
        emit(tick, [0x90 | channel, pitch, Math.round(note.velocity * 127 / 100)]);
        voices.set(event.index, { channel, held: true, captured: false, retired: false });
      } else {
        const voice = voices.get(event.index);
        if (!voice) continue;
        const pitch = pitchToMidi(recording.notes[event.index].pitch);
        if (pitch === null) throw new RangeError("Invalid MIDI pitch");
        emit(tick, [0x80 | voice.channel, pitch, 0]);
        voice.held = false;
        if (voice.retired || !(state.sustain || voice.captured)) voices.delete(event.index);
      }
    }
    // Always leave an external MIDI receiver with every pedal released.
    for (const channel of channels) for (const cc of [64, 66, 67]) emit(previousTick, [0xb0 | channel, cc, 0]);
  } else for (const note of recording.notes) {
    const startTick = millisecondsToTicks(note.startMs, recording.bpm);
    const endTick = millisecondsToTicks(
      note.startMs + note.durationMs,
      recording.bpm,
    );
    const event = new MidiWriter.NoteEvent({
      pitch: note.pitch,
      velocity: note.velocity,
      duration: `T${Math.max(0, endTick - startTick)}`,
    });
    // midi-writer-js uses `fields.startTick || fields.tick || null` in its
    // constructor, losing tick zero. Assign once after construction to preserve
    // the absolute timeline, including simultaneous notes at the origin.
    event.tick = startTick;
    track.addEvent(event);
  }
  // Resolve explicit-tick events first. The writer's recursive merge build
  // appends an extra end marker; its subsequent normal build emits only one.
  track.buildData();
  const writer = new MidiWriter.Writer(track);
  const link = document.createElement("a");
  link.href = writer.dataUri();
  const filename = recording.name.replace(/[^a-zA-Z0-9 _-]/g, "_").trim().slice(0, 80);
  link.download = `${filename || "recording"}.mid`;
  link.click();
}
