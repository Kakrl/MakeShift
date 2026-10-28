// Run against a production build: MAKE_SHIFT_URL and BROWSER_CHANNEL optional.
import assert from "node:assert/strict";
import { chromium } from "../../frontend/node_modules/playwright/index.mjs";
const browser = await chromium.launch({channel:process.env.BROWSER_CHANNEL ?? "chromium"});
try {
  const page=await browser.newPage({viewport:{width:320,height:800}});
  await page.goto(`${process.env.MAKE_SHIFT_URL ?? "http://127.0.0.1:3000"}/?dev=1`);
  const numerator=page.getByLabel("Time Signature numerator", {exact:true});
  await numerator.fill("32"); await numerator.press("Enter");
  await numerator.press("Tab");
  const denominator=page.getByLabel("Time signature denominator", {exact:true});
  assert.equal(await denominator.evaluate(el => el === document.activeElement),true);
  await denominator.selectOption("32");
  assert.deepEqual(await page.evaluate(() => JSON.parse(localStorage.getItem("makeshift:playback-settings:v1")).meter),{numerator:32,denominator:32});
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth),true);
  await numerator.fill(""); await numerator.press("Enter");
  assert.equal(await numerator.inputValue(),"32");
  assert.match(await page.locator("#meter-error").innerText(),/Restored 32\/32/);
  await page.reload();
  await numerator.waitFor();
  await page.waitForFunction(() => document.querySelector("#time-signature").value === "32");
  assert.equal(await denominator.inputValue(),"32");
  console.log("PASS: 320px meter editing, keyboard focus, validation and max-meter reload (no live count-in/hardware claim)");
} finally { await browser.close(); }
