import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";

// Colors come from the @theme tokens in globals.css so the audit always
// matches what the app renders.
const globalsCss = await readFile(resolve("src/app/globals.css"), "utf8");
const palette = Object.fromEntries(
  [...globalsCss.matchAll(/--color-([\w-]+):\s*(#[0-9a-fA-F]{6})\s*;/g)].map(
    ([, name, hex]) => [name, hex.toLowerCase()],
  ),
);

const checks = [
  { name: "Primary text on app surface", foreground: "ink", background: "surface", minimum: 4.5 },
  { name: "Secondary text on app surface", foreground: "ink-muted", background: "surface", minimum: 4.5 },
  { name: "Muted text on white", foreground: "ink-subtle", background: "white", minimum: 4.5 },
  { name: "White text on dark surface", foreground: "white", background: "surface-dark", minimum: 4.5 },
  { name: "Light text on dark surface", foreground: "ink-inverse", background: "surface-dark", minimum: 4.5 },
  { name: "Secondary text on dark surface", foreground: "ink-inverse-muted", background: "surface-dark", minimum: 4.5 },
  { name: "White text on purple accent", foreground: "white", background: "accent", minimum: 4.5 },
  { name: "Purple text on dark surface", foreground: "accent-light", background: "surface-dark", minimum: 4.5 },
  { name: "White text on destructive action", foreground: "white", background: "danger", minimum: 4.5 },
  { name: "White text on destructive hover", foreground: "white", background: "danger-hover", minimum: 4.5 },
  { name: "Destructive text on light surface", foreground: "danger", background: "surface", minimum: 4.5 },
  { name: "Success text on success badge", foreground: "success-strong", background: "success-soft", minimum: 4.5 },
  { name: "White text on success toast", foreground: "white", background: "success-strong", minimum: 4.5 },
  { name: "Paused text on app surface", foreground: "info", background: "surface", minimum: 4.5 },
  { name: "White icon on success accent", foreground: "white", background: "success", minimum: 3 },
  { name: "Input border on white", foreground: "control-border", background: "white", minimum: 3 },
  { name: "Inactive control on app surface", foreground: "control-inactive", background: "surface", minimum: 3 },
  { name: "Paper guide on white", foreground: "danger", background: "white", minimum: 3 },
];

for (const token of checks.flatMap(({ foreground, background }) => [foreground, background])) {
  if (!palette[token]) throw new Error(`Unknown color token "${token}" (expected --color-${token} in globals.css)`);
}

function relativeLuminance(hex) {
  const channels = hex
    .slice(1)
    .match(/.{2}/g)
    .map((channel) => Number.parseInt(channel, 16) / 255)
    .map((channel) =>
      channel <= 0.04045
        ? channel / 12.92
        : ((channel + 0.055) / 1.055) ** 2.4,
    );

  return 0.2126 * channels[0] + 0.7152 * channels[1] + 0.0722 * channels[2];
}

function contrastRatio(foreground, background) {
  const lighter = Math.max(relativeLuminance(foreground), relativeLuminance(background));
  const darker = Math.min(relativeLuminance(foreground), relativeLuminance(background));
  return (lighter + 0.05) / (darker + 0.05);
}

const results = checks.map((check) => {
  const ratio = contrastRatio(palette[check.foreground], palette[check.background]);
  return {
    ...check,
    foregroundHex: palette[check.foreground],
    backgroundHex: palette[check.background],
    ratio: Number(ratio.toFixed(2)),
    result: ratio >= check.minimum ? "PASS" : "FAIL",
  };
});

const evidence = {
  tool: "MakeShift WCAG contrast audit (WebAIM formula)",
  standard: "WCAG 2.2 success criteria 1.4.3 and 1.4.11",
  generatedAt: new Date().toISOString(),
  thresholds: { normalText: 4.5, largeTextAndUiComponents: 3 },
  checks: results,
  summary: {
    passed: results.filter(({ result }) => result === "PASS").length,
    failed: results.filter(({ result }) => result === "FAIL").length,
  },
};

const outputPath = resolve("test-results/contrast-report.json");
await mkdir(dirname(outputPath), { recursive: true });
await writeFile(outputPath, `${JSON.stringify(evidence, null, 2)}\n`);

console.table(results, ["name", "foreground", "background", "ratio", "minimum", "result"]);
console.log(`JSON evidence written to ${outputPath}`);

if (evidence.summary.failed > 0) process.exitCode = 1;
