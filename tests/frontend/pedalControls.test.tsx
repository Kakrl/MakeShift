// @vitest-environment jsdom
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import PedalControls from "../../frontend/src/app/PedalControls";

const audio = vi.hoisted(() => ({ send: vi.fn(() => true), invalidate: null as null | (() => void) }));
vi.mock("../../frontend/src/app/audio/audioEngine", () => ({ browserAudio: {
  setPedals: audio.send,
  subscribeInvalidation: (fn: () => void) => { audio.invalidate = fn; return () => {}; },
} }));
beforeEach(() => { localStorage.clear(); audio.send.mockClear(); });
afterEach(cleanup);

it.each(["hold", "toggle"])("requires keyup and a fresh %s pedal press after a count-in", mode => {
  const view = render(<PedalControls active />); assign();
  fireEvent.change(screen.getByLabelText("Sustain (damper) mode"), { target: { value: mode } });
  fireEvent.click(sustain());
  view.rerender(<PedalControls active={false} />);
  expect(sustain().getAttribute("aria-checked")).toBe("false");
  fireEvent.keyDown(window, { code: "KeyS" });
  view.rerender(<PedalControls active />);
  fireEvent.keyDown(window, { code: "KeyS", repeat: true });
  fireEvent.keyDown(window, { code: "KeyS" });
  expect(sustain().getAttribute("aria-checked")).toBe("false");
  fireEvent.keyUp(window, { code: "KeyS" });
  fireEvent.keyDown(window, { code: "KeyS" });
  expect(sustain().getAttribute("aria-checked")).toBe("true");
});
const sustain = () => screen.getByRole("switch", { name: /Sustain/ });
function assign(code = "KeyS") {
  fireEvent.click(screen.getByRole("button", { name: "Assign Sustain (damper)" }));
  fireEvent.keyDown(window, { code });
  fireEvent.keyUp(window, { code });
}
it("exposes exactly four switches, clear-all, key composition and immediate state", () => {
  render(<PedalControls active />);
  expect(screen.getAllByRole("switch")).toHaveLength(4);
  assign(); fireEvent.keyDown(window, { code: "KeyS" });
  expect(sustain().getAttribute("aria-checked")).toBe("true");
  fireEvent.click(sustain()); fireEvent.keyUp(window, { code: "KeyS" });
  expect(sustain().getAttribute("aria-checked")).toBe("true");
  fireEvent.click(screen.getByRole("switch", { name: /No pedals/ }));
  expect(sustain().getAttribute("aria-checked")).toBe("false");
});
it("ignores editing/IME input and releases even if focus moved to an input", () => {
  render(<PedalControls active />); assign();
  const input = document.createElement("input"); document.body.append(input);
  fireEvent.keyDown(input, { code: "KeyS" });
  fireEvent.keyDown(window, { code: "KeyS", isComposing: true });
  expect(sustain().getAttribute("aria-checked")).toBe("false");
  fireEvent.keyDown(window, { code: "KeyS" }); fireEvent.keyUp(input, { code: "KeyS" });
  expect(sustain().getAttribute("aria-checked")).toBe("false"); input.remove();
});
it("clears on blur, inactive session, Stop hook and invalidation", () => {
  const clearRef = { current: null as null | (() => void) };
  const view = render(<PedalControls active clearRef={clearRef} />);
  fireEvent.click(sustain()); fireEvent.blur(window);
  expect(sustain().getAttribute("aria-checked")).toBe("false");
  fireEvent.click(sustain()); fireEvent.click(screen.getByRole("button", { name: "Restore unassigned defaults" }));
  expect(sustain().getAttribute("aria-checked")).toBe("false");
  fireEvent.click(sustain());
  // Lifecycle callbacks use React's synchronous event wrapper for observation.
  const button = document.createElement("button"); button.onclick = () => clearRef.current?.();
  fireEvent.click(button); expect(sustain().getAttribute("aria-checked")).toBe("false");
  fireEvent.click(sustain()); button.onclick = () => audio.invalidate?.(); fireEvent.click(button);
  expect(sustain().getAttribute("aria-checked")).toBe("false");
  fireEvent.click(sustain()); view.rerender(<PedalControls active={false} clearRef={clearRef} />);
  expect(sustain().getAttribute("aria-checked")).toBe("false");
});
it("rejects duplicate/reserved capture, persists validated modes and reports blocked storage", () => {
  const view = render(<PedalControls active />); assign();
  fireEvent.click(screen.getByRole("button", { name: "Assign Sostenuto" }));
  fireEvent.keyDown(window, { code: "KeyS" });
  expect(screen.getByRole("status").textContent).toContain("already assigned");
  fireEvent.keyDown(window, { code: "Escape" });
  fireEvent.change(screen.getByLabelText("Sustain (damper) mode"), { target: { value: "toggle" } });
  view.unmount(); render(<PedalControls active />);
  expect((screen.getByLabelText("Sustain (damper) mode") as HTMLSelectElement).value).toBe("toggle");
  const spy = vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => { throw new Error("blocked"); });
  fireEvent.click(screen.getByRole("button", { name: "Restore unassigned defaults" }));
  expect(screen.getByRole("status").textContent).toContain("Storage blocked"); spy.mockRestore();
});
it("falls back with feedback on corrupt storage", () => {
  localStorage.setItem("makeshift:pedal-bindings:v1", "not json");
  render(<PedalControls active />);
  expect(screen.getByRole("status").textContent).toContain("could not be read");
  expect(sustain().getAttribute("aria-checked")).toBe("false");
});
