import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { createAskBroker, DONE_TTL_MS, MAX_LIVE_QUESTIONS } from "./broker";

let pushed: Array<{ content: string; meta: Record<string, string> }>;
const pushEvent = async (content: string, meta: Record<string, string>): Promise<void> => {
  pushed.push({ content, meta });
};

const mkBroker = () => createAskBroker({ timeoutMs: 1000, pushEvent });

beforeEach(() => {
  vi.useFakeTimers();
  pushed = [];
});
afterEach(() => {
  vi.useRealTimers();
});

describe("open + streaming", () => {
  it("pushes the event with a fresh id and accumulates notes and chunks", () => {
    const broker = mkBroker();
    const id = broker.open("code_question", "the prompt", { pr: "x" });
    expect(pushed).toEqual([{ content: "the prompt", meta: { pr: "x", event_type: "code_question", id } }]);
    expect(broker.snapshot(id)).toEqual({ notes: [], text: "", done: false, timedOut: false });

    expect(broker.note(id, "reading diff.ts")).toBe(true);
    expect(broker.chunk(id, "First block.")).toBe(true);
    expect(broker.chunk(id, "- a\n- b")).toBe(true);
    expect(broker.chunk(id, "tail\n")).toBe(true);
    expect(broker.chunk(id, "after newline")).toBe(true);
    expect(broker.snapshot(id)).toEqual({
      notes: ["reading diff.ts"],
      text: "First block.\n\n- a\n- b\n\ntail\n\nafter newline",
      done: false,
      timedOut: false,
    });
  });

  it("finish closes the stream; chunked text wins over the closing answer", () => {
    const broker = mkBroker();
    const id = broker.open("code_question", "q", {});
    broker.chunk(id, "streamed answer");
    expect(broker.finish(id, "full restated answer")).toBe(true);
    expect(broker.snapshot(id)).toEqual({
      notes: [],
      text: "streamed answer",
      done: true,
      timedOut: false,
    });
  });

  it("finish without chunks takes the answer text (one-shot fallback)", () => {
    const broker = mkBroker();
    const id = broker.open("code_question", "q", {});
    broker.finish(id, "the whole answer");
    expect(broker.snapshot(id)?.text).toBe("the whole answer");
  });

  it("ids are unique and streams are independent", () => {
    const broker = mkBroker();
    const id1 = broker.open("code_question", "q1", {});
    const id2 = broker.open("code_question", "q2", {});
    expect(id1).not.toBe(id2);
    broker.chunk(id2, "two");
    expect(broker.snapshot(id1)?.text).toBe("");
    expect(broker.snapshot(id2)?.text).toBe("two");
  });

  it("note/chunk/finish refuse unknown, missing, or finished ids", () => {
    const broker = mkBroker();
    expect(broker.note("nope", "x")).toBe(false);
    expect(broker.chunk(undefined, "x")).toBe(false);
    expect(broker.finish("nope", "x")).toBe(false);
    const id = broker.open("code_question", "q", {});
    broker.finish(id, "done");
    expect(broker.note(id, "late")).toBe(false);
    expect(broker.chunk(id, "late")).toBe(false);
    expect(broker.finish(id, "again")).toBe(false);
  });

  it("times out into a done+timedOut snapshot, keeping any partial text", () => {
    const broker = mkBroker();
    const id = broker.open("code_question", "q", {});
    broker.chunk(id, "partial");
    vi.advanceTimersByTime(1000);
    expect(broker.snapshot(id)).toEqual({ notes: [], text: "partial", done: true, timedOut: true });
    vi.advanceTimersByTime(DONE_TTL_MS);
    expect(broker.snapshot(id)).toBeNull();
  });

  it("a finished question stays pollable for the TTL, then expires", () => {
    const broker = mkBroker();
    const id = broker.open("code_question", "q", {});
    broker.finish(id, "a");
    vi.advanceTimersByTime(DONE_TTL_MS - 1);
    expect(broker.snapshot(id)).not.toBeNull();
    vi.advanceTimersByTime(1);
    expect(broker.snapshot(id)).toBeNull();
  });

  it("swallows a pushEvent rejection so a closed channel can't crash the process", async () => {
    const broker = createAskBroker({
      timeoutMs: 1000,
      pushEvent: () => Promise.reject(new Error("transport closed")),
    });
    const id = broker.open("code_question", "q", {});
    await Promise.resolve(); // let the fire-and-forget IIFE's catch run
    await Promise.resolve();
    expect(broker.snapshot(id)).not.toBeNull(); // open still succeeded; no unhandled rejection
  });

  it("caps tracked questions, evicting the oldest once the limit is reached", () => {
    const broker = mkBroker();
    const first = broker.open("code_question", "q", {});
    for (let i = 1; i < MAX_LIVE_QUESTIONS; i++) broker.open("code_question", "q", {});
    expect(broker.snapshot(first)).not.toBeNull(); // exactly at the cap — first still tracked
    broker.open("code_question", "q", {}); // one past the cap → evicts the oldest
    expect(broker.snapshot(first)).toBeNull();
  });
});

describe("ask (one-shot mode)", () => {
  it("awaits the full answer", async () => {
    const broker = mkBroker();
    const p = broker.ask("suggest_questions", "q", {});
    broker.finish(pushed[0].meta.id, '["a"]');
    expect(await p).toBe('["a"]');
  });

  it("resolves empty on timeout even when chunks arrived", async () => {
    const broker = mkBroker();
    const p = broker.ask("suggest_questions", "q", {});
    broker.chunk(pushed[0].meta.id, "partial");
    vi.advanceTimersByTime(1000);
    expect(await p).toBe("");
  });
});
