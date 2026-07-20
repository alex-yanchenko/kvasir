// Shared "retire, don't migrate" table-shape guard for the bun:sqlite stores. Every
// kvasir.db store is a wipe-anytime cache, never a back-compat carrier — so instead of
// writing an ALTER when a table's shape drifts, it drops and recreates. bun:sqlite is
// Bun-only (can't import under vitest), so this holds no vitest-tested logic; each
// store's own *.sqlite.buntest.ts exercises it through that store.
import type { Database } from "bun:sqlite";

/**
 * Ensure `table` exists with exactly `expectedColumns` (order-independent). Creates it
 * from `createTableSql`; if a live table's columns don't match — a column added,
 * removed, or renamed — drops and recreates it, discarding the old-shape rows. A fresh
 * or already-matching db is left untouched, so this only fires on a real shape change.
 *
 * `table` is interpolated into the PRAGMA/DROP (SQLite can't bind an identifier), so it
 * MUST be a trusted code literal — never a caller/user-supplied value.
 */
export function ensureTableShape(
  db: Database,
  table: string,
  createTableSql: string,
  expectedColumns: readonly string[],
): void {
  db.run(createTableSql);
  const liveColumns = db
    .query<{ name: string }, []>(`PRAGMA table_info(${table})`)
    .all()
    .map((column) => column.name);
  const shapeMatches =
    liveColumns.length === expectedColumns.length && expectedColumns.every((c) => liveColumns.includes(c));
  if (!shapeMatches) {
    db.run(`DROP TABLE ${table}`);
    db.run(createTableSql);
  }
}
