// Regenerate-confirmation modal: incremental update (when new commits exist) or
// a full rebuild. A shadcn-styled overlay rendered inside the shadow root (so no
// Radix portal is needed); closes on backdrop click or cancel.
import type { JSX } from "react";
import { launcherStore } from "../launcher";
import { Button } from "../ui/button";

export function RegenDialog({ onClose }: { onClose: () => void }): JSX.Element {
  const newCommits = launcherStore.newCommits();
  const run = (mode: "new" | "incremental", sinceSha?: string) => {
    onClose();
    void launcherStore.requestGenerate(mode, sinceSha);
  };
  return (
    <div
      className="prw-dialog-back fixed inset-0 z-[2147483010] flex items-center justify-center bg-black/45"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div
        role="dialog"
        aria-modal="true"
        className="prw-dialog w-[380px] max-w-[92vw] rounded-xl border border-border bg-background p-4 text-foreground shadow-2xl"
      >
        <div className="mb-1 text-base font-semibold">
          {newCommits ? "New commits since this review" : "Regenerate this review"}
        </div>
        <p className="mb-3 text-sm text-muted-foreground">
          Regenerating runs in your Claude session and blocks chat while it thinks. Choose how:
        </p>
        {newCommits && (
          <button
            className="mb-2 block w-full rounded-lg border border-border bg-secondary p-3 text-left hover:border-primary"
            onClick={() => run("incremental", launcherStore.spec()?.pr?.headSha)}
          >
            <b className="block text-sm font-semibold">Incremental update</b>
            <span className="block text-xs text-muted-foreground">
              Add steps covering only what changed since the last review.
            </span>
          </button>
        )}
        <button
          className="mb-2 block w-full rounded-lg border border-border bg-secondary p-3 text-left hover:border-primary"
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
