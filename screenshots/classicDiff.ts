export function labelClassicDiffWithChangesTabMarkup(): number {
  for (const file of document.querySelectorAll<HTMLElement>('div.file[id^="diff-"][data-tagsearch-path]')) {
    file.querySelector("table")?.setAttribute("aria-label", `Diff for: ${file.dataset.tagsearchPath ?? ""}`);
  }
  let labelled = 0;
  for (const row of document.querySelectorAll<HTMLTableRowElement>('div.file[id^="diff-"] tr')) {
    const code = row.querySelector<HTMLTableCellElement>("td.blob-code:not(.blob-code-hunk)");
    const lineNumber = [...row.querySelectorAll<HTMLElement>("td.blob-num[data-line-number]")].at(-1)?.dataset
      .lineNumber;
    if (!code || !lineNumber) continue;
    for (const node of [...code.childNodes]) {
      if (node.nodeType === Node.TEXT_NODE && (node.textContent ?? "").trim() === "") node.remove();
    }
    row.classList.add("diff-line-row");
    code.classList.add("diff-text-cell");
    code.dataset.lineNumber = lineNumber;
    labelled++;
  }
  return labelled;
}
