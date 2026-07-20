// Runs under `bun test` (NOT vitest) — bun:sqlite is Bun-only. Verifies the SQL store
// matches createMemoryDefaultRootStore's contract: get/set, replace, durability, and
// the retire-not-migrate shape check.
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { Database } from "bun:sqlite";
import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { openKvasirDb } from "./db";
import { createSqliteDefaultRootStore } from "./defaultRootStore.sqlite";

let sandbox: string;
let dbPath: string;

beforeEach(() => {
  sandbox = mkdtempSync(path.join(tmpdir(), "kvasir-dr-"));
  dbPath = path.join(sandbox, "kvasir.db");
});
afterEach(() => {
  rmSync(sandbox, { recursive: true, force: true });
});

describe("createSqliteDefaultRootStore", () => {
  it("returns null before set, stores, and replaces", () => {
    const db = openKvasirDb(dbPath);
    const store = createSqliteDefaultRootStore(db, () => "2026-07-17T00:00:00.000Z");
    expect(store.get()).toBeNull();
    store.set("/home/u/code");
    expect(store.get()).toBe("/home/u/code");
    store.set("/home/u/work");
    expect(store.get()).toBe("/home/u/work"); // single row overwritten via upsert
    db.close();
  });

  it("persists across a reopen of the same file", () => {
    const first = openKvasirDb(dbPath);
    createSqliteDefaultRootStore(first).set("/home/u/code");
    first.close();

    const second = openKvasirDb(dbPath);
    expect(createSqliteDefaultRootStore(second).get()).toBe("/home/u/code");
    second.close();
  });

  it("recreates the table (retire, not migrate) when the column count differs", () => {
    const legacy = new Database(dbPath, { create: true });
    legacy.run("CREATE TABLE default_root (id INTEGER PRIMARY KEY, old_col TEXT) STRICT;");
    legacy.run("INSERT INTO default_root (id, old_col) VALUES (1, 'stale')");
    legacy.close();

    const db = openKvasirDb(dbPath);
    const store = createSqliteDefaultRootStore(db);
    expect(store.get()).toBeNull(); // old row discarded
    store.set("/fresh");
    expect(store.get()).toBe("/fresh");
    db.close();
  });

  it("recreates the table when the column COUNT matches but a name differs", () => {
    // Same 3 columns but `saved_at` renamed to `updated_at` — only the name-membership
    // check (not the length check) can catch this, so it exercises that branch.
    const legacy = new Database(dbPath, { create: true });
    legacy.run("CREATE TABLE default_root (id INTEGER PRIMARY KEY, path TEXT, updated_at TEXT) STRICT;");
    legacy.run("INSERT INTO default_root (id, path, updated_at) VALUES (1, '/stale', 'x')");
    legacy.close();

    const db = openKvasirDb(dbPath);
    const store = createSqliteDefaultRootStore(db);
    expect(store.get()).toBeNull(); // old-shape row discarded
    db.close();
  });
});
