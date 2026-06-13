// Wires Midgard to the Bifrost: every command becomes a page effect here, and
// page facts go back as reports. This is the only place commands are handled —
// the controller functions themselves stay plain, testable functions.

import type { Bifrost } from "../bifrost";
import { clearHL, clearPick, jumpToRef, rehighlightSession, showStep } from "./midgard";

export function connectMidgard(bifrost: Bifrost): () => void {
  const offs = [
    bifrost.handle("highlight:step", (step) => showStep(step)),
    bifrost.handle("highlight:clear", () => clearHL()),
    bifrost.handle("pick:rehighlight", (p) => {
      const rows = rehighlightSession({ file: p.file, text: p.text });
      if (p.scroll) rows[0]?.scrollIntoView({ behavior: "smooth", block: "center" });
    }),
    bifrost.handle("pick:clear", () => clearPick()),
    bifrost.handle("jump:ref", ({ file, start, end }) => {
      if (!jumpToRef(file, start, end)) bifrost.report("ref:missing", { file });
    }),
    bifrost.handle("theme:apply", ({ theme, hlStyle }) => {
      // "auto" is resolved in CSS via @media (prefers-color-scheme); just reflect
      // the raw choice onto the body and let the stylesheet pick the palette.
      document.body.dataset.prwTheme = theme;
      document.body.dataset.prwHl = hlStyle;
    }),
  ];
  return () => offs.forEach((off) => off());
}
