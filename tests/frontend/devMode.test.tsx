import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, expect, it, vi } from "vitest";
import SideNav from "../../frontend/src/app/SideNav";
import { isDevMode } from "../../frontend/src/debugFlags";

afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

function at(search: string) {
  vi.stubGlobal("window", { location: { search } });
}

it("enables dev mode only for ?dev=1 outside production", () => {
  at("?dev=1");
  expect(isDevMode()).toBe(true);
  at("?dev=0");
  expect(isDevMode()).toBe(false);
  at("");
  expect(isDevMode()).toBe(false);
  at("?dev=1");
  vi.stubEnv("NEXT_PUBLIC_VERCEL_ENV", "production");
  expect(isDevMode()).toBe(false);
});

it("disables the home calibration tab in dev mode", () => {
  const html = (calibrationDisabled: boolean) =>
    renderToStaticMarkup(createElement(SideNav, { onCalibrationClick: () => {}, calibrationDisabled }));
  expect(html(true)).toMatch(/<button[^>]*disabled[^>]*>.*Calibration/);
  expect(html(false)).not.toMatch(/<button[^>]*disabled/);
});
