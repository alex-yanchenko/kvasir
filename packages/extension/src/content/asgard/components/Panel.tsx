// The consolidated panel — one movable/resizable floating window holding every
// section as a tab. Geometry lives in panelStore; the tab bodies reuse the
// existing machines. Tab bodies are filled in island by island (Phases 2–5);
// until then they show a placeholder.
import type { JSX } from "react";
import { useRef, useSyncExternalStore } from "react";
import { X } from "lucide-react";
import { launcherStore } from "../launcher";
import { pairingStore } from "../pairing";
import { getSnapshot, PANEL_TABS, panelStore, subscribe, type PanelTab } from "../store";
import { useDrag } from "../hooks/useDrag";
import { useResizePersist } from "../hooks/useResizePersist";
import { Button } from "../ui/button";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "../ui/tabs";
import { ChatTab } from "./tabs/ChatTab";
import { HistoryTab } from "./tabs/HistoryTab";
import { SettingsTab } from "./tabs/SettingsTab";
import { WalkthroughTab } from "./tabs/WalkthroughTab";

const TAB_LABELS: Array<{ value: PanelTab; label: string }> = [
  { value: PANEL_TABS.WALKTHROUGH, label: "Walkthrough" },
  { value: PANEL_TABS.CHAT, label: "Chat" },
  { value: PANEL_TABS.HISTORY, label: "History" },
  { value: PANEL_TABS.SETTINGS, label: "Settings" },
];

/** Shown across all tabs until the extension is paired — nothing the panel does
 * reaches the session without a token, so make pairing the obvious next step. */
function PairBanner(): JSX.Element | null {
  const p = pairingStore.state();
  if (p.phase === "paired" || p.phase === "unknown") return null;
  return (
    <div className="flex items-center gap-2 border-b border-border bg-secondary px-3 py-2 text-xs">
      {p.phase === "waiting" ? (
        <span className="text-muted-foreground">
          Confirm code <b className="font-mono tracking-widest text-foreground">{p.code}</b> in your Claude
          session
        </span>
      ) : (
        <>
          <span className={p.phase === "error" ? "text-destructive" : "text-muted-foreground"}>
            {p.phase === "error"
              ? p.message
              : "Not paired — connect to your Claude session to use the panel."}
          </span>
          <Button size="sm" className="ml-auto h-7" onClick={() => void pairingStore.pair()}>
            Pair
          </Button>
        </>
      )}
    </div>
  );
}

export function Panel(): JSX.Element | null {
  useSyncExternalStore(subscribe, getSnapshot);
  const panelRef = useRef<HTMLDivElement>(null);
  const onHeadDown = useDrag(panelRef, {
    ignore: "button",
    onEnd: (pos) => panelStore.setPos(pos),
  });
  useResizePersist(panelRef, (size) => panelStore.setSize(size));

  if (!panelStore.isOpen()) return null;
  const pos = panelStore.pos();
  const size = panelStore.size();
  const title = launcherStore.spec()?.pr?.title ?? "PR Walkthrough";

  return (
    <div
      ref={panelRef}
      role="dialog"
      aria-label="PR Walkthrough"
      className="prw-panel fixed bottom-5 right-5 z-[2147483002] flex max-h-[85vh] min-h-[320px] w-[420px] min-w-[340px] max-w-[92vw] resize flex-col overflow-hidden rounded-xl border border-border bg-background text-foreground shadow-2xl"
      style={{
        ...(pos ? { left: pos.left, top: pos.top, right: "auto", bottom: "auto" } : null),
        ...(size ? { width: size.w, height: size.h } : null),
      }}
    >
      <div
        className="flex cursor-move items-center gap-2 border-b border-border px-3 py-2"
        onMouseDown={onHeadDown}
      >
        <span className="truncate text-sm font-semibold" title={title}>
          {title}
        </span>
        <Button
          variant="ghost"
          size="icon"
          className="ml-auto h-7 w-7"
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
        <div className="px-3 pt-2">
          <TabsList className="w-full justify-between">
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
        <TabsContent value={PANEL_TABS.HISTORY} className="overflow-y-auto">
          <HistoryTab />
        </TabsContent>
        <TabsContent value={PANEL_TABS.SETTINGS} className="overflow-y-auto">
          <SettingsTab />
        </TabsContent>
      </Tabs>
    </div>
  );
}
