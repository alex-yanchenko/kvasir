// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { describe, it, expect, vi, beforeEach, afterEach, type MockInstance } from "vitest";
import { launcherStore } from "../launcher";
import { RegenDialog } from "./RegenDialog";

let gen: MockInstance;
beforeEach(() => {
  gen = vi.spyOn(launcherStore, "requestGenerate").mockResolvedValue();
});
afterEach(() => {
  cleanup();
});

describe("RegenDialog", () => {
  it("regenerate-as-new runs a full rebuild and closes", () => {
    vi.spyOn(launcherStore, "newCommits").mockReturnValue(false);
    const onClose = vi.fn();
    render(<RegenDialog onClose={onClose} />);
    expect(screen.getByText(/Regenerate this walkthrough/)).toBeTruthy();
    fireEvent.click(screen.getByText("Regenerate as new"));
    expect(gen).toHaveBeenCalledWith("new", undefined);
    expect(gen).toHaveBeenCalledTimes(1);
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("with new commits, offers an incremental update from the reviewed head", () => {
    vi.spyOn(launcherStore, "newCommits").mockReturnValue(true);
    vi.spyOn(launcherStore, "spec").mockReturnValue({
      version: 1,
      pr: { url: "u", owner: "a", repo: "b", number: 7, headSha: "abc" },
      generatedAt: "t",
      steps: [],
    });
    const onClose = vi.fn();
    render(<RegenDialog onClose={onClose} />);
    expect(screen.getByText(/New commits since this walkthrough/)).toBeTruthy();
    fireEvent.click(screen.getByText("Incremental update"));
    expect(gen).toHaveBeenCalledWith("incremental", "abc");
    expect(gen).toHaveBeenCalledTimes(1);
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("cancel and backdrop click close without generating", () => {
    vi.spyOn(launcherStore, "newCommits").mockReturnValue(false);
    const onClose = vi.fn();
    const { container } = render(<RegenDialog onClose={onClose} />);
    fireEvent.click(screen.getByText("Cancel"));
    expect(onClose).toHaveBeenCalledTimes(1);
    fireEvent.click(container.querySelector(".kvasir-dialog-back")!);
    expect(onClose).toHaveBeenCalledTimes(2);
    expect(gen).not.toHaveBeenCalled();
  });

  it("a click inside the card does not close (backdrop guard)", () => {
    vi.spyOn(launcherStore, "newCommits").mockReturnValue(false);
    const onClose = vi.fn();
    const { container } = render(<RegenDialog onClose={onClose} />);
    fireEvent.click(container.querySelector(".kvasir-dialog")!);
    expect(onClose).not.toHaveBeenCalled();
  });

  it("Escape closes; other keys do not", () => {
    vi.spyOn(launcherStore, "newCommits").mockReturnValue(false);
    const onClose = vi.fn();
    render(<RegenDialog onClose={onClose} />);
    fireEvent.keyDown(document, { key: "a" });
    expect(onClose).not.toHaveBeenCalled();
    fireEvent.keyDown(document, { key: "Escape" });
    expect(onClose).toHaveBeenCalledTimes(1);
  });
});
