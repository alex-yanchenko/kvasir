export interface ParsedPr {
  owner: string;
  repo: string;
  number: number;
}

/**
 * Strict GitHub PR-URL matcher. owner/repo are restricted to GitHub's allowed
 * charset so nothing arbitrary can flow into a `gh` path or a session prompt.
 */
export const PR_URL_RE = /^https:\/\/github\.com\/[\w.-]+\/[\w.-]+\/pull\/\d+/;

/** Parse https://github.com/<owner>/<repo>/pull/<n>. Throws on anything else. */
export function parsePrUrl(url: string): ParsedPr {
  const m = url.match(/^https:\/\/github\.com\/([\w.-]+)\/([\w.-]+)\/pull\/(\d+)(?:[/?#]|$)/);
  if (!m) throw new Error("Not a GitHub PR URL");
  const [, ownerRaw, repoRaw] = m; // groups 1-2 always present when m matched
  const owner = ownerRaw ?? "";
  const repo = repoRaw ?? "";
  if (/^\.\.?$/.test(owner) || /^\.\.?$/.test(repo)) throw new Error("Not a GitHub PR URL");
  return { owner, repo, number: Number(m[3]) };
}

/** Canonical key for caching + lookup: "<owner>/<repo>#<number>". */
export function prKey(url: string): string {
  const { owner, repo, number } = parsePrUrl(url);
  return `${owner}/${repo}#${number}`;
}
