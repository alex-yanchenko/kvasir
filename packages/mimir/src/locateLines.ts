/**
 * Derive a step's `lines:{side,start,end}` from its `highlight` substrings by
 * locating them in the file's unified-diff patch — the server owns this verifiable
 * fact so the model only authors WHICH code it means (the `highlight`), never the
 * line arithmetic (which @@ header, which side, counting +/- lines). Same pattern as
 * server-derived anchors: the model names the target, the server computes the range.
 *
 * Pure over its inputs (no IO), so the walk logic is fully unit-tested.
 */
import type { StepLines } from "@kvasir/runes";

/** Unified-diff hunk header: @@ -oldStart[,oldCount] +newStart[,newCount] @@ ... */
const HUNK_HEADER = /^@@ -(\d+)(?:,\d+)? \+(\d+)(?:,\d+)? @@/;

interface PatchLine {
  kind: "context" | "add" | "del";
  /** 1-based line number on the old (L) side; meaningful for context + del. */
  oldNo: number;
  /** 1-based line number on the new (R) side; meaningful for context + add. */
  newNo: number;
  /** Line content with the leading diff marker (' '/'+'/'-') stripped. */
  content: string;
}

/** Split a patch into hunks (each a list of body lines with resolved L/R line
 * numbers), tracking the old/new counters off each @@ header. Body lines that are
 * neither context/add/del (the "\ No newline" marker, stray blanks) are skipped. */
function parseHunks(patch: string): PatchLine[][] {
  const hunks: PatchLine[][] = [];
  let current: PatchLine[] | undefined;
  let oldNo = 0;
  let newNo = 0;
  for (const raw of patch.split("\n")) {
    const header = HUNK_HEADER.exec(raw);
    if (header) {
      current = [];
      hunks.push(current);
      oldNo = Number(header[1]);
      newNo = Number(header[2]);
      continue;
    }
    if (!current) continue; // any preamble before the first hunk header
    const marker = raw[0];
    const content = raw.slice(1);
    switch (marker) {
      case "+": {
        current.push({ kind: "add", oldNo, newNo: newNo++, content });
        break;
      }
      case "-": {
        current.push({ kind: "del", oldNo: oldNo++, newNo, content });
        break;
      }
      case " ": {
        current.push({ kind: "context", oldNo: oldNo++, newNo: newNo++, content });
        break;
      }
      // any other marker ("\" no-newline, stray blank) is not a diff body line — skip
    }
  }
  return hunks;
}

const span = (numbers: number[]): { start: number; end: number } => ({
  start: Math.min(...numbers),
  end: Math.max(...numbers),
});

/**
 * Locate `highlight` substrings in `patch` and derive the line range.
 *
 * - The first hunk with any CHANGED-line match wins; changed lines beat context.
 * - Within that hunk, added ('+') matches → side "R" (new-side numbers); if only
 *   removed ('-') lines match → side "L" (old-side numbers). When both match (a
 *   modification), the added side wins — the reader lands on the current code.
 * - Context-only matches (an unchanged signature the step points at) are the last
 *   resort: side "R" at the context line's new-side number.
 * - Range = min..max of the matched lines on the chosen side (fills any gap).
 *
 * Returns undefined when the patch is absent or no substring matches — the caller
 * treats that as "cannot derive" (reject if the file has a patch, else lines-less).
 */
export function locateLines(
  highlight: readonly string[] | undefined,
  patch: string | undefined,
): StepLines | undefined {
  if (!patch) return undefined;
  const needles = (highlight ?? []).map((h) => h.trim()).filter((h) => h.length > 0);
  if (needles.length === 0) return undefined;
  const matches = (content: string): boolean => needles.some((needle) => content.includes(needle));

  const hunks = parseHunks(patch);

  for (const hunk of hunks) {
    const added = hunk.filter((line) => line.kind === "add" && matches(line.content));
    if (added.length > 0) return { side: "R", ...span(added.map((line) => line.newNo)) };
    const removed = hunk.filter((line) => line.kind === "del" && matches(line.content));
    if (removed.length > 0) return { side: "L", ...span(removed.map((line) => line.oldNo)) };
  }

  for (const hunk of hunks) {
    const context = hunk.filter((line) => line.kind === "context" && matches(line.content));
    if (context.length > 0) return { side: "R", ...span(context.map((line) => line.newNo)) };
  }

  return undefined;
}
