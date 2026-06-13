// The single launcher chip (bottom-right) — the one entry point to the panel.
// Replaces the scattered launcher block; shows the generating timer inline.
import { BookOpen, Loader2 } from "lucide-react";
import { useEffect, useState, useSyncExternalStore } from "react";
import type { JSX } from "react";
import { fmtElapsed, launcherStore } from "../launcher";
import { getSnapshot, panelStore, subscribe } from "../store";
import { Button } from "../ui/button";

function Elapsed({ startAt }: Readonly<{ startAt: number }>): JSX.Element {
  const [, setTick] = useState(0);
  useEffect(() => {
    const clock = setInterval(() => setTick((t) => t + 1), 1000);
    return () => clearInterval(clock);
  }, []);
  return <span className="tabular-nums">{fmtElapsed(Date.now() - startAt)}</span>;
}

export function LauncherChip(): JSX.Element | null {
  useSyncExternalStore(subscribe, getSnapshot);
  if (panelStore.isOpen()) return null; // the panel header owns the close affordance
  const generating = launcherStore.generating();
  return (
    <Button
      className="fixed bottom-5 right-5 z-[2147483000]"
      style={{ boxShadow: "var(--elevation)" }}
      size="lg"
      onClick={() => panelStore.open()}
      aria-label="Open PR Walkthrough"
    >
      {generating ? <Loader2 className="animate-spin" /> : <BookOpen />}
      {generating ? (
        <>
          Generating… <Elapsed startAt={launcherStore.genStartAt()} />
        </>
      ) : (
        "PR Walkthrough"
      )}
    </Button>
  );
}
