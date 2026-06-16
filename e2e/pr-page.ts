// A stand-in GitHub "Files changed" page carrying the exact diff markup the
// extension's pure readers (midgard/diff.ts) key off: a `#diff-<anchor>`
// container whose path is in its aria-labelledby heading, holding
// `tr.diff-line-row > td.diff-text-cell[data-line-number]` rows. The highlighter
// (midgard.ts) finds rows by that contract, so a spec step's anchor + line range
// must line up with what's rendered here.

import type { WalkthroughSpec } from "../packages/runes/src/spec";

export const PR_URL = "https://github.com/acme/widget/pull/1/files";

interface DiffLine {
  n: number;
  code: string;
}
interface DiffFile {
  anchor: string;
  path: string;
  lines: DiffLine[];
}

const FILES: DiffFile[] = [
  {
    anchor: "diff-foo",
    path: "src/foo.ts",
    lines: [
      { n: 1, code: "export function foo() {" },
      { n: 2, code: "+  const next = compute();" },
      { n: 3, code: "+  return next + 1;" },
      { n: 4, code: "}" },
    ],
  },
  {
    anchor: "diff-bar",
    path: "src/bar.ts",
    lines: [
      { n: 1, code: "export const bar = () => {" },
      { n: 2, code: "+  log('bar');" },
      { n: 3, code: "};" },
    ],
  },
];

const fileBlock = (file: DiffFile): string => `
  <div id="${file.anchor}" aria-labelledby="${file.anchor}-h" class="file">
    <h3 id="${file.anchor}-h">${file.path}</h3>
    <table aria-label="Diff for: ${file.path}"><tbody>
      ${file.lines
        .map(
          (line) =>
            `<tr class="diff-line-row"><td class="diff-text-cell" data-line-number="${line.n}">${line.code}</td></tr>`,
        )
        .join("\n")}
    </tbody></table>
  </div>`;

export const prPageHtml = ({ withDiff = true }: { withDiff?: boolean } = {}): string =>
  `<!doctype html><html><head><title>PR</title></head>
<body><div id="repo-content">Files changed</div>
${withDiff ? FILES.map(fileBlock).join("\n") : ""}
</body></html>`;

// A walkthrough spec whose step anchors + line ranges match prPageHtml's diff, so
// opening the Walkthrough tab highlights real rows. Loosely typed — the wire
// contract (and its zod validation) lives in @kvasir/runes/spec.
export const makeSpec = (): WalkthroughSpec => ({
  version: 1,
  pr: {
    url: "https://github.com/acme/widget/pull/1",
    owner: "acme",
    repo: "widget",
    number: 1,
    title: "Add compute() to foo",
    headSha: "sha-baseline",
  },
  generatedAt: "2026-01-01T00:00:00.000Z",
  overview: "Adds a compute step to foo and a log line to bar.",
  steps: [
    {
      id: "foo-compute",
      title: "Compute in foo",
      body: "<p>Introduces the <code>compute()</code> call.</p>",
      file: "src/foo.ts",
      anchor: "diff-foo",
      lines: { side: "R", start: 2, end: 3 },
      suggestions: ["Why compute here?"],
    },
    {
      id: "bar-log",
      title: "Log in bar",
      body: "<p>Adds a debug log line.</p>",
      file: "src/bar.ts",
      anchor: "diff-bar",
      lines: { side: "R", start: 2, end: 2 },
    },
  ],
});
