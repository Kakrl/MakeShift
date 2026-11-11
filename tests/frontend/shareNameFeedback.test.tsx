// @vitest-environment jsdom
import { createElement } from "react";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import SaveTakeDialog from "../../frontend/src/app/share/SaveTakeDialog";
import SongsDialog, { type MyRecordings } from "../../frontend/src/app/share/SongsDialog";
import type { KeepShare } from "../../frontend/src/app/share/shareStore";

const take = {
  id: "take-1",
  name: "Untitled recording",
  bpm: 120,
  createdAt: "2026-10-01T00:00:00.000Z",
  notes: [{ pitch: "C4", velocity: 80, startMs: 0, durationMs: 500 }],
};

const typeInto = (label: string | RegExp, value: string) =>
  fireEvent.change(screen.getByLabelText(label), { target: { value } });

describe("name filter feedback in the share forms (#280)", () => {
  const keepShare = vi.fn<KeepShare>(() => ({ ok: true }));
  beforeEach(() => {
    window.history.pushState({}, "", "/?mock=1");
    keepShare.mockClear();
    vi.stubGlobal("IntersectionObserver", class {
      observe() {}
      disconnect() {}
    });
  });
  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
  });

  it("flags a blocked song name under its field and does not share", () => {
    render(createElement(SaveTakeDialog, { take, onSave: vi.fn(), keepShare, onDelete: () => true, onClose: vi.fn() }));
    fireEvent.click(screen.getByRole("button", { name: "Yes, save it" }));
    typeInto("Recording name", "Sh1t song");
    fireEvent.click(screen.getByRole("radio", { name: /Everyone/ }));
    typeInto("Your name", "Maya");
    fireEvent.click(screen.getByRole("button", { name: "Save and share" }));
    expect(screen.getByRole("alert").textContent).toMatch(/song name has a word we don't allow/);
    expect(screen.getByLabelText("Recording name").getAttribute("aria-invalid")).toBe("true");
    expect(keepShare).not.toHaveBeenCalled();
    typeInto("Recording name", "Bass song");
    expect(screen.queryByRole("alert")).toBeNull();
  });

  it("lets a blocked title stay private", () => {
    const onSave = vi.fn();
    render(createElement(SaveTakeDialog, { take, onSave, keepShare, onDelete: () => true, onClose: vi.fn() }));
    fireEvent.click(screen.getByRole("button", { name: "Yes, save it" }));
    typeInto("Recording name", "Shit song");
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    expect(onSave).toHaveBeenCalledWith("Shit song");
  });

  it("flags a blocked author name when sharing from My recordings", () => {
    const mine: MyRecordings = {
      entries: [{ recording: { ...take, name: "Practice" }, saved: true }],
      shares: {},
      rename: () => true,
      remove: async () => false,
      keepShare: (_id, share) => keepShare(share),
      stopSharing: async () => false,
      error: null,
    };
    render(createElement(SongsDialog, { initialTab: "mine", mine, onClose: () => {} }));
    fireEvent.click(screen.getByRole("button", { name: /Practice/ }));
    fireEvent.click(screen.getByRole("button", { name: "Share" }));
    typeInto("Your name", "b!tch");
    fireEvent.click(screen.getByRole("button", { name: "Share" }));
    expect(screen.getByRole("alert").textContent).toMatch(/name has a word we don't allow/);
    expect(keepShare).not.toHaveBeenCalled();
  });
});
