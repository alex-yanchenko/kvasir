// @vitest-environment jsdom
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import { describe, it, expect, vi, afterEach } from "vitest";

const { renderMock } = vi.hoisted(() => ({ renderMock: vi.fn() }));
vi.mock("../mermaidLoader", () => ({
  loadMermaid: () => Promise.resolve({ initialize: vi.fn(), render: renderMock }),
}));

import { Diagram } from "./Diagram";

afterEach(() => {
  cleanup();
  renderMock.mockReset();
});

describe("Diagram", () => {
  it("renders the mermaid svg for the source", async () => {
    renderMock.mockResolvedValue({ svg: "<svg data-testid='rendered'></svg>" });
    render(<Diagram source="flowchart TD; A-->B" />);
    await waitFor(() => expect(document.querySelector("[data-testid='diagram'] svg")).toBeTruthy());
    expect(renderMock).toHaveBeenCalledWith(
      expect.stringContaining("kvasir-diagram-"),
      "flowchart TD; A-->B",
    );
  });

  it("shows a fallback when the diagram fails to render", async () => {
    renderMock.mockRejectedValue(new Error("bad mermaid"));
    render(<Diagram source="not valid" />);
    expect(await screen.findByText(/Couldn’t render this diagram/)).toBeTruthy();
  });

  it("ignores a render that resolves after unmount (no state update)", async () => {
    let resolveRender: (value: { svg: string }) => void = () => {};
    renderMock.mockReturnValue(
      new Promise((resolve) => {
        resolveRender = resolve;
      }),
    );
    const { unmount } = render(<Diagram source="x" />);
    await Promise.resolve(); // let loadMermaid resolve so we're awaiting render()
    unmount();
    resolveRender({ svg: "<svg></svg>" });
    await Promise.resolve();
    expect(document.querySelector("[data-testid='diagram']")).toBeNull();
  });

  it("ignores a render that rejects after unmount (no fallback)", async () => {
    let rejectRender: (error: unknown) => void = () => {};
    renderMock.mockReturnValue(
      new Promise((_resolve, reject) => {
        rejectRender = reject;
      }),
    );
    const { unmount } = render(<Diagram source="y" />);
    await Promise.resolve();
    unmount();
    rejectRender(new Error("late failure"));
    await Promise.resolve();
    expect(document.querySelector("[data-testid='diagram']")).toBeNull();
  });
});
