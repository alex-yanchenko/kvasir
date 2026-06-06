// @vitest-environment jsdom
import { describe, it, expect } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach } from "vitest";
import { App } from "./App";

afterEach(cleanup);

describe("App", () => {
  it("renders the landed islands (Settings)", () => {
    render(<App />);
    expect(screen.getByLabelText("Settings")).toBeTruthy();
  });
});
