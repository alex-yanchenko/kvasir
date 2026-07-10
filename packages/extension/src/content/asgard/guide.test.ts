// @vitest-environment jsdom
import { describe, it, expect, vi } from "vitest";
import { activeGuide } from "./guide";
import { reviewStore } from "./review";
import { tourStore } from "./tour";

const at = (href: string): void => {
  Object.defineProperty(window, "location", { value: new URL(href), writable: true });
};

describe("activeGuide", () => {
  it("is the review guide on a ?kvasir page, the walkthrough otherwise", () => {
    at("https://github.com/acme/web/blob/main/src/a.ts?kvasir=rev-1");
    expect(activeGuide()).toBe(reviewStore);
    at("https://github.com/acme/web/pull/7/files");
    expect(activeGuide()).toBe(tourStore);
  });

  it("throws a typed error when the needed guide module was never loaded", async () => {
    // A fresh guide module with NO store modules loaded: the registry is empty,
    // and asking for the active guide must fail loudly, not return undefined.
    vi.resetModules();
    const fresh = await import("./guide");
    at("https://github.com/acme/web/pull/7/files"); // picks WHICH kind is asked for — both throw here
    expect(() => fresh.activeGuide()).toThrow(fresh.GuideUnregisteredError);
  });

  it("with only one store loaded, the loaded kind resolves and the other throws", async () => {
    // The error's real trigger class: an entry point that reaches chat while
    // importing only one of the two store modules.
    vi.resetModules();
    const fresh = await import("./guide");
    const freshReview = await import("./review"); // registers only the review guide
    at("https://github.com/acme/web/blob/main/src/a.ts?kvasir=rev-1");
    expect(fresh.activeGuide()).toBe(freshReview.reviewStore);
    at("https://github.com/acme/web/pull/7/files");
    expect(() => fresh.activeGuide()).toThrow(fresh.GuideUnregisteredError);
  });

  it("a repeat registration for the same kind replaces the earlier one", async () => {
    vi.resetModules();
    const fresh = await import("./guide");
    const stub = (label: string): import("./guide").Guide => ({
      kind: "walkthrough",
      stepContext: () => label,
      backgroundContext: () => "",
      askAboutStep: () => {},
    });
    const second = stub("second");
    fresh.registerGuide(stub("first"));
    fresh.registerGuide(second);
    at("https://github.com/acme/web/pull/7/files");
    expect(fresh.activeGuide()).toBe(second);
  });
});
