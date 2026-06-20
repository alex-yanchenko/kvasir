// Runs under `bun test` (bun:sqlite is Bun-only). Verifies the SQL session store
// matches createMemorySessionStore and persists across a reopen of the file.
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { hashToken, type SessionRecord } from "./sessionStore";
import { createSqliteSessionStore } from "./sessionStore.sqlite";

const rec = (over: Partial<SessionRecord> = {}): SessionRecord => ({
  id: "req-1",
  tokenHash: hashToken("tok-1"),
  name: "Chrome",
  createdAt: 1000,
  ...over,
});

describe("createSqliteSessionStore (in-memory)", () => {
  it("adds, lists in created order, replaces by id, removes, and clears", () => {
    const store = createSqliteSessionStore(":memory:");
    expect(store.all()).toEqual([]);
    store.add(rec({ id: "a", createdAt: 1 }));
    store.add(rec({ id: "b", name: "Firefox", createdAt: 2 }));
    expect(store.all()).toEqual([
      rec({ id: "a", createdAt: 1 }),
      rec({ id: "b", name: "Firefox", createdAt: 2 }),
    ]);
    store.add(rec({ id: "a", name: "Edge", createdAt: 1 }));
    expect(store.all().find((row) => row.id === "a")?.name).toBe("Edge");
    expect(store.remove("a")).toBe(true);
    expect(store.remove("a")).toBe(false);
    expect(store.all().map((row) => row.id)).toEqual(["b"]);
    store.clear();
    expect(store.all()).toEqual([]);
  });
});

describe("createSqliteSessionStore (file durability)", () => {
  let directory: string;
  beforeEach(() => {
    directory = mkdtempSync(path.join(tmpdir(), "kvasir-sess-"));
  });
  afterEach(() => {
    rmSync(directory, { recursive: true, force: true });
  });

  it("persists sessions across a fresh store on the same file (restart survives)", () => {
    const dbPath = path.join(directory, "kvasir.db");
    createSqliteSessionStore(dbPath).add(rec({ id: "s1" }));
    expect(createSqliteSessionStore(dbPath).all()).toEqual([rec({ id: "s1" })]);
  });
});
