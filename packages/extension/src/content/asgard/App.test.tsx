// @vitest-environment jsdom
import { describe, it, expect } from "vitest";
import { render } from "@testing-library/react";
import { App } from "./App";

describe("App", () => {
  it("renders nothing until the islands land", () => {
    const { container } = render(<App />);
    expect(container.innerHTML).toBe("");
  });
});
