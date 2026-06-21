// Chat tab — the chat thread, markdown answers with clickable citations,
// per-answer actions, quick prompts + AI suggestions, the autosizing input, and
// the live-stream bubble. The panel hosts it (no window chrome of its own); the
// machine (chat.ts) owns the sessions and the /ask flow.
import { renderMarkdown } from "@kvasir/runes/markdown";
import {
  ArrowRight,
  Check,
  ChevronDown,
  Copy,
  Crosshair,
  MessageSquare,
  Minimize2,
  Plus,
  RotateCw,
  Trash2,
  X,
} from "lucide-react";
import { useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import type { JSX, KeyboardEvent as ReactKeyboardEvent, MouseEvent as ReactMouseEvent } from "react";
import { bifrost } from "../../../bifrost";
import { changedFilePaths } from "../../../midgard/diff";
import { chatStore, QUICK, QUICK_PR } from "../../chat";
import { pairingStore } from "../../pairing";
import { chatSnippet, chatsStore, getSnapshot, subscribe } from "../../store";
import type { ChatMessage, ChatSession } from "../../types";
import { Button } from "../../ui/button";

// React-rendered icons use lucide components (below); these two strings exist only
// for the per-code-block copy button, which is appended to non-React markdown DOM.
const ICON = {
  copy: '<rect x="9" y="9" width="11" height="11" rx="2"/><path d="M5 15V5a2 2 0 0 1 2-2h10"/>',
  check: '<path d="M4 12l5 5L20 6"/>',
};
// Parse a static icon to an <svg> element (DOMParser is inert — no innerHTML sink).
const svgIcon = (inner: string): Element =>
  new DOMParser().parseFromString(
    `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">${inner}</svg>`,
    "image/svg+xml",
  ).documentElement;

// Turn `path.ext:line` / `path.ext:start-end` mentions in an assistant answer into
// clickable jump-to-code links, and bare `dir/file.ext` mentions into jump-to-file
// links when the file is in this PR's diff. Skips fenced code blocks and existing
// links; a cited file:line that isn't in the diff just no-ops on click.
export const REF_RE = /\b[\w@./-]*\w\.\w{1,8}:\d+(?:-\d+)?\b/;
/** A bare path mention: at least one slash, ends in an extension, no :line. */
const FILE_RE = /\b[\w@-][\w@.-]*(?:\/[\w@.-]+)+\.\w{1,8}\b/;

const mkRefLink = (label: string, ref: { file: string; start: number | null; end: number | null }) => {
  const a = document.createElement("a");
  a.className = "kvasir-ref";
  a.href = "#";
  a.textContent = label;
  a.addEventListener("click", (event) => {
    event.preventDefault();
    bifrost.send("jump:ref", ref);
  });
  return a;
};

type Canonicalize = (mention: string) => string | null;

const insidePreOrAnchor = (node: Text, root: HTMLElement): boolean => {
  for (let p = node.parentElement; p && p !== root; p = p.parentElement) {
    if (p.tagName === "PRE" || p.tagName === "A") return true;
  }
  return false;
};

// Text nodes that mention a ref/path and aren't already inside a code block or link.
const collectRefNodes = (root: HTMLElement): Text[] => {
  const nodes: Text[] = [];
  const walk = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  for (let current = walk.nextNode(); current; current = walk.nextNode()) {
    const node = current;
    if (!(node instanceof Text) || !node.nodeValue) continue;
    if (!REF_RE.test(node.nodeValue) && !FILE_RE.test(node.nodeValue)) continue;
    if (!insidePreOrAnchor(node, root)) nodes.push(node);
  }
  return nodes;
};

// A `path:line` match becomes a jump-to-code link; a bare path becomes a jump-to-file
// link only when it names a file in the PR's diff (else it stays plain text).
const linkForMatch = (full: string, canonical: Canonicalize): HTMLAnchorElement | null => {
  if (/:\d+(?:-\d+)?$/.test(full)) {
    const colon = full.lastIndexOf(":");
    const [start = "", end] = full.slice(colon + 1).split("-");
    return mkRefLink(full, { file: full.slice(0, colon), start: +start, end: end ? +end : null });
  }
  const file = canonical(full);
  return file ? mkRefLink(full, { file, start: null, end: null }) : null;
};

const linkifyTextNode = (node: Text, canonical: Canonicalize): void => {
  const text = String(node.nodeValue); // collected nodes all matched a pattern — never null
  const frag = document.createDocumentFragment();
  // SAFE: built from the constant regex literals above, never user input. The
  // :line form is first so the alternation prefers it over the bare path.
  const re = new RegExp(`${REF_RE.source}|${FILE_RE.source}`, "g");
  let last = 0;
  let m;
  while ((m = re.exec(text))) {
    const link = linkForMatch(m[0], canonical);
    if (!link) continue; // a path that isn't in the PR stays plain text
    if (m.index > last) frag.append(document.createTextNode(text.slice(last, m.index)));
    frag.append(link);
    last = m.index + m[0].length;
  }
  if (last === 0) return; // nothing linkable in this node after validation
  if (last < text.length) frag.append(document.createTextNode(text.slice(last)));
  node.parentNode?.replaceChild(frag, node);
};

export function linkifyReferences(root: HTMLElement): void {
  // bare paths only become links when they name a file in the PR's diff —
  // otherwise every npm package or URL fragment would turn into a dead link
  const known = changedFilePaths();
  const canonical: Canonicalize = (mention) =>
    known.find((p) => p === mention || p.endsWith("/" + mention) || mention.endsWith("/" + p)) ?? null;
  for (const node of collectRefNodes(root)) linkifyTextNode(node, canonical);
}

/** A streaming partial can end mid-code-fence; close it so the block renders as
 * code while it grows instead of flashing raw backticks until done. */
export const closeFences = (text: string): string =>
  text.split("```").length % 2 === 0 ? text + "\n```" : text;

/** Rendered assistant markdown: escape-first renderMarkdown HTML, then a ref
 * effect adds per-code-block copy buttons and the citation links. */
function Markdown({ text }: Readonly<{ text: string }>): JSX.Element {
  const ref = useRef<HTMLSpanElement>(null);
  // The {__html} object must be referentially stable: React resets innerHTML
  // whenever the object identity changes, which would wipe the copy buttons and
  // citation links this effect adds on every unrelated re-render (copy flash).
  const html = useMemo(() => ({ __html: renderMarkdown(text) }), [text]);
  useEffect(() => {
    const element = ref.current!; // the span renders unconditionally; references are set before effects
    for (const pre of element.querySelectorAll("pre.kvasir-code")) {
      const code = pre.querySelector("code")!; // renderMarkdown always nests <code> in .kvasir-code
      const b = document.createElement("button");
      b.className = "kvasir-iconbtn kvasir-code-copy";
      b.dataset.kvasirTip = "Copy code";
      b.setAttribute("aria-label", "Copy code");
      b.replaceChildren(svgIcon(ICON.copy));
      b.addEventListener("click", () => {
        void navigator.clipboard?.writeText(String(code.textContent)); // textContent is never null on an element
        b.replaceChildren(svgIcon(ICON.check));
      });
      pre.append(b);
    }
    linkifyReferences(element);
  }, [html]);
  return <span ref={ref} className="kvasir-md" dangerouslySetInnerHTML={html} />;
}

/** Cosmetic streaming: reveal progressively. True token streaming needs the
 * fast-model path; the channel returns the whole answer at once. */
function Typewriter({ text, onDone }: Readonly<{ text: string; onDone: () => void }>): JSX.Element {
  const [shown, setShown] = useState(0);
  // Latest onDone in a ref so the typewriter restarts only on a new `text`, not on
  // every render (the parent passes an inline onDone whose identity changes).
  const onDoneRef = useRef(onDone);
  onDoneRef.current = onDone;
  useEffect(() => {
    const step = Math.max(2, Math.round(text.length / 120));
    const tick = setInterval(() => {
      setShown((index) => {
        const next = Math.min(text.length, index + step);
        if (next >= text.length) {
          clearInterval(tick);
          onDoneRef.current();
        }
        return next;
      });
    }, 12);
    return () => clearInterval(tick);
  }, [text]);
  return <span>{text.slice(0, shown)}</span>;
}

interface Busy {
  question: string;
  // options-bag field: callers pass through a maybe-undefined index, so allow it
  replaceIdx?: number | undefined;
}

function Message({
  sess,
  message,
  index,
  onRegenerate,
  streaming,
  onStreamed,
}: Readonly<{
  sess: ChatSession;
  message: ChatMessage;
  index: number;
  onRegenerate: (mi: number) => void;
  streaming: boolean;
  onStreamed: () => void;
}>): JSX.Element {
  const bodyRef = useRef<HTMLDivElement>(null);
  const refIndex = useRef(0);
  const [copied, setCopied] = useState(false);
  if (message.role === "user") {
    return (
      <div className="kvasir-message kvasir-message-user">
        <span>{message.content}</span>
      </div>
    );
  }
  const locate = () => {
    // bodyRef is on this message's root div — set before any click can land
    const references = bodyRef.current!.querySelectorAll<HTMLAnchorElement>(".kvasir-ref");
    if (references.length > 0) {
      // several citations: each click advances to the next (the inline links
      // jump to a specific one directly)
      const a = references[refIndex.current % references.length];
      refIndex.current++;
      a?.click();
    } else if (!sess.general) {
      bifrost.send("pick:rehighlight", { file: sess.file ?? "", text: sess.text, scroll: true });
    }
  };
  return (
    <div className="kvasir-message kvasir-message-bot" ref={bodyRef}>
      {streaming ? (
        <Typewriter text={message.content} onDone={onStreamed} />
      ) : (
        <Markdown text={message.content} />
      )}
      <div className="kvasir-message-actions">
        <button
          className="kvasir-iconbtn"
          data-kvasir-tip="Regenerate answer"
          aria-label="Regenerate answer"
          onClick={() => onRegenerate(index)}
        >
          <RotateCw />
        </button>
        <button
          className="kvasir-iconbtn"
          data-kvasir-tip="Jump to the cited code"
          aria-label="Jump to the cited code"
          onClick={locate}
        >
          <Crosshair />
        </button>
        <button
          className={"kvasir-iconbtn" + (copied ? " kvasir-ok" : "")}
          data-kvasir-tip="Copy message"
          aria-label="Copy message"
          onClick={() => {
            void navigator.clipboard?.writeText(message.content);
            setCopied(true);
            setTimeout(() => setCopied(false), 1200);
          }}
        >
          {copied ? <Check /> : <Copy />}
        </button>
      </div>
    </div>
  );
}

/** An option row: selectable text + a → button (only the button sends). The
 * expand chevron appears when the text is clipped at the current width. */
function OptionRow({
  label,
  onAsk,
  disabled,
}: Readonly<{
  label: string;
  onAsk: () => void;
  disabled?: boolean;
}>): JSX.Element {
  const textRef = useRef<HTMLSpanElement>(null);
  const [clipped, setClipped] = useState(false);
  const [open, setOpen] = useState(false);
  useEffect(() => {
    const element = textRef.current!; // the span renders unconditionally; references are set before effects
    const check = () => setClipped(element.scrollWidth > element.clientWidth + 4);
    check();
    const ro = new ResizeObserver(check);
    ro.observe(element);
    return () => ro.disconnect();
  }, []);
  return (
    <div className={"kvasir-srow" + (open ? " kvasir-srow-open" : "")}>
      {(clipped || open) && (
        <button
          className="kvasir-srow-exp"
          data-kvasir-tip={open ? "Collapse" : "Show full text"}
          aria-label="Show full text"
          onClick={() => setOpen((o) => !o)}
        >
          <ChevronDown />
        </button>
      )}
      <span ref={textRef} className="kvasir-srow-text" data-kvasir-tip={label}>
        {label}
      </span>
      <button
        className="kvasir-srow-ask"
        data-kvasir-tip="Ask this"
        aria-label="Ask this question"
        disabled={disabled}
        onClick={onAsk}
      >
        <ArrowRight />
      </button>
    </div>
  );
}

/** The chat rail: New chat, the list of open chats (active highlighted, each with
 * a trash), and Clear all. Lets several chats run at once — pick any to view it. */
function ChatRail({ active, width }: Readonly<{ active: string | null; width: number }>): JSX.Element {
  const sessions = chatsStore.sessions();
  return (
    <div className="flex shrink-0 flex-col" style={{ width }}>
      <div className="p-2">
        <Button size="sm" className="w-full" onClick={() => chatStore.newChat()}>
          <Plus /> New chat
        </Button>
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto px-1">
        {sessions.length === 0 ? (
          <p className="px-2 py-1 text-xs text-muted-foreground">No chats yet.</p>
        ) : (
          sessions.map((sess) => (
            <div
              key={sess.key}
              className={
                "group flex items-center rounded-md " +
                (sess.key === active ? "bg-accent" : "hover:bg-accent")
              }
            >
              <button
                className="flex-1 truncate px-2 py-1.5 text-left text-xs"
                title={chatSnippet(sess)}
                onClick={() => chatStore.open(sess)}
              >
                {chatSnippet(sess)}
              </button>
              <Button
                variant="ghost"
                size="icon"
                className="h-6 w-6 shrink-0 text-muted-foreground opacity-0 hover:text-destructive group-hover:opacity-100"
                aria-label="Delete this chat"
                onClick={() => chatStore.deleteSession(sess.key)}
              >
                <Trash2 />
              </Button>
            </div>
          ))
        )}
      </div>
      {sessions.length > 0 && (
        <Button
          variant="ghost"
          size="sm"
          className="m-2 mt-1 hover:border-destructive/40 hover:bg-destructive/10 hover:text-destructive"
          onClick={() => chatsStore.clearSessions()}
        >
          <Trash2 /> Clear all
        </Button>
      )}
    </div>
  );
}

const RAIL_KEY = "kvasir:chatRailW";
const RAIL_MIN = 120;
const RAIL_MAX = 280;
const RAIL_NUDGE: Record<string, number> = { ArrowLeft: -16, ArrowRight: 16 };
const clampRail = (n: number): number => Math.min(RAIL_MAX, Math.max(RAIL_MIN, Math.round(n)));
const initialRail = (): number => {
  const stored = Number(localStorage.getItem(RAIL_KEY));
  return Number.isFinite(stored) && stored > 0 ? clampRail(stored) : 152;
};

export function ChatTab(): JSX.Element {
  useSyncExternalStore(subscribe, getSnapshot);
  const sess = chatStore.active();
  const rowRef = useRef<HTMLDivElement>(null);
  const [railW, setRailW] = useState(initialRail);

  // Drag the divider to resize the rail; persist the final width (a global UI
  // pref, like the theme — localStorage, not the per-PR chrome store).
  const onResize = (event: ReactMouseEvent): void => {
    event.preventDefault();
    const left = rowRef.current!.getBoundingClientRect().left; // the row is mounted — the handle lives in it
    const move = (event: MouseEvent): void => setRailW(clampRail(event.clientX - left));
    const up = (): void => {
      document.removeEventListener("mousemove", move);
      document.removeEventListener("mouseup", up);
      setRailW((w) => {
        localStorage.setItem(RAIL_KEY, String(w));
        return w;
      });
    };
    document.addEventListener("mousemove", move);
    document.addEventListener("mouseup", up);
  };
  // Keyboard equivalent of the drag (WAI-ARIA window-splitter pattern): arrows
  // nudge the rail, persisting like the drag's mouseup does.
  const onResizeKey = (event: ReactKeyboardEvent): void => {
    const delta = RAIL_NUDGE[event.key] ?? 0;
    if (!delta) return;
    event.preventDefault();
    setRailW((w) => {
      const next = clampRail(w + delta);
      localStorage.setItem(RAIL_KEY, String(next));
      return next;
    });
  };

  return (
    <div ref={rowRef} className="flex h-full min-h-0">
      <ChatRail active={sess?.key ?? null} width={railW} />
      {/* Keyboard-operable splitter (WAI-ARIA window-splitter): focusable, arrows resize. The lint maps role="separator" as non-interactive and so rejects the tabIndex + handlers, but that pattern is exactly how an accessible splitter is built. */}
      {/* eslint-disable jsx-a11y/no-noninteractive-element-interactions, jsx-a11y/no-noninteractive-tabindex -- see above */}
      <div
        role="separator"
        aria-orientation="vertical"
        aria-label="Resize chat list"
        aria-valuenow={railW}
        aria-valuemin={RAIL_MIN}
        aria-valuemax={RAIL_MAX}
        tabIndex={0}
        className="w-[5px] shrink-0 cursor-col-resize border-x border-border bg-transparent transition-colors hover:border-primary/40 hover:bg-primary/60 focus-visible:border-primary focus-visible:bg-primary/60 focus-visible:outline-none"
        onMouseDown={onResize}
        onKeyDown={onResizeKey}
      />
      {/* eslint-enable jsx-a11y/no-noninteractive-element-interactions, jsx-a11y/no-noninteractive-tabindex */}
      <div className="flex min-h-0 min-w-0 flex-1 flex-col">
        {sess ? (
          <Thread key={sess.key} sess={sess} />
        ) : (
          <div className="flex flex-1 flex-col items-center justify-center gap-2 p-6 text-center text-sm text-muted-foreground">
            <MessageSquare className="size-6 opacity-50" />
            Pick a chat, start a New chat, or select code in the diff.
          </div>
        )}
      </div>
    </div>
  );
}

function Thread({ sess }: Readonly<{ sess: ChatSession }>): JSX.Element {
  const threadRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const bannerRef = useRef<HTMLDetailsElement>(null);
  const [busy, setBusy] = useState<Busy | null>(null);
  const [error, setError] = useState<(Busy & { message: string }) | null>(null);
  const [streamIndex, setStreamIndex] = useState<number | null>(null);
  const liveRaw = chatStore.live();
  const liveAsk = liveRaw && liveRaw.key === sess.key ? liveRaw : null;
  // Asking hits the bridge; while unpaired those controls are disabled (the panel's
  // PairBanner explains why) so a click can't silently 401 into nothing.
  const blocked = pairingStore.needsPairing();
  // While a send is in flight a second one would clobber the `live` singleton and
  // interleave turns, so gate the input controls on busy too — not just pairing.
  const inputDisabled = blocked || !!busy;

  // the step-context banner closes on any click outside it (shadow-safe)
  useEffect(() => {
    const away = (event: MouseEvent) => {
      const b = bannerRef.current;
      if (b?.open && !event.composedPath().includes(b)) b.open = false;
    };
    document.addEventListener("mousedown", away, true);
    return () => document.removeEventListener("mousedown", away, true);
  }, []);

  // keep the newest message in view
  useEffect(() => {
    const t = threadRef.current;
    if (t) t.scrollTop = t.scrollHeight;
  });

  const send = (question: string, options: { pushUser?: boolean; replaceIdx?: number | undefined } = {}) => {
    setError(null);
    setBusy({ question, replaceIdx: options.replaceIdx });
    void chatStore.send(sess.key, question, options).then((r) => {
      setBusy(null);
      if (r.ok) {
        const latest = chatStore.active();
        const latestIndex = latest ? latest.messages.length - 1 : null;
        // already watched the text stream in → no cosmetic typewriter replay
        setStreamIndex(r.streamed ? null : (options.replaceIdx ?? latestIndex));
      } else {
        setError({ question, replaceIdx: options.replaceIdx, message: r.error });
      }
    });
  };

  // A trailing user turn means the answer never arrived (the page was refreshed
  // mid-request) — re-issue it so the answer lands. Skip while unpaired: it would
  // just 401, and opening a selection chat shouldn't fire a backend call.
  useEffect(() => {
    if (blocked) return;
    const tail = sess.messages.at(-1);
    if (tail && tail.role === "user") send(tail.content, { pushUser: false });
    // eslint-disable-next-line react-hooks/exhaustive-deps -- run once when this chat opens (Thread is keyed by sess.key, so a different chat remounts); re-running on send/messages/blocked would re-fire the request.
  }, []);

  // Suggestions prefetch (selection chats only; the PR chat has none). Runs once
  // paired — re-attempted when pairing flips so a chat opened while unpaired still
  // gets its suggestions afterwards (ensureSuggestions is a no-op once cached).
  useEffect(() => {
    if (!sess.general && !blocked) void chatStore.ensureSuggestions(sess.key);
  }, [blocked, sess.general, sess.key]);

  const ask = (q: string) => send(q);
  const endSuffix = sess.lines && sess.lines.end !== sess.lines.start ? `-${sess.lines.end}` : "";
  const lineLabel = sess.lines ? `:${sess.lines.start}${endSuffix}` : "";
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

  // Suggestion area: the cached AI suggestions, or skeleton shimmer while they
  // load — but nothing once unpaired (no fetch is coming, so don't shimmer forever).
  const suggestionRows = ((): JSX.Element[] | null => {
    if (sess.suggestions)
      return sess.suggestions
        .slice(0, 3)
        .map((q) => <OptionRow key={q} label={q} onAsk={() => ask(q)} disabled={inputDisabled} />);
    if (blocked) return null;
    return [0, 1, 2].map((index) => <div key={index} className="kvasir-srow kvasir-skel" />);
  })();

  return (
    <div className="flex h-full flex-col">
      <div className="flex items-center gap-2 border-b border-border px-3 py-1.5">
        <span className="truncate text-xs font-medium text-muted-foreground" data-kvasir-tip={fileTitle}>
          {fileLabel}
        </span>
        <Button
          variant="ghost"
          size="icon"
          className="ml-auto h-6 w-6 text-muted-foreground"
          aria-label="Collapse chat"
          data-kvasir-tip="Collapse (keep in the list)"
          onClick={() => chatStore.closeActive()}
        >
          <Minimize2 />
        </Button>
        <Button
          variant="ghost"
          size="icon"
          className="h-6 w-6 text-muted-foreground"
          aria-label="Close and delete"
          data-kvasir-tip="Delete this chat"
          onClick={() => chatStore.deleteActive()}
        >
          <X />
        </Button>
      </div>
      {sess.step && (
        <details ref={bannerRef} className="kvasir-ctxbanner">
          <summary className="kvasir-ctxbanner-h">ⓘ Includes this step’s context</summary>
          <div className="kvasir-ctxbanner-b">{sess.step}</div>
        </details>
      )}
      <div className="kvasir-options">
        <div className="kvasir-quick">
          {(sess.general ? QUICK_PR : QUICK).map((a) => (
            <button key={a.label} className="kvasir-chip" disabled={inputDisabled} onClick={() => ask(a.q)}>
              {a.label}
            </button>
          ))}
        </div>
        <div className={"kvasir-ai" + (sess.general || sess.suggestions?.length === 0 ? "" : " kvasir-has")}>
          {!sess.general && suggestionRows}
        </div>
      </div>
      <div className="kvasir-thread" ref={threadRef}>
        {sess.messages.map((m, index) => (
          <Message
            key={index}
            sess={sess}
            message={m}
            index={index}
            streaming={streamIndex === index}
            onStreamed={() => setStreamIndex(null)}
            onRegenerate={(mi) => {
              const q = sess.messages[mi - 1]?.content;
              if (q && mi >= 1) send(q, { replaceIdx: mi });
            }}
          />
        ))}
        {busy && (
          <div className="kvasir-message kvasir-message-bot">
            {liveAsk?.note && <div className="kvasir-live-note">⚙ {liveAsk.note}</div>}
            {liveAsk?.text && (
              <span className="kvasir-live-text">
                <Markdown text={closeFences(liveAsk.text)} />
              </span>
            )}
            {/* the dots stay up while the stream is open — partial text above is not the end */}
            <span className="kvasir-typing">
              <i></i>
              <i></i>
              <i></i>
            </span>
          </div>
        )}
        {error && (
          <div className="kvasir-message kvasir-message-bot kvasir-message-note">
            <span>
              ⚠ {error.message}{" "}
              <button
                className="kvasir-note-retry"
                onClick={() => send(error.question, { pushUser: false, replaceIdx: error.replaceIdx })}
              >
                Retry
              </button>
            </span>
          </div>
        )}
      </div>
      <div className="kvasir-chat-foot">
        <textarea
          ref={inputRef}
          className="kvasir-input kvasir-chat-input"
          rows={1}
          disabled={inputDisabled}
          placeholder={
            blocked ? "Pair the extension to chat…" : "Ask…  (Enter to send · ⌘/Ctrl+Enter for a new line)"
          }
          onInput={(event) => autosize(event.currentTarget)}
          onKeyDown={(event) => {
            if (event.key !== "Enter") return;
            // ⌘/Ctrl+Enter inserts a newline at the cursor (a textarea won't on
            // its own); Shift+Enter keeps the native newline; plain Enter sends.
            if (event.metaKey || event.ctrlKey) {
              event.preventDefault();
              const input = event.currentTarget;
              const start = input.selectionStart;
              const end = input.selectionEnd;
              input.value = input.value.slice(0, start) + "\n" + input.value.slice(end);
              input.selectionStart = input.selectionEnd = start + 1;
              autosize(input);
              return;
            }
            if (event.shiftKey) return;
            event.preventDefault();
            submit();
          }}
        />
        <Button disabled={inputDisabled} onClick={submit}>
          Ask
        </Button>
      </div>
    </div>
  );
}

// Grow the textarea with its content up to a cap, then let it scroll.
function autosize(input: HTMLTextAreaElement): void {
  input.style.height = "auto";
  input.style.height = `${Math.min(input.scrollHeight, 160)}px`;
}
