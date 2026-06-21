// The Bifrost — the ONLY way between Asgard (the panel UI) and Midgard (the
// GitHub-page controller). Everything that crosses is plain data: DOM nodes
// never leave Midgard. Three message kinds, one discipline:
//   commands  (Asgard → Midgard)  cause page writes
//   reports   (Midgard → Asgard)  state facts that happened on the page
//   queries   (sync, data-only)   pure reads Midgard exposes — see MidgardQuery
// Handlers are isolated: one throwing handler never blocks the others (a content
// script has no global error UI, so a single bad listener must not take down the
// bridge), and the error is logged for debugging.

import type { LineRange, RowRect } from "./midgard/diff";

/** A completed code selection, as data — the session key, never the rows. */
export interface SelectionPayload {
  selectionId: string;
  file: string;
  text: string;
  lines: LineRange | null;
  rect: RowRect;
}

/** What a step highlight needs painted (subset of a Runes WalkthroughStep). */
interface StepHighlightPayload {
  anchor: string;
  lines: LineRange | null;
  highlight: string[] | null;
}

/** Commands: Asgard → Midgard. Each causes a write to GitHub's page. */
interface BifrostCommands {
  "highlight:step": StepHighlightPayload;
  "highlight:clear": undefined;
  "pick:rehighlight": {
    file: string;
    text: string;
    /** The selection's stored line range — anchors which occurrence of duplicate
     * text to re-highlight (the span whose first row sits at lines.start). */
    lines?: { start: number; end: number } | null;
    scroll?: boolean;
  };
  "pick:clear": undefined;
  /** start null = no line cited — jump to the file's diff container itself. */
  "jump:ref": { file: string; start: number | null; end: number | null };
  "theme:apply": { theme: string; hlStyle: string };
  /** Tell the grip whether a walkthrough step is active (shows the context-chat
   * ask button) — pushed by the app, so Midgard never reads app state. */
  "grip:context": { hasActiveStep: boolean };
}

/** Reports: Midgard → Asgard. Facts about what happened on the page. */
interface BifrostReports {
  "pr:changed": { pr: string | null; onFilesTab: boolean };
  "selection:completed": SelectionPayload;
  "selection:cleared": undefined;
  /** The user clicked an ask button on the selection bar. */
  "selection:ask": SelectionPayload & { withStep: boolean };
  "ref:missing": { file: string };
}

type Handler<P> = (payload: P) => void;

export interface Bifrost {
  send<K extends keyof BifrostCommands>(kind: K, payload: BifrostCommands[K]): void;
  handle<K extends keyof BifrostCommands>(kind: K, fn: Handler<BifrostCommands[K]>): () => void;
  report<K extends keyof BifrostReports>(kind: K, payload: BifrostReports[K]): void;
  on<K extends keyof BifrostReports>(kind: K, fn: Handler<BifrostReports[K]>): () => void;
}

// A typed pub/sub over one event map. The registry is a mapped-type record, so each
// event's Set is typed to that event's payload — no cast bridges public ↔ storage.
function makeBus<EventMap>() {
  const handlers: { [K in keyof EventMap]?: Set<Handler<EventMap[K]>> } = {};
  return {
    emit<K extends keyof EventMap>(kind: K, payload: EventMap[K]): void {
      const set = handlers[kind];
      if (!set) return;
      // Snapshot before dispatch: a handler may unsubscribe another (or itself)
      // mid-publish, and iterating the live Set would skip a not-yet-called handler.
      const snapshot = [...set];
      for (const fn of snapshot) {
        try {
          fn(payload);
        } catch (error) {
          console.error(`[kvasir bifrost] ${String(kind)} handler failed:`, error);
        }
      }
    },
    listen<K extends keyof EventMap>(kind: K, fn: Handler<EventMap[K]>): () => void {
      const set = (handlers[kind] ??= new Set());
      set.add(fn);
      return () => {
        set.delete(fn);
      };
    },
  };
}

export function createBifrost(): Bifrost {
  const commands = makeBus<BifrostCommands>();
  const reports = makeBus<BifrostReports>();
  return {
    send: (kind, payload) => commands.emit(kind, payload),
    handle: (kind, fn) => commands.listen(kind, fn),
    report: (kind, payload) => reports.emit(kind, payload),
    on: (kind, fn) => reports.listen(kind, fn),
  };
}

/** The one bridge instance both worlds share at runtime (tests build their own). */
export const bifrost = createBifrost();
