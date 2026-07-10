// Runtime guards for state restored from chrome.storage. storeGet returns
// `unknown` (it's whatever was persisted, possibly from an older build), so every
// read is narrowed here instead of cast — a mismatched field is dropped, never
// trusted. Keeps heimdall/watch.ts honest and free of shape casts.
import { isReview, type Review } from "@kvasir/runes/review";
import type { TourState } from "./store";
import type { ChatSession } from "./types";

const isRecord = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null;

type Pos = { left: number; top: number };
type Size = { w: number; h: number };

const isPos = (v: unknown): v is Pos =>
  isRecord(v) && typeof v.left === "number" && typeof v.top === "number";
const isSize = (v: unknown): v is Size => isRecord(v) && typeof v.w === "number" && typeof v.h === "number";

const isStringArray = (v: unknown): v is string[] =>
  Array.isArray(v) && v.every((entry) => typeof entry === "string");

/** Restore a persisted TourState, dropping any field that doesn't match. Returns
 * the fully-defaulted shape, so a field added to TourState fails to compile here
 * until this restorer handles it. */
export function parseTourState(v: unknown): Required<TourState> {
  if (!isRecord(v)) return { step: 0, overview: false, pos: null, size: null, visited: [], visitedStamp: "" };
  return {
    step: typeof v.step === "number" ? v.step : 0,
    overview: v.overview === true,
    pos: isPos(v.pos) ? v.pos : null,
    size: isSize(v.size) ? v.size : null,
    visited: isStringArray(v.visited) ? v.visited : [],
    visitedStamp: typeof v.visitedStamp === "string" ? v.visitedStamp : "",
  };
}

/** Restore the per-tab panel state (open + tab + geometry) from sessionStorage,
 * dropping mismatches. The tab string is validated by the caller via isPanelTab. */
export function parsePanelState(v: unknown): {
  open: boolean;
  sidebarOpen: boolean;
  tab: string | null;
  pos: Pos | null;
  size: Size | null;
} {
  if (!isRecord(v)) return { open: false, sidebarOpen: false, tab: null, pos: null, size: null };
  return {
    open: v.open === true,
    sidebarOpen: v.sidebarOpen === true,
    tab: typeof v.tab === "string" ? v.tab : null,
    pos: isPos(v.pos) ? v.pos : null,
    size: isSize(v.size) ? v.size : null,
  };
}

/** Restore the panel's GLOBAL prefs (window geometry + sidebar-open) from localStorage.
 * These are the window's SHAPE — a cross-tab preference like the rail width, NOT per-tab
 * state — so a fresh tab opens at the user's last size/position with their sidebar
 * preference, not the default. Drops mismatches. (open/tab stay per-tab; see store.ts.) */
export function parsePanelPrefs(v: unknown): { pos: Pos | null; size: Size | null; sidebarOpen: boolean } {
  if (!isRecord(v)) return { pos: null, size: null, sidebarOpen: false };
  return {
    pos: isPos(v.pos) ? v.pos : null,
    size: isSize(v.size) ? v.size : null,
    sidebarOpen: v.sidebarOpen === true,
  };
}

/** The cached review walk (content + step + visited dots), so a fresh page renders
 * the panel instantly from storage instead of waiting on the mailbox fetch. */
export function parseReviewCache(v: unknown): { step: number; review: Review | null; visited: string[] } {
  if (!isRecord(v)) return { step: 0, review: null, visited: [] };
  return {
    step: typeof v.step === "number" ? v.step : 0,
    review: isReview(v.review) ? v.review : null,
    visited: Array.isArray(v.visited) ? v.visited.filter((x): x is string => typeof x === "string") : [],
  };
}

const isChatSession = (v: unknown): v is ChatSession =>
  isRecord(v) &&
  typeof v.key === "string" &&
  typeof v.text === "string" &&
  (v.file === null || typeof v.file === "string") &&
  Array.isArray(v.messages);

export const isChatSessionArray = (v: unknown): v is ChatSession[] =>
  Array.isArray(v) && v.every(isChatSession);
