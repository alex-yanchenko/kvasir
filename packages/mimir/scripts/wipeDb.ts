#!/usr/bin/env bun
/**
 * Full reset of the Kvasir durable store (~/.kvasir/kvasir.db): hard-delete every
 * stored walkthrough (live AND soft-deleted) plus every paired session, so the
 * channel comes up empty and the browser must re-pair.
 *
 * Destructive, so it follows the repo's destructive-script rule: a bare run is a
 * DRY RUN that only prints the live counts; nothing is written without --apply.
 * The wipe logic itself lives in the tested store methods (GuideStore.wipe,
 * SessionStore.clear) — this is IO-only glue, like buildReview.ts.
 *
 *   bun run scripts/wipeDb.ts            → prints counts, writes nothing
 *   bun run scripts/wipeDb.ts --apply    → wipes entries + sessions
 */
import { homedir } from "node:os";
import path from "node:path";
import { createSqliteGuideStore } from "../src/guideStore.sqlite";
import { createSqliteSessionStore } from "../src/sessionStore.sqlite";

// Mirrors channel.ts: the durable db lives at ~/.kvasir/kvasir.db.
const dbPath = path.join(homedir(), ".kvasir", "kvasir.db");

function main(): void {
  const apply = process.argv.includes("--apply");
  const guides = createSqliteGuideStore(dbPath);
  const sessions = createSqliteSessionStore(dbPath);
  const entryCount = guides.list().length;
  const sessionCount = sessions.all().length;

  if (!apply) {
    console.log(
      `DRY RUN — ${entryCount} entries + ${sessionCount} sessions in ${dbPath}; pass --apply to wipe.`,
    );
    return;
  }

  guides.wipe();
  sessions.clear();
  console.log(
    `wiped ${entryCount} entries + ${sessionCount} sessions — restart the kvasir channel`,
  );
}

try {
  main();
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
}
