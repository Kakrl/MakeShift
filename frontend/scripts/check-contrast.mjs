import { mkdir, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";

const checks = [
  { name: "Primary text on app surface", foreground: "#1e1e1e", background: "#fffdf7", minimum: 4.5 },
  { name: "Secondary text on app surface", foreground: "#595854", background: "#fffdf7", minimum: 4.5 },
  { name: "Muted text on white", foreground: "#595959", background: "#ffffff", minimum: 4.5 },
  { name: "White text on dark surface", foreground: "#ffffff", background: "#090909", minimum: 4.5 },
  { name: "Secondary text on dark surface", foreground: "#bdbdbd", background: "#090909", minimum: 4.5 },
  { name: "White text on purple accent", foreground: "#ffffff", background: "#7440a8", minimum: 4.5 },
  { name: "Purple text on dark surface", foreground: "#c78cff", background: "#090909", minimum: 4.5 },
  { name: "White text on destructive action", foreground: "#ffffff", background: "#b42318", minimum: 4.5 },
  { name: "Destructive text on light surface", foreground: "#b42318", background: "#fffdf7", minimum: 4.5 },
  { name: "White icon on success accent", foreground: "#ffffff", background: "#237a45", minimum: 3 },
  { name: "Input border on white", foreground: "#767676", background: "#ffffff", minimum: 3 },
  { name: "Inactive control on app surface", foreground: "#8a8882", background: "#fffdf7", minimum: 3 },
  { name: "Paper guide on white", foreground: "#b42318", background: "#ffffff", minimum: 3 },
];

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
  const ratio = contrastRatio(check.foreground, check.background);
  return {
    ...check,
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
