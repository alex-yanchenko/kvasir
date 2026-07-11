// Runs under `bun test` (NOT vitest) — bun:sqlite is Bun-only. The store's whole
// reason to exist: the publish-time coverage gate + author stamp must survive a
// channel restart between start_walkthrough and publish_walkthrough.
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { openKvasirDb } from "./db";
import type { PrManifest } from "./manifest";
import { createSqliteManifestStore, MANIFEST_MAX_AGE_MS } from "./manifestStore.sqlite";

const mkManifest = (over: Partial<PrManifest> = {}): PrManifest => ({
  owner: "acme",
  repo: "web",
  number: 7,
  title: "T",
  author: "octocat",
  description: "d",
  headSha: "abc123",
  files: [],
  discussion: [],
  ...over,
});

let sandbox: string;
beforeEach(() => {
  sandbox = mkdtempSync(path.join(tmpdir(), "kvasir-ms-"));
});
afterEach(() => {
  rmSync(sandbox, { recursive: true, force: true });
});

describe("createSqliteManifestStore", () => {
  it("round-trips a manifest and overwrites on a repeat set for the same key", () => {
    const store = createSqliteManifestStore(openKvasirDb(":memory:"));
    store.set("pr-1", mkManifest());
    expect(store.get("pr-1")).toEqual(mkManifest());
    store.set("pr-1", mkManifest({ author: "someone-else" }));
    expect(store.get("pr-1")).toEqual(mkManifest({ author: "someone-else" }));
    expect(store.get("pr-absent")).toBeUndefined();
  });

  it("survives a channel restart — a fresh connection to the same file still has the manifest", () => {
    const dbPath = path.join(sandbox, "kvasir.db");
    createSqliteManifestStore(openKvasirDb(dbPath)).set("pr-1", mkManifest());
    const reopened = createSqliteManifestStore(openKvasirDb(dbPath));
    expect(reopened.get("pr-1")).toEqual(mkManifest());
  });

  it("treats a garbled row as absent instead of crashing the publish", () => {
    const db = openKvasirDb(":memory:");
    const store = createSqliteManifestStore(db);
    db.run("INSERT INTO manifests (pr_key, json, updated_at) VALUES ('pr-bad', '{not json', 1)");
    db.run(`INSERT INTO manifests (pr_key, json, updated_at) VALUES ('pr-shape', '{"owner":1}', 1)`);
    expect(store.get("pr-bad")).toBeUndefined();
    expect(store.get("pr-shape")).toBeUndefined();
  });

  it("sweeps rows older than the max age at open, keeping fresh ones", () => {
    const dbPath = path.join(sandbox, "kvasir.db");
    const db = openKvasirDb(dbPath);
    const early = createSqliteManifestStore(db, () => 1000);
    early.set("pr-old", mkManifest());
    const later = 1000 + MANIFEST_MAX_AGE_MS + 1;
    createSqliteManifestStore(db, () => later).set("pr-fresh", mkManifest());
    const swept = createSqliteManifestStore(openKvasirDb(dbPath), () => later + 1);
    expect(swept.get("pr-old")).toBeUndefined();
    expect(swept.get("pr-fresh")).toEqual(mkManifest());
  });
});

describe("openKvasirDb", () => {
  it("one connection serves the manifest store and a sibling table without conflict", () => {
    const db = openKvasirDb(":memory:");
    const store = createSqliteManifestStore(db);
    db.run("CREATE TABLE sibling (id TEXT PRIMARY KEY)");
    db.run("INSERT INTO sibling (id) VALUES ('x')");
    store.set("pr-1", mkManifest());
    expect(store.get("pr-1")).toEqual(mkManifest());
    expect(db.query<{ id: string }, []>("SELECT * FROM sibling").all()).toEqual([{ id: "x" }]);
  });
});
