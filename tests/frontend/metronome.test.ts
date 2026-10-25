import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createMetronome } from "../../frontend/src/app/audio/metronome";

function fixture() {
  const output = {
    prepare: vi.fn(async () => true),
    click: vi.fn(),
    silence: vi.fn(),
    close: vi.fn(),
  };
  const callbacks = {
    onCountInBeat: vi.fn(),
    onCountInComplete: vi.fn(),
    onUnavailable: vi.fn(),
  };
  const clock = createMetronome(output);
  clock.configure({ tempo: 120, beatsPerMeasure: 4, audible: true }, callbacks);
  return { clock, output, callbacks };
}
beforeEach(() =>
  vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout", "performance"] }),
);
afterEach(() => vi.useRealTimers());

describe("shared metronome/count-in", () => {
  it("plays ongoing accented beats with only one deadline timer", () => {
    const { clock, output } = fixture();
    clock.setPlaying(true);
    clock.setPlaying(true);
    vi.advanceTimersByTime(2000);
    expect(output.click.mock.calls.map(([accent]) => accent)).toEqual([
      true,
      false,
      false,
      false,
      true,
    ]);
    expect(vi.getTimerCount()).toBe(1);
    clock.close();
    expect(vi.getTimerCount()).toBe(0);
  });
  it("shares the count-in with ongoing clicks without doubling its first/end beat", () => {
    const { clock, output, callbacks } = fixture();
    clock.setPlaying(true);
    clock.beginCountIn();
    vi.advanceTimersByTime(1999);
    expect(callbacks.onCountInBeat.mock.calls.flat()).toEqual([1, 2, 3, 4]);
    expect(callbacks.onCountInComplete).not.toHaveBeenCalled();
    vi.advanceTimersByTime(1);
    expect(callbacks.onCountInComplete).toHaveBeenCalledTimes(1);
    expect(output.click).toHaveBeenCalledTimes(5);
    vi.advanceTimersByTime(500);
    expect(output.click).toHaveBeenCalledTimes(6);
  });
  it("keeps muted visual count-in while toggle-off cancels audible clicks", () => {
    const { clock, output, callbacks } = fixture();
    clock.setPlaying(true);
    clock.beginCountIn();
    vi.advanceTimersByTime(0);
    clock.setAudible(false);
    vi.advanceTimersByTime(2000);
    expect(output.click).toHaveBeenCalledTimes(1);
    expect(output.silence).toHaveBeenCalled();
    expect(callbacks.onCountInComplete).toHaveBeenCalledTimes(1);
    expect(vi.getTimerCount()).toBe(0);
  });
  it("silences pause, restores resume count-in, then accompanies recording Stop", () => {
    const { clock, output, callbacks } = fixture();
    clock.setPlaying(true);
    vi.advanceTimersByTime(0);
    clock.setPlaying(true, true);
    vi.advanceTimersByTime(1000);
    expect(output.click).toHaveBeenCalledTimes(1);
    clock.beginCountIn();
    // Recorder remains paused during its resume count-in.
    clock.setPlaying(true, true);
    vi.advanceTimersByTime(2000);
    expect(callbacks.onCountInComplete).toHaveBeenCalledTimes(1);
    clock.cancelCountIn();
    clock.setPlaying(true, false);
    vi.advanceTimersByTime(500);
    expect(output.click).toHaveBeenCalledTimes(7);
  });
  it("cannot complete a cancelled count-in or restart after interruption", () => {
    const { clock, output, callbacks } = fixture();
    clock.setPlaying(true);
    clock.beginCountIn();
    vi.advanceTimersByTime(500);
    clock.cancelCountIn();
    vi.advanceTimersByTime(2500);
    expect(callbacks.onCountInComplete).not.toHaveBeenCalled();
    clock.stop();
    const count = output.click.mock.calls.length;
    vi.advanceTimersByTime(5000);
    expect(output.click).toHaveBeenCalledTimes(count);
    expect(vi.getTimerCount()).toBe(0);
  });
  it("updates tempo after the pending beat without restarting/duplicating it", () => {
    const { clock, output, callbacks } = fixture();
    clock.setPlaying(true);
    vi.advanceTimersByTime(250);
    clock.configure(
      { tempo: 60, beatsPerMeasure: 3, audible: true },
      callbacks,
    );
    vi.advanceTimersByTime(250);
    expect(output.click).toHaveBeenCalledTimes(2);
    vi.advanceTimersByTime(999);
    expect(output.click).toHaveBeenCalledTimes(2);
    vi.advanceTimersByTime(1);
    expect(output.click).toHaveBeenCalledTimes(3);
  });
  it("does not burst missed beats when a callback is late", () => {
    let time = 0;
    const output = {
      prepare: vi.fn(async () => true),
      click: vi.fn(),
      silence: vi.fn(),
      close: vi.fn(),
    };
    const clock = createMetronome(output, () => time);
    clock.setPlaying(true);
    vi.advanceTimersByTime(0);
    time = 10000;
    vi.advanceTimersByTime(500);
    expect(output.click).toHaveBeenCalledTimes(2);
    expect(vi.getTimerCount()).toBe(1);
  });
  it("reopens after cleanup and reports audio failure without leaving timers", async () => {
    const { clock, output, callbacks } = fixture();
    clock.close();
    expect(await clock.prepare()).toBe(true);
    clock.setPlaying(true);
    output.click.mockImplementation(() => {
      throw new Error("suspended");
    });
    vi.advanceTimersByTime(0);
    expect(callbacks.onUnavailable).toHaveBeenCalledTimes(1);
    expect(vi.getTimerCount()).toBe(0);
  });
  it("honors invalidation from a completion callback before issuing a click", () => {
    const { clock, output, callbacks } = fixture();
    callbacks.onCountInComplete.mockImplementation(() => clock.stop());
    clock.setPlaying(true);
    clock.beginCountIn();
    vi.advanceTimersByTime(2000);
    expect(output.click).toHaveBeenCalledTimes(4);
    expect(vi.getTimerCount()).toBe(0);
  });
});
