#!/usr/bin/env bun
/**
 * Full reset of the Kvasir durable store (~/.kvasir/kvasir.db): hard-delete every
 * stored walkthrough (live AND soft-deleted), every paired session, and every
 * recorded PR manifest, so the channel comes up empty and the browser must re-pair.
 *
 * Destructive, so it follows the repo's destructive-script rule: a bare run is a
 * DRY RUN that only prints the live counts; nothing is written without --apply.
 * The wipe logic itself lives in the tested store methods (GuideStore.wipe,
 * SessionStore.clear, ManifestStore.clear) — this is IO-only glue, like buildReview.ts.
 *
 *   bun run scripts/wipeDb.ts            → prints counts, writes nothing
 *   bun run scripts/wipeDb.ts --apply    → wipes entries + sessions + manifests
 */
import { homedir } from "node:os";
import path from "node:path";
import { openKvasirDb } from "../src/db";
import { createSqliteGuideStore } from "../src/guideStore.sqlite";
import { createSqliteManifestStore } from "../src/manifestStore.sqlite";
import { createSqliteSessionStore } from "../src/sessionStore.sqlite";

// Mirrors channel.ts: the durable db lives at ~/.kvasir/kvasir.db.
const dbPath = path.join(homedir(), ".kvasir", "kvasir.db");

function main(): void {
  const apply = process.argv.includes("--apply");
  const db = openKvasirDb(dbPath);
  const guides = createSqliteGuideStore(db);
  const sessions = createSqliteSessionStore(db);
  const manifests = createSqliteManifestStore(db);
  const entryCount = guides.list().length;
  const sessionCount = sessions.all().length;

  if (!apply) {
    console.log(
      `DRY RUN — ${entryCount} entries + ${sessionCount} sessions (+ recorded PR manifests) in ${dbPath}; pass --apply to wipe.`,
    );
    return;
  }

  guides.wipe();
  sessions.clear();
  manifests.clear();
  console.log(
    `wiped ${entryCount} entries + ${sessionCount} sessions + the PR manifests — restart the kvasir channel`,
  );
}

try {
  main();
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
}
