/**
 * The reviewer's default clones root — a single directory under which resolution
 * looks for `<root>/<repo>` before giving up, set via the resolution card's "set as
 * my default root" action so repos kept there never prompt again. A wipe-friendly
 * single-value cache (retire, don't migrate). bridge/resolution unit tests use the
 * in-memory impl here; channel.ts wires the bun:sqlite one (defaultRootStore.sqlite.ts).
 */
export interface DefaultRootStore {
  /** The saved default root, or null if none is set. */
  get(): string | null;
  /** Persist (replace) the default root. */
  set(root: string): void;
}

/** In-memory store — what bridge/resolution unit tests run against. */
export function createMemoryDefaultRootStore(): DefaultRootStore {
  let root: string | null = null;
  return {
    get: () => root,
    set: (next) => {
      root = next;
    },
  };
}
