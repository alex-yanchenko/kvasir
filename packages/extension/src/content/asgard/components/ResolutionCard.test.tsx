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

  it("absent → renders the five actions and no error banner", () => {
    state.resolve.status = "absent";
    render(<ResolutionCard />);
    for (const id of ["clone-kvasir", "use-existing", "clone-dest", "set-default-root", "diff-only"]) {
      expect(screen.getByTestId(`resolve-action-${id}`)).toBeTruthy();
    }
    expect(screen.queryByTestId("resolve-error")).toBeNull();
  });

  it("error → banners the reason and still offers the actions", () => {
    state.resolve.status = "error";
    state.resolve.error = "refusing to clone into /x: it is not empty";
    render(<ResolutionCard />);
    expect(screen.getByTestId("resolve-error").textContent).toContain("not empty");
    expect(screen.getByTestId("resolve-action-clone-kvasir")).toBeTruthy();
  });

  it("Clone into kvasir's folder → prepareCheckout('clone-kvasir')", () => {
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

  it("a path action is disabled while empty, enabled once filled", () => {
    state.resolve.status = "absent";
    const { rerender } = render(<ResolutionCard />);
    expect(disabled("resolve-action-use-existing")).toBe(true);
    state.resolve.existingPath = "/work/repo";
    rerender(<ResolutionCard />);
    expect(disabled("resolve-action-use-existing")).toBe(false);
  });

  it("typing in each path input calls its setter", () => {
    const setExisting = vi.spyOn(resolveStore, "setExistingPath");
    const setClone = vi.spyOn(resolveStore, "setClonePath");
    const setRoot = vi.spyOn(resolveStore, "setDefaultRoot");
    state.resolve.status = "absent";
    render(<ResolutionCard />);
    fireEvent.change(screen.getByTestId("resolve-input-use-existing"), { target: { value: "/a" } });
    fireEvent.change(screen.getByTestId("resolve-input-clone-dest"), { target: { value: "/b" } });
    fireEvent.change(screen.getByTestId("resolve-input-set-default-root"), { target: { value: "/c" } });
    expect(setExisting).toHaveBeenCalledWith("/a");
    expect(setClone).toHaveBeenCalledWith("/b");
    expect(setRoot).toHaveBeenCalledWith("/c");
  });

  it("Use (existing clone) forwards the trimmed typed path", () => {
    state.resolve.status = "absent";
    state.resolve.existingPath = " /work/repo ";
    render(<ResolutionCard />);
    fireEvent.click(screen.getByTestId("resolve-action-use-existing"));
    expect(resolveStore.prepareCheckout).toHaveBeenCalledWith("use-existing", "/work/repo");
  });

  it("submitting a path action forwards the trimmed typed dest", () => {
    state.resolve.status = "absent";
    state.resolve.clonePath = "  /work/x  ";
    render(<ResolutionCard />);
    fireEvent.click(screen.getByTestId("resolve-action-clone-dest"));
    expect(resolveStore.prepareCheckout).toHaveBeenCalledWith("clone-dest", "/work/x");
  });

  it("set-default-root forwards its trimmed dest", () => {
    state.resolve.status = "absent";
    state.resolve.defaultRoot = "/root";
    render(<ResolutionCard />);
    fireEvent.click(screen.getByTestId("resolve-action-set-default-root"));
    expect(resolveStore.prepareCheckout).toHaveBeenCalledWith("set-default-root", "/root");
  });

  it("needs pairing → every action (including diff-only) is disabled", () => {
    vi.spyOn(pairingStore, "needsPairing").mockReturnValue(true);
    state.resolve.status = "absent";
    state.resolve.existingPath = "/x";
    render(<ResolutionCard />);
    for (const id of ["clone-kvasir", "use-existing", "clone-dest", "set-default-root", "diff-only"]) {
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
