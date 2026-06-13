// Runtime guards for state restored from chrome.storage. storeGet returns
// `unknown` (it's whatever was persisted, possibly from an older build), so every
// read is narrowed here instead of cast — a mismatched field is dropped, never
// trusted. Keeps heimdall/watch.ts honest and free of shape casts.
import type { ChatSession } from "./types";

const isRecord = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null;

type Pos = { left: number; top: number };
type Size = { w: number; h: number };

const isPos = (v: unknown): v is Pos =>
  isRecord(v) && typeof v.left === "number" && typeof v.top === "number";
const isSize = (v: unknown): v is Size => isRecord(v) && typeof v.w === "number" && typeof v.h === "number";

/** Restore a persisted TourState, dropping any field that doesn't match. */
export function parseTourState(v: unknown): { step: number; pos: Pos | null; size: Size | null } {
  if (!isRecord(v)) return { step: 0, pos: null, size: null };
  return {
    step: typeof v.step === "number" ? v.step : 0,
    pos: isPos(v.pos) ? v.pos : null,
    size: isSize(v.size) ? v.size : null,
  };
}

/** Restore persisted panel geometry (pos + size), dropping mismatches. */
export function parsePanelGeometry(v: unknown): { pos: Pos | null; size: Size | null } {
  if (!isRecord(v)) return { pos: null, size: null };
  return { pos: isPos(v.pos) ? v.pos : null, size: isSize(v.size) ? v.size : null };
}

const isChatSession = (v: unknown): v is ChatSession =>
  isRecord(v) && typeof v.key === "string" && Array.isArray(v.messages);

export const isChatSessionArray = (v: unknown): v is ChatSession[] =>
  Array.isArray(v) && v.every(isChatSession);
