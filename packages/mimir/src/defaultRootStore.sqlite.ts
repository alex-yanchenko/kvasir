// The bun:sqlite-backed DefaultRootStore — a single-row STRICT table on the shared
// kvasir.db connection, so the reviewer's default clones root survives restarts.
// bun:sqlite is Bun-only (can't import under vitest), so this file holds no decision
// logic: it mirrors createMemoryDefaultRootStore (defaultRootStore.ts) and is verified
// by defaultRootStore.sqlite.buntest.ts.
import type { Database } from "bun:sqlite";
import type { DefaultRootStore } from "./defaultRootStore";

// A one-row table: `id` is pinned to 1 so `set` always upserts the same row.
const CREATE_TABLE = `
  CREATE TABLE IF NOT EXISTS default_root (
    id       INTEGER PRIMARY KEY CHECK (id = 1),
    path     TEXT NOT NULL CHECK (path <> ''),
    saved_at TEXT NOT NULL
  ) STRICT;
`;
// The current column set, in DDL order. A live db whose columns don't match is
// recreated (retire, don't migrate) — so any change to CREATE_TABLE must update this.
const EXPECTED_COLUMNS = ["id", "path", "saved_at"];

/** Store over the shared connection (openKvasirDb). `now` yields the ISO `saved_at`
 * stamp (diagnostic only), injectable for tests. */
export function createSqliteDefaultRootStore(
  db: Database,
  now: () => string = () => new Date().toISOString(),
): DefaultRootStore {
  db.run(CREATE_TABLE);
  // Retire, don't migrate: drop + recreate on a shape mismatch (wipe-anytime cache).
  const liveColumns = db
    .query<{ name: string }, []>("PRAGMA table_info(default_root)")
    .all()
    .map((column) => column.name);
  const shapeMatches =
    liveColumns.length === EXPECTED_COLUMNS.length && EXPECTED_COLUMNS.every((c) => liveColumns.includes(c));
  if (!shapeMatches) {
    db.run("DROP TABLE default_root");
    db.run(CREATE_TABLE);
  }

  const selectPath = db.query<{ path: string }, []>("SELECT path FROM default_root WHERE id = 1");
  const upsert = db.query(
    `INSERT INTO default_root (id, path, saved_at) VALUES (1, $path, $savedAt)
     ON CONFLICT(id) DO UPDATE SET path = $path, saved_at = $savedAt`,
  );

  return {
    get: () => selectPath.get()?.path ?? null,
    set: (root) => {
      upsert.run({ $path: root, $savedAt: now() });
    },
  };
}
