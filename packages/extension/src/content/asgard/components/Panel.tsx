// The consolidated panel — one movable/resizable floating window holding every
// section as a tab. Geometry lives in panelStore; the tab bodies reuse the
// existing machines. Tab bodies are filled in island by island (Phases 2–5);
// until then they show a placeholder.
import { ListTree, X } from "lucide-react";
import { useEffect, useRef, useSyncExternalStore } from "react";
import type { JSX, KeyboardEvent as ReactKeyboardEvent, MouseEvent as ReactMouseEvent } from "react";
import { activeGuide } from "../guide";
import { historyStore } from "../history";
import { useDrag } from "../hooks/useDrag";
import { useResizePersist } from "../hooks/useResizePersist";
import { useScrollLock } from "../hooks/useScrollLock";
import { launcherStore } from "../launcher";
import { pairingStore } from "../pairing";
import { reviewStore } from "../review";
import { getSnapshot, isPanelTab, PANEL_TABS, panelStore, subscribe, type PanelTab } from "../store";
import { tourStore } from "../tour";
import { Button } from "../ui/button";
import { KvasirMark } from "../ui/KvasirMark";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "../ui/tabs";
import { PanelSidebar } from "./PanelSidebar";
import { ChatTab } from "./tabs/ChatTab";
import { HistoryTab } from "./tabs/HistoryTab";
import { ReviewTab } from "./tabs/ReviewTab";
import { SettingsTab } from "./tabs/SettingsTab";
import { WalkthroughTab } from "./tabs/WalkthroughTab";

const TAB_LABELS: Array<{ value: PanelTab; label: string }> = [
  { value: PANEL_TABS.WALKTHROUGH, label: "Walkthrough" },
  { value: PANEL_TABS.CHAT, label: "Chat" },
  { value: PANEL_TABS.HISTORY, label: "History" },
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

/** Shown when the walkthrough this tab was viewing got deleted (here or in another
 * tab). The content is already cleared; this explains why it vanished. Auto-hides
 * once a new walkthrough loads (panelStore.guideDeleted gates on review/spec). */
function GuideDeletedBanner(): JSX.Element | null {
  if (!panelStore.guideDeleted()) return null;
  return (
    <div className="flex items-center gap-2 border-b border-border bg-secondary px-3 py-1.5 text-xs">
      <span className="text-muted-foreground">This walkthrough was deleted.</span>
      <Button
        variant="ghost"
        size="sm"
        className="ml-auto h-6"
        onClick={() => panelStore.dismissGuideDeleted()}
      >
        Dismiss
      </Button>
    </div>
  );
}

const SIDEBAR_MIN = 130;
const SIDEBAR_MAX = 360;
const DIVIDER_W = 3; // matches the separator's w-[3px]
const CONTENT_MIN = 240; // the content column never shrinks below this
const DEFAULT_CONTENT_W = 420; // matches the panel's w-[420px] default
const DEFAULT_HEIGHT = 320; // matches min-h-[320px]
const DIVIDER_NUDGE: Record<string, number> = { ArrowLeft: -16, ArrowRight: 16 };

// Geometry rule: panelStore.size.w is the CONTENT column width — NEVER the whole
// window. The rendered window width is contentW + (open ? railWidth + DIVIDER_W : 0),
// with the window's right edge as the anchor. Every interaction below keeps exactly
// one invariant, so the content never jumps. (setRailWidth clamps the sidebar to
// [SIDEBAR_MIN, SIDEBAR_MAX].) Reading the persisted size in one place keeps the
// null-default branches to a single spot.
function panelGeom(): { content: number; height: number; pos: { left: number; top: number } | null } {
  const size = panelStore.size();
  return {
    content: size?.w ?? DEFAULT_CONTENT_W,
    height: size?.h ?? DEFAULT_HEIGHT,
    pos: panelStore.pos(),
  };
}

// Opening/closing the sidebar grows/shrinks the window leftward (right edge fixed),
// leaving the content width untouched — the sidebar appears OUTSIDE the content, never
// shrinking it. A positioned window shifts its left edge by the sidebar chrome; a
// default (bottom-right anchored) one moves leftward on its own.
function toggleSidebar(): void {
  const open = tourStore.outlineOpen();
  const { pos } = panelGeom();
  if (pos) {
    const chrome = tourStore.railWidth() + DIVIDER_W;
    panelStore.setPos({ left: open ? pos.left + chrome : pos.left - chrome, top: pos.top });
  }
  tourStore.setOutlineOpen(!open);
}

// The divider is a NORMAL split: it redistributes width between sidebar and content
// while the window (both edges) stays put — sidebar grows, content shrinks, bounded by
// the sidebar clamp AND the content minimum.
function onDividerDown(event: ReactMouseEvent): void {
  event.preventDefault();
  const startX = event.clientX;
  const startSidebar = tourStore.railWidth();
  const { content: startContent, height: startHeight } = panelGeom();
  const maxByContent = startSidebar + (startContent - CONTENT_MIN);
  const move = (moved: MouseEvent): void => {
    tourStore.setRailWidth(Math.min(startSidebar + (moved.clientX - startX), maxByContent));
    const applied = tourStore.railWidth() - startSidebar;
    panelStore.setSize({ w: startContent - applied, h: startHeight });
  };
  const up = (): void => {
    document.removeEventListener("mousemove", move);
    document.removeEventListener("mouseup", up);
  };
  document.addEventListener("mousemove", move);
  document.addEventListener("mouseup", up);
}

function onDividerKey(event: ReactKeyboardEvent): void {
  const delta = DIVIDER_NUDGE[event.key] ?? 0;
  if (!delta) return;
  event.preventDefault();
  const startSidebar = tourStore.railWidth();
  const { content: startContent, height: startHeight } = panelGeom();
  tourStore.setRailWidth(startSidebar + delta);
  const applied = tourStore.railWidth() - startSidebar;
  panelStore.setSize({ w: startContent - applied, h: startHeight });
}

// Bottom-left corner grip: drag up/down = window height; drag left/right = grow the
// WINDOW and the sidebar together (content width unchanged), extending leftward (right
// edge fixed). The native bottom-right handle does an ordinary content resize.
function onCornerDown(event: ReactMouseEvent): void {
  event.preventDefault();
  event.stopPropagation();
  const startX = event.clientX;
  const startY = event.clientY;
  const startSidebar = tourStore.railWidth();
  const { content: startContent, height: startHeight, pos: startPos } = panelGeom();
  const move = (moved: MouseEvent): void => {
    tourStore.setRailWidth(startSidebar + (startX - moved.clientX)); // drag left → wider sidebar
    const applied = tourStore.railWidth() - startSidebar; // clamped delta
    panelStore.setSize({
      w: startContent,
      h: Math.max(DEFAULT_HEIGHT, startHeight + (moved.clientY - startY)),
    });
    // Right edge fixed: a positioned panel shifts its left edge out by the growth; the
    // default bottom-right-anchored panel grows leftward on its own.
    if (startPos) panelStore.setPos({ left: startPos.left - applied, top: startPos.top });
  };
  const up = (): void => {
    document.removeEventListener("mousemove", move);
    document.removeEventListener("mouseup", up);
  };
  document.addEventListener("mousemove", move);
  document.addEventListener("mouseup", up);
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
  // The sidebar is the left COLUMN of the window; opening it grows the window leftward
  // (right edge fixed) so the content never shrinks. size.w is the CONTENT-column width,
  // so the rendered window is content + chrome (see panelGeom). Open state + width are
  // global (shared across tabs), so switching tabs never resizes anything.
  const isReview = activeGuide().kind === "review";
  const sidebarOpen = tourStore.outlineOpen();
  const chrome = sidebarOpen ? tourStore.railWidth() + DIVIDER_W : 0;
  const onHeadDown = useDrag(panelRef, { ignore: "button", onEnd: (p) => panelStore.setPos(p) });
  // The observer measures the whole window; back out the sidebar chrome so size.w stays
  // the content width. No drift: opening the sidebar leaves the stored content the same.
  useResizePersist(panelRef, (size) => panelStore.setSize({ w: size.w - chrome, h: size.h }));
  useScrollLock(panelRef);
  // Closing the panel ends the tour and clears the page highlight (the Walkthrough
  // tab no longer does this on tab-switch, so the highlight survives Settings/Chat).
  useEffect(() => () => tourStore.close(), []);
  // Auto-load history on panel open so the tab badge reflects backend drift even
  // before the tab is viewed (cache-then-refresh; a closed bridge is a no-op).
  useEffect(() => {
    void historyStore.load();
  }, []);

  const pos = panelStore.pos();
  const size = panelStore.size();
  // Review-mode (a pushed cross-repo review opened via ?kvasir) swaps the walkthrough
  // tab for the review tab; everything else (chat, settings) is unchanged. (isReview
  // is computed above for the rail-offset.)
  const staleHistory = historyStore.staleCount();
  const title = isReview ? reviewStore.title() || "Kvasir" : (launcherStore.spec()?.pr?.title ?? "Kvasir");

  return (
    <div
      ref={panelRef}
      role="dialog"
      aria-label="Kvasir"
      className="kvasir-panel fixed bottom-5 right-5 z-[2147483002] flex max-h-[85vh] min-h-[320px] w-[420px] min-w-[340px] max-w-[92vw] resize overflow-hidden rounded-lg border border-border bg-background text-foreground"
      style={{
        boxShadow: "var(--elevation)",
        ...(pos ? { left: pos.left, top: pos.top, right: "auto", bottom: "auto" } : null),
        width: (size?.w ?? DEFAULT_CONTENT_W) + chrome,
        ...(size?.h ? { height: size.h } : null),
      }}
    >
      {/* The sidebar is the left column; it sits OUTSIDE the content (the window grows
          to fit it) so opening it never shrinks or moves the content column. */}
      {sidebarOpen && <PanelSidebar />}
      {/* Always-visible separator. Drag/arrows redistribute width between the sidebar
          and content while the window (both edges) stays put. */}
      {/* eslint-disable jsx-a11y/no-noninteractive-element-interactions, jsx-a11y/no-noninteractive-tabindex -- accessible window-splitter */}
      {sidebarOpen && (
        <div
          role="separator"
          aria-orientation="vertical"
          aria-label="Resize sidebar"
          aria-valuenow={tourStore.railWidth()}
          aria-valuemin={SIDEBAR_MIN}
          aria-valuemax={SIDEBAR_MAX}
          tabIndex={0}
          className="w-[3px] shrink-0 cursor-col-resize bg-border transition-colors hover:bg-primary/60 focus-visible:bg-primary focus-visible:outline-none"
          onMouseDown={onDividerDown}
          onKeyDown={onDividerKey}
        />
      )}
      {/* eslint-enable jsx-a11y/no-noninteractive-element-interactions, jsx-a11y/no-noninteractive-tabindex */}
      {/* Content column: title bar, banners, tabs — fixed at the content width. */}
      <div className="flex min-w-0 flex-1 flex-col">
        {/* eslint-disable-next-line jsx-a11y/no-static-element-interactions -- title-bar drag handle: drag-to-move is a non-essential reposition with no ARIA role; the panel auto-positions and every function inside is a native, keyboard-operable control. */}
        <div className="flex cursor-move items-center gap-2 px-3 py-2" onMouseDown={onHeadDown}>
          <Button
            variant="ghost"
            size="icon"
            className={"-ml-1 h-7 w-7 shrink-0" + (sidebarOpen ? " text-primary" : "")}
            aria-label={sidebarOpen ? "Hide sidebar" : "Show sidebar"}
            data-kvasir-tip="Outline / navigation"
            onClick={toggleSidebar}
          >
            <ListTree />
          </Button>
          <KvasirMark className="size-4 shrink-0 text-primary" />
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
        <GuideDeletedBanner />

        <Tabs
          value={panelStore.tab()}
          onValueChange={(v) => {
            if (isPanelTab(v)) panelStore.setTab(v);
          }}
          className="flex min-h-0 flex-1 flex-col"
        >
          <div className="px-2 pt-1">
            <TabsList className="justify-between">
              {TAB_LABELS.map((t) => (
                <TabsTrigger key={t.value} value={t.value} className="flex-1">
                  {t.value === PANEL_TABS.WALKTHROUGH && isReview ? "Review" : t.label}
                  {t.value === PANEL_TABS.HISTORY && staleHistory > 0 ? (
                    <span
                      aria-label={`${staleHistory} need sync`}
                      className="ml-1 inline-flex min-w-4 items-center justify-center rounded-full bg-primary px-1 text-[10px] font-semibold text-primary-foreground"
                    >
                      {staleHistory}
                    </span>
                  ) : null}
                </TabsTrigger>
              ))}
            </TabsList>
          </div>
          <TabsContent value={PANEL_TABS.WALKTHROUGH} className="min-h-0">
            {isReview ? <ReviewTab /> : <WalkthroughTab />}
          </TabsContent>
          <TabsContent value={PANEL_TABS.CHAT} className="min-h-0">
            <ChatTab />
          </TabsContent>
          <TabsContent value={PANEL_TABS.HISTORY} className="min-h-0">
            <HistoryTab />
          </TabsContent>
          <TabsContent value={PANEL_TABS.SETTINGS} className="overflow-y-auto">
            <SettingsTab />
          </TabsContent>
        </Tabs>
      </div>
      {/* Mouse-only resize grip (bottom-left corner): drags window height + sidebar
          width. Keyboard users resize via the sidebar splitter's arrow keys + the
          native bottom-right handle, so the grip is aria-hidden. */}
      {sidebarOpen && (
        <div
          aria-hidden="true"
          data-testid="resize-corner"
          className="absolute bottom-0 left-0 z-20 size-3.5 cursor-nesw-resize"
          onMouseDown={onCornerDown}
        />
      )}
    </div>
  );
}
