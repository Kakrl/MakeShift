/* Production library regression: seed versioned storage, reload and inspect real MIDI downloads. */
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
  // This fixture tests export, so skip the first-visit welcome overlay.
  await page.addInitScript(() => {
    localStorage.setItem("hasVisited", "true");
    if (localStorage.getItem("makeshift:recordings:v1") === null) localStorage.setItem("makeshift:recordings:v1", JSON.stringify([{
      id: "export-regression", name: "Export regression", bpm: 120,
      createdAt: "2026-09-29T00:00:00.000Z",
      notes: [{ pitch: "C3", velocity: 80, startMs: 0, durationMs: 500 }],
    }]));
  });
  const errors = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.goto(process.env.MAKE_SHIFT_URL || "http://127.0.0.1:3000");
  for (let attempt = 0; attempt < 2; attempt++) {
    const pending = page.waitForEvent("download", { timeout: 10000 });
    await page.getByRole("button", { name: "Download MIDI", exact: true }).click();
    const download = await pending;
    assert.equal(await download.failure(), null);
    assert.equal(download.suggestedFilename(), "Export regression.mid");
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
  await page.getByRole("button", { name: "Rename", exact: true }).click();
  await page.getByLabel("Name", { exact: true }).fill("Renamed take");
  await page.getByRole("button", { name: "Save name", exact: true }).click();
  await page.reload();
  await page.getByRole("listitem", { name: "Renamed take", exact: true }).waitFor();
  page.once("dialog", (dialog) => dialog.accept());
  await page.getByRole("button", { name: "Delete", exact: true }).click();
  await page.reload();
  await page.getByText("No recordings yet.", { exact: true }).waitFor();
  assert.deepEqual(errors, []);
  console.log(`PASS: library reload, rename/delete, two named MIDI downloads and exact bytes (${await browser.version()})`);
} finally {
  await browser.close();
}
