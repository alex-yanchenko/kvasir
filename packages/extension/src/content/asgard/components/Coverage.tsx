// Coverage confidence: does the walkthrough explain the whole change? "key files"
// are the significant changed files (≥30 changed lines, excluding tests/generated/
// deleted) — not every changed file — so a small/test-heavy PR reads e.g. 1/1 even
// with many files touched. Stamped server-side at publish (PR walkthroughs only);
// absent for a cross-repo review or a pre-coverage cached spec → renders nothing.
import { AlertTriangle, Check, ChevronDown } from "lucide-react";
import { useState } from "react";
import type { JSX } from "react";
import { bifrost } from "../../bifrost";

export function Coverage({
  coverage,
}: Readonly<{ coverage: { significant: string[]; uncovered: string[] } | undefined }>): JSX.Element | null {
  const [open, setOpen] = useState(false);
  if (!coverage || coverage.significant.length === 0) return null;
  const { significant, uncovered } = coverage;
  const covered = Math.max(0, significant.length - uncovered.length); // guard malformed server data
  const full = uncovered.length === 0;
  return (
    <div className="min-w-0">
      <button
        className="flex min-w-0 items-center gap-1 text-left text-[11px]"
        aria-label="Walkthrough coverage of key changed files"
        data-kvasir-tip={
          full
            ? "Every key changed file (≥30 changed lines) has a step"
            : "Some key changed files have no step — click to list them"
        }
        disabled={full}
        onClick={() => setOpen((value) => !value)}
      >
        {full ? (
          <Check className="size-3 shrink-0 text-primary" />
        ) : (
          <AlertTriangle className="size-3 shrink-0 text-amber-500" />
        )}
        <span className="whitespace-nowrap text-muted-foreground">
          {covered}/{significant.length} key
        </span>
        {!full && (
          <ChevronDown className={"size-3 shrink-0 transition-transform" + (open ? " rotate-180" : "")} />
        )}
      </button>
      {open && !full && (
        <ul className="mt-1 space-y-0.5">
          {uncovered.map((path) => (
            <li key={path}>
              <button
                className="block w-full truncate text-left font-mono text-[11px] text-muted-foreground hover:text-primary"
                data-kvasir-tip="Jump to this uncovered file in the diff"
                onClick={() => bifrost.send("jump:ref", { file: path, start: null, end: null })}
              >
                {path}
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
