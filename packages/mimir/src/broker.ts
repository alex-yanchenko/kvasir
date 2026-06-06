// The ask broker: registers a question, pushes the event into the running
// Claude session, and accumulates the session's streamed reply — progress notes
// (progress_note), partial answer text (answer_chunk), and the final
// answer_question call. The extension polls snapshot() until done. ask() keeps
// the old await-the-whole-answer mode for small one-shot calls (/suggest).

export interface QuestionSnapshot {
  notes: string[];
  text: string;
  done: boolean;
  timedOut: boolean;
}

interface QuestionState extends QuestionSnapshot {
  resolve?: (answer: string) => void;
  timer: ReturnType<typeof setTimeout>;
}

/** How long a finished question stays pollable before it is dropped. */
export const DONE_TTL_MS = 60_000;

export interface AskBroker {
  /** Register a streamed question, push it to the session, return its id. */
  open(eventType: string, content: string, meta: Record<string, string>): string;
  /** One-shot mode: like open(), but awaits the full answer ("" on timeout). */
  ask(eventType: string, content: string, meta: Record<string, string>): Promise<string>;
  /** Append a progress note. False when the id is unknown or already done. */
  note(id: string | undefined, note: string): boolean;
  /** Append a piece of the answer. False when the id is unknown or already done. */
  chunk(id: string | undefined, text: string): boolean;
  /** Final answer. When chunks already streamed the text is ignored (the model
   * re-sends the full answer; the chunks ARE the answer). False on unknown id. */
  finish(id: string | undefined, text: string): boolean;
  /** Current state for polling; null when the id is unknown (or expired). */
  snapshot(id: string): QuestionSnapshot | null;
}

export function createAskBroker(opts: {
  timeoutMs: number;
  pushEvent: (content: string, meta: Record<string, string>) => Promise<void>;
}): AskBroker {
  const questions = new Map<string, QuestionState>();
  let nextId = 1;

  const get = (id: string | undefined): QuestionState | undefined => (id ? questions.get(id) : undefined);

  const close = (id: string, q: QuestionState, timedOut: boolean): void => {
    clearTimeout(q.timer);
    q.done = true;
    q.timedOut = timedOut;
    q.resolve?.(timedOut ? "" : q.text);
    q.resolve = undefined;
    // Keep the finished state pollable briefly, then drop it.
    q.timer = setTimeout(() => questions.delete(id), DONE_TTL_MS);
  };

  const broker: AskBroker = {
    open(eventType, content, meta) {
      const id = `q${nextId++}-${Date.now().toString(36)}`;
      const q: QuestionState = {
        notes: [],
        text: "",
        done: false,
        timedOut: false,
        timer: setTimeout(() => close(id, q, true), opts.timeoutMs),
      };
      questions.set(id, q);
      void opts.pushEvent(content, { ...meta, event_type: eventType, id });
      return id;
    },

    ask(eventType, content, meta) {
      return new Promise<string>((resolve) => {
        const id = broker.open(eventType, content, meta);
        questions.get(id)!.resolve = resolve;
      });
    },

    note(id, note) {
      const q = get(id);
      if (!q || q.done) return false;
      q.notes.push(note);
      return true;
    },

    chunk(id, text) {
      const q = get(id);
      if (!q || q.done) return false;
      q.text += text;
      return true;
    },

    finish(id, text) {
      const q = get(id);
      if (!q || q.done) return false;
      if (!q.text) q.text = text;
      close(id!, q, false);
      return true;
    },

    snapshot(id) {
      const q = questions.get(id);
      return q ? { notes: [...q.notes], text: q.text, done: q.done, timedOut: q.timedOut } : null;
    },
  };
  return broker;
}
