// Settings tab — theme + highlight toggles and the bridge pairing (Connection).
// Replaces the floating gear popover; the machines (settingsStore/pairingStore)
// are unchanged.
import type { JSX } from "react";
import { useEffect } from "react";
import { Check, Loader2 } from "lucide-react";
import { pairingStore } from "../../pairing";
import { getSnapshot, settingsStore, subscribe } from "../../store";
import { Button } from "../../ui/button";
import { useSyncExternalStore } from "react";

function Segmented({
  label,
  value,
  options,
  onChange,
}: {
  label: string;
  value: string;
  options: Array<{ value: string; label: string }>;
  onChange: (v: string) => void;
}): JSX.Element {
  return (
    <div className="flex items-center justify-between gap-3">
      <span className="text-sm text-muted-foreground">{label}</span>
      <div className="inline-flex gap-0.5 rounded-lg bg-muted p-0.5" role="group" aria-label={label}>
        {options.map((o) => (
          <Button
            key={o.value}
            size="sm"
            variant={value === o.value ? "default" : "ghost"}
            aria-pressed={value === o.value}
            className="h-7 border-0 shadow-none"
            onClick={() => onChange(o.value)}
          >
            {o.label}
          </Button>
        ))}
      </div>
    </div>
  );
}

function Connection(): JSX.Element {
  const p = pairingStore.state();
  useEffect(() => {
    void pairingStore.refresh();
  }, []);
  return (
    <div className="flex flex-col gap-2">
      <span className="text-sm font-medium">Connection</span>
      {p.phase === "paired" && (
        <span className="inline-flex items-center gap-1.5 text-sm text-primary">
          <Check className="size-4" /> Paired with your Claude session
        </span>
      )}
      {(p.phase === "unknown" || p.phase === "unpaired") && (
        <div className="flex items-center gap-2">
          <span className="text-sm text-muted-foreground">
            {p.phase === "unpaired" ? "Not paired" : "Checking…"}
          </span>
          <Button size="sm" className="ml-auto" onClick={() => void pairingStore.pair()}>
            Pair
          </Button>
        </div>
      )}
      {p.phase === "waiting" && (
        <span className="inline-flex items-center gap-1.5 text-sm text-muted-foreground">
          <Loader2 className="size-4 animate-spin" /> Confirm code{" "}
          <b className="font-mono tracking-widest text-foreground">{p.code}</b> in your Claude session
        </span>
      )}
      {p.phase === "error" && (
        <div className="flex items-center gap-2">
          <span className="text-sm text-destructive">{p.message}</span>
          <Button size="sm" variant="outline" className="ml-auto" onClick={() => void pairingStore.pair()}>
            Retry
          </Button>
        </div>
      )}
    </div>
  );
}

export function SettingsTab(): JSX.Element {
  useSyncExternalStore(subscribe, getSnapshot);
  return (
    <div className="flex flex-col gap-4 p-4">
      <Segmented
        label="Theme"
        value={settingsStore.theme()}
        options={[
          { value: "auto", label: "Auto" },
          { value: "light", label: "Light" },
          { value: "dark", label: "Dark" },
        ]}
        onChange={(v) => settingsStore.setTheme(v)}
      />
      <Segmented
        label="Highlight"
        value={settingsStore.hlStyle()}
        options={[
          { value: "tint", label: "Tint" },
          { value: "github", label: "GitHub" },
        ]}
        onChange={(v) => settingsStore.setHlStyle(v)}
      />
      <div className="border-t border-border pt-3">
        <Connection />
      </div>
    </div>
  );
}
