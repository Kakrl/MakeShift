// Production player and HTTP submission; intercepted API, no hosted database writes.
import assert from "node:assert/strict";
import { createRequire } from "node:module";
const require = createRequire(new URL("../../frontend/package.json", import.meta.url));
const { chromium } = require("playwright");
const browser = await chromium.launch({ channel: process.env.BROWSER_CHANNEL || "chromium", headless: true });
try {
  const page = await browser.newPage();
  const id = "00000000-0000-4000-8000-000000000290";
  const song = {
    id, title: "Replay fixture", authorName: "Fixture", bpm: 120,
    meter: { numerator: 4, denominator: 4 }, createdAt: "2026-11-19T00:00:00Z",
    durationMs: 4000, noteCount: 1, octaves: 1, replayCount: 0,
    notes: [{ pitch: "C4", velocity: 80, startMs: 0, durationMs: 4000 }],
  };
  const submissions = [];
  const listSorts = [];
  const errors = [];
  page.on("pageerror", error => errors.push(error.message));
  await page.addInitScript(() => localStorage.setItem("hasVisited", "true"));
  await page.route("**/api/recordings**", async route => {
    const request = route.request();
    const url = new URL(request.url());
    if (url.pathname === `/api/recordings/${id}/replays`) {
      assert.equal(request.method(), "POST");
      submissions.push(request.postDataJSON());
      await route.fulfill({ json: { counted: true } });
    } else if (url.pathname === `/api/recordings/${id}`) {
      await route.fulfill({ json: song });
    } else {
      assert.equal(url.pathname, "/api/recordings");
      listSorts.push(url.searchParams.get("sort"));
      const summary = { ...song };
      delete summary.notes;
      await route.fulfill({ json: { recordings: [summary], nextCursor: null } });
    }
  });
  const base = process.env.MAKE_SHIFT_URL || "http://127.0.0.1:3000";
  await page.goto(`${base}/?song=${id}`);
  const dialog = page.getByRole("dialog", { name: "Songs" });
  await dialog.getByRole("button", { name: "Play", exact: true }).click();
  await page.waitForFunction(() => document.querySelector('[role="slider"][aria-label="Song position"]')?.getAttribute("aria-valuenow") > 250);
  await dialog.getByRole("button", { name: "Pause", exact: true }).click();
  assert.equal(submissions.length, 0);
  await page.waitForTimeout(2200);
  assert.equal(submissions.length, 0, "paused time must not qualify");
  await dialog.getByRole("button", { name: "Play", exact: true }).click();
  await dialog.getByRole("button", { name: "Play again", exact: true }).waitFor();
  assert.equal(submissions.length, 1);
  assert.ok(submissions[0].listenedMs >= 2000);
  await dialog.getByRole("button", { name: "Play again", exact: true }).click();
  await dialog.getByRole("button", { name: "Play again", exact: true }).waitFor();
  assert.equal(submissions.length, 2);
  assert.ok(submissions[1].listenedMs >= 2000);
  await dialog.getByRole("button", { name: "Shared songs", exact: true }).click();
  await dialog.getByRole("combobox", { name: "Sort songs" }).waitFor();
  assert.equal(await dialog.getByRole("combobox", { name: "Sort songs" }).inputValue(), "most-replays");
  assert.ok(listSorts.includes("most-replays"));
  assert.deepEqual(errors, []);
  console.log(`PASS: production replay submission, pause/resume, Play again and Shared default (${await browser.version()}); API intercepted`);
} finally {
  await browser.close();
}
