// The ONE way kvasir.db is opened. The channel opens a single connection and
// hands it to every store (guides, sessions, manifests, resolved repos) — per-store opens meant
// several WAL handles on the same file for no reason, and per-connection PRAGMAs
// applied only to whichever store ran first. Bun-only (bun:sqlite).
import { Database } from "bun:sqlite";

export function openKvasirDb(dbPath: string): Database {
  const db = new Database(dbPath, { create: true });
  db.run("PRAGMA foreign_keys = ON;"); // per-connection (no FKs yet, but the contract holds)
  db.run("PRAGMA journal_mode = WAL;"); // concurrent reads while a push writes
  return db;
}
