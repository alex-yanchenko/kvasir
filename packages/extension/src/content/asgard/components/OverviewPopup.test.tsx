// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { describe, it, expect, vi, afterEach } from "vitest";
import { OverviewPopup } from "./OverviewPopup";

afterEach(() => {
  cleanup();
});

describe("OverviewPopup", () => {
  it("renders the overview as HTML (not literal tags) and closes via the Close button", () => {
    const onClose = vi.fn();
    const { container } = render(
      <OverviewPopup overview="<p>Adds <code>rate limiting</code>.</p>" onClose={onClose} />,
    );
    // parsed to a real <code> element — would be absent if rendered as escaped text
    expect(container.querySelector("code")?.textContent).toBe("rate limiting");
    fireEvent.click(screen.getByRole("button", { name: "Close overview" }));
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("closes on a click-away (no backdrop dim)", () => {
    const onClose = vi.fn();
    const { container } = render(<OverviewPopup overview="<p>x</p>" onClose={onClose} />);
    fireEvent.click(container.querySelector(".fixed.inset-0")!); // transparent click-away
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("Escape closes; other keys do not", () => {
    const onClose = vi.fn();
    render(<OverviewPopup overview="<p>x</p>" onClose={onClose} />);
    fireEvent.keyDown(document, { key: "a" });
    expect(onClose).not.toHaveBeenCalled();
    fireEvent.keyDown(document, { key: "Escape" });
    expect(onClose).toHaveBeenCalledTimes(1);
  });
});
