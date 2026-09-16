"use client";

import { useEffect, useRef, useState } from "react";
import type { Point, Size } from "./coverGeometry";

/** Landmark indices for the five fingertips, thumb through pinky. */
export const FINGERTIP_LANDMARKS = [4, 8, 12, 16, 20];

/** ~15fps. Detection is far more expensive than the display refresh. */
const FRAME_INTERVAL_MS = 1000 / 15;

/** Samples kept for the stability check, about one second at 15fps. */
const HISTORY = 15;

export interface HandSample {
  /** Hands found in the most recent frame. */
  hands: number;
  /** Fingertips in source-frame normalized coordinates, 0 to 1. */
  fingertips: Point[];
  /** Video frame size the fingertips were normalized against. */
  frame: Size;
}

export interface LiveHandState extends HandSample {
  /**
   * True when the hand count has held steady across the whole history window.
   * A wavering count means the user is still moving or the lighting is
   * marginal, and calibrating off that would store a bad profile.
   */
  stable: boolean;
}

const EMPTY: LiveHandState = {
  hands: 0,
  fingertips: [],
  frame: { width: 0, height: 0 },
  stable: false,
};

type DetectFn = (
  video: HTMLVideoElement,
  timestamp: number,
) => { landmarks?: { x: number; y: number }[][] } | null;

/**
 * Runs hand detection against the live preview while `enabled` is set, and
 * stops the loop as soon as it clears. Nothing is captured or frozen: the
 * caller draws the returned fingertips straight over the video.
 */
export function useLiveHandLandmarks(
  videoRef: React.RefObject<HTMLVideoElement | null>,
  detectForVideo: DetectFn,
  enabled: boolean,
): LiveHandState {
  const [state, setState] = useState<LiveHandState>(EMPTY);

  // Kept in refs so the loop does not restart on every sample.
  const historyRef = useRef<number[]>([]);
  const lastRunRef = useRef(0);
  const lastTimestampRef = useRef(0);

  // Reset the moment `enabled` flips, so re-entering the step cannot flash the
  // dots from the previous visit before the first fresh sample lands. Deriving
  // this during render rather than in an effect avoids rendering the stale
  // frame at all.
  const [prevEnabled, setPrevEnabled] = useState(enabled);
  if (prevEnabled !== enabled) {
    setPrevEnabled(enabled);
    setState(EMPTY);
  }

  useEffect(() => {
    if (!enabled) {
      historyRef.current = [];
      return;
    }

    let frame = 0;
    let cancelled = false;

    const tick = (now: number) => {
      frame = requestAnimationFrame(tick);
      if (cancelled) return;
      if (now - lastRunRef.current < FRAME_INTERVAL_MS) return;
      lastRunRef.current = now;

      const video = videoRef.current;
      if (!video || !video.videoWidth || !video.videoHeight) return;

      // MediaPipe rejects a timestamp that does not advance.
      const timestamp = Math.max(now, lastTimestampRef.current + 1);
      lastTimestampRef.current = timestamp;

      let result;
      try {
        result = detectForVideo(video, timestamp);
      } catch {
        // A detector closed mid-frame throws; the next enable rebuilds it.
        return;
      }
      if (!result) return;

      const hands = result.landmarks?.length ?? 0;
      const fingertips: Point[] = [];
      for (const hand of result.landmarks ?? []) {
        for (const index of FINGERTIP_LANDMARKS) {
          const pt = hand[index];
          if (pt) fingertips.push({ x: pt.x, y: pt.y });
        }
      }

      const history = historyRef.current;
      history.push(hands);
      if (history.length > HISTORY) history.shift();
      const stable =
        history.length === HISTORY && history.every((h) => h === hands);

      setState({
        hands,
        fingertips,
        frame: { width: video.videoWidth, height: video.videoHeight },
        stable,
      });
    };

    frame = requestAnimationFrame(tick);
    return () => {
      cancelled = true;
      cancelAnimationFrame(frame);
      historyRef.current = [];
    };
  }, [enabled, videoRef, detectForVideo]);

  return enabled ? state : EMPTY;
}
