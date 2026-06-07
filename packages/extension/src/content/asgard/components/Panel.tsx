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
import { Button } from "../ui/button";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "../ui/tabs";
import { HistoryTab } from "./tabs/HistoryTab";
import { SettingsTab } from "./tabs/SettingsTab";

const TAB_LABELS: Array<{ value: PanelTab; label: string }> = [
  { value: PANEL_TABS.WALKTHROUGH, label: "Walkthrough" },
  { value: PANEL_TABS.CHAT, label: "Chat" },
  { value: PANEL_TABS.HISTORY, label: "History" },
  { value: PANEL_TABS.SETTINGS, label: "Settings" },
];

function Placeholder({ name }: { name: string }): JSX.Element {
  return <div className="p-4 text-sm text-muted-foreground">{name} — coming soon.</div>;
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
        <TabsContent value={PANEL_TABS.WALKTHROUGH}>
          <Placeholder name="Walkthrough" />
        </TabsContent>
        <TabsContent value={PANEL_TABS.CHAT}>
          <Placeholder name="Chat" />
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
