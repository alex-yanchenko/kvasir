// @vitest-environment jsdom
import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { PortalContainerProvider, usePortalContainer } from "./portal-container";

function Probe(): React.JSX.Element {
  const node = usePortalContainer();
  return <span>{node ? node.id : "none"}</span>;
}

describe("portal container context", () => {
  it("hands the provided node to consumers; null without a provider", () => {
    render(<Probe />);
    expect(screen.getByText("none")).toBeTruthy();

    const container = document.createElement("div");
    container.id = "prw-portal";
    render(
      <PortalContainerProvider container={container}>
        <Probe />
      </PortalContainerProvider>,
    );
    expect(screen.getByText("prw-portal")).toBeTruthy();
  });
});
