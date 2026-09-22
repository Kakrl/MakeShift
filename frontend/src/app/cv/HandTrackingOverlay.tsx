"use client";

import { useEffect, useRef, useState } from "react";
import { FilesetResolver, HandLandmarker } from "@mediapipe/tasks-vision";
import type { NormalizedLandmark } from "../../cv/collision";
import {
  recordCameraFrame,
  recordHandInference,
} from "../../cv/performanceMetrics";
import { drawHandLandmarks } from "./handLandmarkDrawing";

const VISION_WASM_PATH =
  "https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@latest/wasm";

export default function HandTrackingOverlay({
  videoRef,
  onLandmarks,
}: {
  videoRef: React.RefObject<HTMLVideoElement | null>;
  onLandmarks?: (hands: readonly (readonly NormalizedLandmark[])[]) => void;
}) {
  const [status, setStatus] = useState("Loading MediaPipe…");
  const [handCount, setHandCount] = useState(0);
  const [fps, setFps] = useState(0);
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    let cancelled = false;
    let animationFrame = 0;
    let handLandmarker: HandLandmarker | null = null;
    let lastHandCount = -1;
    let fpsStartTimestamp = 0;
    let fpsFrameCount = 0;

    const processFrame = (timestamp: number) => {
      const video = videoRef.current;
      const canvas = canvasRef.current;

      if (fpsStartTimestamp === 0) fpsStartTimestamp = timestamp;
      fpsFrameCount += 1;
      if (timestamp - fpsStartTimestamp >= 1000) {
        setFps(
          Math.round(
            (fpsFrameCount * 1000) / (timestamp - fpsStartTimestamp),
          ),
        );
        fpsStartTimestamp = timestamp;
        fpsFrameCount = 0;
      }

      if (!cancelled && video && canvas && video.readyState >= 2) {
        recordCameraFrame(performance.now());
        if (
          canvas.width !== video.videoWidth ||
          canvas.height !== video.videoHeight
        ) {
          canvas.width = video.videoWidth;
          canvas.height = video.videoHeight;
        }

        const context = canvas.getContext("2d");
        const inferenceStartedAt = performance.now();
        const result = handLandmarker?.detectForVideo(video, timestamp);
        if (result) {
          recordHandInference(performance.now() - inferenceStartedAt);
        }
        if (context) {
          context.clearRect(0, 0, canvas.width, canvas.height);
        }

        if (result && context) {
          drawHandLandmarks(
            context,
            result.landmarks,
            canvas.width,
            canvas.height,
          );
        }

        onLandmarks?.(result?.landmarks ?? []);

        if (result && result.landmarks.length !== lastHandCount) {
          lastHandCount = result.landmarks.length;
          setHandCount(lastHandCount);
        }
      }

      if (!cancelled) {
        animationFrame = requestAnimationFrame(processFrame);
      }
    };

    const initialize = async () => {
      try {
        const vision = await FilesetResolver.forVisionTasks(VISION_WASM_PATH);
        let createdHandLandmarker: HandLandmarker;
        let delegate = "GPU";

        try {
          createdHandLandmarker = await HandLandmarker.createFromOptions(
            vision,
            {
              baseOptions: {
                modelAssetPath: "/models/hand_landmarker.task",
                delegate: "GPU",
              },
              runningMode: "VIDEO",
              numHands: 2,
            },
          );
        } catch (gpuError) {
          console.warn(
            "GPU hand tracking is unavailable; falling back to CPU",
            gpuError,
          );
          delegate = "CPU";
          createdHandLandmarker = await HandLandmarker.createFromOptions(
            vision,
            {
              baseOptions: { modelAssetPath: "/models/hand_landmarker.task" },
              runningMode: "VIDEO",
              numHands: 2,
            },
          );
        }

        if (cancelled) {
          createdHandLandmarker.close();
          return;
        }

        handLandmarker = createdHandLandmarker;
        setStatus(`MediaPipe ready (${delegate})`);
        animationFrame = requestAnimationFrame(processFrame);
      } catch (error) {
        console.error("Unable to initialize MediaPipe hand tracking", error);
        setStatus("MediaPipe unavailable");
      }
    };

    void initialize();

    return () => {
      cancelled = true;
      cancelAnimationFrame(animationFrame);
      handLandmarker?.close();
    };
  }, [onLandmarks, videoRef]);

  return (
    <>
      <canvas
        ref={canvasRef}
        className="pointer-events-none absolute inset-0 z-10 h-full w-full object-cover"
      />
      <div className="absolute left-4 top-4 z-20 rounded bg-black/70 px-3 py-2 text-sm text-white">
        {status} · Hands: {handCount}
        <br />
        FPS: {fps}
      </div>
    </>
  );
}
