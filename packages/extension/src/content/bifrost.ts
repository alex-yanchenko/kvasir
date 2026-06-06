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
  "jump:ref": { file: string; start: number; end: number | null };
  "theme:apply": { theme: string; hlStyle: string };
}

/** Reports: Midgard → Asgard. Facts about what happened on the page. */
export interface BifrostReports {
  "pr:changed": { pr: string | null; onFilesTab: boolean };
  "selection:completed": SelectionPayload;
  "selection:cleared": undefined;
  "ref:missing": { file: string };
}

/** Synchronous, side-effect-free reads Midgard exposes. Pure data out — calling
 * these directly (not via messages) is deliberate: they read, never write. */
export interface MidgardQuery {
  captureSelection(): SelectionPayload | null;
  stepSelection(step: StepHighlightPayload & { file: string }): SelectionPayload | null;
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
    for (const fn of [...set]) {
      try {
        fn(payload);
      } catch (e) {
        console.error(`[prw bifrost] ${kind} handler failed:`, e);
      }
    }
  };

  return {
    send: (kind, payload) => publish(commands, kind, payload),
    handle: (kind, fn) => subscribe(commands, kind, fn as Handler<unknown>),
    report: (kind, payload) => publish(reports, kind, payload),
    on: (kind, fn) => subscribe(reports, kind, fn as Handler<unknown>),
  };
}

/** The one bridge instance both worlds share at runtime (tests build their own). */
export const bifrost = createBifrost();
