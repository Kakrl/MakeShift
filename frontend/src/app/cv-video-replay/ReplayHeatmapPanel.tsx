import { useEffect, useRef, useState } from "react";
import { colorizeShadowDifference, measureShadowDifference, readHeatmapPalette, type ShadowDifference } from "../../cv/shadowHeatmap";
import type { ShadowSampleFrame } from "../../cv/shadowSamples";
import type { ReplayVisualFrame } from "./page";
import ProjectionMaps from "../cv-shadow-test/ProjectionMaps";
import styles from "./replay.module.css";

export default function ReplayHeatmapPanel({ frame, reference, playing, sampleSource }: {
  sampleSource: { id: string; name: string };
  frame: ReplayVisualFrame | null; reference: ImageData | null; playing: boolean;
}) {
  const [projection, setProjection] = useState<{ frame: ReplayVisualFrame; reference: ImageData; minimumReference: number; difference: ShadowDifference; sampleFrame: ShadowSampleFrame } | null>(null);
  const darkRef = useRef<HTMLCanvasElement>(null);
  const colorRef = useRef<HTMLCanvasElement>(null);
  const [noise, setNoise] = useState(5);
  const [scale, setScale] = useState(120);
  const [colorScale, setColorScale] = useState(40);
  const [minimumReference, setMinimumReference] = useState(40);
  const [readout, setReadout] = useState<{ frame: number; text: string } | null>(null);
  const message = !frame ? "Run a manual replay to inspect shadow heatmaps." : playing ? "Pause replay to inspect this frame’s heatmaps." : !reference ? "No captured reference for this frame. Start the clip with the empty sheet and all markers visible." : readout?.frame === frame.frame ? readout.text : "Preparing the displayed frame...";

  useEffect(() => {
    const canvases = [darkRef.current, colorRef.current];
    for (const canvas of canvases) canvas?.getContext("2d")?.clearRect(0, 0, canvas.width, canvas.height);
    if (!frame) return;
    if (playing || !reference) return;
    // Wait for the selected cached/new video frame to be painted. Cancel work
    // if the user changes frame, view, settings, or resumes before it is ready.
    let second = 0;
    const first = requestAnimationFrame(() => { second = requestAnimationFrame(() => {
      const video = document.querySelector<HTMLVideoElement>("#video");
      if (!video || video.seeking || video.readyState < 2 || Math.abs(video.currentTime * 1000 - frame.mediaTimeMs) > 2) {
        setReadout({ frame: frame.frame, text: "Waiting for the displayed video frame." }); return;
      }
      const source = document.createElement("canvas");
      source.width = reference.width; source.height = reference.height;
      const context = source.getContext("2d", { willReadFrequently: true })!;
      context.drawImage(video, 0, 0, source.width, source.height);
      const current = context.getImageData(0, 0, source.width, source.height);
      const difference = measureShadowDifference(current, reference, minimumReference);
      if (!difference) { setReadout({ frame: frame.frame, text: "Reference comparison unavailable." }); return; }
      setProjection({ frame, reference, minimumReference, difference, sampleFrame: { difference, current, reference, context: {
        source: { ...sampleSource, kind: "video", nativeWidth: video.videoWidth, nativeHeight: video.videoHeight,
          timeSeconds: frame.mediaTimeMs / 1000, frame: frame.frame, frameIdentity: "replay-index", fps: null },
        reference: { id: `${sampleSource.id}:reference-${frame.heatmapReferenceId}`, name: `Replay reference ${frame.heatmapReferenceId}`, timeSeconds: null },
      } } });
      const palette = readHeatmapPalette();
      for (const [canvas, mode, floor, limit] of [[darkRef.current, "darkening", noise, scale], [colorRef.current, "color", 0, colorScale]] as const) {
        if (!canvas) continue;
        canvas.width = difference.width; canvas.height = difference.height;
        const target = canvas.getContext("2d")!;
        const image = target.createImageData(difference.width, difference.height);
        image.data.set(colorizeShadowDifference(difference, mode, floor, limit, palette));
        target.putImageData(image, 0, 0);
      }
      setReadout({ frame: frame.frame, text: `Frame ${frame.frame} · reference ${frame.heatmapReferenceId} · ${difference.width} × ${difference.height} samples · ${difference.sampledPixels} eligible pixels · maximum darkening ${difference.maxDarkening.toFixed(1)} luma.` });
    }); });
    return () => { cancelAnimationFrame(first); cancelAnimationFrame(second); };
  }, [frame, reference, playing, noise, scale, colorScale, minimumReference, sampleSource]);

  const activeProjection = !playing && projection?.frame === frame && projection.reference === reference && projection.minimumReference === minimumReference ? projection : null;

  return <section className={styles.evidence} aria-label="Replay shadow heatmaps">
    <h2>Shadow heatmaps</h2>
    <p className={styles.muted}>Whole-frame comparison with the empty-sheet reference captured by this replay. No fingertip regions or clustering.</p>
    <div className={styles.heatmapControls}>
      {([
        ["Darkening noise floor", noise, setNoise, 0, 254],
        ["Darkening full scale", scale, setScale, 1, 255],
        ["Color-shift full scale", colorScale, setColorScale, 1, 255],
        ["Ignore reference luma below", minimumReference, setMinimumReference, 0, 255],
      ] as const).map(([label, value, setter, min, max]) => <label key={label}>{label}<input type="number" min={min} max={max} value={value} onChange={(event) => { const next = event.target.valueAsNumber; if (Number.isFinite(next)) setter(Math.max(min, Math.min(max, next))); }} /></label>)}
    </div>
    <p className={styles.muted} aria-live="polite">{message}</p>
    <h3 className={styles.chartTitle}>Darkening from reference</h3>
    <canvas id="replay-darkening-map" ref={darkRef} className={styles.heatmapCanvas} aria-label="Replay darkening heatmap" />
    <div className={styles.heatmapLegend} /><div className={styles.legendLabels}><span>≤ {noise}: no displayed darkening</span><span>≥ {Math.max(scale, noise + 1)} luma</span></div>
    <h3 className={styles.chartTitle}>Color change / ambiguity</h3>
    <canvas id="replay-color-map" ref={colorRef} className={styles.heatmapCanvas} aria-label="Replay color change heatmap" />
    <div className={styles.heatmapLegend} /><div className={styles.legendLabels}><span>Same color proportions</span><span>≥ {colorScale}: strong shift</span></div>
    <ProjectionMaps difference={activeProjection?.difference ?? null} sampleFrame={activeProjection?.sampleFrame ?? null} minimumReferenceLuma={minimumReference} noiseFloor={noise} fullScale={scale} />
    <p className={styles.muted}>Gray = unavailable or ignored. Fingers can appear in both maps. Low color shift does not prove shadow; high shift does not prove skin. Scales remain fixed across frames. Updates while paused.</p>
  </section>;
}
