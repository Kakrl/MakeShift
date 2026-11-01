import { useEffect, useRef, useState } from "react";
import { captureShadowSample, SAMPLE_LABELS, SAMPLE_PHASES, type SampleLabel, type SamplePhase, type ShadowSample, type ShadowSampleFrame, type ShadowSampleSettings } from "../../cv/shadowSamples";
import styles from "./heatmap.module.css";

const LIMIT = 200;
export default function ShadowSampleCollector({ frame, settings }: { frame: ShadowSampleFrame | null; settings: ShadowSampleSettings }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [label, setLabel] = useState<SampleLabel>("ambiguous");
  const [phase, setPhase] = useState<SamplePhase>("unspecified");
  const [size, setSize] = useState(1);
  const [note, setNote] = useState("");
  const [samples, setSamples] = useState<ShadowSample[]>([]);
  const [point, setPoint] = useState<{ frame: ShadowSampleFrame; x: number; y: number } | null>(null);
  const x = Math.max(0, Math.min((frame?.current.width ?? 1) - 1, point?.x ?? Math.floor((frame?.current.width ?? 1) / 2)));
  const y = Math.max(0, Math.min((frame?.current.height ?? 1) - 1, point?.y ?? Math.floor((frame?.current.height ?? 1) / 2)));
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const context = canvas.getContext("2d")!;
    context.clearRect(0, 0, canvas.width, canvas.height);
    if (!frame) return;
    canvas.width = frame.current.width; canvas.height = frame.current.height;
    context.putImageData(frame.current, 0, 0);
    const radius = Math.floor(size / 2);
    context.strokeStyle = getComputedStyle(document.documentElement).getPropertyValue("--color-focus").trim();
    context.lineWidth = 1;
    context.strokeRect(Math.max(0, x - radius) + 0.5, Math.max(0, y - radius) + 0.5,
      Math.min(canvas.width, x + radius + 1) - Math.max(0, x - radius),
      Math.min(canvas.height, y + radius + 1) - Math.max(0, y - radius));
  }, [frame, x, y, size]);

  function save(atX: number, atY: number) {
    if (!frame || samples.length >= LIMIT) return;
    const sample = captureShadowSample(frame.difference, frame.current, frame.reference, frame.context, settings,
      { x: atX, y: atY, size, label, phase, note });
    if (sample) setSamples((previous) => [...previous, { ...sample, id: crypto.randomUUID(), savedAt: new Date().toISOString() }].slice(0, LIMIT));
  }
  function download() {
    const blob = new Blob([JSON.stringify({ schemaVersion: 1, exportedAt: new Date().toISOString(), samples }, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a"); link.href = url; link.download = "shadow-samples.json"; link.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }
  return <section className={styles.collector} aria-label="Labeled shadow samples">
    <h3>Labeled pixel / patch samples</h3>
    <p className={styles.muted}>Choose a label and click the source image to save a sample. Label what you see in the source, then compare both methods. For mixed patches, use boundary or ambiguous. Samples stay in memory while this view is open; export before reloading or switching diagnostic views.</p>
    <div className={styles.inputs}>
      <label>Sample label<select aria-label="Sample label" value={label} onChange={(event) => setLabel(event.target.value as SampleLabel)}>{SAMPLE_LABELS.map((value) => <option key={value}>{value}</option>)}</select></label>
      <label>Contact phase<select aria-label="Contact phase" value={phase} onChange={(event) => setPhase(event.target.value as SamplePhase)}>{SAMPLE_PHASES.map((value) => <option key={value}>{value}</option>)}</select></label>
      <label>Patch size<select aria-label="Patch size" value={size} onChange={(event) => setSize(Number(event.target.value))}>{[1, 3, 5, 9].map((value) => <option key={value} value={value}>{value} × {value}</option>)}</select></label>
      <label>Sample note<input maxLength={300} value={note} onChange={(event) => setNote(event.target.value)} /></label>
    </div>
    <canvas id="sample-source" ref={canvasRef} className={styles.sampleCanvas} aria-label="Source image for labeling samples" onClick={(event) => {
      if (!frame) return;
      const rect = event.currentTarget.getBoundingClientRect();
      const atX = Math.max(0, Math.min(frame.current.width - 1, Math.floor((event.clientX - rect.left) / rect.width * frame.current.width)));
      const atY = Math.max(0, Math.min(frame.current.height - 1, Math.floor((event.clientY - rect.top) / rect.height * frame.current.height)));
      setPoint({ frame, x: atX, y: atY }); save(atX, atY);
    }} />
    <div className={styles.inputs}>
      <label>Sample X<input type="number" min="0" max={frame ? frame.current.width - 1 : 0} value={x} disabled={!frame} onChange={(event) => { const n = event.target.valueAsNumber; if (frame && Number.isInteger(n)) setPoint({ frame, x: Math.max(0, Math.min(frame.current.width - 1, n)), y }); }} /></label>
      <label>Sample Y<input type="number" min="0" max={frame ? frame.current.height - 1 : 0} value={y} disabled={!frame} onChange={(event) => { const n = event.target.valueAsNumber; if (frame && Number.isInteger(n)) setPoint({ frame, x, y: Math.max(0, Math.min(frame.current.height - 1, n)) }); }} /></label>
      <button type="button" disabled={!frame || samples.length >= LIMIT} onClick={() => save(x, y)}>Save selected sample</button>
      <button type="button" disabled={!samples.length} onClick={download}>Export samples JSON</button>
    </div>
    <p className={styles.muted} data-testid="sample-count">{samples.length} / {LIMIT} samples saved{samples.length === LIMIT ? "; export or remove samples before saving more" : ""}. Coordinates use the analysis image. Unknown values export as null.</p>
    {samples.length > 0 && <div className={styles.sampleList}><table><caption>Saved samples (both methods evaluated at capture settings)</caption><thead><tr><th>Label / phase</th><th>Source / position</th><th>Color / projection retained</th><th /></tr></thead><tbody>{samples.map((sample) => <tr key={sample.id}>
      <td>{sample.selection.label} / {sample.selection.phase}</td><td>{sample.context.source.name} · {sample.context.source.frame === null ? "image" : `frame ${sample.context.source.frame}`} · ({sample.selection.x}, {sample.selection.y})</td>
      <td>{sample.counts.colorRetained} / {sample.counts.projectionRetained} of {sample.counts.total}; unknown {sample.counts.colorUnknown} / {sample.counts.projectionUnknown}</td>
      <td><button type="button" aria-label={`Remove sample ${sample.id}`} onClick={() => setSamples((previous) => previous.filter((value) => value.id !== sample.id))}>Remove</button></td>
    </tr>)}</tbody></table></div>}
  </section>;
}
