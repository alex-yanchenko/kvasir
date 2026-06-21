// Asgard's domain types. ChatSession is the persisted chat unit (chrome.storage,
// most-recent-first in the store); it is pure data — DOM never appears here.
import type { LineRange } from "../midgard/diff";

export interface ChatMessage {
  role: "user" | "assistant";
  content: string;
}

export interface ChatSession {
  /** file + leading selection text — doubles as the Bifrost selectionId. */
  key: string;
  /** null for the whole-PR ("general") chat. */
  file: string | null;
  lines: LineRange | null;
  text: string;
  suggestions: string[] | null;
  messages: ChatMessage[];
  /** Compact walkthrough-step context captured when the chat was opened from a step. */
  step?: string;
  /** The walkthrough step id this chat belongs to (set when opened from a step) —
   * lets the step's icon show a chat exists and reopen it. */
  stepId?: string;
  /** True only for the single whole-PR chat. */
  general?: boolean;
}
