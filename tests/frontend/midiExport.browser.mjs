/* Production regression for #140. Run after npm run build && npm start.
 * Seeds a completed take through React's test-page state, then clicks the real
 * export UI and inspects the downloaded MIDI bytes. No writer/download mocks.
 * The private React hook lookup is deliberately guarded: UI changes must fail
 * this fixture explicitly, never silently skip the browser regression.
 */
import assert from "node:assert/strict";
import { createRequire } from "node:module";
const require = createRequire(new URL("../../frontend/package.json", import.meta.url));
const { chromium } = require("playwright");
const browser = await chromium.launch({
  channel: process.env.MIDI_BROWSER_CHANNEL || "msedge",
  headless: true,
});
try {
  const page = await browser.newPage({ acceptDownloads: true });
  const errors = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.goto(process.env.MAKE_SHIFT_URL || "http://127.0.0.1:3000");
  await page.getByRole("button", { name: "Start recording", exact: true }).waitFor();
  await page.evaluate(() => {
    const button = document.querySelector('button[aria-label="Start recording"]');
    const key = Object.keys(button).find((name) => name.startsWith("__reactFiber$"));
    let fiber = button[key];
    while (fiber) {
      let hook = fiber.memoizedState;
      while (hook) {
        // Home owns recorder and consumer refs, then completedRecording state.
        const recorder = hook.memoizedState?.current;
        if (typeof recorder?.startRecording === "function" &&
            typeof recorder?.stopRecording === "function") {
          const consumers = hook.next;
          if (!consumers?.memoizedState ||
              !("current" in consumers.memoizedState) || consumers.queue !== null)
            throw new Error("Consumer-ref fixture no longer matches Home hooks");
          const completed = consumers.next;
          if (!completed?.queue?.dispatch || completed.memoizedState !== null)
            throw new Error("Completed-recording fixture no longer matches Home hooks");
          completed.queue.dispatch({
            id: "export-regression", name: "Export regression", bpm: 120,
            createdAt: "2026-09-29T00:00:00.000Z",
            notes: [{ pitch: "C3", velocity: 80, startMs: 0, durationMs: 500 }],
          });
          return;
        }
        hook = hook.next;
      }
      fiber = fiber.return;
    }
    throw new Error("Recorder fixture not found; update test for Home's state layout");
  });
  for (let attempt = 0; attempt < 2; attempt++) {
    await page.getByRole("button", { name: "Export .MIDI Recording", exact: true }).click();
    const pending = page.waitForEvent("download", { timeout: 10000 });
    await page.getByRole("button", { name: "Export", exact: true }).click();
    const download = await pending;
    assert.equal(await download.failure(), null);
    assert.equal(download.suggestedFilename(), "recording.mid");
    const chunks = [];
    for await (const chunk of await download.createReadStream()) chunks.push(chunk);
    const bytes = Buffer.concat(chunks);
    assert.equal(bytes.toString("ascii", 0, 4), "MThd");
    assert.equal(bytes.readUInt32BE(4), 6);
    assert.equal(bytes.readUInt16BE(10), 1);
    assert.equal(bytes.readUInt16BE(12), 128);
    assert.equal(bytes.toString("ascii", 14, 18), "MTrk");
    assert.equal(bytes.readUInt32BE(18), bytes.length - 22);
    // Tempo 120; C3 on at tick 0, velocity round(80/100*127)=102;
    // C3 off at tick 128 (500 ms), then end of track.
    assert.deepEqual([...bytes.subarray(22)], [
      0, 255, 81, 3, 7, 161, 32,
      0, 144, 48, 102,
      129, 0, 128, 48, 102,
      0, 255, 47, 0,
    ]);
    await page.getByRole("button", { name: "Export", exact: true }).waitFor({ state: "hidden" });
    await download.delete();
  }
  assert.deepEqual(errors, []);
  console.log(`PASS: two production MIDI downloads, exact bytes and dialog closure (${await browser.version()})`);
} finally {
  await browser.close();
}
