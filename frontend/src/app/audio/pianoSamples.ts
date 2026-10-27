import {
  PIANO_SAMPLES,
  preparePianoSample,
} from "../../../public/audio/sampled-piano.js";

export type PianoSample = ReturnType<typeof preparePianoSample>;

/** Bounded startup loading; no note can fetch or decode a recording. */
export async function loadPianoSamples(
  context: AudioContext,
  signal: AbortSignal,
): Promise<PianoSample[]> {
  const bank: PianoSample[] = new Array(PIANO_SAMPLES.length);
  let next = 0;
  await Promise.all(
    Array.from({ length: 4 }, async () => {
      while (next < PIANO_SAMPLES.length) {
        const index = next++;
        const { note, name } = PIANO_SAMPLES[index];
        const response = await fetch(`/audio/piano-samples/${name}.mp3`, {
          signal,
        });
        if (!response.ok)
          throw new Error(
            `Could not load piano recording ${name}. Select Enable audio to retry.`,
          );
        const decoded = await context.decodeAudioData(
          await response.arrayBuffer(),
        );
        signal.throwIfAborted();
        if (decoded.sampleRate !== context.sampleRate)
          throw new Error("Piano recording sample rate mismatch");
        bank[index] = preparePianoSample(note, decoded);
      }
    }),
  );
  return bank;
}
