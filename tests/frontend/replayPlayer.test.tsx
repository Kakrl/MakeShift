// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import SharedPlayer from "../../frontend/src/app/share/SharedPlayer";
import { browserAudio } from "../../frontend/src/app/audio/audioEngine";
import { replayThresholdMs, type SharedRecording } from "../../frontend/src/lib/recordings";

vi.mock("../../frontend/src/app/audio/audioEngine", () => ({
  browserAudio: {
    initialize: vi.fn(async () => {}),
    noteOn: vi.fn(() => ({ session: 1, press: 1 })),
    noteOff: vi.fn(() => true),
    subscribeInvalidation: () => () => {},
  },
}));

const song = (durationMs: number, id = "shared-song"): SharedRecording => ({
  id, title: "Replay fixture", authorName: "Fixture", bpm: 120, createdAt: "2026-11-19T00:00:00Z",
  durationMs, noteCount: durationMs > 0 ? 1 : 0, octaves: 1, replayCount: 0,
  notes: durationMs > 0 ? [{ pitch: "C4", velocity: 80, startMs: 0, durationMs }] : [],
});
const click = async (name: string) => {
  await act(async () => { fireEvent.click(screen.getByRole("button", { name })); });
};
const advance = async (ms: number) => {
  await act(async () => { await vi.advanceTimersByTimeAsync(ms); });
};

beforeEach(() => {
  vi.useFakeTimers();
  vi.mocked(browserAudio.initialize).mockReset().mockResolvedValue();
  vi.mocked(browserAudio.noteOn).mockReset().mockReturnValue({ session: 1, press: 1 });
});
afterEach(() => { cleanup(); vi.restoreAllMocks(); vi.useRealTimers(); });

it.each([1, 10000, 29999, 30000, 60000])("submits once at the active-listening threshold for %i ms", async duration => {
  const onReplay = vi.fn<(listenedMs: number) => Promise<{ counted: boolean }>>(async () => ({ counted: true }));
  render(<SharedPlayer recording={song(duration)} onReplay={onReplay} />);
  await click("Play");
  await advance(replayThresholdMs(duration) - 1);
  expect(onReplay).not.toHaveBeenCalled();
  await advance(32);
  expect(onReplay).toHaveBeenCalledOnce();
  expect(onReplay.mock.calls[0][0]).toBeGreaterThanOrEqual(replayThresholdMs(duration));
  await advance(1000);
  expect(onReplay).toHaveBeenCalledOnce();
});

it("keeps pause and seek within an attempt, then allows Play again", async () => {
  const onReplay = vi.fn<(listenedMs: number) => Promise<{ counted: boolean }>>(async () => ({ counted: true }));
  render(<SharedPlayer recording={song(10000)} onReplay={onReplay} />);
  await click("Play"); await advance(2000); await click("Pause");
  await advance(10000);
  fireEvent.keyDown(screen.getByRole("slider", { name: "Song position" }), { key: "Home" });
  expect(onReplay).not.toHaveBeenCalled();
  await click("Play"); await advance(3032);
  expect(onReplay).toHaveBeenCalledOnce();
  await click("Pause"); await click("Play"); await advance(10000);
  expect(onReplay).toHaveBeenCalledOnce();
  await click("Play again"); await advance(5032);
  expect(onReplay).toHaveBeenCalledTimes(2);
});

it("does not qualify by seeking forward to the end", async () => {
  const onReplay = vi.fn<(listenedMs: number) => Promise<{ counted: boolean }>>(async () => ({ counted: true }));
  render(<SharedPlayer recording={song(60000)} onReplay={onReplay} />);
  await click("Play"); await advance(1000);
  fireEvent.keyDown(screen.getByRole("slider", { name: "Song position" }), { key: "End" });
  await advance(32);
  expect(onReplay).not.toHaveBeenCalled();
});

it("does not retry a failed metric or interrupt playback", async () => {
  const onReplay = vi.fn(async () => { throw new Error("offline"); });
  render(<SharedPlayer recording={song(10000)} onReplay={onReplay} />);
  await click("Play"); await advance(6000);
  expect(onReplay).toHaveBeenCalledOnce();
  expect(screen.getByRole("button", { name: "Pause" })).toBeTruthy();
  await advance(10000);
  expect(onReplay).toHaveBeenCalledOnce();
  expect(screen.queryByRole("alert")).toBeNull();
});

it("does not count loading, failed audio or zero duration; private players need no callback", async () => {
  const onReplay = vi.fn<(listenedMs: number) => Promise<{ counted: boolean }>>(async () => ({ counted: true }));
  let finish!: () => void;
  vi.mocked(browserAudio.initialize).mockImplementationOnce(() => new Promise<void>(resolve => { finish = resolve; }));
  const view = render(<SharedPlayer recording={song(10000)} onReplay={onReplay} />);
  await click("Play"); await advance(30000);
  expect(onReplay).not.toHaveBeenCalled();
  await act(async () => { finish(); });
  view.unmount();
  vi.mocked(browserAudio.initialize).mockRejectedValueOnce(new Error("audio failed"));
  const failed = render(<SharedPlayer recording={song(10000)} onReplay={onReplay} />);
  await click("Play"); await advance(10000);
  expect(onReplay).not.toHaveBeenCalled(); failed.unmount();
  const empty = render(<SharedPlayer recording={song(0)} onReplay={onReplay} />);
  await click("Play"); await advance(100);
  expect(onReplay).not.toHaveBeenCalled(); empty.unmount();
  render(<SharedPlayer recording={song(10000)} shareActions={false} />);
  await click("Play"); await advance(6000);
  expect(onReplay).not.toHaveBeenCalled();
});

it("resets submission state when another recording loads", async () => {
  const onReplay = vi.fn<(listenedMs: number) => Promise<{ counted: boolean }>>(async () => ({ counted: true }));
  const view = render(<SharedPlayer key="shared-song" recording={song(10000)} onReplay={onReplay} />);
  await click("Play"); await advance(5032);
  view.rerender(<SharedPlayer key="other-song" recording={song(10000, "other-song")} onReplay={onReplay} />);
  await click("Play"); await advance(5032);
  expect(onReplay).toHaveBeenCalledTimes(2);
});
