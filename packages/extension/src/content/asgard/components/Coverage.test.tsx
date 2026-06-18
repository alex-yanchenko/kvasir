// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { describe, it, expect, vi, afterEach } from "vitest";

import { bifrost } from "../../bifrost";
import { Coverage } from "./Coverage";

const LABEL = "Walkthrough coverage of key changed files";

afterEach(() => cleanup());

describe("Coverage", () => {
  it("shows partial coverage and jumps to an uncovered file", () => {
    const send = vi.spyOn(bifrost, "send").mockImplementation(() => {});
    render(<Coverage coverage={{ significant: ["f.ts", "g.ts", "h.ts"], uncovered: ["h.ts"] }} />);
    expect(screen.getByLabelText(LABEL).textContent).toContain("2/3 key");
    fireEvent.click(screen.getByLabelText(LABEL)); // expand the uncovered list
    fireEvent.click(screen.getByRole("button", { name: "h.ts" }));
    expect(send).toHaveBeenCalledWith("jump:ref", { file: "h.ts", start: null, end: null });
    expect(send).toHaveBeenCalledTimes(1);
  });

  it("shows a complete, non-expandable chip at full coverage", () => {
    render(<Coverage coverage={{ significant: ["f.ts", "g.ts"], uncovered: [] }} />);
    const chip = screen.getByLabelText(LABEL) as HTMLButtonElement;
    expect(chip.textContent).toContain("2/2 key");
    expect(chip.disabled).toBe(true);
  });

  it("renders nothing when coverage is absent", () => {
    const { container } = render(<Coverage coverage={undefined} />);
    expect(container.innerHTML).toBe("");
  });

  it("renders nothing when no changed files are significant", () => {
    const { container } = render(<Coverage coverage={{ significant: [], uncovered: [] }} />);
    expect(container.innerHTML).toBe("");
  });
});
