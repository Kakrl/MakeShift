// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

const getLatestRelease = vi.fn<() => Promise<string | null>>();
vi.mock("../../frontend/src/lib/release", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../frontend/src/lib/release")>()),
  getLatestRelease: () => getLatestRelease(),
}));

const { default: About } = await import("../../frontend/src/app/about/page");

async function renderAbout() {
  render(await About());
  return screen.getByText(/MakeShift turns paper into a piano/);
}

afterEach(() => {
  cleanup();
  getLatestRelease.mockReset();
});

describe("About page release number", () => {
  it("ends the description with the latest GitHub release", async () => {
    getLatestRelease.mockResolvedValue("v0.7.1");
    const description = await renderAbout();
    expect(description.textContent).toBe(
      "MakeShift turns paper into a piano. Your webcam watches your fingers and plays the notes. This is release v0.7.1.",
    );
  });

  it("keeps the description and the rest of the page when no release is available", async () => {
    getLatestRelease.mockResolvedValue(null);
    const description = await renderAbout();
    expect(description.textContent).toBe(
      "MakeShift turns paper into a piano. Your webcam watches your fingers and plays the notes.",
    );
    expect(screen.queryByText(/release/i)).toBeNull();
    expect(screen.getByRole("heading", { name: "About MakeShift" })).toBeTruthy();
    expect(screen.getByRole("link", { name: /See the code on GitHub/ }).getAttribute("href"))
      .toBe("https://github.com/Kakrl/MakeShift");
  });
});
