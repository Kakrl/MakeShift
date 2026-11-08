// @vitest-environment jsdom
import { createRef, StrictMode } from "react";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import RecordingsLibrary, { type RecordingsLibraryHandle } from "../../frontend/src/app/midi/RecordingsLibraryPanel";
import type { Recording } from "../../frontend/src/app/midi/midiUtils";

vi.mock("../../frontend/src/app/share/SharedPlayer", () => ({ default: () => null }));

const key = "makeshift:recordings:v1";
const take = (id: string): Recording => ({
  id,
  name: "Untitled recording",
  bpm: 120,
  meter: { numerator: 4, denominator: 4 },
  createdAt: "2026-10-26T12:00:00Z",
  notes: [{ pitch: "C4", velocity: 75, startMs: 0, durationMs: 100 }],
});
const storedIds = () => (JSON.parse(window.localStorage.getItem(key) ?? "[]") as Recording[]).map(({ id }) => id);

beforeEach(() => {
  const data = new Map<string, string>();
  Object.defineProperty(window, "localStorage", {
    configurable: true,
    value: { getItem: (k: string) => data.get(k) ?? null, setItem: (k: string, v: string) => void data.set(k, v), removeItem: (k: string) => void data.delete(k), clear: () => data.clear() },
  });
  vi.spyOn(window, "confirm").mockReturnValue(true); });
afterEach(() => { cleanup(); vi.restoreAllMocks(); });

it("No, delete it removes a just-finished take from the library and storage", () => {
  const ref = createRef<RecordingsLibraryHandle>();
  render(<StrictMode><RecordingsLibrary ref={ref} onStatusChange={() => {}} /></StrictMode>);
  act(() => { ref.current!.completeTake(take("keep")); });
  act(() => { ref.current!.completeTake(take("discard")); ref.current!.reviewTake("discard"); });
  expect(storedIds()).toEqual(["discard", "keep"]);

  fireEvent.click(screen.getByRole("button", { name: "No, delete it" }));

  expect(screen.queryByRole("dialog")).toBeNull();
  expect(storedIds()).toEqual(["keep"]);
  expect(screen.getByText("1 recording")).toBeTruthy();
});

it("cancelling the deletion confirmation keeps the take", () => {
  vi.spyOn(window, "confirm").mockReturnValue(false);
  const ref = createRef<RecordingsLibraryHandle>();
  render(<RecordingsLibrary ref={ref} onStatusChange={() => {}} />);
  act(() => { ref.current!.completeTake(take("keep")); ref.current!.reviewTake("keep"); });

  fireEvent.click(screen.getByRole("button", { name: "No, delete it" }));

  expect(screen.getByRole("dialog")).toBeTruthy();
  expect(storedIds()).toEqual(["keep"]);
});

it("a discarded take does not come back after a remount", () => {
  const ref = createRef<RecordingsLibraryHandle>();
  const { unmount } = render(<RecordingsLibrary ref={ref} onStatusChange={() => {}} />);
  act(() => { ref.current!.completeTake(take("keep")); ref.current!.completeTake(take("discard")); ref.current!.reviewTake("discard"); });
  fireEvent.click(screen.getByRole("button", { name: "No, delete it" }));
  unmount();

  render(<RecordingsLibrary ref={createRef<RecordingsLibraryHandle>()} onStatusChange={() => {}} />);

  expect(screen.getByText("1 recording")).toBeTruthy();
});
