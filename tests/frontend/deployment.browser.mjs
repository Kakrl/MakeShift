/* Deployment smoke test (#89). Run against `npm run build && npm start`
 * or a Vercel URL:
 *   MAKE_SHIFT_URL=https://make-shift-seven.vercel.app npm run test:deployment
 * MAKE_SHIFT_URL defaults to http://127.0.0.1:3000. BROWSER_CHANNEL selects
 * the browser (default "chromium": full Chromium in new headless mode; the
 * headless shell has no camera support). Install: npx playwright install chromium
 * EXPECT_DATABASE=ok additionally requires /api/health to reach Supabase.
 * Uses fake media devices; real camera and speaker checks stay manual.
 */
import assert from "node:assert/strict";
import { createRequire } from "node:module";
const requireFromFrontend = createRequire(
  new URL("../../frontend/package.json", import.meta.url),
);
const { chromium } = requireFromFrontend("playwright");
// The runtime WASM must match the exactly pinned npm wrapper version.
const tasksVisionVersion = requireFromFrontend("./package.json").dependencies[
  "@mediapipe/tasks-vision"
];

const base = (process.env.MAKE_SHIFT_URL || "http://127.0.0.1:3000").replace(
  /\/+$/,
  "",
);
const PAGES = ["/", "/calibration", "/audio", "/tutorial", "/about"];
const WASM_BASE = `https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@${tasksVisionVersion}/wasm`;
const ASSETS = [
  [base + "/audio/piano-worklet.js", /javascript/],
  [base + "/audio/synth.js", /javascript/],
  [base + "/models/hand_landmarker.task", /./],
  [WASM_BASE + "/vision_wasm_internal.js", /javascript/],
  [WASM_BASE + "/vision_wasm_internal.wasm", /application\/wasm/],
];

const results = {};

async function checkAssets(request) {
  for (const [url, type] of ASSETS) {
    const response = await request.get(url);
    assert.equal(response.status(), 200, `${url} must load`);
    const contentType = response.headers()["content-type"] || "";
    assert.match(contentType, type, `${url} served as ${contentType}`);
    assert((await response.body()).length > 0, `${url} must not be empty`);
  }
  results.assets = `${ASSETS.length} loaded with expected types`;
}

async function checkPages(context) {
  const page = await context.newPage();
  const errors = [];
  page.on("pageerror", (error) => errors.push(error.message));
  for (const path of PAGES) {
    const response = await page.goto(base + path);
    assert.equal(response?.status(), 200, `${path} must return 200`);
  }
  assert.deepEqual(errors, [], "pages must load without uncaught errors");
  await page.close();
  results.pages = PAGES.join(", ");
}

async function checkCameraRecovery(browser) {
  const context = await browser.newContext({ permissions: ["camera"] });
  // Deterministic denial: the first request rejects like a blocked prompt.
  await context.addInitScript(() => {
    const devices = navigator.mediaDevices;
    const original = devices.getUserMedia.bind(devices);
    let calls = 0;
    devices.getUserMedia = (constraints) => {
      calls += 1;
      if (calls === 1) {
        return Promise.reject(new DOMException("denied", "NotAllowedError"));
      }
      return original(constraints).then((stream) => {
        window.testCameraStream = stream;
        return stream;
      });
    };
  });
  const page = await context.newPage();
  // Calibration renders the camera status overlay (home overlays: #112).
  await page.goto(base + "/calibration");
  const status = page.getByRole("status");
  await status.filter({ hasText: "Camera access blocked" }).waitFor();
  await page.getByRole("button", { name: "Try again" }).click();
  await page.waitForFunction(() => window.testCameraStream?.active);
  await status.filter({ hasText: "Camera access blocked" }).waitFor({
    state: "detached",
  });
  // Camera loss: an ended track must surface an error, not a frozen preview.
  await page.evaluate(() => {
    for (const track of window.testCameraStream.getVideoTracks()) {
      track.stop();
      track.dispatchEvent(new Event("ended"));
    }
  });
  await status.filter({ hasText: "Camera disconnected" }).waitFor();
  await page.getByRole("button", { name: "Try again" }).click();
  await page.waitForFunction(() => window.testCameraStream?.active);
  await context.close();
  results.camera = "denial, retry, loss and recovery handled";
}

async function checkLocalPlaying(context) {
  const page = await context.newPage();
  const errors = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.goto(base + "/audio");
  await page.waitForLoadState("networkidle");
  const requests = [];
  // The browser itself may fetch the favicon lazily; that is not app traffic.
  page.on("request", (request) => {
    if (!new URL(request.url()).pathname.startsWith("/favicon")) {
      requests.push(request.url());
    }
  });
  for (let round = 0; round < 3; round += 1) {
    await page
      .getByRole("button", { name: "Enable audio", exact: true })
      .click();
    await page
      .getByRole("status")
      .filter({ hasText: "Audio enabled" })
      .waitFor();
    // The worklet module loads once per AudioContext; notes must not fetch.
    const beforeNotes = requests.length;
    for (const name of ["Soft A4", "Loud A4", "Ten-note chord"]) {
      await page.getByRole("button", { name }).click();
      await page.waitForTimeout(100);
    }
    await page.getByRole("button", { name: "Stop sound" }).click();
    await page.getByRole("status").filter({ hasText: "Stopped." }).waitFor();
    assert.deepEqual(
      requests.slice(beforeNotes),
      [],
      "playing notes must not make network requests",
    );
  }
  assert.deepEqual(errors, []);
  await page.close();
  results.localPlaying = "3 enable/play/stop rounds, 0 note requests";
}

async function checkHealth(request) {
  const response = await request.get(base + "/api/health");
  const body = await response.json();
  assert.ok(body.database?.status, "/api/health must report database status");
  if (process.env.EXPECT_DATABASE === "ok") {
    assert.equal(response.status(), 200, JSON.stringify(body));
    assert.equal(body.database.status, "ok");
  }
  results.database = body.database.status;
}

(async () => {
  const browser = await chromium.launch({
    channel: process.env.BROWSER_CHANNEL || "chromium",
    headless: true,
    args: [
      "--use-fake-device-for-media-stream",
      "--autoplay-policy=no-user-gesture-required",
    ],
  });
  try {
    const context = await browser.newContext();
    await checkAssets(context.request);
    await checkPages(context);
    await checkLocalPlaying(context);
    await checkHealth(context.request);
    await context.close();
    await checkCameraRecovery(browser);
    console.log(
      JSON.stringify(
        { url: base, browser: browser.version(), ...results },
        null,
        2,
      ),
    );
  } finally {
    await browser.close();
  }
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
