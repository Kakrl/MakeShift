import MidiWriter from "midi-writer-js";

// fix for typescript note knowing the MidiWriter types
type MidiTrack = {
  setTempo(bpm: number): void;
  addEvent(event: unknown): void;
};

let track: MidiTrack | null = null;

let recordingStartTime = 0;
let recordingBpm = 120;

function millisecondsToTicks(
  milliseconds: number,
  bpm: number
): number {
  return Math.round((milliseconds * 128 * bpm) / 60000);
}

export function startRecording(bpm: number): void {
  const newTrack = new MidiWriter.Track();

  newTrack.setTempo(bpm);

  track = newTrack;
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

  const elapsedTime =
    performance.now() - recordingStartTime;

  const tick = millisecondsToTicks(
    elapsedTime,
    recordingBpm
  );

  track.addEvent(
    new MidiWriter.NoteOnEvent({
      pitch,
      velocity,
      tick,
    })
  );
}

export function noteOff(pitch: string): void {
  if (track === null) {
    return;
  }

  const elapsedTime =
    performance.now() - recordingStartTime;

  const tick = millisecondsToTicks(
    elapsedTime,
    recordingBpm
  );

  track.addEvent(
    new MidiWriter.NoteOffEvent({
      pitch,
      tick,
    })
  );
}

// a bug exists where if the last note was not released when the recording is stopped, it will note be recorded
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