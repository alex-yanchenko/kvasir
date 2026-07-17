import { describe, it, expect } from "vitest";
import { createMemoryResolvedRepoStore } from "./resolvedRepoStore";

describe("createMemoryResolvedRepoStore", () => {
  it("returns null for an owner/repo it has never seen", () => {
    const store = createMemoryResolvedRepoStore();
    expect(store.get("acme/widget")).toBeNull();
  });

  it("stores a path and reads it back", () => {
    const store = createMemoryResolvedRepoStore();
    store.set("acme/widget", "/home/u/code/widget");
    expect(store.get("acme/widget")).toBe("/home/u/code/widget");
  });

  it("upserts — a second set overwrites the prior path", () => {
    const store = createMemoryResolvedRepoStore();
    store.set("acme/widget", "/old/path");
    store.set("acme/widget", "/new/path");
    expect(store.get("acme/widget")).toBe("/new/path");
  });

  it("drops an entry so it reads absent again", () => {
    const store = createMemoryResolvedRepoStore();
    store.set("acme/widget", "/home/u/code/widget");
    store.drop("acme/widget");
    expect(store.get("acme/widget")).toBeNull();
  });

  it("keeps entries for distinct repos independent", () => {
    const store = createMemoryResolvedRepoStore();
    store.set("acme/widget", "/a");
    store.set("acme/gadget", "/b");
    store.drop("acme/widget");
    expect(store.get("acme/widget")).toBeNull();
    expect(store.get("acme/gadget")).toBe("/b");
  });
});
