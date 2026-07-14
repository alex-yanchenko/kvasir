// Settings tab — theme + highlight toggles and the bridge pairing (Connection).
// Replaces the floating gear popover; the machines (settingsStore/pairingStore)
// are unchanged.
import { Check, Loader2 } from "lucide-react";
import { useEffect, useState, useSyncExternalStore } from "react";
import type { JSX, ReactNode } from "react";
import { wipeStoredData } from "../../debug";
import { pairingStore } from "../../pairing";
import { getSnapshot, settingsStore, subscribe } from "../../store";
import { Button } from "../../ui/button";

// Every setting carries a one-line `hint` describing what it does — users can't
// infer "Walkthrough depth" or "Highlight" from the label alone. Required, so a
// new setting can't ship unexplained.
function Segmented({
  label,
  value,
  options,
  onChange,
  hint,
}: Readonly<{
  label: string;
  value: string;
  options: Array<{ value: string; label: string }>;
  onChange: (v: string) => void;
  hint: string;
}>): JSX.Element {
  return (
    <div className="flex flex-col gap-1">
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
      <p className="text-xs text-muted-foreground/75">{hint}</p>
    </div>
  );
}

// The settings sections, in render order — shared with SettingsNav (the sidebar)
// which jumps to each by its data-settings-section id.
export const SETTINGS_SECTIONS = [
  { id: "appearance", label: "Appearance" },
  { id: "review", label: "Walkthrough" },
  { id: "generation", label: "Generation" },
  { id: "connection", label: "Connection" },
  { id: "debug", label: "Debug" },
] as const;

// A titled group of settings that SettingsNav can jump to. scroll-mt keeps a little
// headroom when SettingsNav scrolls one into view.
function Section({
  id,
  title,
  children,
}: Readonly<{ id: string; title: string; children: ReactNode }>): JSX.Element {
  return (
    <section data-settings-section={id} className="flex scroll-mt-2 flex-col gap-4">
      <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground/70">{title}</h3>
      {children}
    </section>
  );
}

function Connection(): JSX.Element {
  const p = pairingStore.state();
  useEffect(() => {
    void pairingStore.recheck();
  }, []);
  return (
    <div className="flex flex-col gap-2">
      <span className="text-sm font-medium">Connection</span>
      {p.phase === "paired" && (
        <span className="inline-flex items-center gap-1.5 text-sm text-primary">
          <Check className="size-4" /> Paired with your Claude session
        </span>
      )}
      {p.phase === "down" && (
        <div className="flex items-center gap-2">
          <span className="text-sm text-muted-foreground">
            Channel not running — run <b className="font-mono">kvasir</b> in your terminal to start it.
          </span>
          <Button size="sm" variant="outline" className="ml-auto" onClick={() => void pairingStore.recheck()}>
            Retry
          </Button>
        </div>
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

// The Debug row's explainer, by state. The wipe DELETEs the channel store, which
// only accepts a paired request — while unpaired the button is disabled and the
// text says why (an unpaired full reset is the wipe script's job, not the button's).
function wipeHint(wiped: boolean, blocked: boolean): string {
  if (wiped) return "Wiped — reload the page";
  if (blocked) return "Pair to wipe — the channel store only accepts a paired delete.";
  return "Clear all stored extension data";
}

function Debug(): JSX.Element {
  const [confirming, setConfirming] = useState(false);
  const [wiped, setWiped] = useState(false);
  const blocked = pairingStore.needsPairing();
  return (
    <div className="flex flex-col gap-2">
      <span className="text-sm font-medium">Debug</span>
      <div className="flex items-center gap-2">
        <span className="text-sm text-muted-foreground">{wipeHint(wiped, blocked)}</span>
        {wiped && (
          <Button size="sm" variant="outline" className="ml-auto" onClick={() => location.reload()}>
            Reload
          </Button>
        )}
        {confirming ? (
          <div className="ml-auto flex gap-1">
            <Button
              size="sm"
              variant="outline"
              className="text-destructive hover:text-destructive"
              onClick={() => {
                void wipeStoredData();
                setConfirming(false);
                setWiped(true);
              }}
            >
              Confirm wipe
            </Button>
            <Button size="sm" variant="ghost" onClick={() => setConfirming(false)}>
              Cancel
            </Button>
          </div>
        ) : (
          !wiped && (
            <Button
              size="sm"
              variant="outline"
              className="ml-auto text-destructive hover:text-destructive"
              disabled={blocked}
              onClick={() => {
                setConfirming(true);
                setWiped(false);
              }}
            >
              Wipe data
            </Button>
          )
        )}
      </div>
    </div>
  );
}

export function SettingsTab(): JSX.Element {
  useSyncExternalStore(subscribe, getSnapshot);
  return (
    <div className="flex flex-col gap-4 p-4">
      <Section id="appearance" title="Appearance">
        <Segmented
          label="Theme"
          hint="Match the page, or force light/dark for the panel."
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
          hint="How a step's lines are marked on the diff — a left rail on the code, optionally with a faint wash on the line-number gutter. The code itself is never tinted, so the diff stays readable."
          value={settingsStore.hlStyle()}
          options={[
            { value: "rail", label: "Rail" },
            { value: "gutter", label: "Rail + gutter" },
          ]}
          onChange={(v) => settingsStore.setHlStyle(v)}
        />
      </Section>
      <Section id="review" title="Walkthrough">
        <Segmented
          label="Step nav"
          hint="On load = scroll the page to your saved step when a walkthrough opens; Instant = only when you pick a step."
          value={settingsStore.reviewSync() ? "synced" : "instant"}
          options={[
            { value: "synced", label: "On load" },
            { value: "instant", label: "Instant" },
          ]}
          onChange={(v) => settingsStore.setReviewSync(v === "synced")}
        />
        <Segmented
          label="Walkthrough depth"
          hint="Deep context reads the locally-cloned repo — what the feature is and how the change flows (falls back to Diff only if the repo isn't found); Diff only uses just the PR diff."
          value={settingsStore.reviewMode()}
          options={[
            { value: "heavy", label: "Deep context" },
            { value: "light", label: "Diff only" },
          ]}
          onChange={(v) => settingsStore.setReviewMode(v)}
        />
        {settingsStore.reviewMode() === "heavy" && (
          <div className="flex flex-col gap-1">
            <div className="flex items-center justify-between gap-3">
              <span className="text-sm text-muted-foreground">Local repos root</span>
              <input
                type="text"
                aria-label="Local repos root"
                value={settingsStore.reviewReposRoot()}
                onChange={(event) => settingsStore.setReviewReposRoot(event.target.value)}
                className="h-7 w-40 rounded-lg border border-border bg-muted px-2 text-sm text-foreground"
              />
            </div>
            <p className="text-xs text-muted-foreground/75">
              Where Deep context looks for the clone — it searches here for a repo whose name or remote
              matches the PR.
            </p>
          </div>
        )}
      </Section>
      <Section id="generation" title="Generation">
        <Segmented
          label="Suggested questions"
          hint="Preload three AI-suggested questions in each chat (costs a model call). Off by default."
          value={settingsStore.preloadQuestions() ? "on" : "off"}
          options={[
            { value: "off", label: "Off" },
            { value: "on", label: "On" },
          ]}
          onChange={(value) => settingsStore.setPreloadQuestions(value === "on")}
        />
        <Segmented
          label="Flow diagram"
          hint="Have the session author a flow diagram of the change (adds time to generation; the renderer loads only when you open one). Off by default."
          value={settingsStore.generateDiagram() ? "on" : "off"}
          options={[
            { value: "off", label: "Off" },
            { value: "on", label: "On" },
          ]}
          onChange={(value) => settingsStore.setGenerateDiagram(value === "on")}
        />
      </Section>
      {/* Connection and Debug carry their own headers, so they wrap in a plain
          jump-target div rather than a titled Section (no duplicate heading). */}
      <div data-settings-section="connection" className="scroll-mt-2 border-t border-border pt-3">
        <Connection />
      </div>
      <div data-settings-section="debug" className="scroll-mt-2 border-t border-border pt-3">
        <Debug />
      </div>
    </div>
  );
}
