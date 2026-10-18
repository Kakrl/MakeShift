/** Test-only browser page for replaying labeled clips through the CV pipeline.
 * It is opened by the Playwright runner; it is not part of normal piano play.
 * See docs/cv_video_tests.md for setup and usage.
 */
"use client";

import { useRef, useState } from "react";
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
import { toPersistedDepthCalibration } from "../../cv/depthCalibration";
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
const FINGER_LABELS = ["thumb", "index", "middle", "ring", "pinky"] as const;

interface ReplayVisualFrame {
  frame: number;
  mediaTimeMs: number;
  whiteKeys: Point[][] | null;
  activeKeyIndexes: number[];
  fingertips: Array<{
    point: Point;
    active: boolean;
    candidate: boolean;
    eligible: boolean;
  }>;
  shadowCandidates: number;
}

type ManualReplayAction = "pause" | "resume" | "next" | "previous";

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
  const [manualReview, setManualReview] = useState(false);
  const [manualPlaying, setManualPlaying] = useState(false);
  const [displayedFrame, setDisplayedFrame] = useState(-1);
  const [captureLabel, setCaptureLabel] = useState<"hover" | "press" | null>(null);
  const [captureInterests, setCaptureInterests] = useState<string[]>([]);
  const manualControlRef = useRef({
    playing: false,
    action: null as ManualReplayAction | null,
    wake: null as (() => void) | null,
  });

  function sendManualAction(action: ManualReplayAction) {
    const control = manualControlRef.current;
    control.action = action;
    if (action === "resume") {
      control.playing = true;
      setManualPlaying(true);
    } else {
      control.playing = false;
      setManualPlaying(false);
    }
    control.wake?.();
  }

  function captureLabeledFrame(
    label: "hover" | "press",
    fingerInterests: readonly string[],
  ) {
    const video = document.querySelector("#video") as HTMLVideoElement | null;
    if (
      !video ||
      video.readyState < 2 ||
      video.videoWidth === 0 ||
      fingerInterests.length === 0
    )
      return;
    const capture = document.createElement("canvas");
    capture.width = video.videoWidth;
    capture.height = video.videoHeight;
    const context = capture.getContext("2d");
    if (!context) return;
    // Keep the training/evaluation image free of rendered diagnostic marks.
    context.drawImage(video, 0, 0, capture.width, capture.height);
    const frame = Math.max(0, displayedFrame);
    const timestampMs = Math.round(video.currentTime * 1000);
    const interestTag = [...fingerInterests].sort().join("+");
    const link = document.createElement("a");
    link.download = `${label}_${interestTag}_frame_${String(frame).padStart(6, "0")}_${timestampMs}ms.png`;
    link.href = capture.toDataURL("image/png");
    link.click();
  }

  async function runReplay() {
    const videoFile = (document.querySelector("#clip") as HTMLInputElement).files?.[0];
    const sidecarFile = (document.querySelector("#sidecar") as HTMLInputElement).files?.[0];
    if (!videoFile || !sidecarFile) throw new Error("Choose both files first");
    const videoCase = parseCvVideoCase(JSON.parse(await sidecarFile.text()));
    const searchParams = new URLSearchParams(window.location.search);
    const manual = searchParams.get("manual") === "1";
    setManualReview(manual);
    setManualPlaying(false);
    setDisplayedFrame(-1);
    manualControlRef.current = { playing: false, action: null, wake: null };
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
      const replayOverlay = document.querySelector(
        "#replay-overlay",
      ) as HTMLCanvasElement;
      replayOverlay.width = video.videoWidth;
      replayOverlay.height = video.videoHeight;
      const replayOverlayContext = replayOverlay.getContext("2d");
      const overlayStyle = getComputedStyle(document.documentElement);
      const overlayColors = {
        ink: overlayStyle.getPropertyValue("--color-ink").trim(),
        danger: overlayStyle.getPropertyValue("--color-danger").trim(),
        blue: overlayStyle.getPropertyValue("--color-blue").trim(),
        green: overlayStyle.getPropertyValue("--color-green").trim(),
        muted: overlayStyle.getPropertyValue("--color-ink-muted").trim(),
      };
      const drawReplayOverlay = (state: ReplayVisualFrame) => {
        if (!replayOverlayContext || (!manual && visualReplayDelayMs <= 0))
          return;
        replayOverlayContext.clearRect(
          0,
          0,
          replayOverlay.width,
          replayOverlay.height,
        );
        replayOverlayContext.lineWidth = 3;
        state.whiteKeys?.forEach((key, index) => {
          replayOverlayContext.beginPath();
          key.forEach((point, pointIndex) => {
            if (pointIndex === 0)
              replayOverlayContext.moveTo(point.x, point.y);
            else replayOverlayContext.lineTo(point.x, point.y);
          });
          replayOverlayContext.closePath();
          const active = state.activeKeyIndexes.includes(index);
          replayOverlayContext.strokeStyle = active
            ? overlayColors.danger
            : overlayColors.ink;
          replayOverlayContext.fillStyle = active
            ? overlayColors.danger
            : overlayColors.ink;
          replayOverlayContext.globalAlpha = active ? 0.42 : 0.12;
          replayOverlayContext.fill();
          replayOverlayContext.globalAlpha = 0.85;
          replayOverlayContext.stroke();
        });
        replayOverlayContext.globalAlpha = 1;
        const pointRadius = Math.max(5, video.videoWidth / 180);
        for (const fingertip of state.fingertips) {
          replayOverlayContext.beginPath();
          replayOverlayContext.arc(
            fingertip.point.x,
            fingertip.point.y,
            pointRadius,
            0,
            Math.PI * 2,
          );
          replayOverlayContext.fillStyle = fingertip.active
            ? overlayColors.danger
            : fingertip.candidate
              ? overlayColors.green
              : fingertip.eligible
                ? overlayColors.blue
                : overlayColors.muted;
          replayOverlayContext.fill();
        }
      };
      const context = canvas.getContext("2d", { willReadFrequently: true });
      if (!context) throw new Error("Unable to create video frame canvas");
      const backgroundCanvas = document.createElement("canvas");

      const layout = layoutFromCase(videoCase.calibration.keyboard.layoutId,
        videoCase.calibration.keyboard.startingMidiNote);
      const depthModels = toPersistedDepthCalibration(
        buildDepthCalibrations(videoCase),
      );
      const technique = searchParams.get("technique");
      const frameDelayMs = Number(searchParams.get("frameDelayMs") ?? 0);
      const visualReplayDelayMs = Number.isFinite(frameDelayMs)
        ? Math.max(0, Math.min(frameDelayMs, 5000))
        : 0;
      const synchronousShadowExperiment = technique === "synchronous-shadow" ||
        technique === "synchronous-shadow-no-knuckles";
      const knucklesEnabled = technique !== "synchronous-shadow-no-knuckles";
      pipeline = new LiveContactPipeline({
        onContactsChanged: () => undefined,
        onShadowCameraPreview: () => undefined,
        onShadowPreview: () => undefined,
        onError: (message) => { throw new Error(message); },
      }, synchronousShadowExperiment
        ? {
            knuckles: knucklesEnabled,
            shadows: false,
            synchronousShadows: true,
          }
        : undefined, () => replayTimeMs);
      pipeline.start();
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
        synchronousShadowSamples: number;
        synchronousShadowCandidates: number;
      }> = [];
      let lastMarkerDetectionMs = -Infinity;
      let markerAcquired = false;
      let markerDetectionCount = 0;
      let shadowSamplesSubmitted = 0;
      let synchronousShadowSamples = 0;
      let synchronousShadowCandidates = 0;
      let cachedWhiteKeys: Point[][] | null = null;
      const visualFrames: ReplayVisualFrame[] = [];
      let displayCursor = -1;
      const showCachedFrame = async (index: number) => {
        const state = visualFrames[index];
        if (!state) return;
        await seekFrame(video, state.mediaTimeMs);
        drawReplayOverlay(state);
        displayCursor = index;
        setDisplayedFrame(index);
        const activeKeys = [...state.activeKeyIndexes].sort((a, b) => a - b);
        setStatus(
          `Frame ${state.frame + 1} / ${lastFrame + 1} · active keys: ${activeKeys.length ? activeKeys.join(", ") : "none"} · shadow candidates: ${state.shadowCandidates}`,
        );
      };
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
                if (markers.missingIds.length === 0) {
                  if (backgroundCanvas.width !== canvas.width)
                    backgroundCanvas.width = canvas.width;
                  if (backgroundCanvas.height !== canvas.height)
                    backgroundCanvas.height = canvas.height;
                  backgroundCanvas.getContext("2d")?.drawImage(canvas, 0, 0);
                }
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
        if (pipeline.processFrame({ video,
          background: markerAcquired ? backgroundCanvas : null,
          hands, fingertips, whiteKeys,
          calibration: depthModels,
          previewFingerId: null })) shadowSamplesSubmitted += 1;
        for (const measurement of pipeline.synchronousMeasurements.values()) {
          synchronousShadowSamples += 1;
          if (measurement.state === "press candidate")
            synchronousShadowCandidates += 1;
        }
        const wallEndMs = performance.now();
        const contactMs = wallEndMs - contactStartedMs;
        const frameSynchronousSamples = pipeline.synchronousMeasurements.size;
        const frameSynchronousCandidates = [...pipeline.synchronousMeasurements.values()]
          .filter((measurement) => measurement.state === "press candidate").length;
        timings.push({ frame, mediaTimeMs, wallStartMs, wallEndMs,
          processMs: wallEndMs - wallStartMs, inferenceMs, result: null });
        frameStages.push({ frame, mediaTimeMs, seekMs, markerMs, geometryMs,
          inferenceMs, contactMs, totalCvMs: wallEndMs - wallStartMs,
          synchronousShadowSamples: frameSynchronousSamples,
          synchronousShadowCandidates: frameSynchronousCandidates });
        const activeKeyIndexes = new Set<number>();
        for (const [id, contact] of pipeline.contacts) {
          if (!contact.active) continue;
          for (const key of pipeline.gates.get(id)?.keyIndexes ?? [])
            activeKeyIndexes.add(key);
        }
        const visualState: ReplayVisualFrame = {
          frame,
          mediaTimeMs,
          whiteKeys,
          activeKeyIndexes: [...activeKeyIndexes],
          fingertips: fingertips.map((fingertip) => ({
            point: fingertip.point,
            active: pipeline?.contacts.get(fingertip.id)?.active ?? false,
            candidate: pipeline?.synchronousMeasurements.get(
              fingertip.id,
            )?.state === "press candidate",
            eligible: pipeline?.gates.get(fingertip.id)?.knuckleEligible ?? false,
          })),
          shadowCandidates: frameSynchronousCandidates,
        };
        visualFrames.push(visualState);
        displayCursor = frame;
        setDisplayedFrame(frame);
        drawReplayOverlay(visualState);
        keys.push({ frame, mediaTimeMs, activeKeyIndexes: [...activeKeyIndexes] });
        if (manual) {
          setStatus(
            `Frame ${frame + 1} / ${lastFrame + 1} · active keys: ${activeKeyIndexes.size ? [...activeKeyIndexes].sort((a, b) => a - b).join(", ") : "none"} · shadow candidates: ${frameSynchronousCandidates}`,
          );
          let continueProcessing = false;
          while (!continueProcessing) {
            const control = manualControlRef.current;
            if (control.playing) {
              await new Promise((resolve) => window.setTimeout(resolve, 33));
              if (!manualControlRef.current.playing) continue;
              if (displayCursor < frame) {
                await showCachedFrame(displayCursor + 1);
                continue;
              }
              continueProcessing = true;
              continue;
            }
            const action = control.action ?? await new Promise<ManualReplayAction>(
              (resolve) => {
                control.wake = () => {
                  const pendingAction = control.action ?? "pause";
                  control.action = null;
                  control.wake = null;
                  resolve(pendingAction);
                };
              },
            );
            control.action = null;
            if (action === "previous" && displayCursor > 0) {
              await showCachedFrame(displayCursor - 1);
            } else if (action === "next") {
              if (displayCursor < frame)
                await showCachedFrame(displayCursor + 1);
              else continueProcessing = true;
            }
          }
        } else if (visualReplayDelayMs > 0) {
          const activeKeys = [...activeKeyIndexes].sort((a, b) => a - b);
          setStatus(
            `Frame ${frame + 1} / ${lastFrame + 1} · active keys: ${activeKeys.length ? activeKeys.join(", ") : "none"} · shadow candidates: ${frameSynchronousCandidates}`,
          );
          await new Promise((resolve) =>
            window.setTimeout(resolve, visualReplayDelayMs),
          );
        } else if (frame % 10 === 0 || frame === lastFrame) {
          setStatus(`Processed frame ${frame + 1} / ${lastFrame + 1}`);
        }
      }
      const transitions = transitionsFromFrames(keys).filter((transition) =>
        transition.frame >= labeledStart && transition.frame <= labeledEnd,
      );
      const replayElapsedMs = performance.now() - replayStartedMs;
      const synchronousContactTimes = frameStages
        .filter((stage) => stage.synchronousShadowSamples > 0)
        .map((stage) => stage.contactMs)
        .sort((a, b) => a - b);
      const percentile = (fraction: number) => synchronousContactTimes.length
        ? synchronousContactTimes[Math.floor((synchronousContactTimes.length - 1) * fraction)]
        : null;
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
          visualReplayFrameDelayMs: visualReplayDelayMs,
          steadyStateReplayFps: frameStages.length > 1
            ? (frameStages.length - 1) * 1000 /
              (replayElapsedMs - frameStages[0].seekMs - frameStages[0].totalCvMs)
            : null,
          markerDetectionCount,
          shadowSamplesSubmitted,
          synchronousShadowSamples,
          synchronousShadowCandidates,
          backgroundCaptured: backgroundCanvas.width > 0 && backgroundCanvas.height > 0,
          synchronousContactMs: {
            sampledFrames: synchronousContactTimes.length,
            median: percentile(0.5),
            p95: percentile(0.95),
            max: synchronousContactTimes.at(-1) ?? null,
          },
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
    {manualReview && (
      <div style={{ display: "flex", gap: 8, marginTop: 12, marginBottom: 12 }}>
        <button
          type="button"
          onClick={() => sendManualAction(manualPlaying ? "pause" : "resume")}
        >
          {manualPlaying ? "Pause" : "Resume"}
        </button>
        <button
          type="button"
          disabled={displayedFrame <= 0}
          onClick={() => sendManualAction("previous")}
        >
          Previous frame
        </button>
        <button
          type="button"
          onClick={() => sendManualAction("next")}
        >
          Next frame
        </button>
        <button
          type="button"
          onClick={() => {
            setCaptureLabel("hover");
            setCaptureInterests([]);
          }}
        >
          Capture hover
        </button>
        <button
          type="button"
          onClick={() => {
            setCaptureLabel("press");
            setCaptureInterests([]);
          }}
        >
          Capture press
        </button>
      </div>
    )}
    {manualReview && captureLabel && (
      <form
        onSubmit={(event) => {
          event.preventDefault();
          captureLabeledFrame(captureLabel, captureInterests);
          setCaptureLabel(null);
        }}
        style={{ border: "1px solid currentColor", padding: 12, marginBottom: 12 }}
      >
        <p>
          Label this {captureLabel} image. The full raw frame is saved so the
          hand and joints remain available for later tests.
        </p>
        {(["left", "right"] as const).map((hand) => (
          <fieldset key={hand} style={{ display: "inline-block", marginRight: 16 }}>
            <legend>{hand === "left" ? "Left hand" : "Right hand"}</legend>
            {FINGER_LABELS.map((finger) => {
              const id = `${hand}-${finger}`;
              return (
                <label key={id} style={{ display: "block" }}>
                  <input
                    type="checkbox"
                    checked={captureInterests.includes(id)}
                    onChange={() => setCaptureInterests((current) =>
                      current.includes(id)
                        ? current.filter((selected) => selected !== id)
                        : [...current, id],
                    )}
                  />
                  {` ${finger}`}
                </label>
              );
            })}
          </fieldset>
        ))}
        <div style={{ display: "flex", gap: 8, marginTop: 8 }}>
          <button type="submit" disabled={captureInterests.length === 0}>
            Save labeled image
          </button>
          <button type="button" onClick={() => setCaptureLabel(null)}>
            Cancel
          </button>
        </div>
      </form>
    )}
    <p role="status">{status}</p>
    <div
      style={{ position: "relative", display: "inline-block", maxWidth: 640, width: "100%" }}
    >
      <video
        id="video"
        muted
        playsInline
        style={{ display: "block", width: "100%" }}
      />
      <canvas
        id="replay-overlay"
        aria-hidden="true"
        style={{
          position: "absolute",
          inset: 0,
          width: "100%",
          height: "100%",
          pointerEvents: "none",
        }}
      />
    </div>
    <canvas id="frame" hidden />
    <pre>{result}</pre>
  </main>;
}
