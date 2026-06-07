// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";

vi.mock("../../../api", () => ({ api: vi.fn() }));
vi.mock("../../../muninn", () => ({ storeGet: vi.fn(), storeSet: vi.fn(), storeRemove: vi.fn() }));

import { api } from "../../../api";
import { storeGet } from "../../../muninn";
import { bifrost } from "../../../bifrost";
import { pairingStore } from "../../pairing";
import { state } from "../../store";
import { SettingsTab } from "./SettingsTab";

let applied: Array<{ theme: string; hlStyle: string }>;
let off: () => void;
beforeEach(() => {
  state.theme = "auto";
  state.hlStyle = "tint";
  localStorage.clear();
  pairingStore.reset();
  vi.mocked(storeGet).mockResolvedValue(undefined);
  vi.mocked(api).mockResolvedValue({ ok: false });
  applied = [];
  off = bifrost.handle("theme:apply", (p) => applied.push(p));
});
afterEach(() => {
  cleanup();
  off();
  vi.restoreAllMocks();
  vi.clearAllMocks();
});

describe("SettingsTab", () => {
  it("theme toggle writes through the store and the page command", () => {
    render(<SettingsTab />);
    fireEvent.click(screen.getByRole("button", { name: "Dark" }));
    expect(state.theme).toBe("dark");
    expect(applied.at(-1)).toEqual({ theme: "dark", hlStyle: "tint" });
    const dark = screen.getByRole("button", { name: "Dark" });
    expect(dark.getAttribute("aria-pressed")).toBe("true");
  });

  it("highlight toggle writes through too", () => {
    render(<SettingsTab />);
    fireEvent.click(screen.getByRole("button", { name: "GitHub" }));
    expect(state.hlStyle).toBe("github");
    expect(applied.at(-1)).toEqual({ theme: "auto", hlStyle: "github" });
  });

  it("shows the unpaired state and starts pairing on Pair", async () => {
    vi.mocked(storeGet).mockResolvedValue(undefined);
    vi.mocked(api).mockResolvedValue({ ok: true, data: { requestId: "r", code: "ABC234" } });
    render(<SettingsTab />);
    await screen.findByText("Not paired");
    fireEvent.click(screen.getByRole("button", { name: "Pair" }));
    await screen.findByText("ABC234");
    expect(screen.getByText(/Confirm code/)).toBeTruthy();
  });

  it("shows paired status when a token is stored", async () => {
    vi.mocked(storeGet).mockResolvedValue("tok");
    vi.mocked(api).mockResolvedValue({ ok: true, data: { paired: true } }); // /auth confirms the token
    render(<SettingsTab />);
    await screen.findByText(/Paired with your Claude session/);
    expect(screen.queryByRole("button", { name: "Pair" })).toBeNull();
  });

  it("surfaces a pairing error with a Retry", async () => {
    vi.mocked(storeGet).mockResolvedValue(undefined);
    vi.mocked(api).mockResolvedValue({
      ok: false,
      data: { error: "another pairing request is already pending" },
    });
    render(<SettingsTab />);
    fireEvent.click(await screen.findByRole("button", { name: "Pair" }));
    await screen.findByText(/already pending/);
    fireEvent.click(screen.getByRole("button", { name: "Retry" }));
    await screen.findByText(/already pending/);
  });
});
