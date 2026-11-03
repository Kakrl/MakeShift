// @vitest-environment jsdom
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import VolumeControl from "../../frontend/src/app/VolumeControl";
import { changeVolume, loadVolume, validVolume, volumeGain } from "../../frontend/src/app/audio/volume";
const setVolume = vi.hoisted(() => vi.fn());
vi.mock("../../frontend/src/app/audio/audioEngine", () => ({ browserAudio: { setVolume } }));
beforeEach(() => { changeVolume(100); localStorage.clear(); setVolume.mockClear(); });
afterEach(cleanup);
it("validates saved levels and preserves the unity baseline", () => {
  expect([0, 100, 200].map(volumeGain)).toEqual([0, 1, 4]);
  for (const bad of [-1, 201, NaN, Infinity, "100", null]) expect(validVolume(bad)).toBe(false);
  localStorage.setItem("makeshift:piano-volume:v1", '"loud"');
  expect(loadVolume()).toBe(100);
});
it("labels native keyboard sliders, synchronizes copies, saves mute and reloads it", () => {
  const view = render(<><VolumeControl /><VolumeControl /></>);
  const sliders = screen.getAllByRole("slider", { name: "Piano volume" });
  fireEvent.change(sliders[0], { target: { value: "200" } });
  expect((sliders[1] as HTMLInputElement).value).toBe("200");
  expect(setVolume).toHaveBeenLastCalledWith(200);
  fireEvent.change(sliders[1], { target: { value: "0" } });
  expect(sliders[0].getAttribute("aria-valuetext")).toBe("Muted");
  view.unmount(); render(<VolumeControl />);
  expect((screen.getByRole("slider") as HTMLInputElement).value).toBe("0");
  expect(setVolume).toHaveBeenLastCalledWith(0);
});
it("continues adjusting when saving is blocked", () => {
  vi.spyOn(Storage.prototype, "setItem").mockImplementationOnce(() => { throw new Error("blocked"); });
  render(<VolumeControl />);
  fireEvent.change(screen.getByRole("slider"), { target: { value: "150" } });
  expect(setVolume).toHaveBeenLastCalledWith(150);
  expect(screen.getByText(/preference could not be saved/).textContent).toContain("could not be saved");
  vi.restoreAllMocks();
});
