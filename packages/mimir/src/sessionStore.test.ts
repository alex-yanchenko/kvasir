import { describe, expect, it } from "vitest";
import { createMemorySessionStore, hashToken, type SessionRecord } from "./sessionStore";

const rec = (over: Partial<SessionRecord> = {}): SessionRecord => ({
  id: "req-1",
  tokenHash: hashToken("tok-1"),
  name: "Chrome",
  createdAt: 1000,
  ...over,
});

describe("hashToken", () => {
  it("is stable for the same token, differs across tokens, and never echoes it", () => {
    expect(hashToken("abc")).toBe(hashToken("abc"));
    expect(hashToken("abc")).not.toBe(hashToken("abd"));
    expect(hashToken("abc")).toMatch(/^[0-9a-f]{64}$/);
    expect(hashToken("abc")).not.toContain("abc");
  });
});

describe("createMemorySessionStore", () => {
  it("adds, lists, removes, and clears; add by same id replaces", () => {
    const store = createMemorySessionStore();
    expect(store.all()).toEqual([]);
    store.add(rec({ id: "a" }));
    store.add(rec({ id: "b", name: "Firefox" }));
    expect(store.all()).toEqual([rec({ id: "a" }), rec({ id: "b", name: "Firefox" })]);
    store.add(rec({ id: "a", name: "Edge" })); // same id replaces
    expect(store.all()).toEqual([rec({ id: "a", name: "Edge" }), rec({ id: "b", name: "Firefox" })]);
    expect(store.remove("a")).toBe(true);
    expect(store.remove("a")).toBe(false);
    expect(store.all()).toEqual([rec({ id: "b", name: "Firefox" })]);
    store.clear();
    expect(store.all()).toEqual([]);
  });

  it("seeds from an array", () => {
    const store = createMemorySessionStore([rec({ id: "s1" }), rec({ id: "s2" })]);
    expect(store.all().map((row) => row.id)).toEqual(["s1", "s2"]);
  });
});
