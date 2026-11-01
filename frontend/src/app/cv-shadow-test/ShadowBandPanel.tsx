import { useEffect, useRef, useState } from "react";
import { measureShadowBand, type BandPoint } from "../../cv/shadowBand";
import type { ShadowSampleFrame, ShadowSampleSettings } from "../../cv/shadowSamples";
import styles from "./heatmap.module.css";

export default function ShadowBandPanel({ frame, settings }: { frame: ShadowSampleFrame | null; settings: ShadowSampleSettings }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [tip, setTip] = useState<BandPoint>({ x: 0, y: 0 });
  const [outward, setOutward] = useState<BandPoint>({ x: 0, y: 10 });
  const [selecting, setSelecting] = useState<"tip" | "outward">("tip");
  const [confirmed, setConfirmed] = useState("");
  const [maxDistance, setMaxDistance] = useState(24);
  const [halfWidth, setHalfWidth] = useState(2);
  const [finger, setFinger] = useState("unspecified");
  const [phase, setPhase] = useState("unspecified");
  const [records, setRecords] = useState<Array<{ id: string; savedAt: string; finger: string; phase: string; context: ShadowSampleFrame["context"]; measurement: NonNullable<ReturnType<typeof measureShadowBand>> }>>([]);
  const frameKey = frame ? JSON.stringify([frame.context.source.id, frame.context.source.timeSeconds, frame.context.source.frame, frame.context.reference.id, frame.current.width, frame.current.height]) : "";
  const measurement = frame && confirmed === frameKey ? measureShadowBand(frame.difference, tip, outward, { ...settings, maxDistance, halfWidth }) : null;
  useEffect(() => {
    const canvas = canvasRef.current; if (!canvas) return;
    const context = canvas.getContext("2d")!; context.clearRect(0, 0, canvas.width, canvas.height);
    if (!frame) return;
    canvas.width = frame.current.width; canvas.height = frame.current.height;
    context.putImageData(frame.current, 0, 0);
    if (confirmed !== frameKey) return;
    const theme = getComputedStyle(document.documentElement);
    context.strokeStyle = theme.getPropertyValue("--color-focus").trim(); context.lineWidth = 1;
    context.beginPath(); context.arc(tip.x, tip.y, 3, 0, 2 * Math.PI); context.stroke();
    context.beginPath(); context.moveTo(tip.x, tip.y); context.lineTo(outward.x, outward.y); context.stroke();
    for (const ray of measurement?.rays ?? []) for (const pixel of ray.profile) {
      if (pixel.state === "outside") continue;
      context.fillStyle = theme.getPropertyValue(pixel.state === "shadow-compatible" ? "--color-yellow" : pixel.state === "below-floor" ? "--color-blue" : "--color-control-inactive").trim();
      context.fillRect(pixel.x, pixel.y, 1, 1);
    }
  }, [frame, confirmed, frameKey, tip, outward, measurement]);
  function download() {
    const url = URL.createObjectURL(new Blob([JSON.stringify({ schemaVersion: 1, exportedAt: new Date().toISOString(), records }, null, 2)], { type: "application/json" }));
    const a = document.createElement("a"); a.href = url; a.download = "shadow-band-measurements.json"; a.click(); setTimeout(() => URL.revokeObjectURL(url), 1000);
  }
  return <section className={styles.collector} aria-label="Fingertip shadow band">
    <h3>Fingertip shadow-band measurement</h3>
    <p className={styles.muted}>Mark the distal fingertip boundary on the source, then a point outward onto the paper. Measurements use analysis pixels (maximum image edge 640), not millimeters. Re-mark or confirm the source tip on every frame; a fixed image coordinate does not follow a finger.</p>
    <div className={styles.inputs}>
      <button type="button" onClick={() => setSelecting("tip")}>Mark fingertip</button>
      <button type="button" onClick={() => setSelecting("outward")}>Mark outward direction</button>
      <label>Band scan length<input type="number" min="1" max="64" value={maxDistance} onChange={(e) => { const n = e.target.valueAsNumber; if (Number.isInteger(n)) setMaxDistance(Math.max(1, Math.min(64, n))); }} /></label>
      <label>Band half-width<input type="number" min="0" max="4" value={halfWidth} onChange={(e) => { const n = e.target.valueAsNumber; if (Number.isInteger(n)) setHalfWidth(Math.max(0, Math.min(4, n))); }} /></label>
      <label>Band finger<select aria-label="Band finger" value={finger} onChange={(e) => setFinger(e.target.value)}>{["unspecified", "thumb", "index", "middle", "ring", "pinky"].map((v) => <option key={v}>{v}</option>)}</select></label>
      <label>Band phase<select aria-label="Band phase" value={phase} onChange={(e) => setPhase(e.target.value)}>{["unspecified", "hover", "approach", "touch", "hold", "release"].map((v) => <option key={v}>{v}</option>)}</select></label>
    </div>
    <p className={styles.muted}>Next click sets: {selecting === "tip" ? "fingertip boundary" : "outward direction"}. Yellow = shadow-compatible sample; blue = at/below darkening floor; gray = unknown or color mismatch.</p>
    <canvas id="band-source" className={styles.sampleCanvas} ref={canvasRef} aria-label="Source image for shadow-band measurement" onClick={(event) => {
      if (!frame) return;
      const rect = event.currentTarget.getBoundingClientRect();
      const p = { x: Math.max(0, Math.min(frame.current.width - 1, Math.floor((event.clientX - rect.left) / rect.width * frame.current.width))), y: Math.max(0, Math.min(frame.current.height - 1, Math.floor((event.clientY - rect.top) / rect.height * frame.current.height))) };
      if (selecting === "tip") { const dx = outward.x - tip.x; const dy = outward.y - tip.y; setTip(p); setOutward({ x: p.x + dx, y: p.y + dy }); setSelecting("outward"); setConfirmed(""); }
      else { setOutward(p); setSelecting("tip"); setConfirmed(frameKey); }
    }} />
    <div className={styles.inputs}>{([ ["Tip X", tip.x, "tip", "x"], ["Tip Y", tip.y, "tip", "y"], ["Outward X", outward.x, "outward", "x"], ["Outward Y", outward.y, "outward", "y"] ] as const).map(([label, value, target, axis]) => <label key={label}>{label}<input type="number" value={value} disabled={!frame} onChange={(event) => { const n = event.target.valueAsNumber; if (!Number.isFinite(n)) return; (target === "tip" ? setTip : setOutward)((p) => ({ ...p, [axis]: n })); setConfirmed(""); }} /></label>)}
      <button type="button" disabled={!frame} onClick={() => setConfirmed(frameKey)}>Confirm anchors for this frame</button>
    </div>
    <p data-testid="band-readout" className={styles.readout}>{!frame ? "Pause on a frame with a reference." : confirmed !== frameKey ? "Mark or confirm the fingertip for this frame." : !measurement ? "Invalid anchors: choose distinct in-image points at least one pixel apart." : measurement.status === "measured" ? `Median band ${measurement.medianWidth} analysis px; ${measurement.measuredRays}/${measurement.totalRays} rays measured.` : `Insufficient evidence: ${measurement.measuredRays}/${measurement.totalRays} rays measured. No press inference.`}</p>
    {measurement && <div className={styles.sampleList}><table><caption>Per-ray band evidence</caption><thead><tr><th>Offset</th><th>Status</th><th>Width / lower bound</th></tr></thead><tbody>{measurement.rays.map((ray) => <tr key={ray.offset}><td>{ray.offset}</td><td>{ray.status}</td><td>{ray.width ?? (ray.lowerBound === null ? "unknown" : `≥ ${ray.lowerBound}`)}</td></tr>)}</tbody></table></div>}
    <p className={styles.muted}>A band must start within three steps and end at a below-floor pixel. Color mismatch or unknown pixels make the boundary ambiguous; reaching the scan/image edge is censored. No visible band stays insufficient evidence. Neighboring shadows, printed ink and a misplaced tip can affect widths.</p>
    <div className={styles.inputs}><button type="button" disabled={!measurement || records.length >= 200} onClick={() => { if (frame && measurement) setRecords((r) => [...r, { id: crypto.randomUUID(), savedAt: new Date().toISOString(), finger, phase, context: structuredClone(frame.context), measurement: structuredClone(measurement) }].slice(0, 200)); }}>Save band measurement</button><button type="button" disabled={!records.length} onClick={download}>Export band JSON</button><button type="button" disabled={!records.length} onClick={() => setRecords((r) => r.slice(0, -1))}>Remove last band record</button></div>
    <p className={styles.muted} data-testid="band-count">{records.length} / 200 band records. Export before reloading or switching views. Records preserve raw ray profiles and capture settings, including unavailable results.</p>
  </section>;
}
