import { describe, it, expect } from "vitest";
import { createMemoryDefaultRootStore } from "./defaultRootStore";

describe("createMemoryDefaultRootStore", () => {
  it("returns null before a root is set", () => {
    expect(createMemoryDefaultRootStore().get()).toBeNull();
  });

  it("stores a root and reads it back", () => {
    const store = createMemoryDefaultRootStore();
    store.set("/home/u/code");
    expect(store.get()).toBe("/home/u/code");
  });

  it("replaces the root on a second set", () => {
    const store = createMemoryDefaultRootStore();
    store.set("/home/u/code");
    store.set("/home/u/work");
    expect(store.get()).toBe("/home/u/work");
  });
});
