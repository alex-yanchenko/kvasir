// The launcher block (bottom-left): Run review / Open review / Ask about PR /
// Regenerate, or the generating status with its live elapsed timer. All state
// machinery lives in launcher.ts; this renders it and arms the dismiss button.
import type { JSX } from "react";
import { useEffect, useState, useSyncExternalStore } from "react";
import { fmtElapsed, launcherStore } from "../launcher";
import { chatStore } from "../chat";
import { getSnapshot, subscribe } from "../store";
import { RegenDialog } from "./RegenDialog";

function GenTimer({ startAt }: { startAt: number }): JSX.Element {
  const [, setTick] = useState(0);
  useEffect(() => {
    const clock = setInterval(() => setTick((t) => t + 1), 1000);
    return () => clearInterval(clock);
  }, []);
  return <span className="prw-gen-time">{fmtElapsed(Date.now() - startAt)}</span>;
}

function GeneratingStatus(): JSX.Element {
  const [armed, setArmed] = useState(false);
  // first click arms; reverts after a few seconds
  useEffect(() => {
    if (!armed) return;
    const t = setTimeout(() => setArmed(false), 3000);
    return () => clearTimeout(t);
  }, [armed]);
  return (
    <div className="prw-launch-status">
      <span>⏳ Generating review… </span>
      <GenTimer startAt={launcherStore.genStartAt()} />
      <span className="prw-gen-note"> · runs in your session, blocks chat </span>
      <button
        className={"prw-dismiss" + (armed ? " prw-dismiss-armed" : "")}
        title="Stop watching — generation keeps running in your session; reopen later"
        onClick={() => (armed ? launcherStore.dismissGen() : setArmed(true))}
      >
        {armed ? "click again to confirm" : "dismiss"}
      </button>
    </div>
  );
}

export function Launcher(): JSX.Element {
  useSyncExternalStore(subscribe, getSnapshot);
  const [dialog, setDialog] = useState(false);
  const spec = launcherStore.spec();
  return (
    <div id="prw-launch" className="prw-launch">
      {launcherStore.generating() ? (
        <GeneratingStatus />
      ) : spec ? (
        <>
          <button className="prw-pill" onClick={() => launcherStore.openTour()}>
            ▶ Open review ({spec.steps.length})
          </button>
          <button className="prw-pill prw-ghost" onClick={() => chatStore.openPrChat()}>
            💬 Ask about PR
          </button>
          {/* Regenerate is always available; emphasized when there are new commits. */}
          <button
            className={"prw-pill prw-ghost" + (launcherStore.newCommits() ? " prw-attn" : "")}
            onClick={() => setDialog(true)}
          >
            {launcherStore.newCommits() ? "⟳ Update" : "⟳ Regenerate"}
          </button>
          {dialog && <RegenDialog onClose={() => setDialog(false)} />}
        </>
      ) : (
        <button className="prw-pill" onClick={() => void launcherStore.requestGenerate("new")}>
          ▶ Run review
        </button>
      )}
    </div>
  );
}
