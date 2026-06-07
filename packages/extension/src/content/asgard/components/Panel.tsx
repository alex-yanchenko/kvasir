// The consolidated panel — one movable/resizable floating window holding every
// section as a tab. Geometry lives in panelStore; the tab bodies reuse the
// existing machines. Tab bodies are filled in island by island (Phases 2–5);
// until then they show a placeholder.
import type { JSX } from "react";
import { useRef, useSyncExternalStore } from "react";
import { X } from "lucide-react";
import { launcherStore } from "../launcher";
import { getSnapshot, PANEL_TABS, panelStore, subscribe, type PanelTab } from "../store";
import { useDrag } from "../hooks/useDrag";
import { useResizePersist } from "../hooks/useResizePersist";
import { useScrollLock } from "../hooks/useScrollLock";
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

      <Tabs
        value={panelStore.tab()}
        onValueChange={(v) => panelStore.setTab(v as PanelTab)}
        className="flex min-h-0 flex-1 flex-col"
      >
        <TabsList className="w-full justify-between px-2">
          {TAB_LABELS.map((t) => (
            <TabsTrigger key={t.value} value={t.value} className="flex-1">
              {t.label}
            </TabsTrigger>
          ))}
        </TabsList>
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
