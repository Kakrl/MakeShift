import { useEffect, useRef, useState } from "react";
import { colorizeShadowDifference, readHeatmapPalette, type ShadowDifference, type ShadowMapMode } from "../../cv/shadowHeatmap";
import ShadowBandPanel from "./ShadowBandPanel";
import ShadowSampleCollector from "./ShadowSampleCollector";
import type { ShadowSampleFrame } from "../../cv/shadowSamples";
import styles from "./heatmap.module.css";

const maps = [
  ["multiplier", "Brightness multiplier a", "0 → 1.5; 1 means unchanged brightness", 1.5],
  ["attenuation", "Attenuation 1−a", "0 → 1; brighter pixels display at zero", 1],
  ["residualReference", "Color mismatch / reference (e_B)", "0 → residual full scale", 0],
  ["residualCurrent", "Color mismatch / current (e_I)", "0 → residual full scale", 0],
  ["candidate", "Darkening after color exclusion", "Darkening with high color mismatch excluded", 0],
] as const;

export default function ProjectionMaps({ difference, noiseFloor, fullScale, sampleFrame = null, minimumReferenceLuma = 40 }: {
  difference: ShadowDifference | null; noiseFloor: number; fullScale: number;
  sampleFrame?: ShadowSampleFrame | null; minimumReferenceLuma?: number;
}) {
  const canvases = useRef<Partial<Record<ShadowMapMode, HTMLCanvasElement | null>>>({});
  const [residualScale, setResidualScale] = useState(0.3);
  const [method, setMethod] = useState<"color" | "projection">("color");
  const [maximumColorShift, setMaximumColorShift] = useState(10);
  const [maximumResidual, setMaximumResidual] = useState(0.15);
  const [pixel, setPixel] = useState<{ difference: ShadowDifference; text: string } | null>(null);
  useEffect(() => {
    for (const canvas of Object.values(canvases.current)) canvas?.getContext("2d")?.clearRect(0, 0, canvas.width, canvas.height);
    if (!difference) return;
    const palette = readHeatmapPalette();
    for (const [mode, , , scale] of maps) {
      const canvas = canvases.current[mode];
      if (!canvas) continue;
      canvas.width = difference.width; canvas.height = difference.height;
      const context = canvas.getContext("2d")!;
      const output = context.createImageData(canvas.width, canvas.height);
      output.data.set(colorizeShadowDifference(difference, mode, mode === "candidate" ? noiseFloor : 0,
        mode === "candidate" ? fullScale : scale || residualScale, palette,
        { method, maximumColorShift, maximumResidual }));
      context.putImageData(output, 0, 0);
    }
  }, [difference, noiseFloor, fullScale, residualScale, method, maximumColorShift, maximumResidual]);

  function inspect(event: React.PointerEvent<HTMLCanvasElement>) {
    if (!difference) return;
    const rect = event.currentTarget.getBoundingClientRect();
    const x = Math.max(0, Math.min(difference.width - 1, Math.floor((event.clientX - rect.left) / rect.width * difference.width)));
    const y = Math.max(0, Math.min(difference.height - 1, Math.floor((event.clientY - rect.top) / rect.height * difference.height)));
    const i = y * difference.width + x;
    const format = (value: number) => Number.isFinite(value) ? value.toFixed(4) : "unknown";
    setPixel({ difference, text: `Sample (${x}, ${y}): a ${format(difference.multiplier[i])}; 1−a ${format(difference.attenuation[i])}; e_B ${format(difference.residualReference[i])}; e_I ${format(difference.residualCurrent[i])}; color shift ${difference.valid[i] ? format(difference.colorShift[i]) : "unknown"}${difference.projectionValid[i] ? "" : "; insufficient signal / ignored (projection maps unknown)"}.` });
  }
  return <section className={styles.experiment} aria-label="Brightness and chromaticity experiment">
    <h2>Brightness and chromaticity experiment</h2>
    <div className={styles.inputs}>
      <label>Residual full scale<input type="number" min="0.001" max="5" step="0.01" value={residualScale} onChange={(event) => { const n = event.target.valueAsNumber; if (Number.isFinite(n)) setResidualScale(Math.max(0.001, Math.min(5, n))); }} /></label>
      <label>Exclusion method<select aria-label="Exclusion method" value={method} onChange={(event) => setMethod(event.target.value as "color" | "projection")}>
        <option value="color">Normalized RGB color shift</option><option value="projection">Projection residual e_I</option>
      </select></label>
      <label>Maximum retained color shift<input type="number" min="0" max="255" step="1" value={maximumColorShift} onChange={(event) => { const n = event.target.valueAsNumber; if (Number.isFinite(n)) setMaximumColorShift(Math.max(0, Math.min(255, n))); }} /></label>
      <label>Maximum retained e_I<input type="number" min="0" max="1" step="0.01" value={maximumResidual} onChange={(event) => { const n = event.target.valueAsNumber; if (Number.isFinite(n)) setMaximumResidual(Math.max(0, Math.min(1, n))); }} /></label>
    </div>
    <p className={styles.muted}>Compare color-shift exclusion with projection on the same pixels. Thresholds are exploratory. Retained darkening is a shadow candidate, including any neutral objects that fit the model. Gray means unknown; black means excluded or below the display floor.</p>
    <div className={styles.grid}>{maps.map(([mode, title, legend]) => <section className={styles.panel} key={mode}>
      <h3>{title}</h3><canvas id={`${mode}-map`} ref={(canvas) => { canvases.current[mode] = canvas; }} aria-label={title} onPointerMove={inspect} />
      <div className={styles.legend} /><p className={styles.muted}>{legend}{mode.startsWith("residual") ? ` (${residualScale})` : ""}</p>
    </section>)}</div>
    <ShadowBandPanel frame={sampleFrame} settings={{ method, maximumColorShift, maximumResidual, noiseFloor, fullScale, residualScale, minimumReferenceLuma }} />
    <ShadowSampleCollector frame={sampleFrame} settings={{ method, maximumColorShift, maximumResidual, noiseFloor, fullScale, residualScale, minimumReferenceLuma }} />
    <p className={styles.readout} data-testid="projection-pixel">{difference && pixel?.difference === difference ? pixel.text : "Move over a projection map to inspect raw values. Low-signal pixels remain unknown in the maps; raw values can still be inspected."}</p>
  </section>;
}
