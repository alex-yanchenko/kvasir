// Regenerate-confirmation dialog: incremental update (when new commits exist)
// or a full rebuild. Closes on backdrop click or cancel.
import type { JSX } from "react";
import { launcherStore } from "../launcher";

export function RegenDialog({ onClose }: { onClose: () => void }): JSX.Element {
  const newCommits = launcherStore.newCommits();
  const run = (mode: "new" | "incremental", sinceSha?: string) => {
    onClose();
    void launcherStore.requestGenerate(mode, sinceSha);
  };
  return (
    <div
      className="prw-dialog-back"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div className="prw-dialog">
        <div className="prw-dialog-title">
          {newCommits ? "New commits since this review" : "Regenerate this review"}
        </div>
        <div className="prw-dialog-body">
          Regenerating runs in your Claude session and blocks chat while it thinks. Choose how:
        </div>
        {newCommits && (
          <button
            className="prw-dialog-opt"
            onClick={() => run("incremental", launcherStore.spec()?.pr?.headSha)}
          >
            <b>Incremental update</b>
            <span>Add steps covering only what changed since the last review.</span>
          </button>
        )}
        <button className="prw-dialog-opt" onClick={() => run("new")}>
          <b>Regenerate as new</b>
          <span>Rebuild the whole walkthrough from scratch.</span>
        </button>
        <button className="prw-dialog-cancel" onClick={onClose}>
          Cancel
        </button>
      </div>
    </div>
  );
}
