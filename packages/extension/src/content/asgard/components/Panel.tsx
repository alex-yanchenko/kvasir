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
import type { PairingPhase } from "../pairing";
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
 * whenever the bridge can't be used — the channel itself is down, or the token
 * is absent/stale — so ANY 401 from the bridge (regenerate, chat, suggestions,
 * head) surfaces a way to pair, and a dead channel says "start it" instead of
 * offering a Pair that can't succeed. */
function bannerBody(p: PairingPhase): JSX.Element {
  if (p.phase === "waiting") {
    return (
      <span className="text-muted-foreground">
        Confirm code <b className="font-mono tracking-widest text-foreground">{p.code}</b> in your Claude
        session
      </span>
    );
  }
  if (p.phase === "down") {
    return (
      <>
        <span className="text-muted-foreground">
          Channel not running — run <b className="font-mono text-foreground">kvasir</b> in your terminal to
          start it.
        </span>
        <Button
          size="sm"
          variant="outline"
          className="ml-auto h-6"
          onClick={() => void pairingStore.recheck()}
        >
          Retry
        </Button>
      </>
    );
  }
  return (
    <>
      <span className={p.phase === "error" ? "text-destructive" : "text-muted-foreground"}>
        {p.phase === "error" ? p.message : "Not paired — connect to your Claude session to continue."}
      </span>
      <Button size="sm" className="ml-auto h-6" onClick={() => void pairingStore.pair()}>
        Pair
      </Button>
    </>
  );
}

function PairBanner(): JSX.Element | null {
  const p = pairingStore.state();
  if (p.phase === "paired" || p.phase === "unknown" || panelStore.tab() === PANEL_TABS.SETTINGS) return null;
  return (
    <div className="flex items-center gap-2 border-b border-border bg-secondary px-3 py-1.5 text-xs">
      {bannerBody(p)}
    </div>
  );
}

/** Title-bar connection dot — the always-visible one-glance answer to "is this
 * thing connected", independent of which tab is open (the banner hides on
 * Settings; the dot never does). Hover names the phase via the shared tooltip. */
const CONNECTION_DOT: Record<PairingPhase["phase"], { className: string; label: string }> = {
  unknown: { className: "bg-muted-foreground/40", label: "Checking connection…" },
  down: { className: "bg-destructive", label: "Channel not running" },
  unpaired: { className: "bg-amber-500", label: "Not paired" },
  waiting: { className: "bg-amber-500", label: "Pairing…" },
  error: { className: "bg-amber-500", label: "Pairing failed" },
  paired: { className: "bg-emerald-500", label: "Connected to your Claude session" },
};

function ConnectionDot(): JSX.Element {
  const { className, label } = CONNECTION_DOT[pairingStore.state().phase];
  return (
    <span
      role="status"
      aria-label={label}
      data-kvasir-tip={label}
      className={`size-2 shrink-0 rounded-full ${className}`}
    />
  );
}

/** Shown when a ?kvasir link produced nothing although the channel answered: it
 * doesn't have the walkthrough (links are machine-local — say so instead of
 * reading as a broken link). An unreachable channel is the PairBanner's story. */
function ReviewMissingBanner(): JSX.Element | null {
  if (!reviewStore.missing()) return null;
  return (
    <div className="flex items-center gap-2 border-b border-border bg-secondary px-3 py-1.5 text-xs">
      <span className="text-muted-foreground">
        This walkthrough isn&apos;t on this machine&apos;s channel — Kvasir links are machine-local and only
        open on the machine that built them.
      </span>
      <Button variant="ghost" size="sm" className="ml-auto h-6" onClick={() => reviewStore.dismissMissing()}>
        Dismiss
      </Button>
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
const MIN_HEIGHT = 320; // the window never shrinks below this (matches min-h-[320px])
const DEFAULT_CONTENT_W = 640; // initial content-column width (matches the w-[640px] class)
const DEFAULT_HEIGHT = 600; // initial window height — generous so a fresh panel isn't tiny
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
  const open = panelStore.sidebarOpen();
  const { pos } = panelGeom();
  if (pos) {
    const chrome = panelStore.railWidth() + DIVIDER_W;
    panelStore.setPos({ left: open ? pos.left + chrome : pos.left - chrome, top: pos.top });
  }
  panelStore.setSidebarOpen(!open);
}

// The divider is a NORMAL split: it redistributes width between sidebar and content
// while the window (both edges) stays put — sidebar grows, content shrinks, bounded by
// the sidebar clamp AND the content minimum.
function onDividerDown(event: ReactMouseEvent): void {
  event.preventDefault();
  const startX = event.clientX;
  const startSidebar = panelStore.railWidth();
  const { content: startContent, height: startHeight } = panelGeom();
  const maxByContent = startSidebar + (startContent - CONTENT_MIN);
  const move = (moved: MouseEvent): void => {
    panelStore.setRailWidth(Math.min(startSidebar + (moved.clientX - startX), maxByContent));
    const applied = panelStore.railWidth() - startSidebar;
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
  const startSidebar = panelStore.railWidth();
  const { content: startContent, height: startHeight } = panelGeom();
  const maxByContent = startSidebar + (startContent - CONTENT_MIN);
  panelStore.setRailWidth(Math.min(startSidebar + delta, maxByContent));
  const applied = panelStore.railWidth() - startSidebar;
  panelStore.setSize({ w: startContent - applied, h: startHeight });
}

// Bottom-left corner grip: drag up/down = window height; drag left/right resizes the
// WINDOW from its left edge (right edge fixed). The leftward growth fills the SIDEBAR
// first (within its bounds); once the sidebar bottoms out (or tops out), the rest
// spills into the CONTENT width. Dragging back refills the sidebar first, so content
// returns to where it was on its own. The native bottom-right handle resizes content.
function onCornerDown(event: ReactMouseEvent): void {
  event.preventDefault();
  event.stopPropagation();
  const startX = event.clientX;
  const startY = event.clientY;
  const startSidebar = panelStore.railWidth();
  const { content: startContent, height: startHeight, pos: startPos } = panelGeom();
  const move = (moved: MouseEvent): void => {
    const leftGrowth = startX - moved.clientX; // drag left → wider window on the left
    const desiredSidebar = startSidebar + leftGrowth;
    panelStore.setRailWidth(desiredSidebar); // clamps to [SIDEBAR_MIN, SIDEBAR_MAX]
    const spill = desiredSidebar - panelStore.railWidth(); // beyond the sidebar bounds → content
    const content = Math.max(CONTENT_MIN, startContent + spill);
    const grewLeft = panelStore.railWidth() - startSidebar + (content - startContent);
    panelStore.setSize({ w: content, h: Math.max(MIN_HEIGHT, startHeight + (moved.clientY - startY)) });
    // Right edge fixed: a positioned panel shifts its left edge out by the total growth;
    // the default bottom-right-anchored panel grows leftward on its own.
    if (startPos) panelStore.setPos({ left: startPos.left - grewLeft, top: startPos.top });
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
  const sidebarOpen = panelStore.sidebarOpen();
  const chrome = sidebarOpen ? panelStore.railWidth() + DIVIDER_W : 0;
  const onHeadDown = useDrag(panelRef, { ignore: "button", onEnd: (p) => panelStore.setPos(p) });
  // The observer measures the whole window; back out the sidebar chrome so size.w stays
  // the content width, floored at CONTENT_MIN. No drift: opening the sidebar leaves the
  // stored content the same. The floor stops a narrow drag (when the sidebar is wide)
  // from storing a negative content width.
  useResizePersist(panelRef, (size) =>
    panelStore.setSize({ w: Math.max(CONTENT_MIN, size.w - chrome), h: size.h }),
  );
  useScrollLock(panelRef);
  // Closing the panel ends the tour and clears the page highlight (the Walkthrough
  // tab no longer does this on tab-switch, so the highlight survives Settings/Chat).
  useEffect(() => () => tourStore.close(), []);
  // Auto-load history on panel open so the tab badge reflects backend drift even
  // before the tab is viewed (cache-then-refresh; a closed bridge is a no-op).
  useEffect(() => {
    void historyStore.load();
  }, []);
  // Re-probe the connection on every open (channel state can change any time the
  // panel is closed) — feeds the banner, the title-bar dot, and needsPairing gates.
  useEffect(() => {
    void pairingStore.recheck();
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
      className="kvasir-panel fixed bottom-5 right-5 z-[2147483002] flex max-h-[85vh] min-h-[320px] w-[640px] max-w-[92vw] resize overflow-hidden rounded-lg border border-border bg-background text-foreground"
      style={{
        boxShadow: "var(--elevation)",
        ...(pos ? { left: pos.left, top: pos.top, right: "auto", bottom: "auto" } : null),
        // Floor the content (self-heals any previously-stored negative width) and keep
        // the window's min-width = chrome + content floor, so the right-edge resize can
        // never drag content below CONTENT_MIN even when the sidebar is at full width.
        width: Math.max(CONTENT_MIN, size?.w ?? DEFAULT_CONTENT_W) + chrome,
        minWidth: chrome + CONTENT_MIN,
        // Open at a generous default height (capped by max-h-[85vh], floored by
        // min-h-[320px]) instead of letting the window shrink to its content.
        height: size?.h ?? DEFAULT_HEIGHT,
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
          aria-valuenow={panelStore.railWidth()}
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
          <ConnectionDot />
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
        <ReviewMissingBanner />
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
                  {t.label}
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
