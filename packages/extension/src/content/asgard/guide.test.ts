// @vitest-environment jsdom
import { describe, it, expect } from "vitest";
import { activeGuide } from "./guide";
import { reviewStore } from "./review";
import { tourStore } from "./tour";

const at = (href: string): void => {
  Object.defineProperty(window, "location", { value: new URL(href), writable: true });
};

describe("activeGuide", () => {
  it("is the review guide on a ?prw page, the walkthrough otherwise", () => {
    at("https://github.com/acme/web/blob/main/src/a.ts?prw=rev-1");
    expect(activeGuide()).toBe(reviewStore);
    at("https://github.com/acme/web/pull/7/files");
    expect(activeGuide()).toBe(tourStore);
  });
});
