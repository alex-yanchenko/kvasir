// bun:sqlite-backed SessionStore — persisted paired sessions in kvasir.db, so a
// channel restart reloads them instead of forcing a re-pair. Bun-only (can't be
// imported under vitest); the logic it mirrors lives in sessionStore.ts and is
// verified by sessionStore.sqlite.buntest.ts under `bun test`.
import { Database } from "bun:sqlite";
import type { SessionRecord, SessionStore } from "./sessionStore";

const CREATE_TABLE = `
  CREATE TABLE IF NOT EXISTS sessions (
    id           TEXT    PRIMARY KEY,
    token_hash   TEXT    NOT NULL,
    name         TEXT    NOT NULL,
    created_at   INTEGER NOT NULL
  ) STRICT;
`;

interface SessionRow {
  id: string;
  token_hash: string;
  name: string;
  created_at: number;
}

export function createSqliteSessionStore(dbPath: string): SessionStore {
  const db = new Database(dbPath, { create: true });
  db.run("PRAGMA journal_mode = WAL;");
  db.run(CREATE_TABLE);

  const insert = db.query(
    `INSERT INTO sessions (id, token_hash, name, created_at) VALUES ($id, $hash, $name, $createdAt)
     ON CONFLICT(id) DO UPDATE SET token_hash = $hash, name = $name, created_at = $createdAt`,
  );
  const selectAll = db.query<SessionRow, []>("SELECT * FROM sessions ORDER BY created_at");
  const deleteById = db.query("DELETE FROM sessions WHERE id = $id");
  const deleteAll = db.query("DELETE FROM sessions");

  return {
    add: (record) => {
      insert.run({
        $id: record.id,
        $hash: record.tokenHash,
        $name: record.name,
        $createdAt: record.createdAt,
      });
    },
    all: () =>
      selectAll.all().map(
        (row): SessionRecord => ({
          id: row.id,
          tokenHash: row.token_hash,
          name: row.name,
          createdAt: row.created_at,
        }),
      ),
    remove: (id) => deleteById.run({ $id: id }).changes > 0,
    clear: () => {
      deleteAll.run();
    },
  };
}
