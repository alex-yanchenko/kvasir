// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
vi.mock("../../api", () => ({ api: vi.fn() }));
vi.mock("../../muninn", () => ({ storeGet: vi.fn(), storeSet: vi.fn(), storeRemove: vi.fn() }));

import { api } from "../../api";
import { storeGet } from "../../muninn";
import { pairingStore } from "../pairing";
import { Settings } from "./Settings";
import { state } from "../store";
import { bifrost } from "../../bifrost";

let applied: ReturnType<typeof vi.fn>;
let offApply: () => void;
beforeEach(() => {
  state.theme = "auto";
  state.hlStyle = "tint";
  localStorage.clear();
  applied = vi.fn();
  offApply = bifrost.handle("theme:apply", applied);
});
afterEach(() => {
  cleanup();
  offApply();
  vi.restoreAllMocks();
  vi.clearAllMocks();
});

describe("Settings", () => {
  it("renders the gear with the popover closed", () => {
    render(<Settings />);
    expect(screen.getByLabelText("Settings")).toBeTruthy();
    expect(screen.queryByLabelText("theme")).toBeNull();
  });

  it("toggles the popover open and closed from the gear", () => {
    render(<Settings />);
    fireEvent.click(screen.getByLabelText("Settings"));
    expect(screen.getByLabelText("theme")).toBeTruthy();
    fireEvent.click(screen.getByLabelText("Settings"));
    expect(screen.queryByLabelText("theme")).toBeNull();
  });

  it("shows the current choices and applies a theme change end to end", () => {
    state.theme = "light";
    render(<Settings />);
    fireEvent.click(screen.getByLabelText("Settings"));
    const themeSel = screen.getByLabelText("theme") as HTMLSelectElement;
    expect(themeSel.value).toBe("light");
    fireEvent.change(themeSel, { target: { value: "dark" } });
    expect(state.theme).toBe("dark");
    expect(localStorage.getItem("prwTheme")).toBe("dark");
    expect(applied).toHaveBeenCalledWith({ theme: "dark", hlStyle: "tint" });
    expect(themeSel.value).toBe("dark"); // re-rendered from the store
  });

  it("applies a highlight-style change", () => {
    render(<Settings />);
    fireEvent.click(screen.getByLabelText("Settings"));
    const hlSel = screen.getByLabelText("highlight") as HTMLSelectElement;
    fireEvent.change(hlSel, { target: { value: "github" } });
    expect(state.hlStyle).toBe("github");
    expect(applied).toHaveBeenCalledWith({ theme: "auto", hlStyle: "github" });
    expect(hlSel.value).toBe("github");
  });
});

describe("Settings connection section", () => {
  beforeEach(() => {
    pairingStore.reset(); // the machine is a module singleton shared across tests
  });

  it("shows paired status when a token is stored", async () => {
    vi.mocked(storeGet).mockResolvedValue("tok");
    render(<Settings />);
    fireEvent.click(screen.getByLabelText("Settings"));
    await screen.findByText(/paired/);
    expect(screen.queryByText("Pair")).toBeNull();
  });

  it("offers Pair, shows the code, and lands on paired once the claim resolves", async () => {
    vi.mocked(storeGet).mockResolvedValue(undefined);
    vi.mocked(api).mockImplementation(async (path: string) =>
      path === "/pair"
        ? { ok: true, data: { requestId: "rid", code: "QRS456" } }
        : { ok: true, data: { token: "t0k" } },
    );
    render(<Settings />);
    fireEvent.click(screen.getByLabelText("Settings"));
    fireEvent.click(await screen.findByText("Pair"));
    await screen.findByText("QRS456");
    expect(screen.getByText(/confirm it in your Claude session/)).toBeTruthy();
    await screen.findByText(/paired/, undefined, { timeout: 3000 }); // first claim poll lands the token
  });

  it("shows the error with a Retry on a refused pairing", async () => {
    vi.mocked(storeGet).mockResolvedValue(undefined);
    vi.mocked(api).mockResolvedValue({
      ok: false,
      data: { error: "another pairing request is already pending" },
    });
    render(<Settings />);
    fireEvent.click(screen.getByLabelText("Settings"));
    fireEvent.click(await screen.findByText("Pair"));
    await screen.findByText(/already pending/);
    fireEvent.click(screen.getByText("Retry")); // retry re-runs the same flow
    await screen.findByText(/already pending/);
  });
});
