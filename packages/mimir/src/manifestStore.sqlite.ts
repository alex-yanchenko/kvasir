// bun:sqlite-backed PR-manifest store. The manifest recorded by start_walkthrough
// feeds publish_walkthrough's coverage gate + author stamp — held only in memory,
// a channel restart between the two calls silently dropped both (the spec
// published with no coverage and no author). Persisting it closes that window;
// rows expire so abandoned PRs don't accumulate forever.
import type { Database } from "bun:sqlite";
import type { PrManifest } from "./manifest";

/** How long a recorded manifest stays useful: generous for "authored overnight",
 * short enough that a stale diff (the PR moved on) doesn't gate a fresh publish. */
export const MANIFEST_MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000;

/** What publish/start need — reads mirror Map.get so a plain Map still satisfies
 * the consumer side (publish.ts) in vitest tests. */
export interface ManifestStore {
  get(key: string): PrManifest | undefined;
  set(key: string, manifest: PrManifest): void;
}

const CREATE_TABLE = `
  CREATE TABLE IF NOT EXISTS manifests (
    pr_key     TEXT    PRIMARY KEY,
    json       TEXT    NOT NULL,
    updated_at INTEGER NOT NULL
  ) STRICT;
`;

interface ManifestRow {
  json: string;
}

/** Light shape guard for a re-read row: enough to catch a garbled/foreign JSON
 * without re-validating every nested field the writer just serialized. */
const looksLikeManifest = (value: unknown): value is PrManifest =>
  typeof value === "object" &&
  value !== null &&
  "owner" in value &&
  typeof value.owner === "string" &&
  "author" in value &&
  typeof value.author === "string" &&
  "files" in value &&
  Array.isArray(value.files);

export function createSqliteManifestStore(db: Database, now: () => number = () => Date.now()): ManifestStore {
  db.run(CREATE_TABLE);
  db.query("DELETE FROM manifests WHERE updated_at < ?").run(now() - MANIFEST_MAX_AGE_MS);

  const upsert = db.query(
    `INSERT INTO manifests (pr_key, json, updated_at) VALUES ($key, $json, $updatedAt)
     ON CONFLICT(pr_key) DO UPDATE SET json = $json, updated_at = $updatedAt`,
  );
  const selectByKey = db.query<ManifestRow, [string]>("SELECT json FROM manifests WHERE pr_key = ?");

  return {
    get: (key) => {
      const row = selectByKey.get(key);
      if (!row) return undefined;
      try {
        const parsed: unknown = JSON.parse(row.json);
        return looksLikeManifest(parsed) ? parsed : undefined;
      } catch {
        return undefined; // garbled row — publish proceeds without the gate, same as never-recorded
      }
    },
    set: (key, manifest) => {
      upsert.run({ $key: key, $json: JSON.stringify(manifest), $updatedAt: now() });
    },
  };
}
