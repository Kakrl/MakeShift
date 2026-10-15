/** Test-only browser page for replaying labeled clips through the CV pipeline.
 * It is opened by the Playwright runner; it is not part of normal piano play.
 * See docs/cv_video_tests.md for setup and usage.
 */
"use client";

import { useState } from "react";
import { FilesetResolver, HandLandmarker } from "@mediapipe/tasks-vision";
import {
  buildDepthCalibrations,
  parseCvVideoCase,
  scoreTransitions,
  summarizeFramePerformance,
  transitionsFromFrames,
  type ActiveKeyFrame,
  type TimedFrameResult,
} from "../../cv/videoEvaluation";
import { getFingertips, type HandObservation } from "../../cv/collision";
import { LiveContactPipeline } from "../../cv/liveContactPipeline";
import { MarkerDetector } from "../../cv/markerDetector";
import {
  MARKER_ACQUIRE_INTERVAL_MS,
  MARKER_CHECK_INTERVAL_MS,
  PAGE_CORNERS,
} from "../../cv/calibration";
import { computeHomography, projectPoint } from "../../cv/homography";
import { getWhiteKeyPolygons } from "../../cv/keyboardGeometry";
import { DEFAULT_LAYOUT, type KeyboardLayout } from "../../cv/keyboardLayout";
import type { Point } from "../../cv/types";
import { WASM_PATH } from "../useHandLandmarker";

const VISION_MODEL = "/models/hand_landmarker.task";

function layoutFromCase(layoutId: string, startingMidiNote: number): KeyboardLayout {
  const octaves = layoutId.includes("three") ? 3 : layoutId.includes("two") ? 2 : 1;
  return { ...DEFAULT_LAYOUT, octaves, startingMidi: startingMidiNote,
    whiteKeys: octaves * 7 + 1 };
}

function waitForEvent(target: EventTarget, name: string) {
  return new Promise<void>((resolve, reject) => {
    const done = () => { cleanup(); resolve(); };
    const fail = () => { cleanup(); reject(new Error(`Video ${name} failed`)); };
    const cleanup = () => {
      target.removeEventListener(name, done);
      target.removeEventListener("error", fail);
    };
    target.addEventListener(name, done, { once: true });
    target.addEventListener("error", fail, { once: true });
  });
}

async function seekFrame(video: HTMLVideoElement, timeMs: number) {
  const target = Math.min(timeMs / 1000, Math.max(0, video.duration - 0.001));
  if (Math.abs(video.currentTime - target) < 0.0001) return;
  const seeked = waitForEvent(video, "seeked");
  video.currentTime = target;
  await seeked;
}

export default function CvVideoReplayPage() {
  const [status, setStatus] = useState("Choose an MP4 and its JSON sidecar.");
  const [result, setResult] = useState<string>("");

  async function runReplay() {
    const videoFile = (document.querySelector("#clip") as HTMLInputElement).files?.[0];
    const sidecarFile = (document.querySelector("#sidecar") as HTMLInputElement).files?.[0];
    if (!videoFile || !sidecarFile) throw new Error("Choose both files first");
    const videoCase = parseCvVideoCase(JSON.parse(await sidecarFile.text()));
    const url = URL.createObjectURL(videoFile);
    const video = document.querySelector("#video") as HTMLVideoElement;
    let landmarker: HandLandmarker | null = null;
    let handLandmarkerDelegate: "GPU" | "CPU" = "GPU";
    let markerDetector: MarkerDetector | null = null;
    let pipeline: LiveContactPipeline | null = null;
    let replayTimeMs = 0;
    const keys: ActiveKeyFrame[] = [];
    const timings: TimedFrameResult<null>[] = [];
    try {
      const metadataLoaded = waitForEvent(video, "loadedmetadata");
      video.src = url;
      await metadataLoaded;
      await video.play();
      video.pause();

      const handVision = await FilesetResolver.forVisionTasks(WASM_PATH);
      try {
        landmarker = await HandLandmarker.createFromOptions(handVision, {
          baseOptions: { modelAssetPath: VISION_MODEL, delegate: "GPU" },
          runningMode: "VIDEO", numHands: 2,
        });
      } catch (gpuError) {
        console.warn("GPU hand tracking unavailable; falling back to CPU", gpuError);
        handLandmarkerDelegate = "CPU";
        landmarker = await HandLandmarker.createFromOptions(handVision, {
          baseOptions: { modelAssetPath: VISION_MODEL },
          runningMode: "VIDEO", numHands: 2,
        });
      }
      markerDetector = await MarkerDetector.create();
      const canvas = document.querySelector("#frame") as HTMLCanvasElement;
      canvas.width = video.videoWidth;
      canvas.height = video.videoHeight;
      const context = canvas.getContext("2d", { willReadFrequently: true });
      if (!context) throw new Error("Unable to create video frame canvas");

      const layout = layoutFromCase(videoCase.calibration.keyboard.layoutId,
        videoCase.calibration.keyboard.startingMidiNote);
      const depthModels = buildDepthCalibrations(videoCase);
      pipeline = new LiveContactPipeline({
        onContactsChanged: () => undefined,
        onShadowCameraPreview: () => undefined,
        onShadowPreview: () => undefined,
        onError: (message) => { throw new Error(message); },
      }, undefined, () => replayTimeMs);
      const lastFrame = Math.floor((video.duration - 0.001) * videoCase.framesPerSecond);
      const labeledStart = videoCase.annotation.fullyLabeledRange.startFrame;
      const labeledEnd = videoCase.annotation.fullyLabeledRange.endFrame;
      if (labeledEnd > lastFrame) {
        throw new Error(`Labeled end frame ${labeledEnd} exceeds clip frame ${lastFrame}`);
      }
      setStatus(`Replaying ${lastFrame + 1} frames through MediaPipe and CV (${handLandmarkerDelegate})...`);

      const frameStages: Array<{
        frame: number;
        mediaTimeMs: number;
        seekMs: number;
        markerMs: number;
        geometryMs: number;
        inferenceMs: number;
        contactMs: number;
        totalCvMs: number;
      }> = [];
      let lastMarkerDetectionMs = -Infinity;
      let markerAcquired = false;
      let markerDetectionCount = 0;
      let cachedWhiteKeys: Point[][] | null = null;
      const replayStartedMs = performance.now();
      for (let frame = 0; frame <= lastFrame; frame += 1) {
        const mediaTimeMs = frame * 1000 / videoCase.framesPerSecond;
        const seekStartedMs = performance.now();
        await seekFrame(video, mediaTimeMs);
        const seekMs = performance.now() - seekStartedMs;
        replayTimeMs = mediaTimeMs;
        const wallStartMs = performance.now();
        let markerMs = 0;
        let geometryMs = 0;
        const markerIntervalMs = markerAcquired
          ? MARKER_CHECK_INTERVAL_MS : MARKER_ACQUIRE_INTERVAL_MS;
        if (mediaTimeMs - lastMarkerDetectionMs >= markerIntervalMs) {
          context.drawImage(video, 0, 0, canvas.width, canvas.height);
          const markerStartedMs = performance.now();
          const markers = markerDetector.detect(canvas);
          markerMs = performance.now() - markerStartedMs;
          markerDetectionCount += 1;
          lastMarkerDetectionMs = mediaTimeMs;
          const markerCenters = [0, 1, 2, 3].map((id) =>
            markers.observations.find((observation) => observation.id === id)?.center,
          );
          const geometryStartedMs = performance.now();
          if (markerCenters.every((point): point is Point => point !== undefined)) {
            const homography = computeHomography(PAGE_CORNERS, markerCenters);
            if (homography) {
              const candidateKeys = getWhiteKeyPolygons(layout).map((key) =>
                key.map((point) => projectPoint(homography, point)),
              );
              if (candidateKeys.every((key) =>
                key.every((point): point is Point => point !== null))) {
                cachedWhiteKeys = candidateKeys as Point[][];
                markerAcquired = true;
              }
            }
          }
          geometryMs = performance.now() - geometryStartedMs;
        }
        const whiteKeys = cachedWhiteKeys;
        const inferenceStartMs = performance.now();
        const prediction = landmarker.detectForVideo(video, mediaTimeMs);
        const inferenceMs = performance.now() - inferenceStartMs;
        const hands: HandObservation[] = prediction.landmarks.map((landmarks, index) => ({
          landmarks,
          handedness: prediction.handedness[index]?.[0]?.categoryName === "Left"
            ? "Left" : prediction.handedness[index]?.[0]?.categoryName === "Right"
              ? "Right" : "Unknown",
        }));
        const fingertips = getFingertips(hands.map((hand) => hand.landmarks),
          video.videoWidth, video.videoHeight);
        const contactStartedMs = performance.now();
        pipeline.processFrame({ video, hands, fingertips, whiteKeys,
          calibration: depthModels.Right ?? depthModels.Left,
          previewFingerId: null });
        const wallEndMs = performance.now();
        const contactMs = wallEndMs - contactStartedMs;
        timings.push({ frame, mediaTimeMs, wallStartMs, wallEndMs,
          processMs: wallEndMs - wallStartMs, inferenceMs, result: null });
        frameStages.push({ frame, mediaTimeMs, seekMs, markerMs, geometryMs,
          inferenceMs, contactMs, totalCvMs: wallEndMs - wallStartMs });
        const activeKeyIndexes = new Set<number>();
        for (const [id, contact] of pipeline.contacts) {
          if (!contact.active) continue;
          for (const key of pipeline.gates.get(id)?.keyIndexes ?? [])
            activeKeyIndexes.add(key);
        }
        keys.push({ frame, mediaTimeMs, activeKeyIndexes: [...activeKeyIndexes] });
        if (frame % 10 === 0 || frame === lastFrame)
          setStatus(`Processed frame ${frame + 1} / ${lastFrame + 1}`);
      }
      const transitions = transitionsFromFrames(keys).filter((transition) =>
        transition.frame >= labeledStart && transition.frame <= labeledEnd,
      );
      const replayElapsedMs = performance.now() - replayStartedMs;
      const graphicsCanvas = document.createElement("canvas");
      const graphics = graphicsCanvas.getContext("webgl2") ??
        graphicsCanvas.getContext("webgl");
      const debugInfo = graphics?.getExtension("WEBGL_debug_renderer_info");
      const output = { clip: videoCase.video, processedFrames: lastFrame + 1,
        runtime: {
          handLandmarkerDelegate,
          webGlAvailable: graphics !== null,
          webGlVendor: debugInfo ? graphics?.getParameter(debugInfo.UNMASKED_VENDOR_WEBGL) : null,
          webGlRenderer: debugInfo ? graphics?.getParameter(debugInfo.UNMASKED_RENDERER_WEBGL) : null,
        },
        transitions,
        scores: scoreTransitions(videoCase.events, transitions, 1),
        performance: { ...summarizeFramePerformance(timings),
          replayElapsedMs,
          replayFps: (lastFrame + 1) * 1000 / replayElapsedMs,
          steadyStateReplayFps: frameStages.length > 1
            ? (frameStages.length - 1) * 1000 /
              (replayElapsedMs - frameStages[0].seekMs - frameStages[0].totalCvMs)
            : null,
          markerDetectionCount,
          markerAcquired,
          markerAcquireIntervalMs: MARKER_ACQUIRE_INTERVAL_MS,
          markerCheckIntervalMs: MARKER_CHECK_INTERVAL_MS,
          frameStages },
        contactTechniques: pipeline.techniques,
        replayMode: "ordered-paused-frame-stepping-with-live-marker-cadence" };
      setResult(JSON.stringify(output, null, 2));
      setStatus("Replay complete");
    } finally {
      pipeline?.dispose();
      markerDetector?.dispose();
      landmarker?.close();
      URL.revokeObjectURL(url);
    }
  }

  return <main style={{ padding: 24 }}>
    <h1>CV video replay</h1>
    <p>Paused frame stepping; each decoded frame is processed in order by MediaPipe and the live contact pipeline.</p>
    <label>Video <input id="clip" type="file" accept="video/mp4,video/*" /></label>
    <label style={{ marginLeft: 16 }}>Sidecar <input id="sidecar" type="file" accept="application/json,.json" /></label>
    <button type="button" onClick={() => void runReplay().catch((error: unknown) =>
      setStatus(`Replay failed: ${error instanceof Error ? error.message : String(error)}`))}>
      Run replay
    </button>
    <p role="status">{status}</p>
    <video id="video" muted playsInline style={{ maxWidth: 640 }} />
    <canvas id="frame" hidden />
    <pre>{result}</pre>
  </main>;
}
