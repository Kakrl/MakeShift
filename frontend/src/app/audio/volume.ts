import { readStored, writeStored } from "../../lib/storage";

export const DEFAULT_VOLUME = 100;
export const MAX_VOLUME = 200;
export function validVolume(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value) && value >= 0 && value <= MAX_VOLUME;
}
// Quadratic travel: 100% is unity input gain; 200% supplies +12 dB before dynamics.
export function volumeGain(value: number): number {
  return (value / 100) ** 2;
}
export const loadVolume = () => readStored("piano-volume", 1, DEFAULT_VOLUME, validVolume);
export const saveVolume = (value: number) => writeStored("piano-volume", 1, value);

/** Stereo-linked compression after gain; the sample renderer retains its headroom. */
export function createPianoOutput(context: BaseAudioContext) {
  const gain = context.createGain();
  const compressor = context.createDynamicsCompressor();
  gain.gain.value = 1;
  compressor.threshold.value = -6;
  compressor.knee.value = 6;
  compressor.ratio.value = 20;
  compressor.attack.value = 0;
  compressor.release.value = 0.15;
  gain.connect(compressor);
  compressor.connect(context.destination);
  return { gain, compressor };
}

let current: number | undefined;
const listeners = new Set<() => void>();
export const volumeSnapshot = () => current ?? loadVolume();
export const serverVolumeSnapshot = () => DEFAULT_VOLUME;
export function subscribeVolume(listener: () => void) {
  listeners.add(listener);
  return () => { listeners.delete(listener); };
}
export function changeVolume(value: number) {
  if (!validVolume(value)) return { ok: false } as const;
  current = value;
  const result = saveVolume(value);
  for (const listener of listeners) listener();
  return result;
}
