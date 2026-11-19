// @vitest-environment jsdom
import { createElement } from "react";
import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import SongsDialog, { type MyRecordings } from "../../frontend/src/app/share/SongsDialog";
import { favorites } from "../../frontend/src/lib/favorites";
import { shareStore } from "../../frontend/src/app/share/shareStore";

const mine: MyRecordings = {
  entries: [
    {
      saved: true,
      recording: {
        id: "take-1",
        name: "My practice",
        bpm: 120,
        createdAt: "2026-10-01T00:00:00.000Z",
        notes: [{ pitch: "C4", velocity: 80, startMs: 0, durationMs: 500 }],
      },
    },
  ],
  shares: {},
  rename: () => true,
  remove: async () => false,
  keepShare: () => ({ ok: true }),
  stopSharing: async () => false,
  error: null,
};

const open = (tab: "shared" | "mine" = "shared") =>
  render(createElement(SongsDialog, { initialTab: tab, mine, onClose: () => {} }));
const titles = () => screen.queryAllByRole("button", { name: /^Favorite / }).map((b) => b.getAttribute("aria-label")!.slice(9));
const search = (value: string) => fireEvent.change(screen.getByRole("searchbox", { name: "Search songs by title" }), { target: { value } });
let observeMore: IntersectionObserverCallback | null;

describe("finding songs in the dialog (#281, #282)", () => {
  beforeEach(() => {
    window.history.pushState({}, "", "/?mock=1");
    vi.stubGlobal("IntersectionObserver", class {
      constructor(callback: IntersectionObserverCallback) { observeMore = callback; }
      observe() {}
      disconnect() {}
    });
  });
  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
    for (const id of favorites.getSnapshot()) favorites.toggle(id);
  });

  it("defaults Shared to Most replays and preserves each tab's sort choices", async () => {
    open(); await screen.findByText("Mary's little lamb");
    const sort = () => screen.getByRole<HTMLSelectElement>("combobox", { name: "Sort songs" });
    expect(sort().value).toBe("most-replays");
    fireEvent.change(sort(), { target: { value: "oldest" } });
    fireEvent.click(screen.getByRole("tab", { name: "My recordings" }));
    expect(sort().value).toBe("newest");
    expect(within(sort()).queryByRole("option", { name: "Most replays" })).toBeNull();
    fireEvent.change(sort(), { target: { value: "longest" } });
    fireEvent.click(screen.getByRole("tab", { name: "Shared" }));
    expect(sort().value).toBe("oldest");
    search("zzzz"); await screen.findByText(/No songs match/, {}, { timeout: 2000 });
    fireEvent.click(screen.getByRole("button", { name: "Clear filters" }));
    expect(sort().value).toBe("most-replays");
    fireEvent.click(screen.getByRole("tab", { name: "My recordings" }));
    expect(sort().value).toBe("longest");
  });

  it("does not render a recording twice when rankings change between pages", async () => {
    const row = (id: string) => ({
      id, title: `Ranked ${id}`, authorName: "Fixture", bpm: 120, durationMs: 10000,
      noteCount: 1, octaves: 1, createdAt: "2026-11-19T00:00:00Z", replayCount: 0,
    });
    const listing = vi.spyOn(shareStore, "list")
      .mockResolvedValueOnce({ recordings: [row("a"), row("b")], nextCursor: "replays:6" })
      .mockResolvedValueOnce({ recordings: [row("b"), row("c")], nextCursor: null });
    open(); await screen.findByText("Ranked a");
    await act(async () => observeMore!([{ isIntersecting: true } as IntersectionObserverEntry], {} as IntersectionObserver));
    await screen.findByText("Ranked c");
    expect(screen.getAllByText("Ranked b")).toHaveLength(1);
    expect(listing).toHaveBeenLastCalledWith("replays:6", expect.objectContaining({ sort: "most-replays" }));
  });

  it("narrows the shared list by title after a pause in typing", async () => {
    open();
    await screen.findByText("Mary's little lamb");
    search("jingle");
    expect(await screen.findByText("Jingle Bells, left hand too", {}, { timeout: 2000 })).toBeTruthy();
    await waitFor(() => expect(screen.queryByText("Mary's little lamb")).toBeNull());
  });

  it("says nothing matched, and Clear filters restores the list", async () => {
    open();
    await screen.findByText("Mary's little lamb");
    search("zzzz");
    expect(await screen.findByText(/No songs match/, {}, { timeout: 2000 })).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Clear filters" }));
    expect(await screen.findByText("Mary's little lamb", {}, { timeout: 2000 })).toBeTruthy();
    expect((screen.getByRole("searchbox") as HTMLInputElement).value).toBe("");
  });

  it("sorts oldest first and filters by octave size", async () => {
    open();
    await screen.findByText("Mary's little lamb");
    fireEvent.change(screen.getByRole("combobox", { name: "Sort songs" }), { target: { value: "oldest" } });
    await waitFor(() => expect(titles()[0]).toBe("C, F, G chord practice"));
    fireEvent.change(screen.getByRole("combobox", { name: /octaves or fewer/ }), { target: { value: "1" } });
    await waitFor(() => {
      expect(titles().length).toBeGreaterThan(0);
      expect(titles()).not.toContain("Canon in C (both hands!)");
    });
  });

  it("stars a song and shows only favorites", async () => {
    open();
    await screen.findByText("Mary's little lamb");
    const star = screen.getByRole("button", { name: "Favorite Mary's little lamb" });
    expect(star.getAttribute("aria-pressed")).toBe("false");
    fireEvent.click(star);
    expect(star.getAttribute("aria-pressed")).toBe("true");
    expect(favorites.has("demo-4")).toBe(true);
    fireEvent.click(screen.getByRole("button", { name: "Favorites only" }));
    await waitFor(() => expect(titles()).toEqual(["Mary's little lamb"]));
  });

  it("explains an empty favorites list without loading", async () => {
    open();
    await screen.findByText("Mary's little lamb");
    fireEvent.click(screen.getByRole("button", { name: "Favorites only" }));
    expect(await screen.findByText(/No favorites yet/)).toBeTruthy();
  });

  it("filters and stars in My recordings too", async () => {
    open("mine");
    await screen.findByText("My practice");
    search("nope");
    expect(await screen.findByText(/No songs match/, {}, { timeout: 2000 })).toBeTruthy();
    await act(async () => fireEvent.click(screen.getByRole("button", { name: "Clear filters" })));
    const row = (await screen.findByText("My practice")).closest("li")!;
    fireEvent.click(within(row).getByRole("button", { name: "Favorite My practice" }));
    expect(favorites.has("take-1")).toBe(true);
  });
});
