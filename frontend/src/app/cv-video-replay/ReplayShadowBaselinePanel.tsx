"use client";

import { useEffect, useRef, useState } from "react";
import { detectShadowBaseline, SHADOW_BASELINE_CUTOFFS, type ShadowBaselineCutoff } from "../../cv/liveShadowBaseline";
import { baselineSnapshot, explainShadowDecision, shadowPixelFingerprint, type BaselineDfs, type BaselineLevel } from "../../cv/shadowBaselineDiagnostics";
import { colorizeShadowDifference, readHeatmapPalette } from "../../cv/shadowHeatmap";
import type { ReplayVisualFrame } from "./page";
import styles from "./replay.module.css";

type Inspection = { frame: number; current: ImageData; result: ReturnType<typeof detectShadowBaseline> };
const flag = (value: boolean) => value ? "yes" : "no";

/** Same geometry, visited-pixel and witness conventions as the static DFS gallery. */
function drawPaths(context: CanvasRenderingContext2D, dfs: BaselineDfs, level: BaselineLevel,
  width: number, color: (name: string) => string) {
  const allowed = new Set(dfs.corridor.map(point => point.y * width + point.x));
  context.globalAlpha = 0.55; context.fillStyle = color("purple");
  for (const p of dfs.corridor) if ([[1, 0], [-1, 0], [0, 1], [0, -1]].some(([dx, dy]) =>
    !allowed.has((p.y + dy) * width + p.x + dx))) context.fillRect(p.x, p.y, 1, 1);
  context.globalAlpha = 0.3;
  for (const [searches, name] of [[level.downwardSearches, "red"], [level.upwardSearches, "green"]] as const) {
    context.fillStyle = color(name);
    for (const search of searches) for (const p of search.visited) context.fillRect(p.x, p.y, 1, 1);
  }
  context.globalAlpha = 1; context.fillStyle = color("blue");
  for (const p of dfs.arc) context.fillRect(p.x, p.y, 1, 1);
  context.fillStyle = color("purple");
  for (const p of level.attachments) context.fillRect(p.x, p.y, 1, 1);
  const down = level.downwardSearches.find(search => search.reached) ?? level.downwardSearches[0];
  const up = level.upwardSearches.find(search => search.reached) ?? level.upwardSearches[0];
  const witness = down?.reached ? down : up ?? down;
  context.lineWidth = 0.4;
  for (const [y, name] of [[dfs.aY, "purple"], [dfs.downwardY, "red"], [dfs.upwardY, "green"]] as const) {
    context.strokeStyle = color(name); context.beginPath();
    context.moveTo(dfs.crossSection.left - 8, y); context.lineTo(dfs.crossSection.right + 8, y); context.stroke();
  }
  if (witness) {
    context.setLineDash([1, 1]); context.strokeStyle = color("purple");
    context.strokeRect(witness.minimumX, dfs.upwardY, witness.maximumX - witness.minimumX + 1, dfs.downwardY - dfs.upwardY);
    context.setLineDash([]);
  }
  for (const [search, name] of [[down, "red"], [up, "green"]] as const) if (search?.reached) {
    context.strokeStyle = color(name); context.lineWidth = 0.7; context.beginPath();
    search.path.forEach((p, i) => i ? context.lineTo(p.x + 0.5, p.y + 0.5) : context.moveTo(p.x + 0.5, p.y + 0.5));
    context.stroke();
    if (search.endpoint) { context.beginPath(); context.arc(search.endpoint.x + 0.5, search.endpoint.y + 0.5, 1.6, 0, Math.PI * 2); context.stroke(); }
  }
}

export default function ReplayShadowBaselinePanel({ frame, reference, playing }: {
  frame: ReplayVisualFrame | null; reference: ImageData | null; playing: boolean;
}) {
  const overviewRef = useRef<HTMLCanvasElement>(null);
  const tileRefs = useRef<Array<HTMLCanvasElement | null>>([]);
  const [inspection, setInspection] = useState<Inspection | null>(null);
  const [rendered, setRendered] = useState<{ frame: number; candidate: number | null; cutoff: number } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [candidateId, setCandidateId] = useState<number | null>(null);
  const [selectedCutoff, setSelectedCutoff] = useState<ShadowBaselineCutoff | null>(null);
  const baseline = frame?.baseline;
  const cutoff = selectedCutoff ?? baseline?.cutoff ?? 20;
  const current = inspection?.frame === frame?.frame && !playing ? inspection : null;
  const candidate = current?.result.candidates.find(item => item.id === candidateId) ?? current?.result.candidates[0];
  const dfs = candidate?.dfs ?? null;
  const level = dfs?.levels.find(item => item.threshold === cutoff);
  const explanation = candidate ? explainShadowDecision(candidate.keyIndex, dfs, level) : null;

  useEffect(() => {
    setError(null); setInspection(null);
    if (playing || !frame?.baseline || !reference || !frame.baseline.frameToSheet) return;
    try {
      const video = document.querySelector<HTMLVideoElement>("#video");
      if (!video || video.readyState < 2) throw new Error("Wait for the paused video frame.");
      const native = document.createElement("canvas");
      native.width = frame.baseline.frameWidth; native.height = frame.baseline.frameHeight;
      const nativeContext = native.getContext("2d", { willReadFrequently: true });
      const small = document.createElement("canvas");
      small.width = reference.width; small.height = reference.height;
      const context = small.getContext("2d", { willReadFrequently: true });
      if (!nativeContext || !context) throw new Error("Unable to read paused pixels.");
      nativeContext.drawImage(video, 0, 0, native.width, native.height);
      context.drawImage(native, 0, 0, small.width, small.height);
      const pixels = context.getImageData(0, 0, small.width, small.height);
      if (shadowPixelFingerprint(pixels) !== frame.baseline.sourceFingerprint)
        throw new Error("The decoded pixels differ from the originally scored frame. Paths are hidden to avoid showing a different decision.");
      const result = detectShadowBaseline(pixels, reference, native.width, native.height,
        frame.baseline.frameToSheet, frame.baseline.layout, frame.baseline.cutoff, true);
      if (JSON.stringify(baselineSnapshot(result.candidates)) !== JSON.stringify(frame.baseline.candidates))
        throw new Error("Recomputed proposals or decisions differ from the scored frame. Paths are hidden.");
      setInspection({ frame: frame.frame, current: pixels, result });
    } catch (cause) { setError(cause instanceof Error ? cause.message : "Inspection unavailable."); }
  }, [frame, reference, playing]);

  useEffect(() => {
    setRendered(null);
    for (const canvas of [overviewRef.current, ...tileRefs.current]) canvas?.getContext("2d", { willReadFrequently: true })?.clearRect(0, 0, canvas.width, canvas.height);
    if (!current?.result.diagnostics || !overviewRef.current) return;
    const { difference, mask } = current.result.diagnostics;
    const { width, height } = current.current;
    const color = (name: string) => getComputedStyle(overviewRef.current!).getPropertyValue(`--color-${name}`).trim();
    const overview = overviewRef.current;
    overview.width = width; overview.height = height;
    const overviewContext = overview.getContext("2d", { willReadFrequently: true })!;
    overviewContext.putImageData(current.current, 0, 0);
    overviewContext.fillStyle = color("yellow"); overviewContext.globalAlpha = 0.3;
    for (let i = 0; i < mask.length; i++) if (mask[i]) overviewContext.fillRect(i % width, Math.floor(i / width), 1, 1);
    overviewContext.globalAlpha = 1; overviewContext.font = "bold 12px sans-serif";
    for (const item of current.result.candidates) {
      overviewContext.strokeStyle = color(item.id === candidate?.id ? "red" : "blue");
      overviewContext.lineWidth = item.id === candidate?.id ? 2 : 1;
      overviewContext.beginPath(); overviewContext.arc(item.x, item.y, 4, 0, Math.PI * 2); overviewContext.stroke();
      overviewContext.fillStyle = color("red"); overviewContext.fillText(String(item.id), item.x + 5, item.y - 5);
    }
    if (!candidate) { setRendered({ frame: current.frame, candidate: null, cutoff }); return; }
    const palette = readHeatmapPalette();
    const geometry = new Uint8ClampedArray(width * height * 4);
    for (let i = 0; i < mask.length; i++) geometry.set([mask[i] ? 255 : 0, mask[i] ? 255 : 0, mask[i] ? 255 : 0, 255], i * 4);
    const images = [current.current, new ImageData(geometry, width, height),
      new ImageData(new Uint8ClampedArray(colorizeShadowDifference(difference, "darkening", 5, 120, palette)), width, height),
      new ImageData(new Uint8ClampedArray(colorizeShadowDifference(difference, "candidate", 5, 120, palette,
        { method: "projection", maximumColorShift: 10, maximumResidual: 0.12 })), width, height)];
    const cropWidth = Math.min(width, Math.max(64, candidate.width * 3));
    const cropHeight = Math.min(height, 64);
    const left = Math.max(0, Math.min(width - cropWidth, candidate.x - Math.floor(cropWidth / 2)));
    const top = Math.max(0, Math.min(height - cropHeight, candidate.y - 36));
    images.forEach((pixels, index) => {
      const layer = document.createElement("canvas"); layer.width = width; layer.height = height;
      const context = layer.getContext("2d", { willReadFrequently: true })!; context.putImageData(pixels, 0, 0);
      if (dfs && level) drawPaths(context, dfs, level, width, color);
      context.strokeStyle = color("red"); context.lineWidth = 0.5;
      context.beginPath(); context.arc(candidate.x, candidate.y, 2, 0, Math.PI * 2); context.stroke();
      const target = tileRefs.current[index];
      if (!target) return;
      target.width = 480; target.height = Math.round(480 * cropHeight / cropWidth);
      const targetContext = target.getContext("2d", { willReadFrequently: true })!;
      targetContext.imageSmoothingEnabled = false;
      targetContext.drawImage(layer, left, top, cropWidth, cropHeight, 0, 0, target.width, target.height);
    });
    setRendered({ frame: current.frame, candidate: candidate.id, cutoff });
  }, [current, candidate, dfs, level, cutoff]);

  return <section className={styles.evidence} aria-label="Shadow DFS inspector"
    data-frame={frame?.frame ?? -1} data-reference={frame?.heatmapReferenceId ?? ""} data-ready={current && rendered?.frame === current.frame && rendered?.candidate === (candidate?.id ?? null) && rendered?.cutoff === cutoff ? "true" : "false"} data-source-match={current ? "true" : "false"}>
    <p className={styles.eyebrow}>Frame {frame?.frame ?? "—"} · reference {frame?.heatmapReferenceId ?? "unavailable"} · replay cutoff {baseline?.cutoff ?? "—"}</p>
    <h2>Shadow DFS inspection</h2>
    <p className={styles.muted}>Candidate numbers belong to this frame. NO PRESS is the detector’s rejection, not independently proven hover. A key stays pressed if another eligible candidate accepts at the replay cutoff.</p>
    {playing ? <p>Pause replay to inspect this frame’s edges and paths.</p>
      : error ? <p role="alert">{error}</p>
      : !reference || !baseline?.frameToSheet ? <p>Waiting for a complete marker capture and reference.</p>
      : !current ? <p>Checking paused pixels and decisions…</p>
      : <>
        <p className={styles.muted}>Paused pixels and proposals match the scored frame. Inspecting another cutoff changes only this view.</p>
        <div className={styles.sectionHeading}>
          <label>Candidate <select aria-label="Inspect candidate" value={candidate?.id ?? ""} onChange={event => setCandidateId(Number(event.target.value))}>
            {!current.result.candidates.length && <option value="">No proposals</option>}
            {current.result.candidates.map(item => <option key={item.id} value={item.id}>#{item.id} · ({item.x}, {item.y}) · {item.keyIndex < 0 ? "outside keys" : `key ${item.keyIndex}`}</option>)}
          </select></label>
          <label>DFS cutoff <select aria-label="Inspect DFS cutoff" value={cutoff} onChange={event => setSelectedCutoff(Number(event.target.value) as ShadowBaselineCutoff)}>
            {SHADOW_BASELINE_CUTOFFS.map(value => <option key={value}>{value}</option>)}
          </select></label>
        </div>
        <div className={styles.tableScroll}><table><thead><tr><th>Candidate</th><th>Key</th>{SHADOW_BASELINE_CUTOFFS.map(value => <th key={value}>{value} luma</th>)}</tr></thead>
          <tbody>{current.result.candidates.map(item => <tr key={item.id} className={item.id === candidate?.id ? styles.selectedRow : undefined}>
            <td><button type="button" aria-pressed={item.id === candidate?.id} onClick={() => setCandidateId(item.id)}>#{item.id}</button></td><td>{item.keyIndex < 0 ? "excluded" : item.keyIndex}</td>
            {SHADOW_BASELINE_CUTOFFS.map(value => <td key={value}>{explainShadowDecision(item.keyIndex, item.dfs, item.dfs?.levels.find(level => level.threshold === value)).label}</td>)}
          </tr>)}</tbody></table></div>
        {explanation ? <div className={styles.decision} data-testid="dfs-decision"><strong>{explanation.label} at {cutoff}</strong><p>{explanation.reason}</p>
          <p className={styles.muted}>Replay decision at {baseline?.cutoff}: {candidate!.keyIndex < 0 ? "EXCLUDED" : candidate!.decision === null ? "UNKNOWN" : candidate!.decision ? "PRESS" : "NO PRESS"} · tip ({candidate!.x}, {candidate!.y}) · width {candidate!.width}px</p>
        </div> : <p>No fingertip proposals; this frame contributes no pressed keys.</p>}
        {dfs && level && <>
          <p className={styles.muted}>c=d=e=4 · locality radius4 · a={dfs.aY}, veto y={dfs.downwardY}, support y={dfs.upwardY} · mask darkening &gt;5, residual &gt;0.12 · DFS shadow darkening &gt;{cutoff}, residual ≤0.12</p>
          <p data-testid="dfs-flags">Downward veto: {flag(level.downwardVeto)} · upward support: {flag(level.upwardReached)} · downward unknown: {flag(level.downwardUnknown)} · upward unknown: {flag(level.upwardUnknown)} · complete cross-section: {flag(dfs.crossSection.complete)}</p>
          <details><summary>Searches and local width windows</summary><div className={styles.tableScroll}><table><thead><tr><th>Direction</th><th>Seed</th><th>X window</th><th>Visited</th><th>Reached</th><th>Unavailable</th><th>Width / band cap</th></tr></thead>
            <tbody>{([['down', level.downwardSearches], ['up', level.upwardSearches]] as const).flatMap(([direction, searches]) => searches.map((search, index) => <tr key={`${direction}-${index}`}>
              <td>{direction}</td><td>{search.seed.x},{search.seed.y}</td><td>{search.minimumX}…{search.maximumX}</td><td>{search.visited.length}</td><td>{search.endpoint ? `${search.endpoint.x},${search.endpoint.y}` : "no"}</td><td>{flag(search.unavailable)}</td><td>{flag(search.hitWidthLimit)} / {flag(search.hitCorridorLimit)}</td>
            </tr>))}</tbody></table></div></details>
        </>}
      </>}
    <canvas ref={overviewRef} className={styles.heatmapCanvas} hidden={!current} aria-label="Frame source with filtered geometry and numbered proposals" />
    <div className={styles.dfsTiles} hidden={!current || !candidate}>
      {["Source and DFS", "Filtered geometry and DFS", "Raw darkening and DFS", "Filtered shadow and DFS"].map((label, index) => <figure key={label}>
        <figcaption>{label}</figcaption><canvas ref={canvas => { tileRefs.current[index] = canvas; }} aria-label={label} />
      </figure>)}
    </div>
    {current && candidate && <p className={styles.muted}>Blue: selected edge. Purple: allowed band, seeds and a-row. Red: downward visited pixels / veto witness. Green: upward visited pixels / support witness. Dashed box: shown seed’s width window. A line marks an actual successful path; translucent pixels show searched branches. All overlays use analysis pixels; zoom adds no detail.</p>}
  </section>;
}
