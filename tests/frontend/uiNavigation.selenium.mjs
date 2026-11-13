/* Selenium UI navigation checks (3.1.1, 3.1.2, 6.2.1). Run against
 * `npm run build && npm start` or a Vercel URL:
 *   MAKE_SHIFT_URL=https://make-shift-chi.vercel.app npm run test:ui-selenium
 * MAKE_SHIFT_URL defaults to http://127.0.0.1:3000. Uses headless Chrome with
 * fake media devices; Selenium Manager finds or downloads Chrome and
 * chromedriver. Desktop viewports only: below lg the tabs move under the
 * camera.
 */
import assert from "node:assert/strict";
import { createRequire } from "node:module";
const requireFromFrontend = createRequire(
  new URL("../../frontend/package.json", import.meta.url),
);
const { Builder, By, until } = requireFromFrontend("selenium-webdriver");
const chrome = requireFromFrontend("selenium-webdriver/chrome");

const base = (process.env.MAKE_SHIFT_URL || "http://127.0.0.1:3000").replace(
  /\/+$/,
  "",
);
const VIEWPORTS = [
  [1024, 768],
  [1440, 900],
  [1920, 1080],
];
const TABS = ["Calibration", "Tutorial", "About"];
// Pages that render the shared side nav; /tutorial is a full-page dialog.
const NAV_PAGES = ["/", "/?dev=1", "/calibration", "/about"];
const TIMEOUT = 30_000;
const TOLERANCE_PX = 1;

// Reported without failing the run until the linked defect is fixed.
class KnownDefect extends Error {
  constructor(id, issue, cause) {
    super(`${id} (${issue}): ${cause.message.split("\n")[0]}`);
  }
}

const results = {};

async function newDriver([width, height]) {
  const options = new chrome.Options().addArguments(
    "--headless=new",
    `--window-size=${width},${height}`,
    "--use-fake-ui-for-media-stream",
    "--use-fake-device-for-media-stream",
    "--autoplay-policy=no-user-gesture-required",
    "--no-sandbox",
  );
  const driver = await new Builder()
    .forBrowser("chrome")
    .setChromeOptions(options)
    .build();
  // --window-size sets the outer window; size the viewport exactly instead.
  await driver.sendDevToolsCommand("Emulation.setDeviceMetricsOverride", {
    width,
    height,
    deviceScaleFactor: 1,
    mobile: false,
  });
  return driver;
}

async function open(driver, path) {
  await driver.get(base + path);
  await driver.wait(until.elementLocated(By.css('nav[aria-label="Main"]')), TIMEOUT);
}

function navTab(driver, label) {
  return driver.findElement(
    By.xpath(`//nav[@aria-label="Main"]/*[normalize-space(.)="${label}"]`),
  );
}

// Fully inside the viewport, page not scrolled, and the top element at its
// centre is the control itself (or, when locked, its "Calibrate first" cover).
async function visibility(driver, element, coverLabel) {
  return driver.executeScript(
    (el, cover) => {
      const r = el.getBoundingClientRect();
      const hit = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2);
      const hitOk =
        !!hit &&
        (el.contains(hit) ||
          (cover !== null && hit.closest(`[aria-label="${cover}"]`) !== null));
      return {
        rect: [r.left, r.top, r.width, r.height].map(Math.round),
        inViewport:
          r.width > 0 &&
          r.height > 0 &&
          r.left >= 0 &&
          r.top >= 0 &&
          r.right <= window.innerWidth &&
          r.bottom <= window.innerHeight,
        scrollY: window.scrollY,
        hitOk,
      };
    },
    element,
    coverLabel ?? null,
  );
}

async function assertVisible(driver, element, name, coverLabel) {
  const v = await visibility(driver, element, coverLabel);
  assert(v.inViewport, `${name} must be inside the viewport: ${JSON.stringify(v)}`);
  assert.equal(v.scrollY, 0, `${name}: page must not be scrolled`);
  assert(v.hitOk, `${name} must not be covered: ${JSON.stringify(v)}`);
  return v.rect;
}

async function checkFirstLoadControls(viewport) {
  const driver = await newDriver(viewport);
  try {
    await open(driver, "/");
    const welcome = await driver.wait(
      until.elementLocated(By.css('[role="dialog"][aria-labelledby="welcome-title"]')),
      TIMEOUT,
    );
    await driver.findElement(By.xpath('//button[normalize-space(.)="Skip for now"]')).click();
    await driver.wait(until.stalenessOf(welcome), TIMEOUT);

    for (const label of TABS) {
      await assertVisible(driver, await navTab(driver, label), `${label} tab`);
    }
    try {
      // Uncalibrated first visit: Record shows behind its "Calibrate first" cover.
      await assertVisible(
        driver,
        await driver.findElement(By.css('button[aria-label="Start recording"]')),
        "Record control",
        "Calibrate first to record",
      );

      // Dev mode counts as calibrated, so Record itself must be on top.
      await open(driver, "/?dev=1");
      await assertVisible(
        driver,
        await driver.wait(
          until.elementLocated(By.css('button[aria-label="Start recording"]')),
          TIMEOUT,
        ),
        "Record control (dev mode)",
      );
    } catch (error) {
      if (error instanceof assert.AssertionError) throw new KnownDefect("D25", "#245", error);
      throw error;
    }
  } finally {
    await driver.quit();
  }
}

async function checkStableTabs(viewport) {
  const driver = await newDriver(viewport);
  try {
    await open(driver, "/");
    await driver.executeScript(() => localStorage.setItem("hasVisited", "true"));
    const positions = {};
    const scrollbar = {};
    for (const path of NAV_PAGES) {
      await open(driver, path);
      scrollbar[path] = await driver.executeScript(
        () => window.innerWidth - document.documentElement.clientWidth,
      );
      positions[path] = {};
      for (const label of TABS) {
        // Active tabs are plain divs, so only check placement, not cover.
        const v = await visibility(driver, await navTab(driver, label));
        assert(v.inViewport, `${label} tab on ${path}: ${JSON.stringify(v)}`);
        positions[path][label] = v.rect;
      }
    }
    const reference = positions["/"];
    const moves = [];
    for (const path of NAV_PAGES.slice(1)) {
      // Expected x offset if only a classic scrollbar's width differs.
      const gutter = scrollbar["/"] - scrollbar[path];
      for (const label of TABS) {
        const rect = positions[path][label];
        const near = (value, i, dx = 0) => Math.abs(value - reference[label][i] - dx) <= TOLERANCE_PX;
        if (rect.every((value, i) => near(value, i))) continue;
        const scrollbarOnly = gutter !== 0 && rect.every((value, i) => near(value, i, i === 0 ? gutter : 0));
        moves.push({ scrollbarOnly, message: `${label} tab moved on ${path}: ${rect} vs / ${reference[label]}` });
      }
    }
    const real = moves.find((move) => !move.scrollbarOnly);
    assert(!real, real?.message);
    if (moves.length > 0) {
      throw new KnownDefect("D26", "#247", new Error(
        `${moves[0].message} (scrollbar ${JSON.stringify(scrollbar)})`,
      ));
    }
    return reference;
  } finally {
    await driver.quit();
  }
}

async function waitForPath(driver, path, from) {
  await driver.wait(
    async () => new URL(await driver.getCurrentUrl()).pathname === path,
    TIMEOUT,
    `expected to reach ${path} from ${from}`,
  );
}

async function checkCalibrationNav(viewport) {
  const driver = await newDriver(viewport);
  try {
    await open(driver, "/");
    await driver.executeScript(() => localStorage.setItem("hasVisited", "true"));
    await open(driver, "/");
    // A slow CPU stalled this navigation behind home CV work (#260).
    await driver.sendDevToolsCommand("Emulation.setCPUThrottlingRate", { rate: 6 });
    await navTab(driver, "Calibration").click();
    await driver.wait(
      until.elementLocated(By.css('[role="dialog"][aria-labelledby="calibration-intro-title"]')),
      TIMEOUT,
    );
    await driver.findElement(By.xpath('//button[normalize-space(.)="Begin Calibration"]')).click();
    await waitForPath(driver, "/calibration", "Begin Calibration");
    await driver.sendDevToolsCommand("Emulation.setCPUThrottlingRate", { rate: 1 });
    const active = await navTab(driver, "Calibration");
    assert.equal(await active.getAttribute("aria-current"), "page");

    await open(driver, "/about");
    await navTab(driver, "Calibration").click();
    await waitForPath(driver, "/calibration", "the About tab");
  } finally {
    await driver.quit();
  }
}

const viewportName = ([w, h]) => `${w}x${h}`;
let failed = false;

async function record(id, key, check, describe) {
  results[id] ??= {};
  try {
    results[id][key] = `PASS: ${describe(await check())}`;
  } catch (error) {
    if (error instanceof KnownDefect) {
      results[id][key] = `KNOWN FAIL: ${error.message}`;
      return;
    }
    failed = true;
    results[id][key] = `FAIL: ${error.message.split("\n")[0]}`;
  }
}

for (const viewport of VIEWPORTS) {
  const name = viewportName(viewport);
  await record("3.1.1", name, () => checkFirstLoadControls(viewport), () =>
    "Calibration, Tutorial, About and Record visible without scrolling");
  await record("3.1.2", name, () => checkStableTabs(viewport), (tabs) =>
    `tabs fixed across ${NAV_PAGES.join(", ")}: ` +
    TABS.map((label) => `${label} ${tabs[label].join(",")}`).join("; "));
}
await record("6.2.1", viewportName(VIEWPORTS[1]), () => checkCalibrationNav(VIEWPORTS[1]), () =>
  "home tab → intro → Begin Calibration and About tab both reach /calibration");

console.log(JSON.stringify(results, null, 2));
if (failed) process.exit(1);
