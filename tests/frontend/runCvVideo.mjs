#!/usr/bin/env node
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { createServer } from "node:net";
import { mkdir, readdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const frontendDir = path.join(repoRoot, "frontend");
const videoDir = path.join(repoRoot, "tests/automation/CV Test Videos");
const replayScript = path.join(repoRoot, "tests/frontend/cvVideoReplay.browser.mjs");

let clipId;
let browserChannel = process.platform === "darwin" && process.arch === "arm64"
  ? "chrome"
  : undefined;
for (let index = 2; index < process.argv.length; index += 1) {
  const option = process.argv[index];
  if (option === "--clip") clipId = process.argv[++index];
  else if (option === "--browser") browserChannel = process.argv[++index];
  else throw new Error(`Unknown option: ${option}`);
}
assert(clipId === undefined || /^\d+$/.test(clipId), "--clip must be a video number, such as 1");
assert(!browserChannel || ["chrome", "chromium"].includes(browserChannel), "--browser must be chrome or chromium");

const videoNames = await readdir(videoDir);
const sidecarNames = videoNames
  .filter((name) => /^cv_automated_test_\d+\.json$/.test(name))
  .sort((left, right) => Number(left.match(/\d+/)?.[0]) - Number(right.match(/\d+/)?.[0]));
const selectedSidecars = sidecarNames.filter((name) => !clipId || name === `cv_automated_test_${clipId}.json`);
assert(selectedSidecars.length, clipId ? `No labeled clip ${clipId} found` : "No labeled CV clips found");
const cases = [];
for (const sidecarName of selectedSidecars) {
  const id = sidecarName.match(/\d+/)?.[0];
  const sidecarPath = path.join(videoDir, sidecarName);
  const sidecar = JSON.parse(await readFile(sidecarPath, "utf8"));
  assert(typeof sidecar.video === "string", `${sidecarName} must name its video`);
  assert(videoNames.includes(sidecar.video), `Video file not found: ${path.join(videoDir, sidecar.video)}`);
  cases.push({ id, sidecarPath, videoPath: path.join(videoDir, sidecar.video), video: sidecar.video });
}

const resultDir = path.resolve(process.env.CV_RESULT_DIR || path.join(frontendDir, "test-results/cv-video"));
await mkdir(resultDir, { recursive: true });
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
    if (serverProcess.exitCode !== null) {
      throw new Error(`Production server exited with code ${serverProcess.exitCode}`);
    }
    try {
      const response = await fetch(`${baseUrl}/cv-video-replay`);
      if (response.ok) return;
      lastError = new Error(`HTTP ${response.status}`);
    } catch (error) {
      lastError = error;
    }
    await new Promise((resolveWait) => setTimeout(resolveWait, 500));
  }
  throw new Error(`Timed out waiting for the app at ${baseUrl}: ${lastError}`);
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

  const reports = [];
  for (const testCase of cases) {
    const resultPath = path.join(resultDir, `cv_automated_test_${testCase.id}.results.json`);
    console.log(`\nRunning CV replay for clip ${testCase.id}: ${testCase.video}`);
    await run(process.execPath, [replayScript], {
      env: {
        ...process.env,
        MAKE_SHIFT_URL: baseUrl,
        CV_VIDEO_FILE: testCase.videoPath,
        CV_SIDECAR_FILE: testCase.sidecarPath,
        CV_RESULT_FILE: resultPath,
        ...(browserChannel ? { CV_BROWSER_CHANNEL: browserChannel } : {}),
      },
    });
    const report = JSON.parse(await readFile(resultPath, "utf8"));
    reports.push(report);
    console.log(`Full report saved to: ${resultPath}`);
  }

  const scoreTotals = (kind) => {
    const totals = reports.reduce((sum, report) => {
      const score = report.scores?.[kind] || {};
      sum.truePositive += score.truePositive || 0;
      sum.falsePositive += score.falsePositive || 0;
      sum.falseNegative += score.falseNegative || 0;
      return sum;
    }, { truePositive: 0, falsePositive: 0, falseNegative: 0 });
    const predicted = totals.truePositive + totals.falsePositive;
    const expected = totals.truePositive + totals.falseNegative;
    return {
      ...totals,
      precision: predicted ? totals.truePositive / predicted : 0,
      recall: expected ? totals.truePositive / expected : 0,
    };
  };
  const totalFrames = reports.reduce((sum, report) => sum + (report.processedFrames || 0), 0);
  const totalReplayMs = reports.reduce((sum, report) => sum + (report.performance?.replayElapsedMs || 0), 0);
  const summary = {
    clips: reports.map((report) => {
      const summarizeScore = (score = {}) => ({
        truePositive: score.truePositive || 0,
        falsePositive: score.falsePositive || 0,
        falseNegative: score.falseNegative || 0,
        precision: score.precision || 0,
        recall: score.recall || 0,
      });
      const perf = report.performance || {};
      return {
        clip: report.clip,
        processedFrames: report.processedFrames,
        contactTechniques: report.contactTechniques,
        runtime: report.runtime,
        scores: {
          press: summarizeScore(report.scores?.press),
          release: summarizeScore(report.scores?.release),
        },
        performance: {
          replayFps: perf.replayFps,
          steadyStateReplayFps: perf.steadyStateReplayFps,
          replayElapsedMs: perf.replayElapsedMs,
          inferenceMs: perf.inferenceMs,
          markerDetectionCount: perf.markerDetectionCount,
          shadowSamplesSubmitted: perf.shadowSamplesSubmitted,
        },
      };
    }),
    aggregate: {
      clipCount: reports.length,
      processedFrames: totalFrames,
      predictedTransitions: reports.reduce((sum, report) => sum + (report.transitions?.length || 0), 0),
      press: scoreTotals("press"),
      release: scoreTotals("release"),
      replayElapsedMs: totalReplayMs,
      replayFps: totalReplayMs ? totalFrames * 1000 / totalReplayMs : 0,
    },
  };
  const summaryPath = path.join(resultDir, "cv_automated_test_summary.results.json");
  const summaryJson = JSON.stringify(summary, null, 2);
  await writeFile(summaryPath, summaryJson);
  console.log("\nCombined CV metrics summary:");
  console.log(summaryJson);
  console.log(`Combined summary saved to: ${summaryPath}`);
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
