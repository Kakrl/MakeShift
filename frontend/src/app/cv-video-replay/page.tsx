/** Test-only browser page for replaying labeled clips through the CV pipeline.
 * It is opened by the Playwright runner; it is not part of normal piano play.
 * See docs/cv_video_tests.md for setup and usage.
 */
"use client";

import { useEffect, useRef, useState } from "react";
import { parseCvVideoCase, scoreTransitions, summarizeFramePerformance, transitionsFromFrames,
  type ActiveKeyFrame, type TimedFrameResult } from "../../cv/videoEvaluation";
import { VisionReplay } from "../../cv/visionReplay";

function waitForEvent(target: EventTarget, name: string, signal: AbortSignal) {
  return new Promise<void>((resolve, reject) => {
    if (signal.aborted) { reject(new Error("Replay cancelled")); return; }
    const timer = setTimeout(() => { cleanup(); reject(new Error(`Video ${name} timed out`)); }, 30_000);
    const abort = () => { cleanup(); reject(new Error("Replay cancelled")); };
    const done = () => { cleanup(); resolve(); };
    const fail = () => { cleanup(); reject(new Error(`Video ${name} failed`)); };
    const cleanup = () => {
      clearTimeout(timer);
      signal.removeEventListener("abort", abort);
      target.removeEventListener(name, done);
      target.removeEventListener("error", fail);
    };
    signal.addEventListener("abort", abort, { once: true });
    target.addEventListener(name, done, { once: true });
    target.addEventListener("error", fail, { once: true });
  });
}

async function seekFrame(video: HTMLVideoElement, timeMs: number, signal: AbortSignal) {
  const target = Math.min(timeMs / 1000, Math.max(0, video.duration - 0.001));
  // Seek even at time zero: loadeddata/currentTime alone can precede a drawable
  // first frame. Waiting for seeked also synchronizes initial canvas readback.
  const seeked = waitForEvent(video, "seeked", signal);
  video.currentTime = target;
  await seeked;
}

export default function CvVideoReplayPage() {
  const [status, setStatus] = useState("Choose an MP4 and its JSON sidecar.");
  const [result, setResult] = useState<string>("");
  const [busy, setBusy] = useState(false);
  const replayRef = useRef<VisionReplay | null>(null);
  const generation = useRef(0);
  const abortRef = useRef<AbortController | null>(null);
  useEffect(() => () => { generation.current++; abortRef.current?.abort(); replayRef.current?.dispose(); }, []);

  async function runReplay() {
    if (busy) return;
    const videoFile = (document.querySelector("#clip") as HTMLInputElement).files?.[0];
    const sidecarFile = (document.querySelector("#sidecar") as HTMLInputElement).files?.[0];
    if (!videoFile || !sidecarFile) { setStatus("Replay failed: Choose both files first"); return; }
    const run = ++generation.current;
    const controller = new AbortController();
    abortRef.current = controller;
    setBusy(true);
    setStatus("Loading replay…");
    setResult("");
    let url: string | undefined;
    let replay: VisionReplay | undefined;
    const video = document.querySelector("#video") as HTMLVideoElement;
    const active = () => { if (run !== generation.current) throw new Error("Replay cancelled"); };
    try {
      const videoCase = parseCvVideoCase(JSON.parse(await sidecarFile.text()));
      active();
      url = URL.createObjectURL(videoFile);
      const metadataLoaded = waitForEvent(video, "loadeddata", controller.signal);
      video.src = url;
      await metadataLoaded;
      active();
      video.pause();
      if (!Number.isFinite(video.duration) || !video.videoWidth || !video.videoHeight) throw new Error("Video metadata is invalid");
      replay = new VisionReplay();
      replayRef.current = replay;
      const canvas = document.querySelector("#frame") as HTMLCanvasElement;
      canvas.width = video.videoWidth;
      canvas.height = video.videoHeight;
      const context = canvas.getContext("2d", { willReadFrequently: true });
      if (!context) throw new Error("Unable to create video frame canvas");
      const lastFrame = Math.floor((video.duration - 0.001) * videoCase.framesPerSecond);
      const { startFrame: labeledStart, endFrame: labeledEnd } = videoCase.annotation.fullyLabeledRange;
      if (labeledEnd > lastFrame) throw new Error(`Labeled end frame ${labeledEnd} exceeds clip frame ${lastFrame}`);
      const keys: ActiveKeyFrame[] = [];
      const timings: TimedFrameResult<null>[] = [];
      const frameStages: { frame: number; seekMs: number; workerMs: number; roundTripMs: number }[] = [];
      const replayStartedMs = performance.now();
      for (let frame = videoCase.calibration.referenceFrame; frame <= labeledEnd; frame++) {
        const mediaTimeMs = frame * 1000 / videoCase.framesPerSecond;
        const seekStart = performance.now();
        await seekFrame(video, mediaTimeMs, controller.signal);
        active();
        const seekMs = performance.now() - seekStart;
        const wallStartMs = performance.now();
        context.drawImage(video, 0, 0, canvas.width, canvas.height);
        const { data: rgba } = context.getImageData(0, 0, canvas.width, canvas.height);
        const capture = frame === videoCase.calibration.referenceFrame;
        const { result, processMs } = await replay.process(rgba, canvas.width, canvas.height,
          videoCase.calibration.keyboard.octaves, capture);
        active();
        if (capture && (result.referenceScan.status !== "captured" || !result.referenceReady || !result.homographyReady))
          throw new Error("Reference frame was not accepted. Choose an empty keyboard frame with all four markers.");
        if (!result.referenceReady || !result.homographyReady) throw new Error("Vision reference was lost during replay");
        const wallEndMs = performance.now();
        keys.push({ frame, mediaTimeMs, activeKeyIndexes: result.pressedKeys });
        timings.push({ frame, mediaTimeMs, wallStartMs, wallEndMs,
          processMs: wallEndMs - wallStartMs, inferenceMs: null, result: null });
        frameStages.push({ frame, seekMs, workerMs: processMs, roundTripMs: wallEndMs - wallStartMs });
        if (frame % 10 === 0 || frame === labeledEnd) setStatus(`Processed frame ${frame + 1} / ${labeledEnd + 1}`);
      }
      const transitions = transitionsFromFrames(keys).filter(t => t.frame >= labeledStart && t.frame <= labeledEnd);
      const replayElapsedMs = performance.now() - replayStartedMs;
      setResult(JSON.stringify({ schemaVersion: 2, clip: videoCase.video, processedFrames: keys.length,
        runtime: { detector: "Vision WASM module worker" },
        referenceFrame: videoCase.calibration.referenceFrame,
        transitions, scores: scoreTransitions(videoCase.events, transitions, 1),
        performance: { ...summarizeFramePerformance(timings), replayElapsedMs,
          replayFps: keys.length * 1000 / replayElapsedMs, frameStages },
        replayMode: "ordered-paused-frame-stepping",
        limitation: "Offline replay throughput and source-frame errors; not live FPS or physical latency. Vision automatic refresh uses worker wall time, not clip time.",
      }, null, 2));
      setStatus("Replay complete");
    } catch (error) {
      if (run === generation.current)
        setStatus(`Replay failed: ${error instanceof Error ? error.message : String(error)}`);
    } finally {
      replay?.dispose();
      if (replayRef.current === replay) replayRef.current = null;
      if (url) URL.revokeObjectURL(url);
      if (abortRef.current === controller) abortRef.current = null;
      if (run === generation.current) setBusy(false);
    }
  }

  return <main style={{ padding: 24 }}>
    <h1>CV video replay</h1>
    <p>Paused frame stepping through the production Vision worker. Use a version 2 sidecar with a verified empty reference frame and chromatic key offsets.</p>
    <label>Video <input id="clip" type="file" accept="video/mp4,video/*" /></label>
    <label style={{ marginLeft: 16 }}>Sidecar <input id="sidecar" type="file" accept="application/json,.json" /></label>
    <button type="button" disabled={busy} onClick={() => void runReplay()}>
      Run replay
    </button>
    <p role="status">{status}</p>
    <video id="video" muted playsInline style={{ maxWidth: 640 }} />
    <canvas id="frame" hidden />
    <pre>{result}</pre>
  </main>;
}
