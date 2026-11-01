"use client";

import { DEFAULT_DARK_SHADOW_FILTER, type DarkShadowFilter } from "../cv/darkShadowRegion";

const fields = [
  ["minLumaDrop", "Minimum darkening from paper", 0, 255],
  ["maxLuma", "Maximum pixel luma", 0, 255],
  ["maxRgbChannel", "Maximum RGB channel", 0, 255],
  ["maxRedGreenDifference", "Maximum red minus green", -255, 255],
] as const;

export default function ShadowFilterControls({ value, onChange, disabled = false }: {
  value: Readonly<DarkShadowFilter>;
  onChange: (value: DarkShadowFilter) => void;
  disabled?: boolean;
}) {
  return <fieldset disabled={disabled} style={{ padding: 12, marginBlock: 12 }}>
    <legend>Experimental dark-pixel filter</legend>
    <p>All four limits must pass. Change values, then rerun to apply them. Existing results retain their recorded settings. These controls affect diagnostics only.</p>
    <div style={{ display: "flex", flexWrap: "wrap", gap: 16 }}>
      {fields.map(([key, label, min, max]) => <label key={key}>
        {label} <input type="number" min={min} max={max} step={1} value={value[key]}
          aria-label={label}
          style={{ width: 80 }}
          onChange={(event) => {
            const next = event.target.valueAsNumber;
            if (Number.isFinite(next)) onChange({ ...value, [key]: Math.max(min, Math.min(max, Math.round(next))) });
          }} />
      </label>)}
    </div>
    <button type="button" onClick={() => onChange({ ...DEFAULT_DARK_SHADOW_FILTER })}>Reset dark-pixel filter</button>
  </fieldset>;
}
