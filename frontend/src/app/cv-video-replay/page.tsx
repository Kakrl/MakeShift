/** Test-only browser page for replaying labeled clips through the CV pipeline.
 * It is opened by the Playwright runner; it is not part of normal piano play.
 * See docs/cv_video_tests.md for setup and usage.
 */
"use client";

import Link from "next/link";

import { useEffect, useRef, useState } from "react";
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
  markerCorners,
} from "../../cv/calibration";
import { computeHomography, invertHomography, projectPoint, type Homography } from "../../cv/homography";
import { getWhiteKeyPolygons } from "../../cv/keyboardGeometry";
import { detectShadowBaseline, shadowAnalysisSize, SHADOW_BASELINE_CUTOFFS, type ShadowBaselineCutoff } from "../../cv/liveShadowBaseline";
import { DEFAULT_LAYOUT, type KeyboardLayout } from "../../cv/keyboardLayout";
import type { Point } from "../../cv/types";
import ShadowFilterControls from "../ShadowFilterControls";
import { DEFAULT_DARK_SHADOW_FILTER, analyzeDarkShadowRegion, darkShadowRuns, measureShadowEvidence, compareShadowEvidence, type ShadowEvidence } from "../../cv/darkShadowRegion";
import { WASM_PATH } from "../useHandLandmarker";

import ReplayHeatmapPanel from "./ReplayHeatmapPanel";
import ReplayEvidencePanel from "./ReplayEvidencePanel";
import ReplayShadowBaselinePanel from "./ReplayShadowBaselinePanel";
import { baselineSnapshot, shadowPixelFingerprint, type BaselineSnapshot } from "../../cv/shadowBaselineDiagnostics";
import styles from "./replay.module.css";

const VISION_MODEL = "/models/hand_landmarker.task";
const FINGER_LABELS = ["thumb", "index", "middle", "ring", "pinky"] as const;

export interface ReplayVisualFrame {
  frame: number;
  mediaTimeMs: number;
  whiteKeys: Point[][] | null;
  activeKeyIndexes: number[];
  fingertips: Array<{
    id: string;
    point: Point;
    darkRuns: Array<[number, number, number]>;
    evidence: ShadowEvidence | null;
    change: ReturnType<typeof compareShadowEvidence> | null;
    deltaY: number | null;
    active: boolean;
    candidate: boolean;
    eligible: boolean;
  }>;
  shadowCandidates: number;
  heatmapReferenceId: number | null;
  baseline?: {
    cutoff: ShadowBaselineCutoff; frameToSheet: Homography | null;
    frameWidth: number; frameHeight: number; layout: KeyboardLayout;
    sourceFingerprint: string | null; candidates: BaselineSnapshot[];
  };
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
  const [baselineMode, setBaselineMode] = useState(false);
  const [diagnosticView, setDiagnosticView] = useState("heatmap");
  const diagnosticViewRef = useRef("heatmap");
  const heatmapReferences = useRef(new Map<number, ImageData>());
  const [selectedFinger, setSelectedFinger] = useState<string | null>(null);
  const selectedFingerRef = useRef<string | null>(null);
  const historyRef = useRef<ReplayVisualFrame[]>([]);
  const redrawRef = useRef<((frame: ReplayVisualFrame) => void) | null>(null);
  const [filter, setFilter] = useState(DEFAULT_DARK_SHADOW_FILTER);
  const [runFilter, setRunFilter] = useState(DEFAULT_DARK_SHADOW_FILTER);
  const [status, setStatus] = useState("Choose an MP4 and its JSON sidecar.");
  const [result, setResult] = useState<string>("");
  const [manualReview, setManualReview] = useState(false);
  const [manualPlaying, setManualPlaying] = useState(false);
  const [sampleSource, setSampleSource] = useState({ id: "", name: "" });
  const [evidenceFrame, setEvidenceFrame] = useState<ReplayVisualFrame | null>(null);
  const [displayedFrame, setDisplayedFrame] = useState(-1);
  const [captureLabel, setCaptureLabel] = useState<"hover" | "press" | null>(null);
  const [captureInterests, setCaptureInterests] = useState<string[]>([]);
  const manualControlRef = useRef({
    playing: false,
    action: null as ManualReplayAction | null,
    wake: null as (() => void) | null,
  });

  useEffect(() => {
    diagnosticViewRef.current = diagnosticView;
    selectedFingerRef.current = selectedFinger;
    if (!evidenceFrame) return;
    redrawRef.current?.(evidenceFrame);
    const id = selectedFinger ?? evidenceFrame.fingertips.find((tip) => tip.evidence)?.id;
    const tip = evidenceFrame.fingertips.find((item) => item.id === id);
    const crop = document.querySelector<HTMLCanvasElement>("#finger-detail");
    const video = document.querySelector<HTMLVideoElement>("#video");
    const overlay = document.querySelector<HTMLCanvasElement>("#replay-overlay");
    if (!crop) return;
    crop.width = 210; crop.height = 140;
    const context = crop.getContext("2d");
    if (!context || !tip || !video || video.readyState < 2) return;
    const left = Math.max(0, Math.min(video.videoWidth - 140, Math.round(tip.point.x) - 70));
    const top = Math.max(0, Math.min(video.videoHeight - 94, Math.round(tip.point.y) - 24));
    context.drawImage(video, left, top, 140, 94, 0, 0, 210, 140);
    if (overlay) context.drawImage(overlay, left, top, 140, 94, 0, 0, 210, 140);
  }, [selectedFinger, evidenceFrame, diagnosticView]);

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
    setSampleSource({ id: crypto.randomUUID(), name: videoFile.name });
    const videoCase = parseCvVideoCase(JSON.parse(await sidecarFile.text()));
    const searchParams = new URLSearchParams(window.location.search);
    const technique = searchParams.get("technique");
    const shadowBaseline = technique === "shadow-baseline";
    setBaselineMode(shadowBaseline);
    const cutoff = Number(searchParams.get("cutoff") ?? 20) as ShadowBaselineCutoff;
    if (shadowBaseline && !SHADOW_BASELINE_CUTOFFS.includes(cutoff)) throw new Error("DFS cutoff must be 5, 20, 40 or 60");
    const manual = searchParams.get("manual") === "1";
    if (shadowBaseline && manual) {
      setDiagnosticView("dfs"); diagnosticViewRef.current = "dfs";
    } else if (!shadowBaseline && diagnosticViewRef.current === "dfs") {
      setDiagnosticView("heatmap"); diagnosticViewRef.current = "heatmap";
    }
    setManualReview(manual);
    setManualPlaying(false);
    setDisplayedFrame(-1);
    manualControlRef.current = { playing: false, action: null, wake: null };
    setEvidenceFrame(null);
    historyRef.current = [];
    heatmapReferences.current.clear();
    setRunFilter({ ...filter });
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

      if (!shadowBaseline) {
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
        if (diagnosticViewRef.current === "heatmap") return;
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
          const selectedId = selectedFingerRef.current ?? state.fingertips.find((tip) => tip.evidence)?.id;
          const selected = fingertip.id === selectedId;
          replayOverlayContext.globalAlpha = selected ? 1 : 0.45;
          if (fingertip.evidence) {
            replayOverlayContext.fillStyle = overlayColors.blue;
            replayOverlayContext.globalAlpha = 0.5;
            for (const [x, y, length] of fingertip.darkRuns) replayOverlayContext.fillRect(x, y, length, 1);
            replayOverlayContext.globalAlpha = 1;
            replayOverlayContext.strokeStyle = overlayColors.green;
            replayOverlayContext.strokeRect(Math.round(fingertip.point.x) - 40, Math.round(fingertip.point.y) + 2, 81, 9);
            replayOverlayContext.strokeStyle = overlayColors.blue;
            replayOverlayContext.strokeRect(Math.round(fingertip.point.x) - 40, Math.round(fingertip.point.y) + 11, 81, 35);
          }
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
          if (selected) {
            replayOverlayContext.strokeStyle = overlayColors.ink;
            replayOverlayContext.lineWidth = 2;
            replayOverlayContext.strokeRect(fingertip.point.x - 44, fingertip.point.y - 10, 88, 60);
          }
          replayOverlayContext.font = `${Math.max(14, video.videoWidth / 85)}px sans-serif`;
          replayOverlayContext.fillStyle = overlayColors.ink;
          replayOverlayContext.fillText(fingertip.id, fingertip.point.x - 40, fingertip.point.y - 14);
          replayOverlayContext.globalAlpha = 1;
        }
      };
      redrawRef.current = drawReplayOverlay;
      const context = canvas.getContext("2d", { willReadFrequently: true });
      if (!context) throw new Error("Unable to create video frame canvas");
      const backgroundCanvas = document.createElement("canvas");
      let backgroundImageData: ImageData | null = null;

      const layout = layoutFromCase(videoCase.calibration.keyboard.layoutId,
        videoCase.calibration.keyboard.startingMidiNote);
      const depthModels = shadowBaseline ? null : toPersistedDepthCalibration(
        buildDepthCalibrations(videoCase),
      );
      const analysis = document.createElement("canvas");
      const size = shadowAnalysisSize(canvas.width, canvas.height);
      analysis.width = size.width; analysis.height = size.height;
      const analysisContext = analysis.getContext("2d", { willReadFrequently: true });
      if (shadowBaseline && !analysisContext) throw new Error("Unable to create analysis canvas");
      let baselineReference: ImageData | null = null;
      let cachedFrameToSheet: Homography | null = null;
      const referenceCaptures: Array<{ frame: number; mediaTimeMs: number }> = [];
      const baselineFrames: Array<{
        frame: number; mediaTimeMs: number; referenceFrame: number | null; available: boolean;
        candidates: Array<Pick<ReturnType<typeof detectShadowBaseline>["candidates"][number], "id" | "x" | "y" | "width" | "keyIndex" | "decision" | "accepted">>;
        activeKeyIndexes: number[];
      }> = [];
      const frameDelayMs = Number(searchParams.get("frameDelayMs") ?? 0);
      const visualReplayDelayMs = Number.isFinite(frameDelayMs)
        ? Math.max(0, Math.min(frameDelayMs, 5000))
        : 0;
      const synchronousShadowExperiment = technique === "synchronous-shadow" ||
        technique === "synchronous-shadow-no-knuckles";
      const knucklesEnabled = technique !== "synchronous-shadow-no-knuckles";
      if (!shadowBaseline) {
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
      }
      const lastFrame = Math.floor((video.duration - 0.001) * videoCase.framesPerSecond);
      const labeledStart = videoCase.annotation.fullyLabeledRange.startFrame;
      const labeledEnd = videoCase.annotation.fullyLabeledRange.endFrame;
      if (labeledEnd > lastFrame) {
        throw new Error(`Labeled end frame ${labeledEnd} exceeds clip frame ${lastFrame}`);
      }
      setStatus(shadowBaseline
        ? `Replaying ${lastFrame + 1} frames through CPU shadow baseline (cutoff ${cutoff})...`
        : `Replaying ${lastFrame + 1} frames through MediaPipe and CV (${handLandmarkerDelegate})...`);

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
      historyRef.current = visualFrames;
      const evidenceEnabled = manual || searchParams.get("shadowEvidence") === "1";
      let evidenceBackground: ImageData | null = null;
      let heatmapBackground: ImageData | null = null;
      let heatmapReferenceId: number | null = null;
      let previousEvidence = new Map<string, { evidence: ShadowEvidence; y: number }>();
      let displayCursor = -1;
      const showCachedFrame = async (index: number) => {
        const state = visualFrames[index];
        if (!state) return;
        await seekFrame(video, state.mediaTimeMs);
        drawReplayOverlay(state);
        setEvidenceFrame(state);
        displayCursor = index;
        setDisplayedFrame(index);
        const activeKeys = [...state.activeKeyIndexes].sort((a, b) => a - b);
        setStatus(
          `Frame ${state.frame} / ${lastFrame} · active keys: ${activeKeys.length ? activeKeys.join(", ") : "none"} · shadow candidates: ${state.shadowCandidates}`,
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
        if (shadowBaseline) {
          context.drawImage(video, 0, 0, canvas.width, canvas.height);
          analysisContext!.drawImage(canvas, 0, 0, analysis.width, analysis.height);
        }
        const markerIntervalMs = markerAcquired
          ? MARKER_CHECK_INTERVAL_MS : MARKER_ACQUIRE_INTERVAL_MS;
        if (mediaTimeMs - lastMarkerDetectionMs >= markerIntervalMs) {
          if (!shadowBaseline) context.drawImage(video, 0, 0, canvas.width, canvas.height);
          const markerStartedMs = performance.now();
          const markers = markerDetector.detect(canvas);
          markerMs = performance.now() - markerStartedMs;
          markerDetectionCount += 1;
          lastMarkerDetectionMs = mediaTimeMs;
          const markerCenters = shadowBaseline
            ? markerCorners(markers, { deviceId: "replay", width: canvas.width, height: canvas.height, facingMode: "" }) ?? []
            : [0, 1, 2, 3].map((id) => markers.observations.find(observation => observation.id === id)?.center);
          const geometryStartedMs = performance.now();
          if (markerCenters.length === 4 && markerCenters.every((point): point is Point => point !== undefined)) {
            const homography = computeHomography(PAGE_CORNERS, markerCenters);
            if (homography) {
              const candidateKeys = getWhiteKeyPolygons(layout).map((key) =>
                key.map((point) => projectPoint(homography, point)),
              );
              if (candidateKeys.every((key) =>
                key.every((point): point is Point => point !== null))) {
                cachedWhiteKeys = candidateKeys as Point[][];
                markerAcquired = true;
                cachedFrameToSheet = invertHomography(homography);
                if (markers.missingIds.length === 0) {
                  if (shadowBaseline) {
                    baselineReference = analysisContext!.getImageData(0, 0, analysis.width, analysis.height);
                    referenceCaptures.push({ frame, mediaTimeMs });
                  }
                  if (backgroundCanvas.width !== canvas.width)
                    backgroundCanvas.width = canvas.width;
                  if (backgroundCanvas.height !== canvas.height)
                    backgroundCanvas.height = canvas.height;
                  backgroundCanvas.getContext("2d")?.drawImage(canvas, 0, 0);
                  backgroundImageData = backgroundCanvas.getContext("2d")
                    ?.getImageData(0, 0, canvas.width, canvas.height) ?? null;
                }
              }
            }
          }
          geometryMs = performance.now() - geometryStartedMs;
        }
        const whiteKeys = cachedWhiteKeys;
        const inferenceStartMs = performance.now();
        const prediction = landmarker?.detectForVideo(video, mediaTimeMs);
        const inferenceMs = shadowBaseline ? 0 : performance.now() - inferenceStartMs;
        const hands: HandObservation[] = prediction?.landmarks.map((landmarks, index) => ({
          landmarks,
          handedness: prediction!.handedness[index]?.[0]?.categoryName === "Left"
            ? "Left" : prediction!.handedness[index]?.[0]?.categoryName === "Right"
              ? "Right" : "Unknown",
        })) ?? [];
        const fingertips = getFingertips(hands.map((hand) => hand.landmarks),
          video.videoWidth, video.videoHeight);
        const contactStartedMs = performance.now();
        const baselinePixels = shadowBaseline && baselineReference && cachedFrameToSheet
          ? analysisContext!.getImageData(0, 0, analysis.width, analysis.height) : null;
        const baselineResult = baselinePixels && baselineReference && cachedFrameToSheet
          ? detectShadowBaseline(baselinePixels,
            baselineReference, canvas.width, canvas.height, cachedFrameToSheet, layout, cutoff)
          : null;
        if (pipeline?.processFrame({ video,
          background: markerAcquired ? backgroundImageData : null,
          hands, fingertips, whiteKeys,
          calibration: depthModels,
          previewFingerId: null })) shadowSamplesSubmitted += 1;
        for (const measurement of pipeline?.synchronousMeasurements.values() ?? []) {
          synchronousShadowSamples += 1;
          if (measurement.state === "press candidate")
            synchronousShadowCandidates += 1;
        }
        const wallEndMs = performance.now();
        const contactMs = wallEndMs - contactStartedMs;
        const frameSynchronousSamples = pipeline?.synchronousMeasurements.size ?? 0;
        const frameSynchronousCandidates = [...(pipeline?.synchronousMeasurements.values() ?? [])]
          .filter((measurement) => measurement.state === "press candidate").length;
        timings.push({ frame, mediaTimeMs, wallStartMs, wallEndMs,
          processMs: wallEndMs - wallStartMs, inferenceMs, result: null });
        frameStages.push({ frame, mediaTimeMs, seekMs, markerMs, geometryMs,
          inferenceMs, contactMs, totalCvMs: wallEndMs - wallStartMs,
          synchronousShadowSamples: frameSynchronousSamples,
          synchronousShadowCandidates: frameSynchronousCandidates });
        const activeKeyIndexes = new Set<number>(baselineResult?.pressedKeys);
        for (const [id, contact] of pipeline?.contacts ?? []) {
          if (!contact.active) continue;
          for (const key of pipeline!.gates.get(id)?.keyIndexes ?? [])
            activeKeyIndexes.add(key);
        }
        if (shadowBaseline) baselineFrames.push({ frame, mediaTimeMs,
          referenceFrame: referenceCaptures.at(-1)?.frame ?? null,
          available: baselineResult !== null, candidates: baselineResult?.candidates.map(({ id, x, y, width, keyIndex, decision, accepted }) => ({ id, x, y, width, keyIndex, decision, accepted })) ?? [],
          activeKeyIndexes: [...activeKeyIndexes] });
        // Extra diagnostic reads happen outside contact timing and are opt-in.
        let evidencePixels: ImageData | null = null;
        if (evidenceEnabled && backgroundImageData) {
          context.drawImage(video, 0, 0, canvas.width, canvas.height);
          evidencePixels = context.getImageData(0, 0, canvas.width, canvas.height);
        }
        if (evidenceEnabled && backgroundImageData && heatmapBackground !== backgroundImageData) {
          const small = document.createElement("canvas");
          const scale = Math.min(1, 640 / Math.max(canvas.width, canvas.height));
          small.width = Math.max(1, Math.round(canvas.width * scale));
          small.height = Math.max(1, Math.round(canvas.height * scale));
          const smallContext = small.getContext("2d", { willReadFrequently: true })!;
          smallContext.drawImage(backgroundCanvas, 0, 0, small.width, small.height);
          heatmapReferenceId = heatmapReferences.current.size + 1;
          heatmapReferences.current.set(heatmapReferenceId, shadowBaseline && baselineReference
            ? baselineReference : smallContext.getImageData(0, 0, small.width, small.height));
          heatmapBackground = backgroundImageData;
        }
        if (evidenceBackground !== backgroundImageData) previousEvidence.clear();
        evidenceBackground = backgroundImageData;
        const nextEvidence = new Map<string, { evidence: ShadowEvidence; y: number }>();
        const visualState: ReplayVisualFrame = {
          frame,
          mediaTimeMs,
          whiteKeys,
          activeKeyIndexes: [...activeKeyIndexes],
          fingertips: shadowBaseline ? (baselineResult?.candidates ?? []).map(candidate => ({
            id: `candidate-${candidate.id}`, point: {
              x: candidate.x * canvas.width / analysis.width,
              y: candidate.y * canvas.height / analysis.height,
            }, darkRuns: [], evidence: null, change: null, deltaY: null,
            active: candidate.accepted, candidate: candidate.decision === true,
            eligible: candidate.keyIndex >= 0,
          })) : fingertips.map((fingertip) => {
            const hand = hands[fingertip.handIndex]?.handedness ?? "Unknown";
            const fingerName = FINGER_LABELS[[4, 8, 12, 16, 20].indexOf(fingertip.landmarkIndex)] ?? fingertip.landmarkIndex;
            const id = `${hand}-${fingerName}`;
            const uniqueHand = hand !== "Unknown" && hands.filter((item) => item.handedness === hand).length === 1;
            const evidence = evidencePixels && uniqueHand
              ? measureShadowEvidence(evidencePixels, backgroundImageData, fingertip.point, filter) : null;
            const previous = previousEvidence.get(id);
            if (evidence) nextEvidence.set(id, { evidence, y: fingertip.point.y });
            return {
              id,
              darkRuns: evidencePixels && uniqueHand ? darkShadowRuns(analyzeDarkShadowRegion(evidencePixels, backgroundImageData, fingertip.point, filter)) : [],
              evidence,
              change: evidence && previous ? compareShadowEvidence(previous.evidence, evidence) : null,
              deltaY: evidence && previous ? fingertip.point.y - previous.y : null,
              point: fingertip.point,
              active: pipeline?.contacts.get(fingertip.id)?.active ?? false,
              candidate: pipeline?.synchronousMeasurements.get(
                fingertip.id,
              )?.state === "press candidate",
              eligible: pipeline?.gates.get(fingertip.id)?.knuckleEligible ?? false,
            };
          }),
          shadowCandidates: shadowBaseline ? baselineResult?.candidates.filter(candidate => candidate.accepted).length ?? 0 : frameSynchronousCandidates,
          heatmapReferenceId,
          ...(shadowBaseline && evidenceEnabled ? { baseline: {
            cutoff, frameToSheet: cachedFrameToSheet, frameWidth: canvas.width, frameHeight: canvas.height,
            layout, sourceFingerprint: baselinePixels ? shadowPixelFingerprint(baselinePixels) : null,
            candidates: baselineSnapshot(baselineResult?.candidates ?? []),
          } } : {}),
        };
        previousEvidence = nextEvidence;
        visualFrames.push(visualState);
        if (evidenceEnabled) setEvidenceFrame(visualState);
        displayCursor = frame;
        setDisplayedFrame(frame);
        drawReplayOverlay(visualState);
        keys.push({ frame, mediaTimeMs, activeKeyIndexes: [...activeKeyIndexes] });
        if (manual) {
          setStatus(
            `Frame ${frame} / ${lastFrame} · active keys: ${activeKeyIndexes.size ? [...activeKeyIndexes].sort((a, b) => a - b).join(", ") : "none"} · shadow candidates: ${frameSynchronousCandidates}`,
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
            `Frame ${frame} / ${lastFrame} · active keys: ${activeKeys.length ? activeKeys.join(", ") : "none"} · shadow candidates: ${frameSynchronousCandidates}`,
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
      const baselineTimings = timings.filter((_, index) => baselineFrames[index]?.available);
      const baselineAnalysisTimings = baselineTimings.map(timing => ({ ...timing,
        processMs: frameStages[timing.frame].contactMs,
      }));
      const graphicsCanvas = document.createElement("canvas");
      const graphics = graphicsCanvas.getContext("webgl2") ??
        graphicsCanvas.getContext("webgl");
      const debugInfo = graphics?.getExtension("WEBGL_debug_renderer_info");
      const output = { clip: videoCase.video, processedFrames: lastFrame + 1,
        runtime: {
          handLandmarkerDelegate: shadowBaseline ? null : handLandmarkerDelegate,
          detector: shadowBaseline ? "shadow-baseline" : "legacy-contact",
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
        shadowBaselinePerformance: shadowBaseline ? {
          availableFrames: baselineTimings.length,
          analysisMs: summarizeFramePerformance(baselineAnalysisTimings).processMs,
          totalCvMs: summarizeFramePerformance(baselineTimings).processMs,
        } : undefined,
        darkPixelFilter: { ...filter },
        shadowEvidenceFrames: evidenceEnabled ? visualFrames : undefined,
        shadowBaseline: shadowBaseline ? {
          cutoff, velocity: 1, analysisSize: size, referenceCaptures,
          analysisAvailableFrames: baselineFrames.filter(frame => frame.available).length,
          totalProposals: baselineFrames.reduce((sum, frame) => sum + frame.candidates.length, 0),
          eligibleProposals: baselineFrames.reduce((sum, frame) => sum + frame.candidates.filter(candidate => candidate.keyIndex >= 0).length, 0),
          acceptedProposals: baselineFrames.reduce((sum, frame) => sum + frame.candidates.filter(candidate => candidate.accepted).length, 0),
          unknownEligibleProposals: baselineFrames.reduce((sum, frame) => sum + frame.candidates.filter(candidate => candidate.keyIndex >= 0 && candidate.decision === null).length, 0),
          frames: baselineFrames,
          notes: "Actual CPU baseline, no hand inference/tracking/hysteresis. Complete markers assumed empty. Sidecar labels unchanged; some conflict with newer user annotations. Ordered paused seeking does not measure live drops or physical latency.",
        } : undefined,
        contactTechniques: shadowBaseline ? { shadowBaseline: true, cutoff, temporalFiltering: false } : pipeline?.techniques,
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

  return <main className={styles.page}>
    <h1>CV video replay</h1>
    <p><Link href="/cv-shadow-test">Open shadow heatmap · images and video, without finger tracking</Link></p>
    <p className={styles.subtitle}>Inspect detection and shadow evidence, one frame at a time.</p>
    <details className={styles.setup} open={!evidenceFrame}>
    <summary>Source files & filter tuning</summary>
    <div className={styles.files}>
    <label>Video <input id="clip" type="file" accept="video/mp4,video/*" /></label>
    <label style={{ marginLeft: 16 }}>Sidecar <input id="sidecar" type="file" accept="application/json,.json" /></label>
    </div>
    {diagnosticView === "finger" && <ShadowFilterControls value={filter} onChange={setFilter} />}
    <button className={styles.primary} type="button" onClick={() => void runReplay().catch((error: unknown) =>
      setStatus(`Replay failed: ${error instanceof Error ? error.message : String(error)}`))}>
      Run replay
    </button>
    </details>
    {manualReview && (
      <div className={styles.controls}>
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
    <p role="status" className={styles.status}>{status}</p>
    <label className={styles.viewControl}>Diagnostic view
      <select aria-label="Diagnostic view" value={diagnosticView} onChange={(event) => setDiagnosticView(event.target.value)}>
        <option value="heatmap">Shadow heatmaps</option>{baselineMode
          ? <option value="dfs">Shadow DFS inspection</option>
          : <option value="finger">Finger measurements</option>}
      </select>
    </label>
    <div className={styles.workspace}>
    <div className={styles.videoPanel}>
    <div className={styles.video}>
      <video
        id="video"
        muted
        playsInline
        style={{ display: "block", width: "100%" }}
      />
      <canvas
        id="replay-overlay"
        aria-hidden="true"
        className={styles.overlay}
      />
    </div>
    {diagnosticView === "finger" && <div className={styles.legend}>
      <span><i className={styles.swatch} style={{ color: "var(--color-green)" }} />Near band · 2–10 px</span>
      <span><i className={styles.swatch} style={{ color: "var(--color-blue)" }} />Forward band · 11–45 px</span>
      <span>Blue fill = dark-pixel matches</span>
    </div>}
    <p className={styles.muted}>{diagnosticView === "finger" ? <>Recorded filter: drop ≥ {runFilter.minLumaDrop} · luma ≤ {runFilter.maxLuma} · RGB ≤ {runFilter.maxRgbChannel} · R−G ≤ {runFilter.maxRedGreenDifference}. Edit settings and rerun to apply changes.</> : diagnosticView === "dfs" ? "Paused DFS inspection uses this frame’s original reference and scored proposals. Candidate numbers may change between frames." : "Heatmaps use this replay’s saved empty-sheet frame. Pause and use Previous/Next to inspect. Display settings update immediately."}</p>
    </div>
    {diagnosticView === "dfs" ? <ReplayShadowBaselinePanel frame={evidenceFrame} reference={evidenceFrame?.heatmapReferenceId ? heatmapReferences.current.get(evidenceFrame.heatmapReferenceId) ?? null : null} playing={manualPlaying} /> : diagnosticView === "heatmap" ? <ReplayHeatmapPanel sampleSource={sampleSource} frame={evidenceFrame} reference={evidenceFrame?.heatmapReferenceId ? heatmapReferences.current.get(evidenceFrame.heatmapReferenceId) ?? null : null} playing={manualPlaying} /> : evidenceFrame ? <ReplayEvidencePanel frame={evidenceFrame} history={historyRef.current} selected={selectedFinger} onSelect={setSelectedFinger} /> : <div className={styles.evidence}><h2>Frame inspector</h2><p className={styles.muted}>Run a manual replay to inspect a finger, compare measurements and follow their changes over time.</p></div>}
    </div>
    <canvas id="frame" hidden />
    <details className={styles.report}><summary>Raw replay report</summary><pre>{result}</pre></details>
  </main>;
}
