// Durable storage for pushed reviews. The mailbox used to be an in-memory Map that
// a channel restart dropped (re-push everything); this keeps reviews as one JSON
// file per review under a directory, so they survive restarts and can be listed as
// history. bridge.ts depends on the ReviewStore interface (in-memory impl in tests);
// channel.ts wires the file-backed one.
import { mkdirSync, readdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import path from "node:path";
import { type Review, ReviewSchema } from "@prw/runes";

/** A lightweight history row — enough to tell reviews apart by their term (title)
 * and origin without shipping every step. */
export interface ReviewSummary {
  id: string;
  title: string;
  source?: string;
  generatedAt?: string;
  steps: number;
  repos: string[];
}

export interface ReviewStore {
  get(id: string): Review | null;
  put(review: Review): void;
  /** Summaries, newest first, for the history list. */
  list(): ReviewSummary[];
}

export function toReviewSummary(review: Review): ReviewSummary {
  const repos = [...new Set(review.steps.map((step) => `${step.repo.owner}/${step.repo.name}`))];
  return {
    id: review.id ?? "",
    title: review.title,
    steps: review.steps.length,
    repos,
    // omit (not set to undefined) when absent — exactOptionalPropertyTypes + ?:
    ...(review.source === undefined ? {} : { source: review.source }),
    ...(review.generatedAt === undefined ? {} : { generatedAt: review.generatedAt }),
  };
}

const sortKey = (summary: ReviewSummary): string => summary.generatedAt ?? "";
const byNewest = (a: ReviewSummary, b: ReviewSummary): number => sortKey(b).localeCompare(sortKey(a));

/** In-memory store — the default fallback and what bridge unit tests use. */
export function createMemoryReviewStore(seed: readonly Review[] = []): ReviewStore {
  const map = new Map<string, Review>();
  for (const review of seed) if (review.id) map.set(review.id, review);
  return {
    get: (id) => map.get(id) ?? null,
    put: (review) => {
      if (review.id) map.set(review.id, review);
    },
    list: () => [...map.values()].map((review) => toReviewSummary(review)).toSorted(byNewest),
  };
}

// Ids become <id>.json on disk, so reject anything that isn't a plain slug/hex
// token (no path separators, no traversal) before it touches the filesystem.
const isSafeId = (id: string): boolean => /^[\w.-]+$/.test(id) && id !== "." && id !== "..";

const parseReview = (raw: string): Review | null => {
  try {
    const parsed = ReviewSchema.safeParse(JSON.parse(raw));
    return parsed.success ? parsed.data : null;
  } catch {
    return null;
  }
};

/** File-backed store: one JSON file per review under `directory`. Writes go through
 * a temp file + rename (atomic); unreadable/corrupt files are skipped, never fatal. */
export function createFileReviewStore(directory: string): ReviewStore {
  mkdirSync(directory, { recursive: true });
  const fileFor = (id: string): string => path.join(directory, `${id}.json`);
  return {
    get(id) {
      if (!isSafeId(id)) return null;
      try {
        return parseReview(readFileSync(fileFor(id), "utf8"));
      } catch {
        return null;
      }
    },
    put(review) {
      if (!review.id || !isSafeId(review.id)) return;
      const temporary = path.join(directory, `.${review.id}.tmp`);
      writeFileSync(temporary, JSON.stringify(review, null, 2));
      renameSync(temporary, fileFor(review.id));
    },
    list() {
      let names: string[];
      try {
        names = readdirSync(directory);
      } catch {
        return [];
      }
      const summaries: ReviewSummary[] = [];
      for (const name of names) {
        if (!name.endsWith(".json")) continue;
        let raw: string;
        try {
          raw = readFileSync(path.join(directory, name), "utf8");
        } catch {
          continue;
        }
        const review = parseReview(raw);
        if (review) summaries.push(toReviewSummary(review));
      }
      return summaries.toSorted(byNewest);
    },
  };
}
