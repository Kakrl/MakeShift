import MidiWriter from "midi-writer-js";

let track: InstanceType<typeof MidiWriter.Track> | null = null;
let recordingStartTime = 0;
let recordingBpm = 120;

type ActiveNote = {
  startTick: number;
  velocity: number;
};

const activeNotes = new Map<string, ActiveNote>();

export function millisecondsToTicks(
  milliseconds: number,
  bpm: number
): number {
  return Math.round((milliseconds * 128 * bpm) / 60000);
}

export function startRecording(bpm: number): void {
  track = new MidiWriter.Track();
  track.setTempo(bpm);

  activeNotes.clear();

  recordingBpm = bpm;
  recordingStartTime = performance.now();
}

export function noteOn(
  pitch: string,
  velocity: number
): void {
  if (track === null) {
    return;
  }

  if (activeNotes.has(pitch)) {
    return;
  }

  console.log("midi note one");

  const elapsedTime = performance.now() - recordingStartTime;
  const startTick = millisecondsToTicks(elapsedTime, recordingBpm);

  activeNotes.set(pitch, {
    startTick,
    velocity,
  });
}

export function noteOff(pitch: string): void {
  if (track === null) {
    return;
  }

  const activeNote = activeNotes.get(pitch);

  if (activeNote === undefined) {
    return;
  }

  console.log("midi note off");

  const elapsedTime = performance.now() - recordingStartTime;
  const endTick = millisecondsToTicks(elapsedTime, recordingBpm);

  const duration = endTick - activeNote.startTick;

  track.addEvent(
    new MidiWriter.NoteEvent({
      pitch,
      velocity: activeNote.velocity,
      tick: activeNote.startTick,
      duration: `T${duration}`,
    })
  );

  activeNotes.delete(pitch);
}

/** Close every note currently held by the live CV session. */
export function releaseAllNotes(): void {
  for (const pitch of activeNotes.keys()) noteOff(pitch);
}

export function stopRecording(): void {
  if (track === null) {
    return;
  }

  const elapsedTime = performance.now() - recordingStartTime;
  const endTick = millisecondsToTicks(elapsedTime, recordingBpm);

  for (const [pitch, activeNote] of activeNotes) {
    const duration = endTick - activeNote.startTick;

    track.addEvent(
      new MidiWriter.NoteEvent({
        pitch,
        velocity: activeNote.velocity,
        tick: activeNote.startTick,
        duration: `T${duration}`,
      })
    );
  }

  activeNotes.clear();
}

export function downloadMidi(): void {
  if (track === null) {
    return;
  }

  const writer = new MidiWriter.Writer(track);

  const link = document.createElement("a");
  link.href = writer.dataUri();
  link.download = "recording.mid";
  link.click();
}
