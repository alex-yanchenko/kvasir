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
export interface StepHighlightPayload {
  anchor: string;
  lines: LineRange | null;
  highlight: string[] | null;
}

/** Commands: Asgard → Midgard. Each causes a write to GitHub's page. */
export interface BifrostCommands {
  "highlight:step": StepHighlightPayload;
  "highlight:clear": undefined;
  "pick:rehighlight": { file: string; text: string; scroll?: boolean };
  "pick:clear": undefined;
  /** start null = no line cited — jump to the file's diff container itself. */
  "jump:ref": { file: string; start: number | null; end: number | null };
  "theme:apply": { theme: string; hlStyle: string };
  /** Tell the grip whether a walkthrough step is active (shows the context-chat
   * ask button) — pushed by the app, so Midgard never reads app state. */
  "grip:context": { hasActiveStep: boolean };
}

/** Reports: Midgard → Asgard. Facts about what happened on the page. */
export interface BifrostReports {
  "pr:changed": { pr: string | null; onFilesTab: boolean };
  "selection:completed": SelectionPayload;
  "selection:cleared": undefined;
  /** The user clicked an ask button on the selection bar. */
  "selection:ask": SelectionPayload & { withStep: boolean };
  "ref:missing": { file: string };
}

/** Synchronous, side-effect-free reads Midgard exposes. Pure data out — calling
 * these directly (not via messages) is deliberate: they read, never write. */
export interface MidgardQuery {
  captureSelection(): SelectionPayload | null;
  stepSelection(step: StepHighlightPayload & { file: string }): SelectionPayload | null;
  /** Changed-file paths currently on the page (diff.ts changedFilePaths). */
  changedFilePaths(): string[];
}

type Handler<P> = (payload: P) => void;

export interface Bifrost {
  send<K extends keyof BifrostCommands>(kind: K, payload: BifrostCommands[K]): void;
  handle<K extends keyof BifrostCommands>(kind: K, fn: Handler<BifrostCommands[K]>): () => void;
  report<K extends keyof BifrostReports>(kind: K, payload: BifrostReports[K]): void;
  on<K extends keyof BifrostReports>(kind: K, fn: Handler<BifrostReports[K]>): () => void;
}

export function createBifrost(): Bifrost {
  const commands = new Map<string, Set<Handler<unknown>>>();
  const reports = new Map<string, Set<Handler<unknown>>>();

  const subscribe = (map: Map<string, Set<Handler<unknown>>>, kind: string, fn: Handler<unknown>) => {
    let set = map.get(kind);
    if (!set) {
      set = new Set();
      map.set(kind, set);
    }
    set.add(fn);
    return () => {
      set.delete(fn);
    };
  };

  const publish = (map: Map<string, Set<Handler<unknown>>>, kind: string, payload: unknown) => {
    const set = map.get(kind);
    if (!set) return;
    // Snapshot before dispatch: a handler may unsubscribe another (or itself)
    // mid-publish, and iterating the live Set would skip a not-yet-called handler.
    const snapshot = [...set];
    for (const fn of snapshot) {
      try {
        fn(payload);
      } catch (error) {
        console.error(`[prw bifrost] ${kind} handler failed:`, error);
      }
    }
  };

  return {
    send: (kind, payload) => publish(commands, kind, payload),
    // eslint-disable-next-line @typescript-eslint/consistent-type-assertions -- sound variance erasure: the per-event handler types are stored in one heterogeneous registry (Set<Handler<unknown>>); publish always supplies this event's matching payload. A Map can't hold per-key value types.
    handle: (kind, fn) => subscribe(commands, kind, fn as Handler<unknown>),
    report: (kind, payload) => publish(reports, kind, payload),
    // eslint-disable-next-line @typescript-eslint/consistent-type-assertions -- see handle above.
    on: (kind, fn) => subscribe(reports, kind, fn as Handler<unknown>),
  };
}

/** The one bridge instance both worlds share at runtime (tests build their own). */
export const bifrost = createBifrost();
