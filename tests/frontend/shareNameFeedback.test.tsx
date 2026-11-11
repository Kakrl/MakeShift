// @vitest-environment jsdom
import { createElement } from "react";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import DeviceProfilePanel from "../../frontend/src/app/midi/DeviceProfilePanel";
import SaveTakeDialog from "../../frontend/src/app/share/SaveTakeDialog";
import { loadOrCreateProfile } from "../../frontend/src/lib/deviceProfile";

const savedName = vi.hoisted(() => ({ value: "" }));
vi.mock("../../frontend/src/app/share/shareStore", async (original) => ({
  ...(await original<typeof import("../../frontend/src/app/share/shareStore")>()),
  loadShareName: () => savedName.value,
}));
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

  it("shows both issues at once and drops the title one when switched to private", () => {
    render(createElement(SaveTakeDialog, { take, onSave: vi.fn(), keepShare, onDelete: () => true, onClose: vi.fn() }));
    fireEvent.click(screen.getByRole("button", { name: "Yes, save it" }));
    typeInto("Recording name", "Shit song");
    fireEvent.click(screen.getByRole("radio", { name: /Everyone/ }));
    typeInto("Your name", "b1tch");
    fireEvent.click(screen.getByRole("button", { name: "Save and share" }));
    expect(screen.getAllByRole("alert")).toHaveLength(2);
    fireEvent.click(screen.getByRole("radio", { name: /Only me/ }));
    expect(screen.queryByRole("alert")).toBeNull();
    expect(screen.getByLabelText("Recording name").getAttribute("aria-invalid")).toBe("false");
  });

  it("asks for the name again when the saved sharing name is blocked", () => {
    savedName.value = "Sh1t";
    try {
      render(createElement(SaveTakeDialog, { take, onSave: vi.fn(), keepShare, onDelete: () => true, onClose: vi.fn() }));
      fireEvent.click(screen.getByRole("button", { name: "Yes, save it" }));
      fireEvent.click(screen.getByRole("radio", { name: /Everyone/ }));
      expect((screen.getByLabelText("Your name") as HTMLInputElement).value).toBe("Sh1t");
    } finally {
      savedName.value = "";
    }
  });

  it("refuses a blocked sharing name in My recordings", () => {
    const before = loadOrCreateProfile().profile.displayName;
    render(createElement(DeviceProfilePanel));
    fireEvent.click(screen.getByRole("button", { name: /Set name|Edit/ }));
    fireEvent.change(screen.getByRole("textbox", { name: "Sharing name" }), { target: { value: "Sh1t" } });
    fireEvent.click(screen.getByRole("button", { name: "Save sharing name" }));
    expect(screen.getByRole("alert").textContent).toMatch(/word we don't allow/);
    expect(loadOrCreateProfile().profile.displayName).toBe(before);
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
