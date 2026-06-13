// The consolidated panel — one movable/resizable floating window holding every
// section as a tab. Geometry lives in panelStore; the tab bodies reuse the
// existing machines. Tab bodies are filled in island by island (Phases 2–5);
// until then they show a placeholder.
import { X } from "lucide-react";
import { useEffect, useRef, useSyncExternalStore } from "react";
import type { JSX } from "react";
import { useDrag } from "../hooks/useDrag";
import { useResizePersist } from "../hooks/useResizePersist";
import { useScrollLock } from "../hooks/useScrollLock";
import { launcherStore } from "../launcher";
import { pairingStore } from "../pairing";
import { getSnapshot, PANEL_TABS, panelStore, subscribe, type PanelTab } from "../store";
import { tourStore } from "../tour";
import { Button } from "../ui/button";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "../ui/tabs";
import { ChatTab } from "./tabs/ChatTab";
import { SettingsTab } from "./tabs/SettingsTab";
import { WalkthroughTab } from "./tabs/WalkthroughTab";

const TAB_LABELS: Array<{ value: PanelTab; label: string }> = [
  { value: PANEL_TABS.WALKTHROUGH, label: "Walkthrough" },
  { value: PANEL_TABS.CHAT, label: "Chat" },
  { value: PANEL_TABS.SETTINGS, label: "Settings" },
];

/** Shown on every tab (except Settings, which has its own Connection block)
 * whenever the extension isn't paired — so ANY 401 from the bridge (regenerate,
 * chat, suggestions, head) surfaces a way to pair, not just the no-spec empty
 * state. The 401 handlers flip pairingStore to unpaired; this reacts to it. */
function PairBanner(): JSX.Element | null {
  const p = pairingStore.state();
  if (p.phase === "paired" || p.phase === "unknown" || panelStore.tab() === PANEL_TABS.SETTINGS) return null;
  return (
    <div className="flex items-center gap-2 border-b border-border bg-secondary px-3 py-1.5 text-xs">
      {p.phase === "waiting" ? (
        <span className="text-muted-foreground">
          Confirm code <b className="font-mono tracking-widest text-foreground">{p.code}</b> in your Claude
          session
        </span>
      ) : (
        <>
          <span className={p.phase === "error" ? "text-destructive" : "text-muted-foreground"}>
            {p.phase === "error" ? p.message : "Not paired — connect to your Claude session to continue."}
          </span>
          <Button size="sm" className="ml-auto h-6" onClick={() => void pairingStore.pair()}>
            Pair
          </Button>
        </>
      )}
    </div>
  );
}

// The panel mounts only while open, so the resize observer (a mount-only effect)
// attaches to the live element. Keeping the hooks above an `isOpen` early-return
// instead would run them once at boot — when the panel is closed and the ref is
// still null — and never re-attach when it later opens, dropping size persistence.
export function Panel(): JSX.Element | null {
  useSyncExternalStore(subscribe, getSnapshot);
  return panelStore.isOpen() ? <PanelWindow /> : null;
}

function PanelWindow(): JSX.Element {
  const panelRef = useRef<HTMLDivElement>(null);
  const onHeadDown = useDrag(panelRef, {
    ignore: "button",
    onEnd: (pos) => panelStore.setPos(pos),
  });
  useResizePersist(panelRef, (size) => panelStore.setSize(size));
  useScrollLock(panelRef);
  // Closing the panel ends the tour and clears the page highlight (the Walkthrough
  // tab no longer does this on tab-switch, so the highlight survives Settings/Chat).
  useEffect(() => () => tourStore.close(), []);

  const pos = panelStore.pos();
  const size = panelStore.size();
  const title = launcherStore.spec()?.pr?.title ?? "PR Walkthrough";

  return (
    <div
      ref={panelRef}
      role="dialog"
      aria-label="PR Walkthrough"
      className="prw-panel fixed bottom-5 right-5 z-[2147483002] flex max-h-[85vh] min-h-[320px] w-[420px] min-w-[340px] max-w-[92vw] resize flex-col overflow-hidden rounded-lg border border-border bg-background text-foreground"
      style={{
        boxShadow: "var(--elevation)",
        ...(pos ? { left: pos.left, top: pos.top, right: "auto", bottom: "auto" } : null),
        ...(size ? { width: size.w, height: size.h } : null),
      }}
    >
      {/* eslint-disable-next-line jsx-a11y/no-static-element-interactions -- title-bar drag handle: drag-to-move is a non-essential reposition with no ARIA role; the panel auto-positions and every function inside is a native, keyboard-operable control. */}
      <div className="flex cursor-move items-center gap-2 px-3 py-2" onMouseDown={onHeadDown}>
        <span className="truncate text-[13px] font-semibold tracking-tight" title={title}>
          {title}
        </span>
        <Button
          variant="ghost"
          size="icon"
          className="-mr-1 ml-auto h-7 w-7"
          aria-label="Close panel"
          onClick={() => panelStore.close()}
        >
          <X />
        </Button>
      </div>

      <PairBanner />

      <Tabs
        value={panelStore.tab()}
        onValueChange={(v) => panelStore.setTab(v as PanelTab)}
        className="flex min-h-0 flex-1 flex-col"
      >
        <div className="px-2 pt-1">
          <TabsList className="justify-between">
            {TAB_LABELS.map((t) => (
              <TabsTrigger key={t.value} value={t.value} className="flex-1">
                {t.label}
              </TabsTrigger>
            ))}
          </TabsList>
        </div>
        <TabsContent value={PANEL_TABS.WALKTHROUGH} className="min-h-0">
          <WalkthroughTab />
        </TabsContent>
        <TabsContent value={PANEL_TABS.CHAT} className="min-h-0">
          <ChatTab />
        </TabsContent>
        <TabsContent value={PANEL_TABS.SETTINGS} className="overflow-y-auto">
          <SettingsTab />
        </TabsContent>
      </Tabs>
    </div>
  );
}
