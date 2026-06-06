// The ask broker: parks an HTTP request as a pending question, pushes the event
// into the running Claude session, and resolves when answer_question arrives (or
// the timeout fires, resolving ""). Extracted from channel.ts so the timing
// rules are unit-testable; channel.ts injects the real pushEvent.

interface Pending {
  resolve: (answer: string) => void;
  timer: ReturnType<typeof setTimeout>;
}

export interface AskBroker {
  /** Register a pending question, push it to the session, await the answer ("" on timeout). */
  ask(eventType: string, content: string, meta: Record<string, string>): Promise<string>;
  /** Resolve a pending question by id. False when the id is unknown (or timed out). */
  answer(id: string | undefined, text: string): boolean;
}

export function createAskBroker(opts: {
  timeoutMs: number;
  pushEvent: (content: string, meta: Record<string, string>) => Promise<void>;
}): AskBroker {
  const pending = new Map<string, Pending>();
  let nextId = 1;
  const newId = (): string => `q${nextId++}-${Date.now().toString(36)}`;

  return {
    ask(eventType, content, meta) {
      const id = newId();
      const p = new Promise<string>((resolve) => {
        const timer = setTimeout(() => {
          pending.delete(id);
          resolve("");
        }, opts.timeoutMs);
        pending.set(id, { resolve, timer });
      });
      void opts.pushEvent(content, { ...meta, event_type: eventType, id });
      return p;
    },

    answer(id, text) {
      const p = id ? pending.get(id) : undefined;
      if (!p) return false;
      clearTimeout(p.timer);
      pending.delete(id!);
      p.resolve(text);
      return true;
    },
  };
}
