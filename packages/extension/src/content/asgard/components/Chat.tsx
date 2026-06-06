// The chat window — Asgard's biggest island. The machine (chat.ts) owns the
// sessions and the /ask flow; this renders the window: thread with markdown +
// clickable path:line citations, per-answer actions (regenerate / jump / copy),
// quick prompts + AI suggestions, the autosizing input, drag/resize persistence,
// and the pending-answer resume after a refresh.
import type { JSX } from "react";
import { useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import { renderMarkdown } from "@prw/runes/markdown";
import { bifrost } from "../../bifrost";
import { changedFilePaths } from "../../midgard/diff";
import { chatStore, QUICK, QUICK_PR } from "../chat";
import { useDrag } from "../hooks/useDrag";
import { useResizePersist } from "../hooks/useResizePersist";
import { getSnapshot, subscribe } from "../store";
import type { ChatMessage, ChatSession } from "../types";

const ICON = {
  copy: '<rect x="9" y="9" width="11" height="11" rx="2"/><path d="M5 15V5a2 2 0 0 1 2-2h10"/>',
  check: '<path d="M4 12l5 5L20 6"/>',
  regen: '<path d="M21 12a9 9 0 1 1-2.64-6.36"/><path d="M21 3v6h-6"/>',
  locate: '<circle cx="12" cy="12" r="3"/><path d="M12 2v3M12 19v3M2 12h3M19 12h3"/>',
  arrow: '<path d="M5 12h14M13 6l6 6-6 6"/>',
  chevron: '<path d="M6 9l6 6 6-6"/>',
};
const svg = (inner: string): string =>
  `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">${inner}</svg>`;

// Turn `path.ext:line` / `path.ext:start-end` mentions in an assistant answer into
// clickable jump-to-code links, and bare `dir/file.ext` mentions into jump-to-file
// links when the file is in this PR's diff. Skips fenced code blocks and existing
// links; a cited file:line that isn't in the diff just no-ops on click.
export const REF_RE = /\b[\w@./-]*\w\.\w{1,8}:\d+(?:-\d+)?\b/;
/** A bare path mention: at least one slash, ends in an extension, no :line. */
export const FILE_RE = /\b[\w@-][\w@.-]*(?:\/[\w@.-]+)+\.\w{1,8}\b/;

const mkRefLink = (label: string, ref: { file: string; start: number | null; end: number | null }) => {
  const a = document.createElement("a");
  a.className = "prw-ref";
  a.href = "#";
  a.textContent = label;
  a.onclick = (e) => {
    e.preventDefault();
    bifrost.send("jump:ref", ref);
  };
  return a;
};

export function linkifyRefs(root: HTMLElement): void {
  // bare paths only become links when they name a file in the PR's diff —
  // otherwise every npm package or URL fragment would turn into a dead link
  const known = changedFilePaths();
  const canonical = (mention: string): string | null =>
    known.find((p) => p === mention || p.endsWith("/" + mention) || mention.endsWith("/" + p)) ?? null;

  const nodes: Text[] = [];
  const walk = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  let cur = walk.nextNode();
  while (cur) {
    const node = cur;
    cur = walk.nextNode();
    if (!(node instanceof Text) || !node.nodeValue) continue;
    if (!REF_RE.test(node.nodeValue) && !FILE_RE.test(node.nodeValue)) continue;
    let skip = false;
    for (let p = node.parentElement; p && p !== root; p = p.parentElement) {
      if (p.tagName === "PRE" || p.tagName === "A") {
        skip = true;
        break;
      }
    }
    if (!skip) nodes.push(node);
  }
  nodes.forEach((node) => {
    const text = String(node.nodeValue); // collected nodes all matched a pattern — never null
    const frag = document.createDocumentFragment();
    // SAFE: built from the constant regex literals above, never user input. The
    // :line form is first so the alternation prefers it over the bare path.
    const re = new RegExp(`${REF_RE.source}|${FILE_RE.source}`, "g");
    let last = 0;
    let m;
    while ((m = re.exec(text))) {
      const full = m[0];
      let link: HTMLAnchorElement | null;
      if (/:\d+(?:-\d+)?$/.test(full)) {
        const colon = full.lastIndexOf(":");
        const [start, end] = full.slice(colon + 1).split("-");
        link = mkRefLink(full, { file: full.slice(0, colon), start: +start, end: end ? +end : null });
      } else {
        const file = canonical(full);
        link = file ? mkRefLink(full, { file, start: null, end: null }) : null;
      }
      if (!link) continue; // a path that isn't in the PR stays plain text
      if (m.index > last) frag.appendChild(document.createTextNode(text.slice(last, m.index)));
      frag.appendChild(link);
      last = m.index + full.length;
    }
    if (last === 0) return; // nothing linkable in this node after validation
    if (last < text.length) frag.appendChild(document.createTextNode(text.slice(last)));
    node.parentNode?.replaceChild(frag, node);
  });
}

/** A streaming partial can end mid-code-fence; close it so the block renders as
 * code while it grows instead of flashing raw backticks until done. */
export const closeFences = (text: string): string =>
  text.split("```").length % 2 === 0 ? text + "\n```" : text;

/** Rendered assistant markdown: escape-first renderMarkdown HTML, then a ref
 * effect adds per-code-block copy buttons and the citation links. */
function Markdown({ text }: { text: string }): JSX.Element {
  const ref = useRef<HTMLSpanElement>(null);
  // The {__html} object must be referentially stable: React resets innerHTML
  // whenever the object identity changes, which would wipe the copy buttons and
  // citation links this effect adds on every unrelated re-render (copy flash).
  const html = useMemo(() => ({ __html: renderMarkdown(text) }), [text]);
  useEffect(() => {
    const el = ref.current!; // the span renders unconditionally; refs are set before effects
    el.querySelectorAll("pre.prw-code").forEach((pre) => {
      const code = pre.querySelector("code")!; // renderMarkdown always nests <code> in .prw-code
      const b = document.createElement("button");
      b.className = "prw-iconbtn prw-code-copy";
      b.setAttribute("data-prw-tip", "Copy code");
      b.setAttribute("aria-label", "Copy code");
      b.innerHTML = svg(ICON.copy);
      b.onclick = () => {
        navigator.clipboard?.writeText(String(code.textContent)); // an element's textContent is never null
        b.innerHTML = svg(ICON.check);
      };
      pre.appendChild(b);
    });
    linkifyRefs(el);
  }, [html]);
  return <span ref={ref} className="prw-md" dangerouslySetInnerHTML={html} />;
}

/** Cosmetic streaming: reveal progressively. True token streaming needs the
 * fast-model path; the channel returns the whole answer at once. */
function Typewriter({ text, onDone }: { text: string; onDone: () => void }): JSX.Element {
  const [shown, setShown] = useState(0);
  useEffect(() => {
    const step = Math.max(2, Math.round(text.length / 120));
    const tick = setInterval(() => {
      setShown((i) => {
        const next = Math.min(text.length, i + step);
        if (next >= text.length) {
          clearInterval(tick);
          onDone();
        }
        return next;
      });
    }, 12);
    return () => clearInterval(tick);
    // restart only for a new answer text
  }, [text]);
  return <span>{text.slice(0, shown)}</span>;
}

interface Busy {
  question: string;
  replaceIdx?: number;
}

function Message({
  sess,
  msg,
  index,
  onRegenerate,
  streaming,
  onStreamed,
}: {
  sess: ChatSession;
  msg: ChatMessage;
  index: number;
  onRegenerate: (mi: number) => void;
  streaming: boolean;
  onStreamed: () => void;
}): JSX.Element {
  const bodyRef = useRef<HTMLDivElement>(null);
  const refIdx = useRef(0);
  const [copied, setCopied] = useState(false);
  if (msg.role === "user") {
    return (
      <div className="prw-msg prw-msg-user">
        <span>{msg.content}</span>
      </div>
    );
  }
  const locate = () => {
    // bodyRef is on this message's root div — set before any click can land
    const refs = bodyRef.current!.querySelectorAll<HTMLAnchorElement>(".prw-ref");
    if (refs.length) {
      // several citations: each click advances to the next (the inline links
      // jump to a specific one directly)
      const a = refs[refIdx.current % refs.length];
      refIdx.current++;
      a.click();
    } else if (!sess.general) {
      bifrost.send("pick:rehighlight", { file: sess.file ?? "", text: sess.text, scroll: true });
    }
  };
  return (
    <div className="prw-msg prw-msg-bot" ref={bodyRef}>
      {streaming ? <Typewriter text={msg.content} onDone={onStreamed} /> : <Markdown text={msg.content} />}
      <div className="prw-msg-actions">
        <button
          className="prw-iconbtn"
          data-prw-tip="Regenerate answer"
          aria-label="Regenerate answer"
          onClick={() => onRegenerate(index)}
          dangerouslySetInnerHTML={{ __html: svg(ICON.regen) }}
        />
        <button
          className="prw-iconbtn"
          data-prw-tip="Jump to the cited code"
          aria-label="Jump to the cited code"
          onClick={locate}
          dangerouslySetInnerHTML={{ __html: svg(ICON.locate) }}
        />
        <button
          className={"prw-iconbtn" + (copied ? " prw-ok" : "")}
          data-prw-tip="Copy message"
          aria-label="Copy message"
          onClick={() => {
            navigator.clipboard?.writeText(msg.content);
            setCopied(true);
            setTimeout(() => setCopied(false), 1200);
          }}
          dangerouslySetInnerHTML={{ __html: svg(copied ? ICON.check : ICON.copy) }}
        />
      </div>
    </div>
  );
}

/** An option row: selectable text + a → button (only the button sends). The
 * expand chevron appears when the text is clipped at the current width. */
function OptionRow({ label, onAsk }: { label: string; onAsk: () => void }): JSX.Element {
  const textRef = useRef<HTMLSpanElement>(null);
  const [clipped, setClipped] = useState(false);
  const [open, setOpen] = useState(false);
  useEffect(() => {
    const el = textRef.current!; // the span renders unconditionally; refs are set before effects
    const check = () => setClipped(el.scrollWidth > el.clientWidth + 4);
    check();
    const ro = new ResizeObserver(check);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  return (
    <div className={"prw-srow" + (open ? " prw-srow-open" : "")}>
      {(clipped || open) && (
        <button
          className="prw-srow-exp"
          data-prw-tip={open ? "Collapse" : "Show full text"}
          aria-label="Show full text"
          onClick={() => setOpen((o) => !o)}
          dangerouslySetInnerHTML={{ __html: svg(ICON.chevron) }}
        />
      )}
      <span ref={textRef} className="prw-srow-text" data-prw-tip={label}>
        {label}
      </span>
      <button
        className="prw-srow-ask"
        data-prw-tip="Ask this"
        aria-label="Ask this question"
        onClick={onAsk}
        dangerouslySetInnerHTML={{ __html: svg(ICON.arrow) }}
      />
    </div>
  );
}

function computeInitialPos(sess: ChatSession): { left: number; top: number } {
  const W = 420;
  const M = 10;
  let left: number;
  let top: number;
  const at = chatStore.anchor();
  if (sess.pos) {
    left = sess.pos.left;
    top = sess.pos.top;
  } else if (at) {
    left = Math.min(at.left, window.innerWidth - W - M);
    top = at.bottom + 8;
    if (top + 360 > window.innerHeight) top = Math.max(M, at.top - 360 - 8);
  } else {
    left = 40;
    top = 90;
  }
  // Keep clear of the walkthrough card (bottom-right) — slide left of it. Skip
  // if the user already placed this chat themselves. (The card lives in our own
  // shadow root, so this never touches GitHub's DOM.)
  if (!sess.pos) {
    const cr = document
      .getElementById("prw-root")
      ?.shadowRoot?.querySelector(".prw-card")
      ?.getBoundingClientRect();
    if (cr && left + W > cr.left - 8) left = Math.max(M, cr.left - W - 16);
  }
  return { left: Math.max(M, left), top: Math.max(M, top) };
}

export function ChatWindow(): JSX.Element | null {
  useSyncExternalStore(subscribe, getSnapshot);
  const sess = chatStore.active();
  if (!sess) return null;
  return <Window key={sess.key} sess={sess} />;
}

function Window({ sess }: { sess: ChatSession }): JSX.Element {
  const winRef = useRef<HTMLDivElement>(null);
  const threadRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const bannerRef = useRef<HTMLDetailsElement>(null);
  const [busy, setBusy] = useState<Busy | null>(null);
  const [err, setErr] = useState<(Busy & { message: string }) | null>(null);
  const [streamIdx, setStreamIdx] = useState<number | null>(null);
  const [entered, setEntered] = useState(false);
  // ChatWindow subscribes to the store, so every live-stream touch() re-renders us.
  const liveRaw = chatStore.live();
  const liveAsk = liveRaw && liveRaw.key === sess.key ? liveRaw : null;
  const initial = useMemo(() => computeInitialPos(sess), [sess.key]);

  // slide-in: add the class one tick after mount so the CSS transition runs
  useEffect(() => {
    const t = setTimeout(() => setEntered(true), 0);
    return () => clearTimeout(t);
  }, []);

  // the step-context banner closes on any click outside it (shadow-safe)
  useEffect(() => {
    const away = (e: MouseEvent) => {
      const b = bannerRef.current;
      if (b?.open && !e.composedPath().includes(b)) b.open = false;
    };
    document.addEventListener("mousedown", away, true);
    return () => document.removeEventListener("mousedown", away, true);
  }, []);

  // keep the newest message in view
  useEffect(() => {
    const t = threadRef.current;
    if (t) t.scrollTop = t.scrollHeight;
  });

  const send = (question: string, opts: { pushUser?: boolean; replaceIdx?: number } = {}) => {
    setErr(null);
    setBusy({ question, replaceIdx: opts.replaceIdx });
    void chatStore.send(sess.key, question, opts).then((r) => {
      setBusy(null);
      if (r.ok) {
        const latest = chatStore.active();
        // already watched the text stream in → no cosmetic typewriter replay
        setStreamIdx(r.streamed ? null : (opts.replaceIdx ?? (latest ? latest.messages.length - 1 : null)));
      } else {
        setErr({ question, replaceIdx: opts.replaceIdx, message: r.error });
      }
    });
  };

  // A trailing user turn means the answer never arrived (the page was refreshed
  // mid-request) — show the typing dots and re-issue it so the answer lands.
  useEffect(() => {
    const tail = sess.messages[sess.messages.length - 1];
    if (tail && tail.role === "user") send(tail.content, { pushUser: false });
    // once, when this window opens
  }, []);

  // suggestions prefetch (selection chats only; the PR chat has none)
  useEffect(() => {
    if (!sess.general) void chatStore.ensureSuggestions(sess.key);
  }, []);

  const onHeadDown = useDrag(winRef, {
    ignore: "button, select, input, textarea",
    onEnd: (pos) => chatStore.setPos(sess.key, pos),
  });
  useResizePersist(winRef, (size) => chatStore.setSize(sess.key, size));

  const ask = (q: string) => send(q);
  const lineLabel = sess.lines
    ? `:${sess.lines.start}${sess.lines.end !== sess.lines.start ? "-" + sess.lines.end : ""}`
    : "";
  const fileLabel = sess.general ? "This PR" : (sess.file ?? "").split("/").pop() + lineLabel;
  const fileTitle = sess.general ? "Ask about the whole PR" : (sess.file ?? "") + lineLabel;

  const submit = () => {
    const input = inputRef.current;
    const q = input?.value.trim();
    if (!input || !q) return;
    input.value = "";
    autosize(input);
    ask(q);
  };

  return (
    <div
      ref={winRef}
      className={"prw-chat" + (entered ? " prw-in" : "")}
      style={{
        left: initial.left,
        top: initial.top,
        ...(sess.size ? { width: sess.size.w, height: sess.size.h } : null),
      }}
    >
      <div className="prw-chat-head" onMouseDown={onHeadDown}>
        <span className="prw-chat-title">ASK</span>
        {/* textContent/title, never markup — the path comes from GitHub's DOM */}
        <span className="prw-chat-file" data-prw-tip={fileTitle}>
          {fileLabel}
        </span>
        <button
          className="prw-x"
          aria-label="Collapse to Chats list"
          data-prw-tip="Collapse to Chats list"
          onClick={() => {
            const el = winRef.current!; // the window is mounted — its button was just clicked
            const r = el.getBoundingClientRect();
            chatStore.minimize({
              pos: { left: r.left, top: r.top },
              size: { w: el.offsetWidth, h: el.offsetHeight },
            });
          }}
        >
          –
        </button>
        <button
          className="prw-x"
          aria-label="Close and delete"
          data-prw-tip="Close (delete) this chat"
          onClick={() => chatStore.deleteActive()}
        >
          ×
        </button>
      </div>
      {sess.step && (
        <details ref={bannerRef} className="prw-ctxbanner">
          <summary className="prw-ctxbanner-h">ⓘ Includes this step’s context</summary>
          <div className="prw-ctxbanner-b">{sess.step}</div>
        </details>
      )}
      <div className="prw-options">
        <div className="prw-quick">
          {(sess.general ? QUICK_PR : QUICK).map((a) => (
            <button key={a.label} className="prw-chip" onClick={() => ask(a.q)}>
              {a.label}
            </button>
          ))}
        </div>
        <div className={"prw-ai" + (sess.general || sess.suggestions?.length === 0 ? "" : " prw-has")}>
          {!sess.general &&
            (sess.suggestions
              ? sess.suggestions.slice(0, 3).map((q) => <OptionRow key={q} label={q} onAsk={() => ask(q)} />)
              : [0, 1, 2].map((i) => <div key={i} className="prw-srow prw-skel" />))}
        </div>
      </div>
      <div className="prw-thread" ref={threadRef}>
        {sess.messages.map((m, i) => (
          <Message
            key={i}
            sess={sess}
            msg={m}
            index={i}
            streaming={streamIdx === i}
            onStreamed={() => setStreamIdx(null)}
            onRegenerate={(mi) => {
              const q = sess.messages[mi - 1]?.content;
              if (q && mi >= 1) send(q, { replaceIdx: mi });
            }}
          />
        ))}
        {busy && (
          <div className="prw-msg prw-msg-bot">
            {liveAsk?.note && <div className="prw-live-note">⚙ {liveAsk.note}</div>}
            {liveAsk?.text && (
              <span className="prw-live-text">
                <Markdown text={closeFences(liveAsk.text)} />
              </span>
            )}
            {/* the dots stay up while the stream is open — partial text above is not the end */}
            <span className="prw-typing">
              <i></i>
              <i></i>
              <i></i>
            </span>
          </div>
        )}
        {err && (
          <div className="prw-msg prw-msg-bot prw-msg-note">
            <span>
              ⚠ {err.message}{" "}
              <button
                className="prw-note-retry"
                onClick={() => send(err.question, { pushUser: false, replaceIdx: err.replaceIdx })}
              >
                Retry
              </button>
            </span>
          </div>
        )}
      </div>
      <div className="prw-chat-foot">
        <textarea
          ref={inputRef}
          className="prw-input prw-chat-input"
          rows={1}
          placeholder="Ask…  (Enter to send · ⌘/Ctrl+Enter for a new line)"
          onInput={(e) => autosize(e.currentTarget)}
          onKeyDown={(e) => {
            if (e.key !== "Enter") return;
            // ⌘/Ctrl+Enter inserts a newline at the cursor (a textarea won't on
            // its own); Shift+Enter keeps the native newline; plain Enter sends.
            if (e.metaKey || e.ctrlKey) {
              e.preventDefault();
              const input = e.currentTarget;
              const start = input.selectionStart;
              const end = input.selectionEnd;
              input.value = input.value.slice(0, start) + "\n" + input.value.slice(end);
              input.selectionStart = input.selectionEnd = start + 1;
              autosize(input);
              return;
            }
            if (e.shiftKey) return;
            e.preventDefault();
            submit();
          }}
        />
        <button className="prw-btn prw-btn-primary" onClick={submit}>
          Ask
        </button>
      </div>
    </div>
  );
}

// Grow the textarea with its content up to a cap, then let it scroll.
function autosize(input: HTMLTextAreaElement): void {
  input.style.height = "auto";
  input.style.height = `${Math.min(input.scrollHeight, 160)}px`;
}
