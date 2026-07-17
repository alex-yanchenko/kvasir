// Runs under `bun test` (NOT vitest) — bun:sqlite is Bun-only. Verifies the SQL
// store matches createMemoryResolvedRepoStore's contract: upsert, drop, per-key
// independence, and durability across a reopen of the same file.
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { Database } from "bun:sqlite";
import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { openKvasirDb } from "./db";
import { createSqliteResolvedRepoStore } from "./resolvedRepoStore.sqlite";

let sandbox: string;
let dbPath: string;

beforeEach(() => {
  sandbox = mkdtempSync(path.join(tmpdir(), "kvasir-rr-"));
  dbPath = path.join(sandbox, "kvasir.db");
});
afterEach(() => {
  rmSync(sandbox, { recursive: true, force: true });
});

describe("createSqliteResolvedRepoStore", () => {
  it("returns null for an unknown key, stores and reads back, upserts, and drops", () => {
    const db = openKvasirDb(dbPath);
    const store = createSqliteResolvedRepoStore(db, () => "2026-07-17T00:00:00.000Z");

    expect(store.get("acme/widget")).toBeNull();

    store.set("acme/widget", "/home/u/code/widget");
    expect(store.get("acme/widget")).toBe("/home/u/code/widget");

    store.set("acme/widget", "/home/u/other/widget");
    expect(store.get("acme/widget")).toBe("/home/u/other/widget"); // upsert overwrote

    store.drop("acme/widget");
    expect(store.get("acme/widget")).toBeNull();
    db.close();
  });

  it("keeps distinct repos independent", () => {
    const db = openKvasirDb(dbPath);
    const store = createSqliteResolvedRepoStore(db);
    store.set("acme/widget", "/a");
    store.set("acme/gadget", "/b");
    store.drop("acme/widget");
    expect(store.get("acme/widget")).toBeNull();
    expect(store.get("acme/gadget")).toBe("/b");
    db.close();
  });

  it("persists across a reopen of the same file", () => {
    const first = openKvasirDb(dbPath);
    createSqliteResolvedRepoStore(first).set("acme/widget", "/home/u/code/widget");
    first.close();

    const second = openKvasirDb(dbPath);
    expect(createSqliteResolvedRepoStore(second).get("acme/widget")).toBe("/home/u/code/widget");
    second.close();
  });

  it("recreates the table (retire, not migrate) when a live db's shape differs", () => {
    const legacy = new Database(dbPath, { create: true });
    legacy.run("CREATE TABLE resolved_repos (owner_repo TEXT PRIMARY KEY, old_col TEXT) STRICT;");
    legacy.run("INSERT INTO resolved_repos (owner_repo, old_col) VALUES ('acme/widget', 'stale')");
    legacy.close();

    const db = openKvasirDb(dbPath);
    const store = createSqliteResolvedRepoStore(db); // shape mismatch → drop + recreate
    expect(store.get("acme/widget")).toBeNull(); // old row discarded
    store.set("acme/widget", "/fresh");
    expect(store.get("acme/widget")).toBe("/fresh");
    db.close();
  });
});
