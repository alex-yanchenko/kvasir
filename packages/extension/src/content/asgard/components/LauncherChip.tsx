// The single launcher chip (bottom-right) — the one entry point to the panel.
// Replaces the scattered launcher block; shows the generating timer inline.
import { Loader2 } from "lucide-react";
import { useEffect, useState, useSyncExternalStore } from "react";
import type { JSX } from "react";
import { fmtElapsed, launcherStore } from "../launcher";
import { pairingStore } from "../pairing";
import { getSnapshot, panelStore, subscribe } from "../store";
import { Button } from "../ui/button";
import { KvasirMark } from "../ui/KvasirMark";

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
  const paired = pairingStore.state().phase === "paired";
  return (
    <Button
      variant="outline"
      className="kvasir-glass fixed bottom-5 right-5 z-[2147483000] gap-2 rounded-[var(--radius-pill)] text-foreground"
      style={{ boxShadow: "var(--elevation)" }}
      size="lg"
      onClick={() => panelStore.open()}
      aria-label="Open Kvasir"
    >
      {/* rune in a fixed grid cell + leading-none so the pill's rune/dot/label sit
          on one optical line at any label length */}
      <span className="grid size-4 shrink-0 place-items-center">
        {generating ? (
          <Loader2 className="size-4 animate-spin text-primary" />
        ) : (
          <KvasirMark className="size-4 text-primary" />
        )}
      </span>
      <span
        aria-hidden="true"
        className={
          "size-1.5 shrink-0 rounded-full " +
          (paired ? "bg-success kvasir-dot-glow" : "bg-muted-foreground/40")
        }
      />
      <span className="leading-none">
        {generating ? (
          <>
            Generating… <Elapsed startAt={launcherStore.genStartAt()} />
          </>
        ) : (
          "Kvasir"
        )}
      </span>
    </Button>
  );
}
