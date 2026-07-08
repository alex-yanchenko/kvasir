// Durable storage for stored walkthroughs — one SQLite table with soft deletes, so
// the full history survives a restart and deleted rows linger for retro analysis.
// Two KINDS share one store: `pr` (a PR-bound diff tour = a WalkthroughSpec) and
// `code` (a cross-repo authored explanation = a Review). bridge.ts depends on the
// GuideStore interface (the in-memory impl here is what its unit tests use);
// channel.ts wires the bun:sqlite-backed one (guideStore.sqlite.ts), which can't
// be imported under vitest/node — so all the LOGIC (record building, content
// hashing, version bump, soft-delete) lives here, node-tested, and the SQL file
// only mirrors it.
import { createHash } from "node:crypto";
import {
  type EntryKind,
  type EntrySummary,
  prKey,
  type Review,
  stepBlobUrl,
  type WalkthroughSpec,
} from "@kvasir/runes";
import { isRecord } from "./guard";

/** What a caller hands the store to upsert — the display fields plus the full
 * payload (Review | WalkthroughSpec) the store hashes for idempotency + drift. */
export interface GuideRecord {
  kind: EntryKind;
  id: string;
  title: string;
  source?: string;
  steps: number;
  url: string;
  repos: string[];
  payload: unknown;
  generatedAt?: string;
  prNumber?: number;
  author?: string;
}

export interface GuideStore {
  /** Upsert: assigns version 1 on first insert, bumps it only when the payload's
   * content hash changes, and clears any soft-delete (a re-push resurrects). */
  put(record: GuideRecord): EntrySummary;
  /** The stored payload for a LIVE id (soft-deleted rows read as absent). */
  get(id: string): { kind: EntryKind; payload: unknown } | null;
  /** Live rows, newest-changed first — the history list. */
  list(): EntrySummary[];
  /** Soft-delete a live row (kept for retro analysis); false if absent/already gone. */
  softDelete(id: string): boolean;
  /** Hard-delete ALL rows, live and soft-deleted — a full reset, not the
   * retro-preserving softDelete. Backs the wipe-all script and DELETE /entries. */
  wipe(): void;
}

/** Sort object keys recursively (arrays keep their order — step order IS content)
 * so the hash sees content, not serialization byte order. Zod's parsed output
 * orders keys by SCHEMA shape, so a schema recomposition would otherwise change
 * every stored payload's bytes and false-bump versions for unchanged content. */
function canonicalize(value: unknown): unknown {
  if (Array.isArray(value)) return value.map((entry) => canonicalize(entry));
  if (isRecord(value)) {
    const sorted: Record<string, unknown> = {};
    // Alphabetical is exactly the point: any stable total order over keys works.
    for (const key of Object.keys(value).toSorted((a, b) => a.localeCompare(b))) {
      sorted[key] = canonicalize(value[key]);
    }
    return sorted;
  }
  return value;
}

/** sha256 of the canonical (key-order-independent) JSON payload: equal hash ⇒
 * unchanged ⇒ no version bump (so a re-push of identical content raises no false
 * drift on the client). */
export function contentHash(payload: unknown): string {
  return createHash("sha256")
    .update(JSON.stringify(canonicalize(payload)))
    .digest("hex");
}

// ── pure record builders (kind mappers) ──────────────────────────────────────

/** A pushed cross-repo review -> a `code` record. Repos are the distinct
 * owner/name across steps; the row opens at step 1's `?kvasir=` blob landing. */
export function reviewToRecord(review: Review): GuideRecord {
  const repos = [...new Set(review.steps.map((step) => `${step.repo.owner}/${step.repo.name}`))];
  return {
    kind: "code",
    id: review.id ?? "",
    title: review.title,
    steps: review.steps.length,
    url: stepBlobUrl(review.steps[0]!, review.id), // ReviewSchema .min(1) guarantees step 0
    repos,
    payload: review,
    ...(review.source === undefined ? {} : { source: review.source }),
    ...(review.generatedAt === undefined ? {} : { generatedAt: review.generatedAt }),
  };
}

/** A published PR walkthrough spec -> a `pr` record. Id is the canonical prKey so
 * a re-publish of the same PR upserts the same row; the row opens on the PR's
 * Files tab. */
export function specToRecord(spec: WalkthroughSpec): GuideRecord {
  const { owner, repo, number, title, url } = spec.pr;
  return {
    kind: "pr",
    id: prKey(url),
    title: title ?? `${owner}/${repo}#${number}`,
    steps: spec.steps.length,
    url: `${url}/files`,
    repos: [`${owner}/${repo}`],
    payload: spec,
    generatedAt: spec.generatedAt,
    prNumber: number,
    ...(spec.pr.author === undefined ? {} : { author: spec.pr.author }),
  };
}

/** Project a record + its stored version/timestamp to the wire summary. The
 * payload is never read here — only the summary fields — so callers reconstructing
 * a row for display needn't carry it. */
export function toEntrySummary(
  record: Omit<GuideRecord, "payload">,
  version: number,
  updatedAt: number,
): EntrySummary {
  return {
    kind: record.kind,
    id: record.id,
    title: record.title,
    repos: record.repos,
    steps: record.steps,
    url: record.url,
    version,
    updatedAt,
    ...(record.source === undefined ? {} : { source: record.source }),
    ...(record.generatedAt === undefined ? {} : { generatedAt: record.generatedAt }),
    ...(record.prNumber === undefined ? {} : { prNumber: record.prNumber }),
    ...(record.author === undefined ? {} : { author: record.author }),
  };
}

// ── in-memory impl (bridge-test fallback; mirrors the SQL semantics) ──────────

interface Row {
  record: GuideRecord;
  version: number;
  hash: string;
  createdAt: number;
  updatedAt: number;
  deletedAt: number | null;
}

/** In-memory store — what bridge unit tests run against and the channel's fallback
 * if sqlite can't open. `now` is injectable so tests get deterministic timestamps. */
export function createMemoryGuideStore(now: () => number = () => Date.now()): GuideStore {
  const rows = new Map<string, Row>();
  return {
    put(record) {
      const hash = contentHash(record.payload);
      const existing = rows.get(record.id);
      // Unchanged content on a still-live row: idempotent no-op (no version bump,
      // no timestamp churn, so the client sees no false drift / re-sort).
      if (existing && existing.hash === hash && existing.deletedAt === null) {
        return toEntrySummary(existing.record, existing.version, existing.updatedAt);
      }
      const changed = !existing || existing.hash !== hash;
      const version = existing && !changed ? existing.version : (existing?.version ?? 0) + 1;
      const createdAt = existing?.createdAt ?? now();
      const updatedAt = now();
      rows.set(record.id, { record, version, hash, createdAt, updatedAt, deletedAt: null });
      return toEntrySummary(record, version, updatedAt);
    },
    get(id) {
      const row = rows.get(id);
      if (!row || row.deletedAt !== null) return null;
      return { kind: row.record.kind, payload: row.record.payload };
    },
    list() {
      return [...rows.values()]
        .filter((row) => row.deletedAt === null)
        .toSorted((a, b) => b.updatedAt - a.updatedAt)
        .map((row) => toEntrySummary(row.record, row.version, row.updatedAt));
    },
    softDelete(id) {
      const row = rows.get(id);
      if (!row || row.deletedAt !== null) return false;
      row.deletedAt = now();
      return true;
    },
    wipe() {
      rows.clear();
    },
  };
}
