// Regenerate-confirmation modal: incremental update (when new commits exist) or
// a full rebuild. A shadcn-styled overlay rendered inside the shadow root (so no
// Radix portal is needed); closes on backdrop click or cancel.
import { useEffect } from "react";
import type { JSX } from "react";
import { launcherStore } from "../launcher";
import { Button } from "../ui/button";

export function RegenDialog({ onClose }: Readonly<{ onClose: () => void }>): JSX.Element {
  const newCommits = launcherStore.newCommits();
  const run = (mode: "new" | "incremental", sinceSha?: string) => {
    onClose();
    void launcherStore.requestGenerate(mode, sinceSha);
  };
  // Escape closes the modal — the keyboard equivalent of the backdrop click.
  useEffect(() => {
    const onKey = (event: KeyboardEvent): void => {
      if (event.key === "Escape") onClose();
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [onClose]);
  return (
    // eslint-disable-next-line jsx-a11y/no-static-element-interactions, jsx-a11y/click-events-have-key-events -- backdrop click-to-dismiss is a mouse convenience; keyboard users close via the Cancel button or Escape (handler above).
    <div
      className="prw-dialog-back fixed inset-0 z-[2147483010] flex items-center justify-center bg-black/45"
      onClick={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="prw-regen-title"
        className="prw-dialog w-[380px] max-w-[92vw] rounded-xl border border-border bg-background p-4 text-foreground shadow-2xl"
      >
        <div id="prw-regen-title" className="mb-1 text-base font-semibold">
          {newCommits ? "New commits since this review" : "Regenerate this review"}
        </div>
        <p className="mb-3 text-sm text-muted-foreground">
          Regenerating runs in your Claude session and blocks chat while it thinks. Choose how:
        </p>
        {newCommits && (
          <button
            className="mb-2 block w-full cursor-pointer rounded-lg border border-border bg-secondary p-3 text-left transition-colors hover:border-primary hover:bg-accent"
            onClick={() => run("incremental", launcherStore.spec()?.pr?.headSha)}
          >
            <b className="block text-sm font-semibold">Incremental update</b>
            <span className="block text-xs text-muted-foreground">
              Add steps covering only what changed since the last review.
            </span>
          </button>
        )}
        <button
          className="mb-2 block w-full cursor-pointer rounded-lg border border-border bg-secondary p-3 text-left transition-colors hover:border-primary hover:bg-accent"
          onClick={() => run("new")}
        >
          <b className="block text-sm font-semibold">Regenerate as new</b>
          <span className="block text-xs text-muted-foreground">
            Rebuild the whole walkthrough from scratch.
          </span>
        </button>
        <Button variant="ghost" size="sm" className="w-full" onClick={onClose}>
          Cancel
        </Button>
      </div>
    </div>
  );
}
