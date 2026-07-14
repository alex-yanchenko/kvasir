// The consolidated panel — one movable/resizable floating window holding every
// section. A 48px icon rail (left edge) switches sections; the per-section nav
// column (outline / chats / facets / anchors) sits beside it, toggled from the
// rail's active icon — inline while the window fits it, a transient overlay when
// folded. Geometry lives in panelStore; the section bodies reuse the machines.
import { X } from "lucide-react";
import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import type {
  ComponentType,
  JSX,
  KeyboardEvent as ReactKeyboardEvent,
  MouseEvent as ReactMouseEvent,
} from "react";
import { activeGuide } from "../guide";
import { historyStore } from "../history";
import { useDrag } from "../hooks/useDrag";
import { useResizePersist } from "../hooks/useResizePersist";
import { useScrollLock } from "../hooks/useScrollLock";
import { useShadowAwareKeydown } from "../hooks/useShadowAwareKeydown";
import { launcherStore } from "../launcher";
import { pairingStore } from "../pairing";
import type { PairingPhase } from "../pairing";
import { reviewStore } from "../review";
import { getSnapshot, isPanelTab, PANEL_TABS, panelStore, subscribe, type PanelTab } from "../store";
import { tourStore } from "../tour";
import { Button } from "../ui/button";
import { IconChat, IconHistory, IconSettings, IconTour } from "../ui/icons";
import { KvasirMark } from "../ui/KvasirMark";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "../ui/tabs";
import { PanelSidebar } from "./PanelSidebar";
import { ChatTab } from "./tabs/ChatTab";
import { HistoryTab } from "./tabs/HistoryTab";
import { ReviewTab } from "./tabs/ReviewTab";
import { SettingsTab } from "./tabs/SettingsTab";
import { WalkthroughTab } from "./tabs/WalkthroughTab";
import { TIP_DELAY_LONG_MS } from "./Tooltip";

/** The icon rail's sections, top to bottom; Settings is pinned to the rail's
 * bottom (mt-auto). Labels double as the accessible name and the hover tip. */
const RAIL_TABS: Array<{ value: PanelTab; label: string; Icon: ComponentType }> = [
  { value: PANEL_TABS.WALKTHROUGH, label: "Walkthrough", Icon: IconTour },
  { value: PANEL_TABS.CHAT, label: "Chat", Icon: IconChat },
  { value: PANEL_TABS.HISTORY, label: "History", Icon: IconHistory },
  { value: PANEL_TABS.SETTINGS, label: "Settings", Icon: IconSettings },
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

/** Rail-foot connection dot — the always-visible one-glance answer to "is this
 * thing connected", independent of which section is open (the banner hides on
 * Settings; the dot never does). Hover names the phase via the shared tooltip. */
const CONNECTION_DOT: Record<PairingPhase["phase"], { className: string; label: string }> = {
  unknown: { className: "bg-muted-foreground/40", label: "Checking connection…" },
  down: { className: "bg-destructive", label: "Channel not running" },
  unpaired: { className: "bg-warning", label: "Not paired" },
  waiting: { className: "bg-warning", label: "Pairing…" },
  error: { className: "bg-warning", label: "Pairing failed" },
  paired: { className: "bg-success kvasir-dot-glow", label: "Connected to your Claude session" },
};

function ConnectionDot(): JSX.Element {
  const { className, label } = CONNECTION_DOT[pairingStore.state().phase];
  return (
    <span
      role="status"
      aria-label={label}
      data-kvasir-tip={label}
      data-kvasir-tip-delay={TIP_DELAY_LONG_MS}
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

const ICON_RAIL_W = 48; // matches the rail's w-12
const SIDEBAR_MIN = 130;
const SIDEBAR_MAX = 360;
const DIVIDER_W = 3; // matches the separator's w-[3px]
const CONTENT_MIN = 240; // the content column never shrinks below this
const MIN_HEIGHT = 320; // the window never shrinks below this (matches min-h-[320px])
const MIN_WINDOW_W = ICON_RAIL_W + CONTENT_MIN; // rail + minimum content, sidebar folded
const SIDEBAR_FOLD_W = 520; // below this window width the nav column folds into an overlay
const DEFAULT_WINDOW_W = 860; // initial window width (matches the w-[860px] class)
const DEFAULT_HEIGHT = 600; // initial window height — generous so a fresh panel isn't tiny
const DIVIDER_NUDGE: Record<string, number> = { ArrowLeft: -16, ArrowRight: 16 };
const FOLD_HYSTERESIS = 40; // fold below the threshold, unfold only this much above it
/** The rail's 34px icon cell. */
const RAIL_ICON_CELL = "size-[34px] rounded-[10px]";

// Geometry rule: panelStore.size.w is the WINDOW width. Columns are internal:
// rail (fixed 48) + sidebar (sidebarWidth, when it fits) + divider + content (the
// flexible remainder, floored at CONTENT_MIN). Reading the persisted size in one
// place keeps the null-default branches to a single spot.
function panelGeom(): { width: number; height: number; pos: { left: number; top: number } | null } {
  const size = panelStore.size();
  return {
    // The floor self-heals a stored width below the rail+content minimum.
    width: Math.max(MIN_WINDOW_W, size?.w ?? DEFAULT_WINDOW_W),
    height: size?.h ?? DEFAULT_HEIGHT,
    pos: panelStore.pos(),
  };
}

/** The window width below which the nav column folds (can't sit beside minimum
 * content, or the window is simply narrow). Unfolding requires FOLD_HYSTERESIS
 * more width than folding, so the column can't flap at the boundary mid-resize. */
function foldThreshold(): number {
  return Math.max(SIDEBAR_FOLD_W, ICON_RAIL_W + panelStore.sidebarWidth() + DIVIDER_W + CONTENT_MIN);
}

// The divider is a NORMAL split: it redistributes width between sidebar and content
// while the window (both edges) stays put — sidebar grows, content shrinks, bounded by
// the sidebar clamp AND the content minimum.
function onDividerDown(event: ReactMouseEvent): void {
  event.preventDefault();
  const startX = event.clientX;
  const startSidebar = panelStore.sidebarWidth();
  const maxByContent = panelGeom().width - ICON_RAIL_W - DIVIDER_W - CONTENT_MIN;
  const move = (moved: MouseEvent): void => {
    panelStore.setSidebarWidth(Math.min(startSidebar + (moved.clientX - startX), maxByContent));
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
  const maxByContent = panelGeom().width - ICON_RAIL_W - DIVIDER_W - CONTENT_MIN;
  panelStore.setSidebarWidth(Math.min(panelStore.sidebarWidth() + delta, maxByContent));
}

// Bottom-left corner grip: drag up/down = window height; drag left/right resizes the
// window from its left edge (right edge fixed) — a positioned panel shifts its left
// edge by the applied growth; the default bottom-right-anchored one grows leftward on
// its own. The native bottom-right handle resizes from the right edge.
function onCornerDown(event: ReactMouseEvent): void {
  event.preventDefault();
  event.stopPropagation();
  const startX = event.clientX;
  const startY = event.clientY;
  const { width: startWidth, height: startHeight, pos: startPos } = panelGeom();
  const move = (moved: MouseEvent): void => {
    const width = Math.max(MIN_WINDOW_W, startWidth + (startX - moved.clientX));
    panelStore.setSize({ w: width, h: Math.max(MIN_HEIGHT, startHeight + (moved.clientY - startY)) });
    if (startPos) panelStore.setPos({ left: startPos.left - (width - startWidth), top: startPos.top });
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

/** The 48px icon rail — section switcher (Radix tabs, vertical), Settings pinned
 * to the bottom, connection dot at the foot. Activity-bar semantics: activating
 * the ALREADY-ACTIVE icon toggles the nav column (`onActiveTabClick`) — unlike
 * VS Code, switching sections never reveals a hidden column; the column follows
 * the user's persisted intent only.
 *
 * The pressed-tab protocol tells a toggle apart from a switch: the tab is
 * captured BEFORE Radix activates — on pointerdown for mouse (activation follows
 * on mousedown) and on focus for keyboard (roving focus lands first, activation
 * follows) — and refreshed after each click, so pressing Enter right after
 * arriving on an icon is the switch, and pressing it again is the toggle. Tips
 * use the long delay: chrome that's always on screen shouldn't flash a tooltip
 * on every pass. */
function IconRail({ onActiveTabClick }: Readonly<{ onActiveTabClick: () => void }>): JSX.Element {
  const staleHistory = historyStore.staleCount();
  const activeTab = panelStore.tab();
  const pressedTab = useRef<PanelTab | null>(null);
  // True between a pointerdown and its click: the focus that mousedown triggers
  // must not overwrite the pointerdown's pre-activation capture.
  const pointerPressed = useRef(false);
  return (
    <div className="flex w-12 shrink-0 flex-col items-center gap-1 border-r border-border py-2">
      <TabsList className="h-auto w-auto flex-1 flex-col justify-start gap-1 rounded-none border-0 bg-transparent p-0">
        {RAIL_TABS.map(({ value, label, Icon }) => (
          <TabsTrigger
            key={value}
            value={value}
            aria-label={label}
            data-kvasir-tip={value === activeTab ? `${label} — click again to toggle the panel` : label}
            data-kvasir-tip-delay={TIP_DELAY_LONG_MS}
            onPointerDown={() => {
              pointerPressed.current = true;
              pressedTab.current = panelStore.tab();
            }}
            onFocus={() => {
              if (!pointerPressed.current) pressedTab.current = panelStore.tab();
              pointerPressed.current = false;
            }}
            onClick={() => {
              if (pressedTab.current === value) onActiveTabClick();
              pointerPressed.current = false;
              pressedTab.current = panelStore.tab();
            }}
            className={
              `kvasir-rail-tab relative ${RAIL_ICON_CELL} shrink-0 p-0 duration-[120ms] [&_svg]:size-4 data-[state=active]:border-primary/25 data-[state=active]:bg-accent data-[state=active]:text-accent-foreground` +
              (value === PANEL_TABS.SETTINGS ? " mt-auto" : "")
            }
          >
            <Icon />
            {value === PANEL_TABS.HISTORY && staleHistory > 0 ? (
              <span
                aria-label={`${staleHistory} need sync`}
                className="absolute -right-1 -top-1 inline-flex min-w-4 items-center justify-center rounded-full bg-primary px-1 text-[10px] font-semibold text-primary-foreground"
              >
                {staleHistory}
              </span>
            ) : null}
          </TabsTrigger>
        ))}
      </TabsList>
      <div className="flex shrink-0 justify-center pb-1 pt-2">
        <ConnectionDot />
      </div>
    </div>
  );
}

function PanelWindow(): JSX.Element {
  const panelRef = useRef<HTMLDivElement>(null);
  const isReview = activeGuide().kind === "review";
  const { width, height, pos } = panelGeom();
  // Fold state with hysteresis: fold below the threshold, unfold only at
  // threshold + FOLD_HYSTERESIS — the ref carries which side of the band the
  // last render landed on, so the column can't flap inside it.
  const foldedRef = useRef(false);
  const folded = width < foldThreshold() + (foldedRef.current ? FOLD_HYSTERESIS : 0);
  foldedRef.current = folded;
  // The nav column shows when the user wants it AND it fits (sidebarOpen is the
  // persisted intent, toggled from the rail's active icon — resize never
  // overrides it). Folded, the same toggle shows the column as a TRANSIENT
  // overlay instead; it never auto-appears from the persisted intent.
  const wantsSidebar = panelStore.sidebarOpen();
  const [overlayOpen, setOverlayOpen] = useState(false);
  useEffect(() => {
    if (!folded && overlayOpen) setOverlayOpen(false);
  }, [folded, overlayOpen]);
  const onActiveTabClick = (): void => {
    if (folded) setOverlayOpen((open) => !open);
    else panelStore.setSidebarOpen(!panelStore.sidebarOpen());
  };
  const onHeadDown = useDrag(panelRef, { ignore: "button", onEnd: (p) => panelStore.setPos(p) });
  // The observer stores the window size as-is (size.w IS the window width); the
  // floor self-heals any stored width below the rail+content minimum.
  useResizePersist(panelRef, (size) => panelStore.setSize({ w: Math.max(MIN_WINDOW_W, size.w), h: size.h }));
  useScrollLock(panelRef);
  // Closing the panel ends the tour and clears the page highlight (the Walkthrough
  // tab no longer does this on tab-switch, so the highlight survives Settings/Chat).
  useEffect(() => () => tourStore.close(), []);
  // Auto-load history on panel open so the rail badge reflects backend drift even
  // before the section is viewed (cache-then-refresh; a closed bridge is a no-op).
  useEffect(() => {
    void historyStore.load();
  }, []);
  // Re-probe the connection on every open (channel state can change any time the
  // panel is closed) — feeds the banner, the rail dot, and needsPairing gates.
  useEffect(() => {
    void pairingStore.recheck();
  }, []);

  // Escape closes the topmost layer only: a modal owns it outright (RegenDialog
  // binds its own shadow-aware Escape; one press must never close both layers),
  // then the folded-mode overlay, then the panel. PanelWindow mounts only while
  // open, so no closed-state work.
  useShadowAwareKeydown((event) => {
    if (event.key !== "Escape") return;
    const root = document.querySelector("#kvasir-root")?.shadowRoot ?? document;
    if (root.querySelector(".kvasir-dialog-back")) return;
    // the handler is re-registered each render (useShadowAwareKeydown refreshes
    // its ref), so reading render-scope state here is always fresh
    if (overlayOpen) {
      setOverlayOpen(false);
      return;
    }
    panelStore.close();
  });

  // Review-mode (a pushed cross-repo review opened via ?kvasir) swaps the walkthrough
  // section for the review one; everything else (chat, settings) is unchanged.
  const title = isReview ? reviewStore.title() || "Kvasir" : (launcherStore.spec()?.pr?.title ?? "Kvasir");

  return (
    // The 220ms rise puts a transform on this fixed element, which briefly makes it
    // the containing block for fixed descendants (RegenDialog) — accepted: the
    // dialog can't be opened by a human within the animation window, and the
    // transform clears the moment the animation ends.
    <div
      ref={panelRef}
      role="dialog"
      aria-label="Kvasir"
      className="kvasir-panel kvasir-glass fixed bottom-5 right-5 z-[2147483002] flex max-h-[85vh] min-h-[320px] w-[860px] max-w-[92vw] resize overflow-hidden rounded-[var(--radius-panel)] border border-border text-foreground motion-safe:[animation:kvasir-rise_220ms_ease-out]"
      style={{
        boxShadow: "var(--elevation)",
        ...(pos ? { left: pos.left, top: pos.top, right: "auto", bottom: "auto" } : null),
        width,
        minWidth: MIN_WINDOW_W,
        // Open at a generous default height (capped by max-h-[85vh], floored by
        // min-h-[320px]) instead of letting the window shrink to its content.
        height,
      }}
    >
      {/* One Radix root spans the whole row: the rail holds the triggers, the
          content column the panels — required to share the tabs state. */}
      <Tabs
        value={panelStore.tab()}
        onValueChange={(v) => {
          if (isPanelTab(v)) panelStore.setTab(v);
        }}
        orientation="vertical"
        className="relative flex min-h-0 min-w-0 flex-1"
      >
        <IconRail onActiveTabClick={onActiveTabClick} />
        {/* The nav column + its splitter, sliding in as one unit. The divider
            redistributes width between the sidebar and content while the window
            (both edges) stays put. */}
        {/* eslint-disable jsx-a11y/no-noninteractive-element-interactions, jsx-a11y/no-noninteractive-tabindex -- accessible window-splitter */}
        {wantsSidebar && !folded && (
          <div className="flex shrink-0 motion-safe:[animation:kvasir-slide-in_140ms_ease-out]">
            <PanelSidebar />
            <div
              role="separator"
              aria-orientation="vertical"
              aria-label="Resize sidebar"
              aria-valuenow={panelStore.sidebarWidth()}
              aria-valuemin={SIDEBAR_MIN}
              aria-valuemax={SIDEBAR_MAX}
              tabIndex={0}
              className="w-[3px] shrink-0 cursor-col-resize bg-border transition-colors hover:bg-primary/60 focus-visible:bg-primary focus-visible:outline-none"
              onMouseDown={onDividerDown}
              onKeyDown={onDividerKey}
            />
          </div>
        )}
        {/* eslint-enable jsx-a11y/no-noninteractive-element-interactions, jsx-a11y/no-noninteractive-tabindex */}
        {/* Folded-mode overlay: the same nav column floating next to the rail, over
            the content, until toggled away. left-12 = the rail's w-12 (ICON_RAIL_W),
            so the overlay sits flush against it. */}
        {folded && overlayOpen && (
          <div className="absolute inset-y-0 left-12 z-20 border-r border-border bg-background shadow-lg motion-safe:[animation:kvasir-slide-in_140ms_ease-out]">
            <PanelSidebar />
          </div>
        )}
        {/* Content column: title bar, banners, section body — the flexible remainder. */}
        <div className="flex min-w-0 flex-1 flex-col">
          {/* eslint-disable-next-line jsx-a11y/no-static-element-interactions -- title-bar drag handle: drag-to-move is a non-essential reposition with no ARIA role; the panel auto-positions and every function inside is a native, keyboard-operable control. */}
          <div className="flex cursor-move items-center gap-2 px-3 py-2" onMouseDown={onHeadDown}>
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
          <ReviewMissingBanner />
          <GuideDeletedBanner />

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
        </div>
      </Tabs>
      {/* Mouse-only resize grip (bottom-left corner): drags window height + width
          from the left edge. Keyboard users resize via the sidebar splitter's arrow
          keys + the native bottom-right handle, so the grip is aria-hidden. */}
      <div
        aria-hidden="true"
        data-testid="resize-corner"
        className="absolute bottom-0 left-0 z-20 size-3.5 cursor-nesw-resize"
        onMouseDown={onCornerDown}
      />
    </div>
  );
}
