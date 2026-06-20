// The bun:sqlite-backed GuideStore — one STRICT table with soft deletes, so the
// stored walkthrough history survives restarts and deleted rows are retained for
// retrospective analysis. bun:sqlite is Bun-only and can't be imported under
// vitest/node, so this file is the "excluded glue" tier (like channel.ts): it
// holds no decision logic of its own — every rule (content hashing, version
// bump, idempotent re-push, soft-delete, newest-first order) mirrors the
// node-tested createMemoryGuideStore in guideStore.ts and is verified by the
// bun-run guideStore.sqlite.buntest.ts.
import { type EntryKind, EntryKindSchema, type EntrySummary } from "@prw/runes";
import { Database } from "bun:sqlite";
import { contentHash, type GuideRecord, type GuideStore, toEntrySummary } from "./guideStore";

/** A row as stored — SQLite gives us strings/numbers/null, never the rich types. */
interface EntryRow {
  id: string;
  kind: string;
  title: string;
  source: string | null;
  steps: number;
  url: string;
  repos: string;
  payload: string;
  version: number;
  content_hash: string;
  generated_at: string | null;
  author: string | null;
  created_at: number;
  updated_at: number;
  deleted_at: number | null;
}

const CREATE_TABLE = `
  CREATE TABLE IF NOT EXISTS entries (
    id           TEXT    PRIMARY KEY,
    kind         TEXT    NOT NULL CHECK (kind IN ('pr','code')),
    title        TEXT    NOT NULL CHECK (title <> ''),
    source       TEXT,
    steps        INTEGER NOT NULL CHECK (steps >= 1),
    url          TEXT    NOT NULL,
    repos        TEXT    NOT NULL,
    payload      TEXT    NOT NULL,
    version      INTEGER NOT NULL,
    content_hash TEXT    NOT NULL,
    generated_at TEXT,
    author       TEXT,
    created_at   INTEGER NOT NULL,
    updated_at   INTEGER NOT NULL,
    deleted_at   INTEGER
  ) STRICT;
`;
const CREATE_INDEX =
  "CREATE INDEX IF NOT EXISTS idx_entries_live ON entries(kind, updated_at) WHERE deleted_at IS NULL;";

/** Only string elements survive — defends the row->summary read against a payload
 * a different writer might have shaped wrong, without a cast. */
const asStringArray = (value: unknown): string[] =>
  Array.isArray(value) ? value.filter((item): item is string => typeof item === "string") : [];

/** Recover the PR number from a pr entry's id (prKey = "owner/repo#number"), so
 * even rows stored before the author column show "#123" without a re-publish. */
const prNumberFromId = (kind: EntryKind, id: string): number | undefined => {
  if (kind !== "pr") return undefined;
  const parsed = Number(id.slice(id.lastIndexOf("#") + 1));
  return Number.isFinite(parsed) ? parsed : undefined;
};

const rowToSummary = (row: EntryRow): EntrySummary => {
  const repos: unknown = JSON.parse(row.repos);
  const kind = EntryKindSchema.parse(row.kind);
  const prNumber = prNumberFromId(kind, row.id);
  const record: GuideRecord = {
    kind,
    id: row.id,
    title: row.title,
    steps: row.steps,
    url: row.url,
    repos: asStringArray(repos),
    payload: undefined,
    ...(row.source === null ? {} : { source: row.source }),
    ...(row.generated_at === null ? {} : { generatedAt: row.generated_at }),
    ...(prNumber === undefined ? {} : { prNumber }),
    ...(row.author === null ? {} : { author: row.author }),
  };
  return toEntrySummary(record, row.version, row.updated_at);
};

/** File-backed store at `dbPath`. `now` is injectable for deterministic tests. */
export function createSqliteGuideStore(dbPath: string, now: () => number = () => Date.now()): GuideStore {
  const db = new Database(dbPath, { create: true });
  db.run("PRAGMA foreign_keys = ON;"); // per-connection (no FKs yet, but the contract holds)
  db.run("PRAGMA journal_mode = WAL;"); // concurrent reads while a push writes
  db.run(CREATE_TABLE);
  db.run(CREATE_INDEX);
  const columns = db.query<{ name: string }, []>("PRAGMA table_info(entries)").all();
  if (!columns.some((column) => column.name === "author")) {
    db.run("ALTER TABLE entries ADD COLUMN author TEXT");
  }

  const selectById = db.query<EntryRow, [string]>("SELECT * FROM entries WHERE id = ?");
  const selectLiveById = db.query<EntryRow, [string]>(
    "SELECT * FROM entries WHERE id = ? AND deleted_at IS NULL",
  );
  const selectLive = db.query<EntryRow, []>(
    "SELECT * FROM entries WHERE deleted_at IS NULL ORDER BY updated_at DESC",
  );
  const upsert = db.query(
    `INSERT INTO entries
       (id, kind, title, source, steps, url, repos, payload, version, content_hash, generated_at, author, created_at, updated_at, deleted_at)
     VALUES ($id, $kind, $title, $source, $steps, $url, $repos, $payload, $version, $hash, $generatedAt, $author, $createdAt, $updatedAt, NULL)
     ON CONFLICT(id) DO UPDATE SET
       kind = $kind, title = $title, source = $source, steps = $steps, url = $url, repos = $repos,
       payload = $payload, version = $version, content_hash = $hash, generated_at = $generatedAt,
       author = $author, updated_at = $updatedAt, deleted_at = NULL`,
  );
  const softDeleteById = db.query("UPDATE entries SET deleted_at = $t WHERE id = $id AND deleted_at IS NULL");

  const put = db.transaction((record: GuideRecord): EntrySummary => {
    const hash = contentHash(record.payload);
    const existing = selectById.get(record.id);
    if (existing && existing.content_hash === hash && existing.deleted_at === null) {
      return rowToSummary(existing); // unchanged + live: no write, no version bump, no re-sort
    }
    const changed = !existing || existing.content_hash !== hash;
    const version = existing && !changed ? existing.version : (existing?.version ?? 0) + 1;
    const createdAt = existing?.created_at ?? now();
    const updatedAt = now();
    upsert.run({
      $id: record.id,
      $kind: record.kind,
      $title: record.title,
      $source: record.source ?? null,
      $steps: record.steps,
      $url: record.url,
      $repos: JSON.stringify(record.repos),
      $payload: JSON.stringify(record.payload),
      $version: version,
      $hash: hash,
      $generatedAt: record.generatedAt ?? null,
      $author: record.author ?? null,
      $createdAt: createdAt,
      $updatedAt: updatedAt,
    });
    return toEntrySummary(record, version, updatedAt);
  });

  return {
    put: (record) => put(record),
    get(id) {
      const row = selectLiveById.get(id);
      if (!row) return null;
      const payload: unknown = JSON.parse(row.payload);
      return { kind: EntryKindSchema.parse(row.kind), payload };
    },
    list: () => selectLive.all().map((row) => rowToSummary(row)),
    softDelete: (id) => softDeleteById.run({ $t: now(), $id: id }).changes > 0,
  };
}
