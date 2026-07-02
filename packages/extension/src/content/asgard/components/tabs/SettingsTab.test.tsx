// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

vi.mock("../../../api", () => ({ api: vi.fn() }));
vi.mock("../../../muninn", () => ({ storeGet: vi.fn(), storeSet: vi.fn(), storeRemove: vi.fn() }));
vi.mock("../../debug", () => ({ wipeStoredData: vi.fn() }));

import { api } from "../../../api";
import { bifrost } from "../../../bifrost";
import { storeGet } from "../../../muninn";
import { wipeStoredData } from "../../debug";
import { pairingStore } from "../../pairing";
import { state } from "../../store";
import { SettingsTab } from "./SettingsTab";

let applied: Array<{ theme: string; hlStyle: string }>;
let off: () => void;
beforeEach(() => {
  state.theme = "auto";
  state.hlStyle = "rail";
  state.reviewMode = "heavy";
  state.reviewReposRoot = "~/code";
  state.preloadQuestions = false;
  state.generateDiagram = false;
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
});

describe("SettingsTab", () => {
  it("theme toggle writes through the store and the page command", () => {
    render(<SettingsTab />);
    fireEvent.click(screen.getByRole("button", { name: "Dark" }));
    expect(state.theme).toBe("dark");
    expect(applied.at(-1)).toEqual({ theme: "dark", hlStyle: "rail" });
    const dark = screen.getByRole("button", { name: "Dark" });
    expect(dark.getAttribute("aria-pressed")).toBe("true");
  });

  it("highlight toggle writes through too", () => {
    render(<SettingsTab />);
    fireEvent.click(screen.getByRole("button", { name: "Rail + gutter" }));
    expect(state.hlStyle).toBe("gutter");
    expect(applied.at(-1)).toEqual({ theme: "auto", hlStyle: "gutter" });
  });

  it("step-nav toggle flips reviewSync", () => {
    render(<SettingsTab />);
    fireEvent.click(screen.getByRole("button", { name: "Instant" }));
    expect(state.reviewSync).toBe(false);
    fireEvent.click(screen.getByRole("button", { name: "On load" }));
    expect(state.reviewSync).toBe(true);
  });

  it("review-depth toggle flips reviewMode and shows the repos-root input only on heavy", () => {
    render(<SettingsTab />);
    // "Light" also names a Theme option, so scope the clicks to the Review depth group.
    const depth = screen.getByRole("group", { name: "Review depth" });
    expect(screen.getByLabelText("Local repos root")).toBeTruthy(); // heavy default
    fireEvent.click(within(depth).getByRole("button", { name: "Light" }));
    expect(state.reviewMode).toBe("light");
    expect(screen.queryByLabelText("Local repos root")).toBeNull();
    fireEvent.click(within(depth).getByRole("button", { name: "Heavy" }));
    expect(state.reviewMode).toBe("heavy");
    expect(screen.getByLabelText("Local repos root")).toBeTruthy();
  });

  it("repos-root input writes through the store", () => {
    render(<SettingsTab />);
    fireEvent.change(screen.getByLabelText("Local repos root"), { target: { value: "/srv/repos" } });
    expect(state.reviewReposRoot).toBe("/srv/repos");
  });

  it("suggested-questions toggle flips preloadQuestions (default off)", () => {
    render(<SettingsTab />);
    const group = screen.getByRole("group", { name: "Suggested questions" });
    fireEvent.click(within(group).getByRole("button", { name: "On" }));
    expect(state.preloadQuestions).toBe(true);
    fireEvent.click(within(group).getByRole("button", { name: "Off" }));
    expect(state.preloadQuestions).toBe(false);
  });

  it("flow-diagram toggle flips generateDiagram (default off)", () => {
    render(<SettingsTab />);
    const group = screen.getByRole("group", { name: "Flow diagram" });
    fireEvent.click(within(group).getByRole("button", { name: "On" }));
    expect(state.generateDiagram).toBe(true);
    fireEvent.click(within(group).getByRole("button", { name: "Off" }));
    expect(state.generateDiagram).toBe(false);
  });

  it("explains each setting with a hint; the repos-root hint shows only on heavy", () => {
    render(<SettingsTab />);
    expect(screen.getByText(/Heavy reads the locally-cloned repo/)).toBeTruthy();
    expect(screen.getByText(/Preload three AI-suggested questions/)).toBeTruthy();
    expect(screen.getByText(/Where Heavy looks for the clone/)).toBeTruthy(); // heavy default
    const depth = screen.getByRole("group", { name: "Review depth" });
    fireEvent.click(within(depth).getByRole("button", { name: "Light" }));
    expect(screen.queryByText(/Where Heavy looks for the clone/)).toBeNull(); // gone on light
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

  it("Debug: Wipe asks to confirm, runs the wipe, and shows the reload hint", () => {
    render(<SettingsTab />);
    fireEvent.click(screen.getByRole("button", { name: "Wipe data" }));
    fireEvent.click(screen.getByRole("button", { name: "Confirm wipe" }));
    expect(wipeStoredData).toHaveBeenCalledTimes(1);
    expect(screen.getByText("Wiped — reload the page")).toBeTruthy();
  });

  it("Debug: Cancel backs out without wiping", () => {
    render(<SettingsTab />);
    fireEvent.click(screen.getByRole("button", { name: "Wipe data" }));
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    expect(wipeStoredData).not.toHaveBeenCalled();
    expect(screen.getByRole("button", { name: "Wipe data" })).toBeTruthy();
  });

  it("surfaces a pairing error with a Retry", async () => {
    vi.mocked(storeGet).mockResolvedValue(undefined);
    vi.mocked(api).mockImplementation(async (path: string) =>
      path === "/health"
        ? { ok: true, data: { ok: true } }
        : { ok: false, status: 409, data: { error: "another pairing request is already pending" } },
    );
    render(<SettingsTab />);
    fireEvent.click(await screen.findByRole("button", { name: "Pair" }));
    await screen.findByText(/already pending/);
    fireEvent.click(screen.getByRole("button", { name: "Retry" }));
    expect(await screen.findByText(/already pending/)).toBeTruthy();
  });

  it("shows the channel-down state and recovers via Retry once the channel answers", async () => {
    vi.mocked(storeGet).mockResolvedValue(undefined);
    vi.mocked(api).mockResolvedValue({ ok: false, error: "TypeError: Failed to fetch" });
    render(<SettingsTab />);
    await screen.findByText(/Channel not running/);
    expect(screen.queryByRole("button", { name: "Pair" })).toBeNull(); // pairing can't help a dead channel
    vi.mocked(api).mockResolvedValue({ ok: true, data: { ok: true } });
    fireEvent.click(screen.getByRole("button", { name: "Retry" }));
    await screen.findByText("Not paired"); // channel back, token still absent
  });
});
