// Actual production home page + camera canvas + shipped Vision worker + AudioWorklet.
// Requires the native fixture exporter, and a running production frontend.
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtemp, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
const root = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../..",
);
const require = createRequire(path.join(root, "frontend/package.json"));
const { chromium } = require("playwright");
const directory = await mkdtemp(path.join(tmpdir(), "makeshift-vision-live-"));
const native = spawnSync(
  process.env.VISION_NATIVE_ORACLE ??
    path.join(root, "build/vision/wasm_parity_native"),
  [directory],
  { encoding: "utf8" },
);
if (native.status !== 0)
  throw new Error(
    native.stderr ||
      native.error?.message ||
      "Build the native Vision oracle first",
  );
const manifest = JSON.parse(
  await readFile(path.join(directory, "manifest.json"), "utf8"),
);
const empty = manifest.steps.find((s) => s.action === "frame");
const press = manifest.steps.find((s) => s.expected?.pressedKeys?.length);
assert(press, "Fixture contains a real detected press");
const base = process.env.MAKE_SHIFT_URL ?? "http://127.0.0.1:3000";
const browser = await chromium.launch({
  channel: process.env.BROWSER_CHANNEL ?? "chrome",
  headless: true,
});
let page;
try {
  page = await browser.newPage();
  const errors = [],
    requests = [];
  page.on("pageerror", (e) => errors.push(e.message));
  page.on("request", (r) => requests.push(r.url()));
  await page.route("**/vision-fixtures/*.rgba", async (route) => {
    const name = new URL(route.request().url()).pathname.split("/").at(-1);
    assert(/^\d+\.rgba$/.test(name));
    await route.fulfill({
      body: await readFile(path.join(directory, name)),
      contentType: "application/octet-stream",
    });
  });
  await page.addInitScript(
    ({ width, height, emptyFile }) => {
      window.visionFrames = [];
      window.audioCommands = [];
      const NativeWorker = window.Worker;
      window.Worker = class extends NativeWorker {
        constructor(...args) {
          super(...args);
          this.addEventListener("message", ({ data }) => {
            if (data.type === "frame")
              window.visionFrames.push({
                keys: data.result.pressedKeys,
                scan: data.result.referenceScan,
                revision: data.result.referenceRevision,
              });
          });
        }
      };
      const NativeAudioNode = window.AudioWorkletNode;
      window.AudioWorkletNode = class extends NativeAudioNode {
        constructor(...args) {
          super(...args);
          const send = this.port.postMessage.bind(this.port);
          this.port.postMessage = (message, ...rest) => {
            window.audioCommands.push(message);
            return send(message, ...rest);
          };
        }
      };
      let canvas;
      window.showVisionFrame = async (name) => {
        const response = await fetch(`/vision-fixtures/${name}`);
        const rgba = new Uint8ClampedArray(await response.arrayBuffer());
        canvas
          .getContext("2d")
          .putImageData(new ImageData(rgba, width, height), 0, 0);
      };
      navigator.mediaDevices.getUserMedia = async () => {
        canvas = document.createElement("canvas");
        canvas.width = width;
        canvas.height = height;
        await window.showVisionFrame(emptyFile);
        const stream = canvas.captureStream(0);
        const track = stream.getVideoTracks()[0];
        setInterval(() => {
          if (track.readyState === "live") track.requestFrame();
        }, 1000 / 30);
        const settings = track.getSettings.bind(track);
        track.getSettings = () => ({
          ...settings(),
          deviceId: "vision-fixture",
          width,
          height,
          facingMode: "",
        });
        window.visionCameraTrack = track;
        return stream;
      };
      localStorage.setItem("hasVisited", "true");
    },
    { width: empty.width, height: empty.height, emptyFile: empty.file },
  );
  await page.goto(`${base}/?dev=1`);
  await page.locator('[data-vision-state="ready"]').waitFor();
  await page
    .getByRole("button", { name: "Set reference", exact: true })
    .click();
  await page
    .locator("[data-vision-status]")
    .filter({ hasText: "Reference captured" })
    .waitFor();
  await page.getByRole("button", { name: "Enable audio", exact: true }).click();
  await page.getByRole("status").filter({ hasText: "Playing" }).waitFor();
  const note = 48 + press.expected.pressedKeys[0];
  const before = requests.length;
  await page.evaluate((name) => window.showVisionFrame(name), press.file);
  await page.waitForFunction(
    (note) =>
      window.audioCommands.some((e) => e.type === "note-on" && e.note === note),
    note,
  );
  const highlighted = page.locator(`polygon[data-key-midi="${note}"][data-key-active="true"]`);
  await highlighted.waitFor();
  assert.equal(await highlighted.getAttribute("fill"), "var(--color-red)", "White press highlights red");
  await page.screenshot({ path: "/tmp/makeshift-key-highlights.png" });
  const onsets = await page.evaluate(
    () => window.audioCommands.filter((e) => e.type === "note-on").length,
  );
  await page
    .getByRole("button", { name: "Set reference", exact: true })
    .click();
  await page
    .locator("[data-vision-status]")
    .filter({ hasText: "Release all keys" })
    .waitFor();
  assert.equal(
    await page.evaluate(
      () => window.audioCommands.filter((e) => e.type === "note-on").length,
    ),
    onsets,
    "Held snapshot must not retrigger",
  );
  await page.evaluate((name) => window.showVisionFrame(name), empty.file);
  await page.waitForFunction(() =>
    window.audioCommands.some((e) => e.type === "note-off"),
  );
  await highlighted.waitFor({ state: "detached" });
  const revision = await page.evaluate(
    () => window.visionFrames.at(-1).revision,
  );
  await page
    .getByRole("button", { name: "Set reference", exact: true })
    .click();
  await page.waitForFunction(
    (revision) =>
      window.visionFrames.some(
        (f) => f.revision > revision && f.scan.status === "captured",
      ),
    revision,
  );
  assert.equal(
    await page
      .getByRole("button", { name: "Enable audio", exact: true })
      .isDisabled(),
    true,
    "Accepted empty reference refresh preserves the live audio session",
  );
  await page.evaluate((name) => window.showVisionFrame(name), press.file);
  await page.waitForFunction(
    (onsets) =>
      window.audioCommands.filter((e) => e.type === "note-on").length > onsets,
    onsets,
  );
  const releases = await page.evaluate(
    () => window.audioCommands.filter((e) => e.type === "reset").length,
  );
  await page.evaluate(() => window.visionCameraTrack.stop());
  await page.waitForFunction(
    (releases) =>
      window.audioCommands.filter((e) => e.type === "reset").length > releases,
    releases,
  );
  await page
    .getByRole("button", { name: "Enable audio", exact: true })
    .waitFor({ state: "visible" });
  assert.equal(
    await page
      .getByRole("button", { name: "Enable audio", exact: true })
      .isDisabled(),
    true,
    "Camera loss disables playing",
  );
  assert.deepEqual(errors, []);
  assert(
    !requests.some((url) => /hand_landmarker|jsdelivr|opencv/.test(url)),
    "Home must not load the old detector",
  );
  assert(
    requests.slice(before).every((url) => /vision-fixtures|favicon/.test(url)),
    "Playing must not fetch per-note resources",
  );
  console.info(
    JSON.stringify({
      status: "PASS",
      browser: browser.version(),
      note,
      checks:
        "real camera pixels → Vision worker → audio worklet; manual/blocked reference, hold, release, recapture, restart and camera loss",
      fixtures: directory,
    }),
  );
} catch (error) {
  if (page)
    console.error(
      await page.evaluate(() => ({
        status: document.querySelector("[data-vision-status]")?.textContent,
        frames: window.visionFrames?.slice(-3),
        video: {
          width: document.querySelector("video")?.videoWidth,
          height: document.querySelector("video")?.videoHeight,
        },
        messages: [...document.querySelectorAll('[role=\"status\"]')].map(
          (e) => e.textContent,
        ),
      })),
    );
  throw error;
} finally {
  await browser.close();
}
