"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { colorizeShadowDifference, measureShadowDifference, readHeatmapPalette, type ShadowDifference } from "../../cv/shadowHeatmap";
import styles from "./heatmap.module.css";
import type { ShadowSampleFrame } from "../../cv/shadowSamples";
import ProjectionMaps from "./ProjectionMaps";

const MAX_WIDTH = 640;
function dimensions(source: HTMLImageElement | HTMLVideoElement) {
  return source instanceof HTMLVideoElement
    ? { width: source.videoWidth, height: source.videoHeight }
    : { width: source.naturalWidth, height: source.naturalHeight };
}
function sample(source: HTMLImageElement | HTMLVideoElement) {
  const size = dimensions(source);
  const canvas = document.createElement("canvas");
  const scale = Math.min(1, MAX_WIDTH / Math.max(size.width, size.height));
  canvas.width = Math.max(1, Math.round(size.width * scale));
  canvas.height = Math.max(1, Math.round(size.height * scale));
  const context = canvas.getContext("2d", { willReadFrequently: true })!;
  context.drawImage(source, 0, 0, canvas.width, canvas.height);
  return { ...size, pixels: context.getImageData(0, 0, canvas.width, canvas.height) };
}

export default function ShadowHeatmapPage() {
  const sourceRef = useRef<HTMLImageElement | HTMLVideoElement | null>(null);
  const videoRef = useRef<HTMLVideoElement>(null);
  const sourceCanvas = useRef<HTMLCanvasElement>(null);
  const darkCanvas = useRef<HTMLCanvasElement>(null);
  const colorCanvas = useRef<HTMLCanvasElement>(null);
  const referenceRef = useRef<(ReturnType<typeof sample> & { captured: boolean; id: string; timeSeconds: number | null }) | null>(null);
  const sourceUrl = useRef<string | null>(null);
  const sourceId = useRef("");
  const generation = useRef(0);
  const seekSequence = useRef(0);
  const presentationRef = useRef<{ ready: Promise<void>; cancel: () => void; sequence: number } | null>(null);
  const referenceGeneration = useRef(0);
  const differenceRef = useRef<ShadowDifference | null>(null);
  const sampledSourceRef = useRef<ImageData | null>(null);
  const [kind, setKind] = useState<"image" | "video" | null>(null);
  const [sourceRevision, setSourceRevision] = useState(0);
  const [referenceRevision, setReferenceRevision] = useState(0);
  const [referenceName, setReferenceName] = useState("");
  const [sourceName, setSourceName] = useState("");
  const [videoReady, setVideoReady] = useState(false);
  const [playing, setPlaying] = useState(false);
  const [noiseFloor, setNoiseFloor] = useState(5);
  const [fullScale, setFullScale] = useState(120);
  const [colorScale, setColorScale] = useState(40);
  const [minimumReference, setMinimumReference] = useState(40);
  const [fps, setFps] = useState(30);
  const [status, setStatus] = useState("Choose an image or video and an empty-sheet reference.");
  const [summary, setSummary] = useState<{ width: number; height: number; mean: number; max: number; valid: number; time: number } | null>(null);
  const [projection, setProjection] = useState<ShadowSampleFrame | null>(null);
  const [pixel, setPixel] = useState<string>("");

  useEffect(() => () => {
    generation.current += 1; referenceGeneration.current += 1;
    presentationRef.current?.cancel();
    if (sourceUrl.current) URL.revokeObjectURL(sourceUrl.current);
    sourceUrl.current = null;
  }, []);

  const render = useCallback(() => {
    setPixel("");
    differenceRef.current = null;
    setProjection(null);
    setSummary(null);
    for (const canvas of [darkCanvas.current, colorCanvas.current]) {
      if (canvas) canvas.getContext("2d")?.clearRect(0, 0, canvas.width, canvas.height);
    }
    const source = sourceRef.current;
    if (!source || !dimensions(source).width) return;
    if (source instanceof HTMLVideoElement && (source.seeking || source.readyState < 2)) return;
    if (playing) { setStatus("Video playing. Pause to analyze the displayed frame."); return; }
    const current = sample(source);
    sampledSourceRef.current = current.pixels;
    if (sourceCanvas.current) {
      sourceCanvas.current.width = current.pixels.width; sourceCanvas.current.height = current.pixels.height;
      sourceCanvas.current.getContext("2d")?.putImageData(current.pixels, 0, 0);
    }
    const reference = referenceRef.current;
    if (!reference) { setStatus("Load an empty-sheet reference, or capture an empty frame from this video."); return; }
    if (reference.width !== current.width || reference.height !== current.height) {
      setStatus(`Resolution mismatch: source ${current.width} × ${current.height}, reference ${reference.width} × ${reference.height}. Use matching camera frames.`); return;
    }
    const difference = measureShadowDifference(current.pixels, reference.pixels, minimumReference);
    if (!difference) { setStatus("Reference comparison unavailable."); return; }
    differenceRef.current = difference;
    setProjection({ difference, current: current.pixels, reference: reference.pixels, context: {
      source: { id: sourceId.current, name: sourceName, kind: source instanceof HTMLVideoElement ? "video" : "image",
        nativeWidth: current.width, nativeHeight: current.height, timeSeconds: source instanceof HTMLVideoElement ? source.currentTime : null,
        frame: source instanceof HTMLVideoElement ? Math.round(source.currentTime * fps) : null,
        frameIdentity: source instanceof HTMLVideoElement ? "approximate" : null, fps: source instanceof HTMLVideoElement ? fps : null },
      reference: { id: reference.id, name: referenceName, timeSeconds: reference.timeSeconds },
    } });
    const colors = readHeatmapPalette();
    for (const [canvas, mode, scale] of [[darkCanvas.current, "darkening", fullScale], [colorCanvas.current, "color", colorScale]] as const) {
      if (!canvas) continue;
      canvas.width = difference.width; canvas.height = difference.height;
      const context = canvas.getContext("2d")!;
      const output = context.createImageData(difference.width, difference.height);
      output.data.set(colorizeShadowDifference(difference, mode, mode === "darkening" ? noiseFloor : 0, scale, colors));
      context.putImageData(output, 0, 0);
    }
    setSummary({ width: difference.width, height: difference.height, mean: difference.meanDarkening, max: difference.maxDarkening, valid: difference.sampledPixels, time: source instanceof HTMLVideoElement ? source.currentTime : 0 });
    setStatus(difference.sampledPixels ? "Heatmaps ready. Move over a map to inspect a pixel." : "No eligible reference pixels. Lower the reference brightness cutoff.");
  }, [playing, minimumReference, noiseFloor, fullScale, colorScale, sourceName, referenceName, fps]);

  useEffect(() => { render(); }, [render, sourceRevision, referenceRevision]);

  async function loadSource(file: File) {
    const version = ++generation.current;
    sourceId.current = crypto.randomUUID();
    presentationRef.current?.cancel();
    presentationRef.current = null;
    seekSequence.current += 1;
    videoRef.current?.pause();
    sourceRef.current = null;
    if (sourceUrl.current) URL.revokeObjectURL(sourceUrl.current);
    const url = URL.createObjectURL(file); sourceUrl.current = url;
    if (referenceRef.current?.captured) {
      referenceRef.current = null; setReferenceName(""); setReferenceRevision((n) => n + 1);
    }
    setSourceName(file.name); setPlaying(false); setVideoReady(false); setSummary(null); setPixel("");
    setStatus("Loading source...");
    setSourceRevision((n) => n + 1);
    if (file.type.startsWith("video/")) {
      setKind("video");
      const video = videoRef.current!; video.src = url; video.load();
    } else {
      setKind("image");
      const image = new Image(); image.src = url;
      try {
        await image.decode();
        if (version !== generation.current) return;
        sourceRef.current = image; setSourceRevision((n) => n + 1);
      } catch { if (version === generation.current) setStatus("Unable to decode this image."); }
    }
  }

  async function loadReference(file: File) {
    const version = ++referenceGeneration.current;
    const url = URL.createObjectURL(file);
    try {
      const image = new Image(); image.src = url; await image.decode();
      if (version !== referenceGeneration.current) return;
      referenceRef.current = { ...sample(image), captured: false, id: crypto.randomUUID(), timeSeconds: null };
      setReferenceName(file.name); setReferenceRevision((n) => n + 1);
    } catch { if (version === referenceGeneration.current) setStatus("Unable to decode the reference image."); }
    finally { URL.revokeObjectURL(url); }
  }

  async function prepareVideo() {
    const video = videoRef.current;
    if (!video || video.currentSrc !== sourceUrl.current) return;
    const url = video.currentSrc;
    // readyState alone can precede a drawable texture on the first video frame.
    const presented = new Promise<void>((resolve) => {
      if (typeof video.requestVideoFrameCallback === "function") video.requestVideoFrameCallback(() => resolve());
      else requestAnimationFrame(() => requestAnimationFrame(() => resolve()));
    });
    try {
      await video.play();
      await presented;
      if (video.currentSrc !== url || sourceUrl.current !== url) return;
      video.pause();
      sourceRef.current = video;
      setVideoReady(true);
      setSourceRevision((n) => n + 1);
    } catch {
      if (sourceUrl.current === url) setStatus("Press Play, then Pause to prepare a decoded video frame.");
    }
  }

  function beginSeek() {
    const video = videoRef.current;
    if (!video) return;
    presentationRef.current?.cancel();
    const sequence = ++seekSequence.current;
    let finish = () => {};
    let callback = 0;
    const ready = new Promise<void>((resolve) => {
      finish = resolve;
      if (typeof video.requestVideoFrameCallback === "function") callback = video.requestVideoFrameCallback(() => resolve());
      else requestAnimationFrame(() => requestAnimationFrame(() => resolve()));
    });
    presentationRef.current = { ready, sequence, cancel: () => {
      if (callback) video.cancelVideoFrameCallback(callback);
      finish();
    } };
    setVideoReady(false); setSummary(null); differenceRef.current = null; setProjection(null);
    setStatus("Seeking decoded frame...");
    for (const canvas of [darkCanvas.current, colorCanvas.current]) {
      if (canvas) canvas.getContext("2d")?.clearRect(0, 0, canvas.width, canvas.height);
    }
  }

  async function finishSeek() {
    const pending = presentationRef.current;
    const video = videoRef.current;
    const sequence = seekSequence.current;
    const painted = new Promise<void>((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve())));
    // Some browsers present a paused seek before the seeking listener can register.
    // Do not wait forever for another frame when the decoded frame is already ready.
    await (pending ? Promise.race([pending.ready, painted]) : painted);
    await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
    if (!video || sequence !== seekSequence.current || video.seeking || video.currentSrc !== sourceUrl.current) return;
    pending?.cancel();
    sourceRef.current = video; setVideoReady(true); setSourceRevision((n) => n + 1);
  }

  function captureReference() {
    const video = videoRef.current;
    if (!video || !video.paused || video.readyState < 2 || video.seeking) return;
    referenceGeneration.current += 1;
    const captured = sample(video);
    if (!captured.pixels.data.some((channel, index) => index % 4 === 3 && channel > 0)) {
      setStatus("Decoded frame unavailable. Press Play, then Pause before capturing."); return;
    }
    referenceRef.current = { ...captured, captured: true, id: crypto.randomUUID(), timeSeconds: video.currentTime };
    setReferenceName(`${sourceName} at ${video.currentTime.toFixed(3)} s`);
    setReferenceRevision((n) => n + 1);
  }

  function step(direction: number) {
    const video = videoRef.current;
    if (!video || !Number.isFinite(video.duration)) return;
    video.pause();
    video.currentTime = Math.max(0, Math.min(Math.max(0, video.duration - 0.001), (Math.round(video.currentTime * fps) + direction) / fps));
  }

  function inspect(event: React.PointerEvent<HTMLCanvasElement>) {
    const diff = differenceRef.current; const current = sampledSourceRef.current;
    const reference = referenceRef.current?.pixels;
    if (!diff || !current || !reference) return;
    const rect = event.currentTarget.getBoundingClientRect();
    const x = Math.max(0, Math.min(diff.width - 1, Math.floor((event.clientX - rect.left) / rect.width * diff.width)));
    const y = Math.max(0, Math.min(diff.height - 1, Math.floor((event.clientY - rect.top) / rect.height * diff.height)));
    const i = y * diff.width + x; const offset = i * 4;
    setPixel(`Sample (${x}, ${y}): current RGB ${[...current.data.slice(offset, offset + 3)].join(", ")}; reference RGB ${[...reference.data.slice(offset, offset + 3)].join(", ")}; signed darkening ${diff.lumaDrop[i].toFixed(1)} luma; a ${diff.multiplier[i].toFixed(4)}; 1−a ${diff.attenuation[i].toFixed(4)}; e_B ${diff.residualReference[i].toFixed(4)}; e_I ${diff.residualCurrent[i].toFixed(4)}; color shift ${Number.isFinite(diff.colorShift[i]) ? diff.colorShift[i].toFixed(1) : "unknown (too dark)"}${diff.valid[i] ? "" : "; ignored reference pixel"}.`);
  }

  return <main className={styles.page}>
    <h1>Shadow heatmap</h1>
    <p className={styles.muted}>Inspect darkening against the empty sheet. No finger tracking, clustering or contact decisions.</p>
    <div className={styles.setup}>
      <div className={styles.inputs}>
        <label>Current image or video<input id="heatmap-source" type="file" accept="image/*,video/*" onChange={(e) => { const file = e.target.files?.[0]; if (file) void loadSource(file); }} /></label>
        <label>Empty-sheet reference<input id="heatmap-reference" type="file" accept="image/*" onChange={(e) => { const file = e.target.files?.[0]; if (file) void loadReference(file); }} /></label>
      </div>
      <p className={styles.muted}>Reference: {referenceName || "not captured"}. Keep the camera, paper and lighting fixed. The maps cover the whole image; inspect the paper portion.</p>
      <div className={styles.inputs}>
        {([
          ["Darkening noise floor", noiseFloor, setNoiseFloor, 0, 254],
          ["Darkening full scale", fullScale, setFullScale, 1, 255],
          ["Color-shift full scale", colorScale, setColorScale, 1, 255],
          ["Ignore reference luma below", minimumReference, setMinimumReference, 0, 255],
        ] as const).map(([label, value, setter, min, max]) => <label key={label}>{label}<input type="number" min={min} max={max} value={value} onChange={(e) => { const n = e.target.valueAsNumber; if (Number.isFinite(n)) setter(Math.max(min, Math.min(max, n))); }} /></label>)}
      </div>
      <p className={styles.muted}>Color shift compares RGB proportions rather than brightness. A neutral shadow may preserve color; fingers often change it. Both can overlap, and near-black pixels have unknown color. Use the color-exclusion experiment below to inspect the remaining darkening.</p>
    </div>
    {kind === "video" && <div className={styles.controls}>
      <button type="button" onClick={() => step(-1)}>Previous frame</button><button type="button" onClick={() => step(1)}>Next frame</button>
      <label>FPS <input aria-label="Video frames per second" type="number" min="1" max="240" value={fps} onChange={(e) => { const n = e.target.valueAsNumber; if (Number.isFinite(n)) setFps(Math.max(1, Math.min(240, n))); }} /></label>
      <button type="button" disabled={playing || !videoReady} onClick={captureReference}>Capture empty reference</button>
      <span className={styles.muted}>Capture with hands out of view. Set FPS to match the clip; stepping seeks by 1/FPS.</span>
    </div>}
    <p role="status" className={styles.status}>{status}</p>
    <div className={styles.grid}>
      <section className={styles.panel}><h2>Current frame</h2>
        <video id="heatmap-video" ref={videoRef} controls muted playsInline hidden={kind !== "video"}
          onLoadedData={() => void prepareVideo()}
          onSeeking={beginSeek} onSeeked={() => void finishSeek()}
          onPlay={() => setPlaying(true)} onPause={() => { setPlaying(false); if (videoRef.current?.readyState === 4 && sourceUrl.current === videoRef.current.currentSrc) { sourceRef.current = videoRef.current; setVideoReady(true); } setSourceRevision((n) => n + 1); }}
          onError={() => setStatus("Unable to decode this video.")} />
        <canvas id="heatmap-source-canvas" ref={sourceCanvas} hidden={kind === "video"} aria-label="Current source image" />
        <p className={styles.muted}>{sourceName || "No source selected"}{summary && kind === "video" ? ` · ${summary.time.toFixed(3)} s · approximate frame ${Math.round(summary.time * fps)}` : ""}</p>
      </section>
      <section className={styles.panel}><h2>Darkening from reference</h2><canvas id="darkening-map" ref={darkCanvas} aria-label="Darkening heatmap" onPointerMove={inspect} />
        <div className={styles.legend} /><div className={styles.legendLabels}><span>≤ {noiseFloor}: no visible darkening</span><span>≥ {Math.max(fullScale, noiseFloor + 1)} luma</span></div>
        <p className={styles.muted}>Positive reference − current luma. Brighter pixels do not contribute. Gray = ignored reference.</p>
      </section>
      <section className={styles.panel}><h2>Color change / ambiguity</h2><canvas id="color-map" ref={colorCanvas} aria-label="Color change heatmap" onPointerMove={inspect} />
        <div className={styles.legend} /><div className={styles.legendLabels}><span>Same color proportions</span><span>≥ {colorScale}: strong shift</span></div>
        <p className={styles.muted}>Darkening + low color shift is compatible with shadow, but also with some occluding objects. Gray = unavailable.</p>
      </section>
    </div>
    <ProjectionMaps difference={projection?.difference ?? null} sampleFrame={projection} minimumReferenceLuma={minimumReference} noiseFloor={noiseFloor} fullScale={fullScale} />
    <div className={styles.readout} aria-live="polite">{pixel || (summary ? `Analysis ${summary.width} × ${summary.height}; ${summary.valid} eligible pixels. Mean positive darkening ${summary.mean.toFixed(1)} luma; maximum ${summary.max.toFixed(1)}. Display scales stay fixed across frames.` : "Maps update on paused frames and whenever display settings change.")}</div>
    <p className={styles.muted}>Darkening can also come from finger occlusion, camera movement or exposure changes. Brightening is excluded, not interpreted as proof of no shadow. <Link href="/cv-image-test">Image diagnostics</Link> · <Link href="/cv-video-replay">Labeled video replay</Link></p>
  </main>;
}
