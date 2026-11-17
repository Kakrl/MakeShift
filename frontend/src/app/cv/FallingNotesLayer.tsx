"use client";

import { useEffect, useRef, useSyncExternalStore, type RefObject } from "react";
import { fallingBars, keyColumns, type KeyColumn } from "../../cv/fallingNotes";
import { projectPoint, type Homography } from "../../cv/homography";
import type { KeyboardLayout } from "../../cv/keyboardLayout";
import { getPlayAlong, subscribePlayAlong } from "../midi/playAlong";

/**
 * Draws the play-along song falling onto the calibrated keyboard (#131).
 * Its own frame loop reads the timeline and the tracked homography from
 * refs, so drawing never waits on a React render.
 */
export default function FallingNotesLayer({
  homographyRef,
  videoRef,
  layout,
}: {
  homographyRef: RefObject<Homography | null>;
  videoRef: RefObject<HTMLVideoElement | null>;
  layout: KeyboardLayout;
}) {
  const playAlong = useSyncExternalStore(subscribePlayAlong, getPlayAlong, () => null);
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    const context = canvas?.getContext("2d");
    if (!playAlong || !canvas || !context) return;
    const colors = getComputedStyle(document.documentElement);
    const whiteFill = colors.getPropertyValue("--color-accent").trim();
    const blackFill = colors.getPropertyValue("--color-purple").trim();
    const edge = colors.getPropertyValue("--color-surface-dark").trim();
    let homography: Homography | null = null;
    let columns: Map<number, KeyColumn> | null = null;
    let frame = 0;

    const draw = () => {
      const video = videoRef.current;
      if (video?.videoWidth && (canvas.width !== video.videoWidth || canvas.height !== video.videoHeight)) {
        canvas.width = video.videoWidth;
        canvas.height = video.videoHeight;
      }
      context.clearRect(0, 0, canvas.width, canvas.height);
      if (homographyRef.current !== homography) {
        homography = homographyRef.current;
        const current = homography;
        columns = current ? keyColumns(layout, (point) => projectPoint(current, point)) : null;
      }
      if (columns) {
        context.lineWidth = 2;
        context.strokeStyle = edge;
        for (const bar of fallingBars(playAlong.notes, playAlong.timeline.getSnapshot().positionMs, columns)) {
          context.beginPath();
          bar.corners.forEach((corner, index) =>
            index === 0 ? context.moveTo(corner.x, corner.y) : context.lineTo(corner.x, corner.y));
          context.closePath();
          context.fillStyle = bar.black ? blackFill : whiteFill;
          context.globalAlpha = bar.sounding ? 1 : 0.8;
          context.fill();
          context.globalAlpha = 1;
          context.stroke();
        }
      }
      frame = requestAnimationFrame(draw);
    };
    frame = requestAnimationFrame(draw);
    return () => {
      cancelAnimationFrame(frame);
      context.clearRect(0, 0, canvas.width, canvas.height);
    };
  }, [playAlong, homographyRef, videoRef, layout]);

  if (!playAlong) return null;
  return (
    <canvas
      ref={canvasRef}
      width={1920}
      height={1080}
      aria-hidden="true"
      className="absolute inset-0 z-10 h-full w-full object-cover scale-x-[-1] pointer-events-none"
    />
  );
}
