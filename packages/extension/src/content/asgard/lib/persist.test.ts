// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from "vitest";
import {
  readLocal,
  readLocalJson,
  readSessionJson,
  writeLocal,
  writeLocalJson,
  writeSessionJson,
} from "./persist";

afterEach(() => {
  localStorage.clear();
  sessionStorage.clear();
});

const blockStorage = (): void => {
  vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => {
    throw new Error("blocked");
  });
  vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
    throw new Error("blocked");
  });
};

describe("local scope", () => {
  it("round-trips a string and a JSON value", () => {
    writeLocal("k", "v");
    expect(readLocal("k")).toBe("v");
    writeLocalJson("j", { a: 1 });
    expect(readLocalJson("j")).toEqual({ a: 1 });
  });

  it("reads absent keys as null", () => {
    expect(readLocal("missing")).toBeNull();
    expect(readLocalJson("missing")).toBeNull();
  });

  it("reads a garbled JSON value as null instead of throwing", () => {
    localStorage.setItem("j", "{not json");
    expect(readLocalJson("j")).toBeNull();
  });

  it("degrades to null reads and no-op writes when storage is blocked", () => {
    blockStorage();
    expect(() => writeLocal("k", "v")).not.toThrow();
    expect(() => writeLocalJson("j", { a: 1 })).not.toThrow();
    expect(readLocal("k")).toBeNull();
    expect(readLocalJson("j")).toBeNull();
  });

  it("a value that can't be stringified is a no-op, in BOTH scopes", () => {
    const circular: Record<string, unknown> = {};
    circular.self = circular;
    expect(() => writeLocalJson("j", circular)).not.toThrow();
    expect(() => writeSessionJson("j", circular)).not.toThrow();
    expect(readLocalJson("j")).toBeNull();
    expect(readSessionJson("j")).toBeNull();
  });
});

describe("session scope", () => {
  it("round-trips a JSON value and reads absent/garbled as null", () => {
    writeSessionJson("j", [1, 2]);
    expect(readSessionJson("j")).toEqual([1, 2]);
    expect(readSessionJson("missing")).toBeNull();
    sessionStorage.setItem("bad", "{not json");
    expect(readSessionJson("bad")).toBeNull();
  });

  it("degrades to null reads and no-op writes when storage is blocked", () => {
    blockStorage();
    expect(() => writeSessionJson("j", 1)).not.toThrow();
    expect(readSessionJson("j")).toBeNull();
  });
});
