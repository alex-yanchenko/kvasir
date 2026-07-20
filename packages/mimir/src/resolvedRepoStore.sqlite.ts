// The bun:sqlite-backed ResolvedRepoStore — one STRICT table on the shared
// kvasir.db connection (openKvasirDb), so a resolved checkout path survives
// restarts and the reviewer is asked once per repo. bun:sqlite is Bun-only and
// can't be imported under vitest/node, so this file holds no decision logic: it
// mirrors createMemoryResolvedRepoStore (resolvedRepoStore.ts) and is verified by
// resolvedRepoStore.sqlite.buntest.ts.
import type { Database } from "bun:sqlite";
import type { ResolvedRepoStore } from "./resolvedRepoStore";
import { ensureTableShape } from "./sqliteShape";

const CREATE_TABLE = `
  CREATE TABLE IF NOT EXISTS resolved_repos (
    owner_repo TEXT PRIMARY KEY,
    path       TEXT NOT NULL CHECK (path <> ''),
    saved_at   TEXT NOT NULL
  ) STRICT;
`;
// The current column set, in DDL order. A live db whose columns don't match is
// recreated (retire, don't migrate) — so any change to CREATE_TABLE must update this.
const EXPECTED_COLUMNS = ["owner_repo", "path", "saved_at"];

/** Store over the shared connection (openKvasirDb). `now` yields the ISO `saved_at`
 * stamp (diagnostic only — reads are re-validated, never TTL'd), injectable for tests. */
export function createSqliteResolvedRepoStore(
  db: Database,
  now: () => string = () => new Date().toISOString(),
): ResolvedRepoStore {
  ensureTableShape(db, "resolved_repos", CREATE_TABLE, EXPECTED_COLUMNS);

  const selectPath = db.query<{ path: string }, [string]>(
    "SELECT path FROM resolved_repos WHERE owner_repo = ?",
  );
  const upsert = db.query(
    `INSERT INTO resolved_repos (owner_repo, path, saved_at) VALUES ($ownerRepo, $path, $savedAt)
     ON CONFLICT(owner_repo) DO UPDATE SET path = $path, saved_at = $savedAt`,
  );
  const deleteByKey = db.query("DELETE FROM resolved_repos WHERE owner_repo = ?");

  return {
    get: (ownerRepo) => selectPath.get(ownerRepo)?.path ?? null,
    set: (ownerRepo, path) => {
      upsert.run({ $ownerRepo: ownerRepo, $path: path, $savedAt: now() });
    },
    drop: (ownerRepo) => {
      deleteByKey.run(ownerRepo);
    },
  };
}
