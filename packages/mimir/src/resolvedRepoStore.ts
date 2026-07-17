/**
 * Where a PR's local checkout was resolved, keyed by `owner/repo`, so the reviewer
 * is asked once per repo and never again. A wipe-friendly cache: a saved path is
 * re-validated by resolveRepo whenever it is actually consulted (the clones-dir
 * default is tried first, so a shadowed entry isn't proactively checked), and an
 * entry that fails validation is dropped — a stale path is corrected, never migrated. bridge.ts
 * depends on this interface (its unit tests use the in-memory impl here); channel.ts
 * wires the bun:sqlite-backed one (resolvedRepoStore.sqlite.ts), which mirrors these
 * semantics and can't be imported under vitest/node.
 */
export interface ResolvedRepoStore {
  /** The saved local path for `owner/repo`, or null if none is remembered. */
  get(ownerRepo: string): string | null;
  /** Remember (upsert) the resolved path for `owner/repo`. */
  set(ownerRepo: string, path: string): void;
  /** Forget an entry — used when its path fails re-validation. */
  drop(ownerRepo: string): void;
}

/** In-memory store — what bridge/resolution unit tests run against. */
export function createMemoryResolvedRepoStore(): ResolvedRepoStore {
  const paths = new Map<string, string>();
  return {
    get: (ownerRepo) => paths.get(ownerRepo) ?? null,
    set: (ownerRepo, path) => {
      paths.set(ownerRepo, path);
    },
    drop: (ownerRepo) => {
      paths.delete(ownerRepo);
    },
  };
}
