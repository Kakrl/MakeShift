#!/usr/bin/env node
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { createServer } from "node:net";
import { mkdir, readdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const frontendDir = path.join(repoRoot, "frontend");
const caseDir = path.resolve(process.env.CV_IMAGE_CASE_DIR || path.join(repoRoot, "images_test_cases"));
const backgroundPath = path.join(caseDir, "background.png");
const resultDir = path.join(frontendDir, "test-results/cv-image-cases");
const resultPath = path.resolve(
  process.env.CV_IMAGE_RESULT_FILE || path.join(resultDir, "synchronous-shadow-image-report.json"),
);
const channel = process.env.CV_BROWSER_CHANNEL ||
  (process.platform === "darwin" && process.arch === "arm64" ? "chrome" : undefined);
const replayScript = path.join(repoRoot, "tests/frontend/cvImageCases.browser.mjs");

const names = await readdir(caseDir);
assert(names.includes("background.png"),
  `Save the empty-sheet marker/background frame as ${backgroundPath}`);
const supportedImage = /\.(png|jpe?g|webp)$/i;
const casePaths = names
  .filter((name) => name !== "background.png" && supportedImage.test(name))
  .sort((left, right) => left.localeCompare(right))
  .map((name) => path.join(caseDir, name));
assert(casePaths.length, `No labeled image cases found in ${caseDir}`);

await mkdir(path.dirname(resultPath), { recursive: true });
const port = await new Promise((resolvePort, reject) => {
  const server = createServer();
  server.once("error", reject);
  server.listen(0, "127.0.0.1", () => {
    const address = server.address();
    server.close((error) => error ? reject(error) : resolvePort(address.port));
  });
});
const baseUrl = `http://127.0.0.1:${port}`;
const nextCli = path.join(frontendDir, "node_modules/next/dist/bin/next");
const npm = process.platform === "win32" ? "npm.cmd" : "npm";
let serverProcess;

function run(command, args, options = {}) {
  return new Promise((resolveRun, reject) => {
    const child = spawn(command, args, { cwd: frontendDir, stdio: "inherit", ...options });
    child.once("error", reject);
    child.once("exit", (code, signal) => {
      if (code === 0) resolveRun();
      else reject(new Error(`${command} exited with ${code ?? signal}`));
    });
  });
}

async function waitForServer() {
  const deadline = Date.now() + 90_000;
  let lastError;
  while (Date.now() < deadline) {
    if (serverProcess.exitCode !== null)
      throw new Error(`Production server exited with code ${serverProcess.exitCode}`);
    try {
      const response = await fetch(`${baseUrl}/cv-image-test`);
      if (response.ok) return;
      lastError = new Error(`HTTP ${response.status}`);
    } catch (error) {
      lastError = error;
    }
    await new Promise((resolveWait) => setTimeout(resolveWait, 500));
  }
  throw new Error(`Timed out waiting for ${baseUrl}: ${lastError}`);
}

try {
  console.log("Building the production app...");
  await run(npm, ["run", "build"]);
  console.log(`Starting the app at ${baseUrl}...`);
  serverProcess = spawn(process.execPath, [nextCli, "start", "--hostname", "127.0.0.1", "--port", String(port)], {
    cwd: frontendDir,
    stdio: "inherit",
  });
  await waitForServer();
  await run(process.execPath, [replayScript], {
    env: {
      ...process.env,
      MAKE_SHIFT_URL: baseUrl,
      CV_IMAGE_BACKGROUND: backgroundPath,
      CV_IMAGE_CASES: casePaths.join(path.delimiter),
      CV_IMAGE_RESULT_FILE: resultPath,
      ...(channel ? { CV_BROWSER_CHANNEL: channel } : {}),
    },
  });
  const report = JSON.parse(await readFile(resultPath, "utf8"));
  const samples = report.images.flatMap((image) => image.targets.map((target) => ({
    label: image.label,
    measurement: target.measurement,
    refinedMeasurement: target.refinedMeasurement,
  })));
  const counts = {
    hoverSamples: samples.filter((item) => item.label === "hover").length,
    hoverTrueNegatives: samples.filter((item) => item.label === "hover" && item.measurement?.state === "hover").length,
    hoverFalsePositives: samples.filter((item) => item.label === "hover" && item.measurement?.state === "press candidate").length,
    pressSamples: samples.filter((item) => item.label === "press").length,
    pressTruePositives: samples.filter((item) => item.label === "press" && item.measurement?.state === "press candidate").length,
    pressFalseNegatives: samples.filter((item) => item.label === "press" && item.measurement && item.measurement.state !== "press candidate").length,
    unknownMeasurements: samples.filter((item) => !item.measurement || item.measurement.state === "unknown").length,
    fingertipRefinements: samples.filter((item) => item.refinedMeasurement).length,
    refinementNotFound: samples.filter((item) => !item.refinedMeasurement).length,
    refinedHoverTrueNegatives: samples.filter((item) => item.label === "hover" && item.refinedMeasurement?.state === "hover").length,
    refinedHoverFalsePositives: samples.filter((item) => item.label === "hover" && item.refinedMeasurement?.state === "press candidate").length,
    refinedPressTruePositives: samples.filter((item) => item.label === "press" && item.refinedMeasurement?.state === "press candidate").length,
    refinedPressFalseNegatives: samples.filter((item) => item.label === "press" && item.refinedMeasurement && item.refinedMeasurement.state !== "press candidate").length,
  };
  report.summary = counts;
  await writeFile(resultPath, JSON.stringify(report, null, 2));
  console.log("Labeled image summary:");
  console.log(JSON.stringify(counts, null, 2));
  console.log(`Full diagnostics: ${resultPath}`);
} finally {
  if (serverProcess && serverProcess.exitCode === null) {
    serverProcess.kill("SIGTERM");
    await new Promise((resolveExit) => {
      const timeout = setTimeout(() => {
        serverProcess.kill("SIGKILL");
        resolveExit();
      }, 5000);
      serverProcess.once("exit", () => {
        clearTimeout(timeout);
        resolveExit();
      });
    });
  }
}
