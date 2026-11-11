// @vitest-environment jsdom
import { createElement } from "react";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { browserAudio } from "../../frontend/src/app/audio/audioEngine";
import { millisecondsToTicks } from "../../frontend/src/app/midi/midiUtils";
import SharedRecordingLink from "../../frontend/src/app/play/[id]/page";
import { createMockShareStore } from "../../frontend/src/app/share/mockShareStore";
import SongsDialog, { type MyRecordings } from "../../frontend/src/app/share/SongsDialog";
import { pitchToMidi } from "../../frontend/src/cv/noteMap";

const redirect = vi.hoisted(() => vi.fn());
vi.mock("next/navigation", () => ({ redirect }));
vi.mock("../../frontend/src/app/audio/audioEngine", () => {
  let press = 0;
  return {
    browserAudio: {
      initialize: vi.fn(async () => {}),
      noteOn: vi.fn(() => ({ session: 1, press: ++press })),
      noteOff: vi.fn(() => true),
      subscribeInvalidation: vi.fn(() => () => {}),
    },
  };
});

const mine: MyRecordings = {
  entries: [],
  shares: {},
  rename: () => true,
  remove: async () => false,
  keepShare: () => ({ ok: true }),
  stopSharing: async () => false,
  error: null,
};

const open = (id: string) => render(createElement(SongsDialog, { initialSongId: id, mine, onClose: () => {} }));

// Note on/off events from a format-0 file, as [tick, on, pitch].
function midiNotes(uri: string): [number, boolean, number][] {
  const bytes = Buffer.from(uri.split(",")[1], "base64");
  expect(bytes.toString("ascii", 0, 4)).toBe("MThd");
  let offset = 22;
  let tick = 0;
  const events: [number, boolean, number][] = [];
  const varLength = () => {
    let value = 0;
    for (;;) {
      const byte = bytes[offset++];
      value = value * 128 + (byte & 127);
      if (!(byte & 128)) return value;
    }
  };
  while (offset < bytes.length) {
    tick += varLength();
    const status = bytes[offset++];
    if (status === 255) {
      offset++;
      const length = varLength();
      offset += length;
    } else {
      events.push([tick, status === 144, bytes[offset]]);
      offset += 2;
    }
  }
  return events;
}

describe("shared recording link (#120)", () => {
  beforeEach(() => {
    window.history.pushState({}, "", "/?mock=1");
    vi.mocked(browserAudio.noteOn).mockClear();
    vi.stubGlobal("IntersectionObserver", class {
      observe() {}
      disconnect() {}
    });
  });
  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it("keeps /play/<id> short and opens the song, staying on the mock store", async () => {
    await SharedRecordingLink({ params: Promise.resolve({ id: "a b" }), searchParams: Promise.resolve({}) });
    expect(redirect).toHaveBeenLastCalledWith("/?song=a%20b");
    await SharedRecordingLink({ params: Promise.resolve({ id: "demo-2" }), searchParams: Promise.resolve({ mock: "1" }) });
    expect(redirect).toHaveBeenLastCalledWith("/?song=demo-2&mock=1");
  });

  it("shows the title and author and plays the notes through the audio engine", async () => {
    const song = (await createMockShareStore(undefined, 0).get("demo-2"))!;
    open("demo-2");
    expect(await screen.findByRole("heading", { name: song.title })).toBeTruthy();
    expect(screen.getByText(song.authorName)).toBeTruthy();
    const play = screen.getByRole("button", { name: "Play" });
    await waitFor(() => expect((play as HTMLButtonElement).disabled).toBe(false));
    fireEvent.click(play);
    await waitFor(() => expect(browserAudio.noteOn).toHaveBeenCalled());
    const first = song.notes.reduce((a, b) => (b.startMs < a.startMs ? b : a));
    expect(vi.mocked(browserAudio.noteOn).mock.calls[0][0]).toBe(pitchToMidi(first.pitch));
  });

  it("downloads a MIDI file matching the song's note list", async () => {
    const song = (await createMockShareStore(undefined, 0).get("demo-2"))!;
    let href = "";
    vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(function (this: HTMLAnchorElement) {
      href = this.href;
    });
    open("demo-2");
    const download = await screen.findByRole("button", { name: "Download MIDI" });
    await waitFor(() => expect((download as HTMLButtonElement).disabled).toBe(false));
    fireEvent.click(download);
    const events = midiNotes(href);
    const tick = (ms: number) => millisecondsToTicks(ms, song.bpm);
    const expected = (on: boolean) =>
      song.notes
        .map((n): [number, boolean, number] => [tick(on ? n.startMs : n.startMs + n.durationMs), on, pitchToMidi(n.pitch)!])
        .sort((a, b) => a[0] - b[0] || a[2] - b[2]);
    const actual = (on: boolean) => events.filter((e) => e[1] === on).sort((a, b) => a[0] - b[0] || a[2] - b[2]);
    expect(actual(true)).toEqual(expected(true));
    expect(actual(false)).toEqual(expected(false));
  });

  it("explains a missing or hidden song and leads to the shared list", async () => {
    open("not-a-song");
    const heading = await screen.findByRole("heading", { name: "Song not found" });
    expect(document.activeElement).toBe(heading);
    expect(screen.getByText(/removed or hidden/)).toBeTruthy();
    expect(screen.queryByLabelText("Loading notes")).toBeNull();
    expect(screen.queryByRole("button", { name: "Play" })).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Browse shared songs" }));
    expect(await screen.findByRole("tablist", { name: "Songs" })).toBeTruthy();
  });

  it("says when the song could not load", async () => {
    window.history.pushState({}, "", "/?mock=error");
    open("demo-2");
    expect(await screen.findByRole("heading", { name: "This song didn't load" })).toBeTruthy();
  });
});
