// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import { describe, it, expect, afterEach } from "vitest";
import { StepHead, StepRing } from "./StepRing";

afterEach(() => cleanup());

describe("StepRing", () => {
  it("fills the arc proportional to (index+1)/count and shows the count", () => {
    const { container } = render(<StepRing index={1} count={4} />);
    const fill = container.querySelector(".kvasir-ring-fill")!;
    const dashArray = Number(fill.getAttribute("stroke-dasharray"));
    expect(Number(fill.getAttribute("stroke-dashoffset"))).toBeCloseTo(dashArray * (1 - 2 / 4));
    expect(screen.getByText("2/4")).toBeTruthy();
  });

  it("renders full (zero dashoffset) on the last step", () => {
    const { container } = render(<StepRing index={2} count={3} />);
    const fill = container.querySelector(".kvasir-ring-fill")!;
    expect(Number(fill.getAttribute("stroke-dashoffset"))).toBeCloseTo(0);
  });
});

describe("StepHead", () => {
  it("renders the eyebrow under its testid, the title, and the ring", () => {
    render(
      <StepHead eyebrow="src/a.ts · 1 of 2" eyebrowTestId="step-eyebrow" title="Guard" index={0} count={2} />,
    );
    expect(screen.getByTestId("step-eyebrow").textContent).toBe("src/a.ts · 1 of 2");
    expect(screen.getByRole("heading", { name: "Guard" })).toBeTruthy();
    expect(screen.getByTestId("step-ring").textContent).toBe("1/2");
  });
});
