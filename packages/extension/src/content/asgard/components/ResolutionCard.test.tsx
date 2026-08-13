// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

vi.mock("../../muninn", () => ({ storeGet: vi.fn(), storeSet: vi.fn(), storeRemove: vi.fn() }));
vi.mock(import("../../api"), async (importOriginal) => ({ ...(await importOriginal()), api: vi.fn() }));

import { resolveStore } from "../launcher";
import { pairingStore } from "../pairing";
import { resolveDefaults, state } from "../store";
import { ResolutionCard } from "./ResolutionCard";

const disabled = (testId: string): boolean => (screen.getByTestId(testId) as HTMLButtonElement).disabled;
const ACTION_IDS = ["set-default-root", "clone-kvasir", "diff-only"] as const;

beforeEach(() => {
  state.resolve = resolveDefaults();
  vi.spyOn(pairingStore, "needsPairing").mockReturnValue(false);
  vi.spyOn(resolveStore, "prepareCheckout").mockResolvedValue();
});
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe("ResolutionCard", () => {
  it("shows a spinner while resolving", () => {
    state.resolve.status = "resolving";
    render(<ResolutionCard />);
    expect(screen.getByTestId("resolve-spinner").textContent).toMatch(/Looking for a local clone/);
  });

  it("shows a spinner while preparing", () => {
    state.resolve.status = "preparing";
    render(<ResolutionCard />);
    expect(screen.getByTestId("resolve-spinner").textContent).toMatch(/Preparing the checkout/);
  });

  it("absent → renders the three choose-only actions and no error banner", () => {
    state.resolve.status = "absent";
    render(<ResolutionCard />);
    for (const id of ACTION_IDS) {
      expect(screen.getByTestId(`resolve-action-${id}`)).toBeTruthy();
    }
    expect(screen.queryByTestId("resolve-input-use-existing")).toBeNull();
    expect(screen.queryByTestId("resolve-error")).toBeNull();
  });

  it("error → banners the reason and still offers the actions", () => {
    state.resolve.status = "error";
    state.resolve.error = "refusing to clone into /x: it is not empty";
    render(<ResolutionCard />);
    expect(screen.getByTestId("resolve-error").textContent).toContain("not empty");
    expect(screen.getByTestId("resolve-action-set-default-root")).toBeTruthy();
  });

  it("Locate my repos folder → prepareCheckout('set-default-root') with no typed path", () => {
    state.resolve.status = "absent";
    render(<ResolutionCard />);
    fireEvent.click(screen.getByTestId("resolve-action-set-default-root"));
    expect(resolveStore.prepareCheckout).toHaveBeenCalledTimes(1);
    expect(resolveStore.prepareCheckout).toHaveBeenCalledWith("set-default-root");
  });

  it("Clone it into kvasir's folder → prepareCheckout('clone-kvasir')", () => {
    state.resolve.status = "absent";
    render(<ResolutionCard />);
    fireEvent.click(screen.getByTestId("resolve-action-clone-kvasir"));
    expect(resolveStore.prepareCheckout).toHaveBeenCalledWith("clone-kvasir");
  });

  it("Just use the diff → prepareCheckout('diff-only')", () => {
    state.resolve.status = "absent";
    render(<ResolutionCard />);
    fireEvent.click(screen.getByTestId("resolve-action-diff-only"));
    expect(resolveStore.prepareCheckout).toHaveBeenCalledWith("diff-only");
  });

  it("needs pairing → every action is disabled", () => {
    vi.spyOn(pairingStore, "needsPairing").mockReturnValue(true);
    state.resolve.status = "absent";
    render(<ResolutionCard />);
    for (const id of ACTION_IDS) {
      expect(disabled(`resolve-action-${id}`)).toBe(true);
    }
  });

  it("Cancel dismisses the card without generating", () => {
    const dismiss = vi.spyOn(resolveStore, "dismiss");
    state.resolve.status = "absent";
    render(<ResolutionCard />);
    fireEvent.click(screen.getByTestId("resolve-cancel"));
    expect(dismiss).toHaveBeenCalledTimes(1);
    expect(resolveStore.prepareCheckout).not.toHaveBeenCalled();
  });
});
