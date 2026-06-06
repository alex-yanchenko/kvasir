import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { createAskBroker } from "./broker";

let pushed: Array<{ content: string; meta: Record<string, string> }>;
const pushEvent = async (content: string, meta: Record<string, string>): Promise<void> => {
  pushed.push({ content, meta });
};

beforeEach(() => {
  vi.useFakeTimers();
  pushed = [];
});
afterEach(() => {
  vi.useRealTimers();
});

describe("createAskBroker", () => {
  it("pushes the event with a fresh id and resolves when that id is answered", async () => {
    const broker = createAskBroker({ timeoutMs: 1000, pushEvent });
    const p = broker.ask("code_question", "the prompt", { pr: "x" });
    expect(pushed).toEqual([
      {
        content: "the prompt",
        meta: { pr: "x", event_type: "code_question", id: pushed[0].meta.id },
      },
    ]);
    expect(broker.answer(pushed[0].meta.id, "the answer")).toBe(true);
    expect(await p).toBe("the answer");
  });

  it("ids are unique across asks and answers route to the right question", async () => {
    const broker = createAskBroker({ timeoutMs: 1000, pushEvent });
    const p1 = broker.ask("code_question", "q1", {});
    const p2 = broker.ask("code_question", "q2", {});
    const [id1, id2] = [pushed[0].meta.id, pushed[1].meta.id];
    expect(id1).not.toBe(id2);
    broker.answer(id2, "a2");
    broker.answer(id1, "a1");
    expect(await Promise.all([p1, p2])).toEqual(["a1", "a2"]);
  });

  it("resolves empty on timeout, after which the id is gone", async () => {
    const broker = createAskBroker({ timeoutMs: 1000, pushEvent });
    const p = broker.ask("code_question", "q", {});
    vi.advanceTimersByTime(1000);
    expect(await p).toBe("");
    expect(broker.answer(pushed[0].meta.id, "too late")).toBe(false);
  });

  it("answering an unknown or missing id reports false", () => {
    const broker = createAskBroker({ timeoutMs: 1000, pushEvent });
    expect(broker.answer("nope", "x")).toBe(false);
    expect(broker.answer(undefined, "x")).toBe(false);
  });
});
