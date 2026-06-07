// @vitest-environment jsdom
import { describe, it, expect, afterEach } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { Button } from "./button";

afterEach(cleanup);

describe("Button", () => {
  it("renders a native button with merged variant classes", () => {
    render(
      <Button variant="outline" size="sm" className="extra">
        Go
      </Button>,
    );
    const btn = screen.getByRole("button", { name: "Go" });
    expect(btn.className).toContain("extra");
    expect(btn.className).toContain("border");
  });

  it("asChild renders the child element instead of a button", () => {
    render(
      <Button asChild>
        <a href="#x">Link</a>
      </Button>,
    );
    const link = screen.getByRole("link", { name: "Link" });
    expect(link.tagName).toBe("A");
    expect(link.className).toContain("bg-primary");
  });
});
