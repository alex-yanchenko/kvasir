import { describe, it, expect, vi, beforeEach } from "vitest";
import type { WalkthroughSpec } from "@prw/runes";
import { prKey } from "@prw/runes";
import type { BridgeDeps } from "./bridge";
import { createFetchHandler, parseSuggestions } from "./bridge";
import { GUARD_HEADER } from "./guard";

const PR = "https://github.com/acme/widget-api/pull/7";

const mkSpec = (): WalkthroughSpec => ({
  version: 1,
  pr: { url: PR, owner: "acme", repo: "widget-api", number: 7 },
  generatedAt: "2026-01-01T00:00:00Z",
  steps: [{ id: "s1", title: "T", body: "b", file: "f.ts", anchor: "diff-a" }],
});

let deps: {
  specs: Map<string, WalkthroughSpec>;
  open: ReturnType<typeof vi.fn>;
  ask: ReturnType<typeof vi.fn>;
  snapshot: ReturnType<typeof vi.fn>;
  pushEvent: ReturnType<typeof vi.fn>;
  getHeadSha: ReturnType<typeof vi.fn>;
  pairing: {
    arm: ReturnType<typeof vi.fn>;
    request: ReturnType<typeof vi.fn>;
    approve: ReturnType<typeof vi.fn>;
    claim: ReturnType<typeof vi.fn>;
    verify: ReturnType<typeof vi.fn>;
    enforced: ReturnType<typeof vi.fn>;
  };
};
let handler: (req: Request) => Promise<Response>;

beforeEach(() => {
  deps = {
    specs: new Map(),
    open: vi.fn().mockReturnValue("q1-test"),
    ask: vi.fn().mockResolvedValue("an answer"),
    snapshot: vi.fn().mockReturnValue(null),
    pushEvent: vi.fn().mockResolvedValue(undefined),
    getHeadSha: vi.fn().mockResolvedValue("abc123"),
    pairing: {
      arm: vi.fn(),
      request: vi.fn().mockReturnValue({ ok: true, requestId: "rid-1", code: "ABC234" }),
      approve: vi.fn(),
      claim: vi.fn().mockReturnValue({ status: "pending" }),
      verify: vi.fn().mockReturnValue(true),
      enforced: vi.fn().mockReturnValue(true),
    },
  };
  handler = createFetchHandler(deps as unknown as BridgeDeps);
});

// An authorized request: loopback host + the guard header (+ JSON content type on
// POST) — exactly what the extension's background worker sends.
const call = (
  path: string,
  init: { method?: string; body?: unknown; headers?: Record<string, string> } = {},
) =>
  handler(
    new Request(`http://localhost:8799${path}`, {
      method: init.method ?? "GET",
      body: init.body === undefined ? undefined : JSON.stringify(init.body),
      headers: {
        host: "localhost:8799",
        [GUARD_HEADER]: "1",
        ...(init.method === "POST" ? { "content-type": "application/json" } : {}),
        ...init.headers,
      },
    }),
  );

describe("gate + plumbing", () => {
  it("answers OPTIONS preflights with 204 and no grant for unknown origins", async () => {
    const r = await call("/health", { method: "OPTIONS" });
    expect(r.status).toBe(204);
    expect(r.headers.get("access-control-allow-origin")).toBeNull();
  });

  it("refuses a foreign web origin with 403", async () => {
    const r = await call("/health", { headers: { origin: "https://evil.example" } });
    expect(r.status).toBe(403);
    expect(await r.json()).toEqual({ error: "forbidden" });
  });

  it("unknown paths are 404", async () => {
    const r = await call("/nope");
    expect(r.status).toBe(404);
    expect(await r.json()).toEqual({ error: "not found" });
  });

  it("/health reports the spec count", async () => {
    deps.specs.set(prKey(PR), mkSpec());
    const r = await call("/health");
    expect(await r.json()).toEqual({ ok: true, specs: 1 });
  });
});

describe("pairing routes + the token gate", () => {
  it("POST /pair forwards the trimmed name and returns the request handle", async () => {
    const r = await call("/pair", { method: "POST", body: { name: "Chrome on MacBook" } });
    expect(await r.json()).toEqual({ requestId: "rid-1", code: "ABC234" });
    expect(deps.pairing.request).toHaveBeenCalledWith("Chrome on MacBook");
    await call("/pair", { method: "POST", body: {} });
    expect(deps.pairing.request).toHaveBeenLastCalledWith("unnamed extension");
  });

  it("maps a busy slot to 409 and a malformed body to 400", async () => {
    deps.pairing.request.mockReturnValue({ ok: false, reason: "busy" });
    expect((await call("/pair", { method: "POST", body: { name: "x" } })).status).toBe(409);
    const noBody = await handler(
      new Request("http://localhost:8799/pair", {
        method: "POST",
        body: "zzz",
        headers: { host: "localhost:8799", [GUARD_HEADER]: "1", "content-type": "application/json" },
      }),
    );
    expect(noBody.status).toBe(400);
  });

  it("GET /pair/claim relays pending/token and 404s unknown ids, 400 without one", async () => {
    expect(await (await call("/pair/claim?id=rid-1")).json()).toEqual({ status: "pending" });
    deps.pairing.claim.mockReturnValue({ token: "t0k" });
    expect(await (await call("/pair/claim?id=rid-1")).json()).toEqual({ token: "t0k" });
    deps.pairing.claim.mockReturnValue(null);
    expect((await call("/pair/claim?id=zzz")).status).toBe(404);
    expect((await call("/pair/claim")).status).toBe(400);
  });

  it("every protected route demands the token — no grace period; /health and /pair stay open", async () => {
    deps.pairing.verify.mockReturnValue(false);
    const denied = await call(`/walkthrough?pr=${encodeURIComponent(PR)}`);
    expect(denied.status).toBe(401);
    expect(await denied.json()).toEqual({ error: "not paired" });
    expect(deps.pairing.verify).toHaveBeenCalledWith(""); // no header presented
    expect((await call("/ask", { method: "POST", body: { selection: "x", question: "q" } })).status).toBe(
      401,
    );

    // pairing the bridge is still possible while unpaired
    expect((await call("/health")).status).toBe(200);
    expect((await call("/pair", { method: "POST", body: { name: "x" } })).status).toBe(200);
    expect((await call("/pair/claim?id=rid-1")).status).not.toBe(401);

    deps.pairing.verify.mockReturnValue(true);
    const allowed = await call(`/walkthrough?pr=${encodeURIComponent(PR)}`, {
      headers: { "x-prw-token": "t0k" },
    });
    expect(allowed.status).toBe(200);
    expect(deps.pairing.verify).toHaveBeenLastCalledWith("t0k");
  });

  it("GET /auth confirms a valid token (200) and is gated behind it (401)", async () => {
    expect(await (await call("/auth")).json()).toEqual({ paired: true });
    deps.pairing.verify.mockReturnValue(false);
    expect((await call("/auth")).status).toBe(401);
  });
});

describe("/walkthrough + /head", () => {
  it("serves a published spec, absent otherwise, 400 on a bad pr", async () => {
    expect((await call(`/walkthrough?pr=${encodeURIComponent(PR)}`)).status).toBe(200);
    expect(await (await call(`/walkthrough?pr=${encodeURIComponent(PR)}`)).json()).toEqual({
      status: "absent",
    });
    deps.specs.set(prKey(PR), mkSpec());
    expect(await (await call(`/walkthrough?pr=${encodeURIComponent(PR)}`)).json()).toEqual(mkSpec());
    expect((await call("/walkthrough?pr=not-a-pr")).status).toBe(400);
  });

  it("/head returns the sha, 400 on a bad pr, 502 when gh fails", async () => {
    expect(await (await call(`/head?pr=${encodeURIComponent(PR)}`)).json()).toEqual({ headSha: "abc123" });
    expect(deps.getHeadSha).toHaveBeenCalledWith(PR);
    expect((await call("/head?pr=zzz")).status).toBe(400);
    deps.getHeadSha.mockRejectedValue(new Error("gh down"));
    vi.spyOn(console, "error").mockImplementation(() => {});
    expect((await call(`/head?pr=${encodeURIComponent(PR)}`)).status).toBe(502);
  });
});

describe("/generate", () => {
  it("pushes a fresh-walkthrough event by default and an incremental one with sinceSha", async () => {
    const r = await call("/generate", { method: "POST", body: { pr: PR } });
    expect(await r.json()).toEqual({ queued: true });
    expect(deps.pushEvent).toHaveBeenLastCalledWith(expect.stringContaining("fresh walkthrough"), {
      event_type: "generate_walkthrough",
      pr: PR,
      mode: "new",
      since: "",
    });

    await call("/generate", { method: "POST", body: { pr: PR, mode: "incremental", sinceSha: "abc" } });
    expect(deps.pushEvent).toHaveBeenLastCalledWith(expect.stringContaining("INCREMENTAL"), {
      event_type: "generate_walkthrough",
      pr: PR,
      mode: "incremental",
      since: "abc",
    });
    expect(deps.pushEvent.mock.lastCall![0]).toContain("since commit abc");
  });

  it("400 on a malformed body or a bad pr", async () => {
    const noBody = await handler(
      new Request("http://localhost:8799/generate", {
        method: "POST",
        body: "not json",
        headers: { host: "localhost:8799", [GUARD_HEADER]: "1", "content-type": "application/json" },
      }),
    );
    expect(noBody.status).toBe(400);
    expect((await call("/generate", { method: "POST", body: { pr: "nope" } })).status).toBe(400);
  });
});

describe("/ask", () => {
  it("a selection question builds the full prompt (selection, review, step, history, lines) and returns the answer", async () => {
    const r = await call("/ask", {
      method: "POST",
      body: {
        pr: PR,
        file: "src/app.ts",
        lines: { start: 4, end: 6 },
        selection: "const a = 1;",
        review: "the distilled review",
        step: "Step: X",
        question: "why?",
        messages: [
          { role: "user", content: "earlier q" },
          { role: "assistant", content: "earlier a" },
        ],
      },
    });
    expect(await r.json()).toEqual({ id: "q1-test" });
    expect(deps.open).toHaveBeenCalledTimes(1);
    const [eventType, content, meta] = deps.open.mock.calls[0];
    expect(eventType).toBe("code_question");
    expect(meta).toEqual({ pr: PR, file: "src/app.ts" });
    expect(content).toContain("src/app.ts lines 4-6");
    expect(content).toContain("--- SELECTED CODE");
    expect(content).toContain("const a = 1;");
    expect(content).toContain("--- PR WALKTHROUGH");
    expect(content).toContain("the distilled review");
    expect(content).toContain("--- CURRENT REVIEW STEP");
    expect(content).toContain("User: earlier q\nYou: earlier a");
    expect(content).toContain("path:line");
    expect(content).toContain("answer_chunk");
    expect(content).toContain("progress_note");
    expect(content).toContain("never one dense block");
    expect(content).toContain("Never split an already-composed answer");
    expect(content).toContain('say "this", "this step"');
  });

  it("a minimal selection question omits the optional blocks and tolerates bad fields", async () => {
    await call("/ask", {
      method: "POST",
      body: { pr: "not-a-pr", selection: "x", question: "q", lines: { start: 4 }, messages: "nope" },
    });
    const [, content, meta] = deps.open.mock.calls[0];
    expect(meta).toEqual({ pr: "", file: "" }); // unparseable pr never reaches the session prompt meta
    expect(content).toContain("reviewing a PR");
    expect(content).toContain("at this PR"); // no file → generic where; bad lines dropped
    expect(content).not.toContain("--- PR WALKTHROUGH");
    expect(content).not.toContain("--- CURRENT REVIEW STEP");
    expect(content).not.toContain("Conversation so far");
  });

  it("a file without a line range names just the file", async () => {
    await call("/ask", {
      method: "POST",
      body: { pr: PR, file: "src/app.ts", selection: "x", question: "q" },
    });
    expect(deps.open.mock.calls[0][1]).toContain("selection at src/app.ts.");
    expect(deps.open.mock.calls[0][1]).not.toContain("src/app.ts lines");
  });

  it("a PR-level question (no selection) leans on the review", async () => {
    await call("/ask", {
      method: "POST",
      body: { pr: PR, review: "the distilled review", question: "summarize?" },
    });
    const [, content] = deps.open.mock.calls[0];
    expect(content).toContain("general question about the whole PR");
    expect(content).toContain("the distilled review");
    expect(content).not.toContain("--- SELECTED CODE");
  });

  it("PR-level history rides along too", async () => {
    await call("/ask", {
      method: "POST",
      body: { pr: PR, review: "r", question: "next?", messages: [{ role: "user", content: "first" }] },
    });
    expect(deps.open.mock.calls[0][1]).toContain("Conversation so far:\nUser: first");
  });

  it("400s: malformed body, missing question, PR-level without a review", async () => {
    const noBody = await handler(
      new Request("http://localhost:8799/ask", {
        method: "POST",
        body: "zzz",
        headers: { host: "localhost:8799", [GUARD_HEADER]: "1", "content-type": "application/json" },
      }),
    );
    expect(noBody.status).toBe(400);
    expect((await call("/ask", { method: "POST", body: { selection: "x" } })).status).toBe(400);
    const r = await call("/ask", { method: "POST", body: { question: "q" } });
    expect(r.status).toBe(400);
    expect(await r.json()).toEqual({ error: "need a selection or a generated review" });
  });
});

describe("/poll", () => {
  it("returns the live snapshot for a known id", async () => {
    const snap = { notes: ["reading"], text: "partial", done: false, timedOut: false };
    deps.snapshot.mockReturnValue(snap);
    const r = await call("/poll?id=q1-test");
    expect(await r.json()).toEqual(snap);
    expect(deps.snapshot).toHaveBeenCalledWith("q1-test");
  });

  it("400 without an id, 404 for an unknown one", async () => {
    expect((await call("/poll")).status).toBe(400);
    expect((await call("/poll?id=zzz")).status).toBe(404);
  });
});

describe("/suggest", () => {
  it("asks with the selection framed as untrusted and parses a JSON answer", async () => {
    deps.ask.mockResolvedValue('["q1","q2","q3"]');
    const r = await call("/suggest", {
      method: "POST",
      body: { pr: PR, file: "src/app.ts", selection: "const a = 1;" },
    });
    expect(await r.json()).toEqual({ suggestions: ["q1", "q2", "q3"] });
    const [eventType, content, meta] = deps.ask.mock.calls[0];
    expect(eventType).toBe("suggest_questions");
    expect(meta).toEqual({ pr: PR, file: "src/app.ts" });
    expect(content).toContain("(selection in src/app.ts)");
    expect(content).toContain("untrusted data");
  });

  it("omits the file tag without one and 400s without a selection", async () => {
    deps.ask.mockResolvedValue("[]");
    await call("/suggest", { method: "POST", body: { selection: "x" } });
    expect(deps.ask.mock.calls[0][1]).not.toContain("(selection in");
    expect((await call("/suggest", { method: "POST", body: {} })).status).toBe(400);
    const noBody = await handler(
      new Request("http://localhost:8799/suggest", {
        method: "POST",
        body: "zzz",
        headers: { host: "localhost:8799", [GUARD_HEADER]: "1", "content-type": "application/json" },
      }),
    );
    expect(noBody.status).toBe(400);
  });
});

describe("parseSuggestions", () => {
  it("parses a JSON array (capped at 4), falls back to line-splitting, and survives junk", () => {
    expect(parseSuggestions('["a","b","c","d","e"]')).toEqual(["a", "b", "c", "d"]);
    expect(parseSuggestions("- one\n2. two\n* three\n\n")).toEqual(["one", "two", "three"]);
    expect(parseSuggestions('{"not":"array"}')).toEqual(['{"not":"array"}']);
    expect(parseSuggestions("")).toEqual([]);
  });
});
