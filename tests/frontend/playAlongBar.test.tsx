// @vitest-environment jsdom
import { createElement } from "react";
import { act, cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import PlayAlongBar from "../../frontend/src/app/midi/PlayAlongBar";
import { getPlayAlong, startPlayAlong, stopPlayAlong } from "../../frontend/src/app/midi/playAlong";

const recording = {
  id: "take",
  name: "Song",
  bpm: 120,
  createdAt: "2026-10-31T00:00:00.000Z",
  notes: [{ pitch: "C4", velocity: 80, startMs: 0, durationMs: 500 }],
};

function setHidden(hidden: boolean) {
  Object.defineProperty(document, "hidden", { configurable: true, get: () => hidden });
  document.dispatchEvent(new Event("visibilitychange"));
}

describe("play-along lifecycle (#131)", () => {
  afterEach(() => {
    cleanup();
    stopPlayAlong();
    Object.defineProperty(document, "hidden", { configurable: true, get: () => false });
  });

  it("disposes the song when the view unmounts, e.g. visiting Tutorial", async () => {
    const { unmount } = render(createElement(PlayAlongBar));
    await act(async () => startPlayAlong(recording));
    const song = getPlayAlong()!;
    expect(screen.getByRole("region", { name: "Play along" })).toBeTruthy();
    unmount();
    expect(getPlayAlong()).toBeNull();
    expect(song.timeline.getSnapshot().state).toBe("disposed");
  });

  it("pauses the song when the page is hidden and keeps it paused on return", async () => {
    render(createElement(PlayAlongBar));
    await act(async () => startPlayAlong(recording));
    const song = getPlayAlong()!;
    expect(song.timeline.getSnapshot().state).toBe("playing");
    act(() => setHidden(true));
    const paused = song.timeline.getSnapshot();
    expect(paused.state).toBe("paused");
    act(() => setHidden(false));
    expect(song.timeline.getSnapshot()).toMatchObject({ state: "paused", positionMs: paused.positionMs });
    expect(getPlayAlong()).toBe(song);
  });

  it("pauses the song on pagehide", async () => {
    render(createElement(PlayAlongBar));
    await act(async () => startPlayAlong(recording));
    act(() => window.dispatchEvent(new Event("pagehide")));
    expect(getPlayAlong()!.timeline.getSnapshot().state).toBe("paused");
  });
});
