// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { describe, it, expect, vi, afterEach } from "vitest";

vi.mock("../../muninn", () => ({ storeGet: vi.fn(), storeSet: vi.fn(), storeRemove: vi.fn() }));

import { SettingsNav } from "./SettingsNav";

afterEach(() => cleanup());

describe("SettingsNav", () => {
  it("renders a jump link for every settings section", () => {
    render(<SettingsNav />);
    for (const label of ["Appearance", "Review", "Generation", "Connection", "Debug"]) {
      expect(screen.getByRole("button", { name: label })).toBeTruthy();
    }
  });

  it("scrolls the matching section into view when clicked (document root)", () => {
    const section = document.createElement("div");
    section.setAttribute("data-settings-section", "review");
    const scrollIntoView = vi.fn();
    section.scrollIntoView = scrollIntoView;
    document.body.append(section);
    render(<SettingsNav />);
    fireEvent.click(screen.getByRole("button", { name: "Review" }));
    expect(scrollIntoView).toHaveBeenCalledWith({ behavior: "smooth", block: "start" });
    expect(scrollIntoView).toHaveBeenCalledTimes(1);
    section.remove();
  });

  it("finds the section inside a shadow root (the production case)", () => {
    const host = document.createElement("div");
    document.body.append(host);
    const shadow = host.attachShadow({ mode: "open" });
    const section = document.createElement("div");
    section.setAttribute("data-settings-section", "connection");
    const scrollIntoView = vi.fn();
    section.scrollIntoView = scrollIntoView;
    shadow.append(section);
    // The nav renders into the shadow root, so query the buttons from there (screen
    // only sees document.body).
    render(<SettingsNav />, { container: shadow });
    const button = [...shadow.querySelectorAll("button")].find((b) => b.textContent === "Connection");
    fireEvent.click(button!);
    expect(scrollIntoView).toHaveBeenCalledWith({ behavior: "smooth", block: "start" });
    host.remove();
  });

  it("is a no-op when the target section is not present (root has no match)", () => {
    render(<SettingsNav />);
    expect(() => fireEvent.click(screen.getByRole("button", { name: "Debug" }))).not.toThrow();
  });

  it("is a no-op when the root is neither a document nor a shadow root", () => {
    const fragment = document.createDocumentFragment();
    const section = document.createElement("div");
    section.setAttribute("data-settings-section", "appearance");
    const scrollIntoView = vi.fn();
    section.scrollIntoView = scrollIntoView;
    fragment.append(section); // present, but the guard returns before querying
    render(<SettingsNav />, { container: fragment });
    const button = fragment.querySelector("button");
    fireEvent.click(button!);
    expect(scrollIntoView).not.toHaveBeenCalled(); // the instanceof guard short-circuits
  });
});
