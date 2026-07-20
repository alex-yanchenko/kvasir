/**
 * The `-c` config overrides applied to EVERY heavy-pass git invocation (worktree ops,
 * the local-clone adoption, the origin probe). Command-line `-c` is git's
 * highest-precedence config, so these win over any repo `.git/config`.
 *
 * Heavy-pass git only ever runs against a KVASIR-OWNED clone: the authoring tools
 * (prepare_/remove_context_worktree) refuse a repo path outside the clones dir, going
 * forward the boot GC sweep therefore only sees parents of kvasir-created worktrees (and
 * for any pre-guard leftover it falls back to these flags, not a clones-dir check), and a
 * checkout the reviewer points at elsewhere is brought in via `git clone --local`
 * (resolution.adoptForeignCheckout), which writes a fresh, kvasir-authored config —
 * leaving the foreign config's exec keys and named filters behind. So there is no
 * attacker-authored `.git/config` for these flags to override key-by-key; they are
 * defense in depth against content that ships in the fetched TREE, and hold regardless
 * of how the clone was created:
 *   core.hooksPath=/dev/null     — no repo hook runs (a post-checkout hook fires on `worktree add`)
 *   core.fsmonitor=false         — fsmonitor is otherwise a spawned command
 *   safe.bareRepository=explicit — git ignores a bare repo discovered by directory walk
 *                                  (a nested bare repo committed into the tree), honoring
 *                                  only one named via --git-dir/GIT_DIR (GHSA-9ccr-r5hg-74gf)
 *   core.symlinks=false          — checkout writes symlinks as plain files, breaking the
 *                                  symlink→.git checkout chain of CVE-2021-21300 (APFS,
 *                                  the macOS default, is case-insensitive)
 */
export const GIT_HARDENING = [
  "-c",
  "core.hooksPath=/dev/null",
  "-c",
  "core.fsmonitor=false",
  "-c",
  "safe.bareRepository=explicit",
  "-c",
  "core.symlinks=false",
] as const;

/** A fresh mutable copy of GIT_HARDENING for splicing into a spawn argv. */
export function gitHardeningFlags(): string[] {
  return [...GIT_HARDENING];
}

/** The env pair that keeps every heavy-pass git process headless — it must never block
 * on an interactive credential/passphrase prompt (the server has no tty). Spread into
 * each git spawn's env alongside gitHardeningFlags(). */
export const GIT_TERMINAL_PROMPT_OFF = { GIT_TERMINAL_PROMPT: "0" } as const;
