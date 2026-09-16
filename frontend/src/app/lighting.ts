/**
 * Frame brightness sampling for the lighting calibration step.
 *
 * A webcam cannot report lux, so we score the frame itself: mean relative
 * luminance over a downscaled copy. Too dark and the hand landmarker loses
 * fingertips; too bright and the paper blows out and its edges disappear.
 */

/** Sample grid. Small enough to be cheap, large enough to survive noise. */
const SAMPLE_WIDTH = 64;
const SAMPLE_HEIGHT = 36;

export const MIN_BRIGHTNESS = 0.25;
export const MAX_BRIGHTNESS = 0.75;

export type LightingVerdict = "dark" | "ok" | "bright";

export interface LightingReading {
  /** Mean relative luminance, 0 (black) to 1 (white). */
  brightness: number;
  verdict: LightingVerdict;
}

export function classifyBrightness(brightness: number): LightingVerdict {
  if (brightness < MIN_BRIGHTNESS) return "dark";
  if (brightness > MAX_BRIGHTNESS) return "bright";
  return "ok";
}

export const LIGHTING_MESSAGES: Record<LightingVerdict, string> = {
  dark: "Too dim. Add light or move somewhere brighter.",
  ok: "Lighting looks good!",
  bright: "Too bright. Reduce glare or move away from direct light.",
};

/**
 * Draws the current video frame into a small scratch canvas and averages its
 * luminance. Returns null while the video has no usable frame.
 */
export function readFrameBrightness(
  video: HTMLVideoElement,
  scratch: HTMLCanvasElement,
): LightingReading | null {
  if (!video.videoWidth || !video.videoHeight) return null;

  const ctx = scratch.getContext("2d", { willReadFrequently: true });
  if (!ctx) return null;

  scratch.width = SAMPLE_WIDTH;
  scratch.height = SAMPLE_HEIGHT;
  ctx.drawImage(video, 0, 0, SAMPLE_WIDTH, SAMPLE_HEIGHT);

  const { data } = ctx.getImageData(0, 0, SAMPLE_WIDTH, SAMPLE_HEIGHT);
  let total = 0;
  for (let i = 0; i < data.length; i += 4) {
    // Rec. 709 relative luminance, which tracks perceived brightness far
    // better than a flat RGB average.
    total += 0.2126 * data[i] + 0.7152 * data[i + 1] + 0.0722 * data[i + 2];
  }

  const brightness = total / (SAMPLE_WIDTH * SAMPLE_HEIGHT) / 255;
  return { brightness, verdict: classifyBrightness(brightness) };
}
