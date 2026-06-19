// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { describe, it, expect, vi, afterEach } from "vitest";
import { OverviewPopup } from "./OverviewPopup";

afterEach(() => {
  cleanup();
});

describe("OverviewPopup", () => {
  it("renders the overview text and closes via the Close button", () => {
    const onClose = vi.fn();
    render(<OverviewPopup overview="Adds rate limiting at the gateway." onClose={onClose} />);
    expect(screen.getByText("Adds rate limiting at the gateway.")).toBeTruthy();
    fireEvent.click(screen.getByText("Close"));
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("closes on backdrop click but not on a click inside the card", () => {
    const onClose = vi.fn();
    const { container } = render(<OverviewPopup overview="x" onClose={onClose} />);
    fireEvent.click(container.querySelector(".kvasir-dialog")!); // inside the card → stays open
    expect(onClose).not.toHaveBeenCalled();
    fireEvent.click(container.querySelector(".kvasir-dialog-back")!); // backdrop → closes
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("Escape closes; other keys do not", () => {
    const onClose = vi.fn();
    render(<OverviewPopup overview="x" onClose={onClose} />);
    fireEvent.keyDown(document, { key: "a" });
    expect(onClose).not.toHaveBeenCalled();
    fireEvent.keyDown(document, { key: "Escape" });
    expect(onClose).toHaveBeenCalledTimes(1);
  });
});
