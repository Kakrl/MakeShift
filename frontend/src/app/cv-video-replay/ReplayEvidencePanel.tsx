import type { ReplayVisualFrame } from "./page";
import styles from "./replay.module.css";

type Tip = ReplayVisualFrame["fingertips"][number];
const number = (value: number | null | undefined) => value == null ? "—" : value.toFixed(2);
const signed = (value: number | null | undefined) => value == null ? "—" : `${value > 0 ? "+" : ""}${value.toFixed(2)}`;

function Trend({ label, frames, finger, value, color, zeroBaseline = true }: {
  label: string; frames: ReplayVisualFrame[]; finger: string; value: (tip: Tip) => number | null | undefined; color: string; zeroBaseline?: boolean;
}) {
  const values = frames.map((frame) => {
    const tip = frame.fingertips.find((item) => item.id === finger);
    return tip ? value(tip) ?? null : null;
  });
  const available = values.filter((item): item is number => item !== null);
  const min = available.length ? Math.min(...available, ...(zeroBaseline ? [0] : [])) : 0;
  const max = Math.max(min + 1, ...available);
  const first = frames[0]?.frame ?? 0;
  const last = frames.at(-1)?.frame ?? first;
  const x = (frame: number) => 8 + (frame - first) / Math.max(1, last - first) * 384;
  const y = (v: number) => 60 - (v - min) / (max - min) * 48;
  // Break the line at unavailable samples rather than implying continuity.
  const path = values.map((v, i) => {
    if (v === null) return "";
    const command = i > 0 && values[i - 1] !== null ? "L" : "M";
    return `${command}${x(frames[i].frame)},${y(v)}`;
  }).join(" ");
  const current = values.at(-1);
  return <div className={styles.trend}>
    <div className={styles.trendHeading}><span>{label}</span><strong>{number(current)}</strong></div>
    <svg viewBox="0 0 400 76" role="img" aria-label={`${label}, frames ${first} to ${last}; current ${number(current)}`}>
      <line x1="8" x2="392" y1={y(0)} y2={y(0)} stroke="var(--color-divider)" />
      <path d={path} fill="none" stroke={color} strokeWidth="2" />
      {current != null && <circle cx="392" cy={y(current)} r="3" fill={color} />}
      <text x="8" y="73">{first}</text><text x="392" y="73" textAnchor="end">{last}</text>
    </svg>
    <span className={styles.muted}>Range {number(min)} to {number(max)} · independent vertical scale</span>
  </div>;
}

export default function ReplayEvidencePanel({ frame, history, selected, onSelect }: {
  frame: ReplayVisualFrame; history: ReplayVisualFrame[]; selected: string | null; onSelect: (id: string) => void;
}) {
  const ids = [...new Set([...frame.fingertips.map((tip) => tip.id), ...(selected ? [selected] : [])])];
  const id = selected ?? frame.fingertips.find((tip) => tip.evidence)?.id ?? ids[0] ?? "";
  const tip = frame.fingertips.find((item) => item.id === id);
  const frames = history.filter((item) => item.frame <= frame.frame && item.frame > frame.frame - 60);
  return <section className={styles.evidence} aria-label="Frame shadow evidence">
    <p className={styles.eyebrow}>Frame {frame.frame}: {(frame.mediaTimeMs / 1000).toFixed(3)} s · {frame.fingertips.length} tracked fingers</p>
    <div className={styles.sectionHeading}><h2>Inspect a finger</h2>
      <label>Finger <select aria-label="Inspect finger" value={id} onChange={(event) => onSelect(event.target.value)}>
        {!ids.length && <option value="">No fingers detected</option>}
        {ids.map((key) => <option key={key}>{key}</option>)}
      </select></label>
    </div>
    <p className={styles.muted}>Select a row or finger. The outlined finger, zoom and charts follow this selection.</p>
    <canvas id="finger-detail" className={styles.fingerDetail} aria-label="Selected finger magnified crop" />
    <div className={styles.cards}>
      <div><span>Image motion ΔY</span><strong>{signed(tip?.deltaY)} <small>px</small></strong><small>+ down · − up in image</small></div>
      <div><span>Near darkness</span><strong>{number(tip?.evidence?.near?.darknessPerPixel)}</strong><small>Change {signed(tip?.change?.nearDarknessDelta)}</small></div>
      <div><span>Forward darkness</span><strong>{number(tip?.evidence?.forward?.darknessPerPixel)}</strong><small>Change {signed(tip?.change?.forwardDarknessDelta)}</small></div>
      <div><span>Spatial sharpness</span><strong>{number(tip?.evidence?.maxSpatialGradient)}</strong><small>Maximum row gradient</small></div>
    </div>
    <details><summary>All fingers · select a row to inspect</summary>
      <div className={styles.tableScroll}><table><thead><tr><th>Finger</th><th>ΔY px</th><th>Near px / strength</th><th>Forward px / strength</th><th>Near Δ</th><th>Forward Δ</th><th>Sharpness</th></tr></thead>
        <tbody>{frame.fingertips.map((item, index) => <tr key={`${item.id}-${index}`} className={item.id === id ? styles.selectedRow : undefined}>
          <td><button type="button" aria-pressed={item.id === id} onClick={() => onSelect(item.id)}>{item.id}</button></td>
          <td>{signed(item.deltaY)}</td><td>{item.evidence?.near ? `${item.evidence.near.darkPixels} / ${number(item.evidence.near.darknessPerPixel)}` : "unavailable"}</td>
          <td>{item.evidence?.forward ? `${item.evidence.forward.darkPixels} / ${number(item.evidence.forward.darknessPerPixel)}` : "unavailable"}</td>
          <td>{signed(item.change?.nearDarknessDelta)}</td><td>{signed(item.change?.forwardDarknessDelta)}</td><td>{number(item.evidence?.maxSpatialGradient)}</td>
        </tr>)}</tbody></table></div>
    </details>
    <h3 className={styles.chartTitle}>Last 60 frames · aligned by frame</h3>
    <div className={styles.trends}>
      <Trend zeroBaseline={false} label="Image Y (px)" frames={frames} finger={id} value={(item) => item.point.y} color="var(--color-purple)" />
      <Trend label="Near darkness" frames={frames} finger={id} value={(item) => item.evidence?.near?.darknessPerPixel} color="var(--color-green)" />
      <Trend label="Forward darkness" frames={frames} finger={id} value={(item) => item.evidence?.forward?.darknessPerPixel} color="var(--color-blue)" />
      <Trend label="Spatial sharpness" frames={frames} finger={id} value={(item) => item.evidence?.maxSpatialGradient} color="var(--color-ink)" />
    </div>
    <p className={styles.muted}>Darkness = paper-relative darkening per sampled pixel. + change means darker. Gaps mean unavailable. These are diagnostic cues, not contact decisions.</p>
  </section>;
}
