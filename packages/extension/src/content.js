// PR Walkthrough — content script. Renders the Claude-authored walkthrough on a
// GitHub PR and provides the select-code-and-ask modal. All server calls go
// through the background service worker (see background.js) to dodge CORS.
import { escapeHtml, renderMarkdown } from "@prw/runes/markdown";
import {
  filePathFromContainer,
  diffContainerOf,
  lineRangeOf,
  rowsInRange,
  codeForRows,
  rowRect,
} from "./content/midgard/diff";
import { connectMidgard } from "./content/midgard/connect";
import { connectGrip } from "./content/midgard/grip";
import { bifrost } from "./content/bifrost";
import { api } from "./content/api";
import { state } from "./content/state";
import { initTooltips } from "./content/ui/tooltip";
import { sanitizeSpecHtml } from "./content/sanitize";
import { storeGet, storeSet, storeRemove } from "./content/muninn";

(() => {
  if (window.__prwLoaded) return;
  window.__prwLoaded = true;

  // Midgard listens on the Bifrost before anything sends a command.
  connectMidgard(bifrost);
  connectGrip(bifrost);

  const prUrl = () => {
    const m = location.href.match(/(https:\/\/github\.com\/[^/]+\/[^/]+\/pull\/\d+)/);
    return m ? m[1] : null;
  };
  // GitHub's newer PR UI serves the diff at /changes; older at /files. Accept both.
  const onFilesTab = () => /\/pull\/\d+\/(files|changes)/.test(location.href);

  // ── persistence (per-PR; survives refresh and browser restart) ───────────────
  const chatsKey = (pr) => `prw:chats:${pr || prUrl()}`;
  const specKey = (pr) => `prw:spec:${pr || prUrl()}`;
  const tourKey = (pr) => `prw:tour:${pr || prUrl()}`;
  const genKey = (pr) => `prw:gen:${pr || prUrl()}`;
  const saveChats = () => storeSet(chatsKey(), state.chatHistory);
  const saveTour = () => storeSet(tourKey(), state.tourState);
  async function loadPersisted() {
    const pr = prUrl();
    if (!pr) return;
    const chats = await storeGet(chatsKey(pr));
    if (Array.isArray(chats) && chats.length && state.chatHistory.length === 0) {
      state.chatHistory.push(...chats);
      refreshChatsBtn();
    }
    const t = await storeGet(tourKey(pr));
    if (t) state.tourState = { step: t.step || 0, pos: t.pos || null, size: t.size || null };
  }

  // ── theme + highlight style ──────────────────────────────────────────────────
  const applyTheme = () => bifrost.send("theme:apply", { theme: state.theme, hlStyle: state.hlStyle });

  // Fast tooltips for [data-prw-tip] elements. Init after the re-injection guard
  // above so the document listeners bind exactly once.
  initTooltips();

  // ── tour overlay ─────────────────────────────────────────────────────────────
  let stepIdx = 0;
  let card = null;
  let moved = false; // becomes true once the user drags the card
  let pointerOverFooter = false; // is the cursor over the button row right now?
  let cardRO = null,
    cardROTimer = null; // observe + persist the tour card's size

  function ensureCard() {
    if (card) return;
    card = document.createElement("div");
    card.className = "prw-card";
    document.body.appendChild(card);
    // Track whether the pointer is over the footer (buttons), which decides the
    // resize anchor when the step changes.
    card.addEventListener("mousemove", (e) => {
      pointerOverFooter = !!e.target.closest(".prw-foot");
    });
    card.addEventListener("mouseleave", () => {
      pointerOverFooter = false;
    });
    cardRO = new ResizeObserver(() => {
      if (!card) return;
      state.tourState.size = { w: card.offsetWidth, h: card.offsetHeight };
      clearTimeout(cardROTimer);
      cardROTimer = setTimeout(saveTour, 300);
    });
    cardRO.observe(card);
  }

  function resetCardPos() {
    // Clear inline positioning so the CSS bottom-right corner applies again.
    ["left", "top", "right", "bottom"].forEach((p) => {
      card.style[p] = "";
    });
  }

  function renderCard() {
    const s = state.spec.steps[stepIdx];

    // Resize anchoring. Default behavior pins the bottom (CSS bottom-right when
    // untouched, or — once moved — explicitly when the pointer is over the
    // buttons so they stay under the cursor). Otherwise pin the top and grow down.
    const keepBottom = moved && pointerOverFooter;
    const prevBottom = keepBottom ? card.getBoundingClientRect().bottom : 0;

    card.innerHTML = `
      <div class="prw-head">
        <span class="prw-eyebrow">PR WALKTHROUGH</span>
        <span class="prw-head-actions">
          <button class="prw-x" id="prw-step-ask" aria-label="Ask about this step" data-prw-tip="Ask about this step (sends the step's context)">💬</button>
          <button class="prw-x" id="prw-refresh" aria-label="Re-scroll and redraw" title="Re-scroll &amp; redraw">⟳</button>
          <button class="prw-x" id="prw-x" aria-label="Close">×</button>
        </span>
      </div>
      <div class="prw-body">
        <p class="prw-title">${escapeHtml(s.title)}</p>
        <div class="prw-prose">${sanitizeSpecHtml(s.body)}</div>
        ${s.detail ? `<button class="prw-more" id="prw-more">Show details ▾</button><div class="prw-prose prw-detail" id="prw-detail" hidden>${sanitizeSpecHtml(s.detail)}</div>` : ""}
      </div>
      <div class="prw-foot">
        <button class="prw-btn" id="prw-back">← Back</button>
        <button class="prw-btn prw-btn-primary" id="prw-next">${stepIdx === state.spec.steps.length - 1 ? "Finish ✓" : "Next →"}</button>
        <span class="prw-count">${stepIdx + 1} / ${state.spec.steps.length}</span>
      </div>`;

    card.querySelector("#prw-x").onclick = closeTour;
    card.querySelector("#prw-refresh").onclick = () => gotoStep(); // re-scroll + redraw highlight
    card.querySelector("#prw-step-ask").onclick = () => {
      const sel2 = stepSelection();
      if (!sel2) return;
      const session = startSession(sel2);
      session.step = stepContext(); // chat framed by this step
      openChat(session, sel2.rect);
    };
    const more = card.querySelector("#prw-more");
    if (more)
      more.onclick = () => {
        const d = card.querySelector("#prw-detail");
        const open = d.hidden;
        d.hidden = !open;
        more.textContent = open ? "Hide details ▴" : "Show details ▾";
      };
    const back = card.querySelector("#prw-back");
    back.style.opacity = stepIdx === 0 ? "0.4" : "1";
    back.onclick = () => {
      if (stepIdx > 0) {
        stepIdx--;
        gotoStep();
      }
    };
    card.querySelector("#prw-next").onclick = () => {
      if (stepIdx < state.spec.steps.length - 1) {
        stepIdx++;
        gotoStep();
      } else closeTour();
    };
    makeDraggable(card.querySelector(".prw-head"));

    if (moved && keepBottom) {
      // Keep the bottom edge where it was; content change grows the card upward.
      const h = card.offsetHeight;
      card.style.top = `${prevBottom - h}px`;
      card.style.bottom = "auto";
    }
    // moved && !keepBottom: top stays as-is, so it grows downward (off-page is fine).
    // not moved: CSS bottom-right keeps the bottom pinned, so it grows upward.
  }

  function makeDraggable(handle) {
    if (!handle) return;
    handle.style.cursor = "grab";
    handle.addEventListener("mousedown", (e) => {
      if (e.target.closest(".prw-x")) return;
      e.preventDefault();
      const r = card.getBoundingClientRect();
      const ox = e.clientX - r.left,
        oy = e.clientY - r.top;
      handle.style.cursor = "grabbing";
      const move = (ev) => {
        moved = true;
        card.style.left = `${ev.clientX - ox}px`;
        card.style.top = `${ev.clientY - oy}px`;
        card.style.right = "auto";
        card.style.bottom = "auto";
      };
      const up = () => {
        handle.style.cursor = "grab";
        document.removeEventListener("mousemove", move);
        document.removeEventListener("mouseup", up);
        if (card) {
          const b = card.getBoundingClientRect();
          state.tourState.pos = { left: b.left, top: b.top };
          saveTour();
        }
      };
      document.addEventListener("mousemove", move);
      document.addEventListener("mouseup", up);
    });
  }

  function gotoStep() {
    renderCard(); // update the card text immediately — never gated on rendering
    state.tourState.step = stepIdx; // remember where we are (resume here next open)
    saveTour();
    const s = state.spec.steps[stepIdx];
    state.activeStep = s; // current step → available as chat context
    bifrost.send("grip:context", { hasActiveStep: true });
    bifrost.send("highlight:step", {
      anchor: s.anchor,
      lines: s.lines ?? null,
      highlight: s.highlight ?? null,
    });
  }

  function startTour() {
    if (!onFilesTab()) {
      // Hop to the diff tab and auto-resume once it loads.
      sessionStorage.setItem("prwAutoStart", "1");
      location.href = prUrl() + "/files";
      return;
    }
    ensureCard();
    applyTheme();
    stepIdx = Math.min(Math.max(state.tourState.step || 0, 0), state.spec.steps.length - 1); // resume where you left off
    moved = false;
    resetCardPos();
    if (state.tourState.pos) {
      card.style.left = `${state.tourState.pos.left}px`;
      card.style.top = `${state.tourState.pos.top}px`;
      card.style.right = "auto";
      card.style.bottom = "auto";
      moved = true;
    }
    if (state.tourState.size) {
      card.style.width = `${state.tourState.size.w}px`;
      card.style.height = `${state.tourState.size.h}px`;
    }
    gotoStep();
    document.addEventListener("keydown", tourKeys);
  }

  function tourKeys(e) {
    if (!card) return;
    const meta = e.metaKey || e.ctrlKey; // Cmd on macOS, Ctrl elsewhere
    const next = e.key === "ArrowRight" || (meta && e.key === "End");
    const prev = e.key === "ArrowLeft" || (meta && e.key === "Home");
    if (next && stepIdx < state.spec.steps.length - 1) {
      e.preventDefault();
      stepIdx++;
      gotoStep();
    } else if (prev && stepIdx > 0) {
      e.preventDefault();
      stepIdx--;
      gotoStep();
    } else if (e.key === "Escape") closeTour();
  }

  function closeTour() {
    bifrost.send("highlight:clear", undefined);
    if (cardRO) {
      cardRO.disconnect();
      cardRO = null;
    }
    card?.remove();
    card = null;
    moved = false;
    pointerOverFooter = false;
    state.activeStep = null;
    bifrost.send("grip:context", { hasActiveStep: false });
    document.removeEventListener("keydown", tourKeys);
  }

  // Compact text of the current step — passed to chat so answers are framed by it.
  function stepContext() {
    if (!state.activeStep) return "";
    const strip = (h) =>
      (h || "")
        .replace(/<[^>]+>/g, "")
        .replace(/\s+/g, " ")
        .trim();
    const where = state.activeStep.file
      ? ` (${state.activeStep.file}${state.activeStep.lines ? `:${state.activeStep.lines.start}-${state.activeStep.lines.end}` : ""})`
      : "";
    return `Step: ${state.activeStep.title}${where}\n${strip(state.activeStep.body)}${state.activeStep.detail ? "\n" + strip(state.activeStep.detail) : ""}`;
  }
  // A selection object for the step itself (its code), for "Ask about this step".
  function stepSelection() {
    if (!state.activeStep) return null;
    const container = document.getElementById(state.activeStep.anchor);
    const stepRows =
      container && state.activeStep.lines
        ? rowsInRange(container, state.activeStep.lines.start, state.activeStep.lines.end)
        : [];
    let text = stepRows.length ? codeForRows(stepRows) : "";
    if (!text)
      text =
        (state.activeStep.highlight || []).join("\n") ||
        (state.activeStep.body || "").replace(/<[^>]+>/g, "").slice(0, 1000);
    const rect = stepRows.length ? rowRect(stepRows[0]) : { left: 60, top: 90, bottom: 114, height: 24 };
    return { text, file: state.activeStep.file, container, lines: state.activeStep.lines, rect };
  }

  // ── selection → inline chat ─────────────────────────────────────────────────
  let pill = null;
  let chat = null; // the open chat element (one at a time)
  let activeSession = null; // session backing the open chat
  let chatsBtn = null; // persistent launcher to reopen past chats
  let chatsList = null; // open history popover
  let chatRO = null,
    roTimer = null; // observe + persist the chat's size

  function clearPill() {
    pill?.remove();
    pill = null;
  }

  // A chat session holds everything needed to live on after GitHub offloads the
  // code it came from: the selection text + file:lines, the AI suggestions, and
  // the full transcript. So a chat keeps working even when its diff rows are gone.
  function sessionKey(s) {
    return s.file + "::" + s.text.slice(0, 200);
  }
  function startSession(s) {
    const key = sessionKey(s);
    let sess = state.chatHistory.find((c) => c.key === key);
    if (!sess) {
      sess = { key, file: s.file, lines: s.lines, text: s.text, suggestions: null, messages: [], pos: null };
      state.chatHistory.unshift(sess);
      refreshChatsBtn();
      saveChats();
    }
    return sess;
  }

  // Smart-suggestion prefetch + cache. The model round-trip is slow (it goes
  // through the main session), so we start it on pill hover and reuse the result,
  // overlapping the wait with the user reading the instant quick actions.
  const suggestCache = new Map();
  function prefetchSuggest(s) {
    const key = s.file + "::" + s.text.slice(0, 200);
    if (!suggestCache.has(key)) {
      suggestCache.set(
        key,
        api("/suggest", "POST", { pr: prUrl(), file: s.file, selection: s.text.slice(0, 6000) })
          .then((r) => (r.ok && r.data?.suggestions) || [])
          .catch(() => []),
      );
    }
    return suggestCache.get(key);
  }

  // Capture the current diff selection: text, file path, file container, rect.
  function captureSelection() {
    const sel = window.getSelection();
    const text = sel?.toString().trim();
    if (!text || text.length < 2 || sel.rangeCount === 0) return null;
    const range = sel.getRangeAt(0);
    const container = diffContainerOf(range.startContainer);
    const file = filePathFromContainer(container);
    if (!file) return null;
    return {
      text,
      file,
      container,
      lines: lineRangeOf(container, range),
      rect: range.getBoundingClientRect(),
    };
  }

  document.addEventListener("mouseup", () => {
    setTimeout(() => {
      if (chat) return; // don't fight an open chat
      const s = captureSelection();
      if (!s) {
        clearPill();
        return;
      }
      clearPill();
      pill = document.createElement("button");
      pill.className = "prw-pill";
      pill.textContent = "Ask about this";
      pill.style.top = `${window.scrollY + s.rect.bottom + 6}px`;
      pill.style.left = `${window.scrollX + s.rect.left}px`;
      pill.onmousedown = (e) => {
        e.preventDefault();
        openChat(startSession(s), s.rect);
        clearPill();
      };
      document.body.appendChild(pill);
    }, 10);
  });

  // Cmd/Ctrl+K opens the chat on the current selection (or focuses an open one).
  document.addEventListener("keydown", (e) => {
    const meta = e.metaKey || e.ctrlKey;
    if (meta && (e.key === "k" || e.key === "K")) {
      if (chat) {
        e.preventDefault();
        chat.querySelector(".prw-chat-input")?.focus();
        return;
      }
      const s = captureSelection();
      if (s) {
        e.preventDefault();
        clearPill();
        openChat(startSession(s), s.rect);
      }
    }
  });

  const COPY = '<rect x="9" y="9" width="11" height="11" rx="2"/><path d="M5 15V5a2 2 0 0 1 2-2h10"/>';
  const CHECK = '<path d="M4 12l5 5L20 6"/>';
  const REGEN = '<path d="M21 12a9 9 0 1 1-2.64-6.36"/><path d="M21 3v6h-6"/>';
  const LOCATE = '<circle cx="12" cy="12" r="3"/><path d="M12 2v3M12 19v3M2 12h3M19 12h3"/>';
  const svgIcon = (inner) =>
    `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">${inner}</svg>`;

  // Asgard side of the grip: a completed "ask" arrives as data over the Bifrost.
  bifrost.on("selection:ask", (p) => {
    const session = startSession({ text: p.text, file: p.file, lines: p.lines, rect: p.rect });
    if (p.withStep) session.step = stepContext();
    openChat(session, p.rect);
  });

  // A compact, plain-text version of the cached walkthrough — sent with chat
  // questions so even a freshly-restarted (clean-context) session understands the PR.
  function reviewContext() {
    if (!state.spec) return "";
    const head = state.spec.overview
      ? `Overview: ${state.spec.overview.replace(/\s+/g, " ").trim()}\n\n`
      : "";
    const steps = Array.isArray(state.spec.steps)
      ? state.spec.steps
          .map((st) => {
            const where = st.file
              ? ` (${st.file}${st.lines ? `:${st.lines.start}-${st.lines.end}` : ""})`
              : "";
            const body = (st.body || "")
              .replace(/<[^>]+>/g, "")
              .replace(/\s+/g, " ")
              .trim();
            return `• ${st.title}${where}\n  ${body}`;
          })
          .join("\n")
      : "";
    return (head + steps).slice(0, 12000);
  }

  const QUICK = [
    { label: "Explain", q: "Explain what this code does." },
    {
      label: "Why this approach?",
      q: "Why might it be written this way, and what are the trade-offs vs. alternatives?",
    },
    { label: "Bugs & edge cases", q: "Any bugs, edge cases, or risks in this code?" },
    { label: "How's it tested?", q: "How is this covered by tests, and what's missing?" },
    {
      label: "Draft review comment",
      q: "Draft a concise, constructive GitHub PR review comment about this code.",
    },
  ];

  // Quick prompts for a general (whole-PR) chat — no code selection backing them.
  const QUICK_PR = [
    { label: "Summarize", q: "Summarize this PR — what does it change, and why?" },
    { label: "Main risks", q: "What are the main risks or things to scrutinize when reviewing this PR?" },
    { label: "Where to focus", q: "As a reviewer, which files or changes should I look at first, and why?" },
    { label: "Test coverage", q: "How is this PR tested, and what's missing?" },
  ];

  // Open (or resume) the single general "about this PR" chat — no code selection,
  // grounded by the walkthrough (reviewContext) on the server side.
  function openPrChat() {
    let sess = state.chatHistory.find((c) => c.general);
    if (!sess) {
      sess = {
        key: "__pr__",
        general: true,
        file: null,
        lines: null,
        text: "",
        suggestions: [],
        messages: [],
        pos: null,
      };
      state.chatHistory.unshift(sess);
      refreshChatsBtn();
      saveChats();
    }
    openChat(sess, null);
  }

  // Turn `path.ext:line` / `path.ext:start-end` mentions in an assistant answer into
  // clickable jump-to-code links. Skips fenced code blocks and existing links; a
  // cited file that isn't in the diff just no-ops on click, so misses are harmless.
  const REF_RE = /\b[\w@./-]*\w\.\w{1,8}:\d+(?:-\d+)?\b/;
  function linkifyRefs(root) {
    const nodes = [];
    const walk = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
    while (walk.nextNode()) {
      const node = walk.currentNode;
      if (!node.nodeValue || !REF_RE.test(node.nodeValue)) continue;
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
      const text = node.nodeValue;
      const frag = document.createDocumentFragment();
      // SAFE: REF_RE is a constant regex literal defined above, never user input.
      const re = new RegExp(REF_RE.source, "g");
      let last = 0;
      let m;
      while ((m = re.exec(text))) {
        const full = m[0];
        const colon = full.lastIndexOf(":");
        const file = full.slice(0, colon);
        const [start, end] = full.slice(colon + 1).split("-");
        if (m.index > last) frag.appendChild(document.createTextNode(text.slice(last, m.index)));
        const a = document.createElement("a");
        a.className = "prw-ref";
        a.href = "#";
        a.textContent = full;
        a.dataset.file = file;
        a.dataset.line = start;
        if (end) a.dataset.end = end;
        a.onclick = (e) => {
          e.preventDefault();
          bifrost.send("jump:ref", { file, start: +start, end: end ? +end : null });
        };
        frag.appendChild(a);
        last = m.index + full.length;
      }
      if (last < text.length) frag.appendChild(document.createTextNode(text.slice(last)));
      node.parentNode.replaceChild(frag, node);
    });
  }

  function openChat(session, anchorRect) {
    if (chat) minimizeChat(); // only one open; the current one collapses to the list
    activeSession = session;
    const s = session;
    if (!s.general) bifrost.send("pick:rehighlight", { file: s.file, text: s.text }); // repaint (skip for the general PR chat)
    const lineLabel = s.lines
      ? `:${s.lines.start}${s.lines.end !== s.lines.start ? "-" + s.lines.end : ""}`
      : "";

    chat = document.createElement("div");
    chat.className = "prw-chat";
    chat.innerHTML = `
      <div class="prw-chat-head">
        <span class="prw-chat-title">ASK</span>
        <span class="prw-chat-file"></span>
        <button class="prw-x" id="prw-chat-min" aria-label="Collapse to Chats list" title="Collapse to Chats list">–</button>
        <button class="prw-x" id="prw-chat-x" aria-label="Close and delete" title="Close (delete) this chat">×</button>
      </div>
      <div class="prw-options" id="prw-options"></div>
      <div class="prw-thread" id="prw-thread"></div>
      <div class="prw-chat-foot">
        <textarea class="prw-input prw-chat-input" id="prw-q" rows="1" placeholder="Ask…  (Enter to send · ⌘/Ctrl+Enter for a new line)"></textarea>
        <button class="prw-btn prw-btn-primary" id="prw-send">Ask</button>
      </div>`;
    document.body.appendChild(chat);
    // Set the file label via textContent/title (never innerHTML) — the path comes
    // from GitHub's DOM, so escaping it avoids any markup injection into the panel.
    const fileEl = chat.querySelector(".prw-chat-file");
    fileEl.textContent = s.general ? "This PR" : s.file.split("/").pop() + lineLabel;
    fileEl.title = s.general ? "Ask about the whole PR" : s.file + lineLabel;

    // Position: where you left it last, else below the selection, else a default.
    const W = 420,
      M = 10;
    let left, top;
    if (s.pos) {
      left = s.pos.left;
      top = s.pos.top;
    } else if (anchorRect) {
      left = Math.min(anchorRect.left, window.innerWidth - W - M);
      top = anchorRect.bottom + 8;
      if (top + 360 > window.innerHeight) top = Math.max(M, anchorRect.top - 360 - 8);
    } else {
      left = 40;
      top = 90;
    }
    // Keep clear of the walkthrough card (bottom-right) — slide left of it. Skip
    // if the user already placed this chat themselves (s.pos).
    if (!s.pos) {
      const cr = document.querySelector(".prw-card")?.getBoundingClientRect();
      if (cr && left + W > cr.left - 8) left = Math.max(M, cr.left - W - 16);
    }
    chat.style.left = `${Math.max(M, left)}px`;
    chat.style.top = `${Math.max(M, top)}px`;
    if (s.size) {
      chat.style.width = `${s.size.w}px`;
      chat.style.height = `${s.size.h}px`;
    } // restore resized size
    // Persist size on any resize so it survives a plain refresh (not just close).
    if (chatRO) chatRO.disconnect();
    chatRO = new ResizeObserver(() => {
      if (!chat || !activeSession) return;
      refreshAllRowExpands(); // width changed → re-check which rows need an expand toggle
      activeSession.size = { w: chat.offsetWidth, h: chat.offsetHeight };
      clearTimeout(roTimer);
      roTimer = setTimeout(saveChats, 300);
    });
    chatRO.observe(chat);
    requestAnimationFrame(() => chat.classList.add("prw-in"));

    const thread = chat.querySelector("#prw-thread");
    const options = chat.querySelector("#prw-options");
    const input = chat.querySelector("#prw-q");

    chat.querySelector("#prw-chat-x").onclick = deleteChat;
    chat.querySelector("#prw-chat-min").onclick = minimizeChat;
    makeDraggable2(chat.querySelector(".prw-chat-head"), chat);

    // If this chat carries step context, show a collapsible banner so it's clear
    // (and inspectable) that extra info is being injected.
    if (session.step) {
      // Native <details> handles open/close (and the ▾/▴ via CSS); JS only adds
      // click-away-to-close. Self-removes once this chat is detached.
      const cb = document.createElement("details");
      cb.className = "prw-ctxbanner";
      cb.innerHTML =
        '<summary class="prw-ctxbanner-h">ⓘ Includes this step’s context</summary><div class="prw-ctxbanner-b"></div>';
      cb.querySelector(".prw-ctxbanner-b").textContent = session.step;
      const awayClose = (e) => {
        if (!cb.isConnected) {
          document.removeEventListener("mousedown", awayClose, true);
          return;
        }
        if (cb.open && !cb.contains(e.target)) cb.open = false;
      };
      document.addEventListener("mousedown", awayClose, true);
      chat.querySelector(".prw-chat-head").after(cb);
    }

    // One unified style: every option — fixed action or AI suggestion — is a row
    // with selectable text and a → button. Only the button sends, so the text
    // stays selectable/copyable.
    const ARROW =
      '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M5 12h14M13 6l6 6-6 6"/></svg>';
    const CHEVRON =
      '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M6 9l6 6 6-6"/></svg>';
    function addRow(parent, label, q) {
      const row = document.createElement("div");
      row.className = "prw-srow";
      const text = document.createElement("span");
      text.className = "prw-srow-text";
      text.textContent = label;
      text.title = label;
      const btn = document.createElement("button");
      btn.className = "prw-srow-ask";
      btn.title = "Ask this";
      btn.setAttribute("aria-label", "Ask this question");
      btn.innerHTML = ARROW;
      btn.onclick = () => ask(q);
      row.append(text, btn);
      parent.appendChild(row);
      refreshRowExpand(row); // add the expand toggle if the text is clipped at this width
    }
    // Add/remove a row's "expand" toggle based on whether its text is currently
    // clipped. Re-run on resize so shrinking the window still lets you expand.
    function refreshRowExpand(row) {
      if (row.classList.contains("prw-srow-open")) return; // keep the toggle while open
      const text = row.querySelector(".prw-srow-text");
      if (!text) return;
      const clipped = text.scrollWidth > text.clientWidth + 4;
      let exp = row.querySelector(".prw-srow-exp");
      if (clipped && !exp) {
        exp = document.createElement("button");
        exp.className = "prw-srow-exp";
        exp.title = "Show full text";
        exp.setAttribute("aria-label", "Show full text");
        exp.innerHTML = CHEVRON;
        exp.onclick = () => {
          const open = row.classList.toggle("prw-srow-open");
          exp.title = open ? "Collapse" : "Show full text";
        };
        row.insertBefore(exp, row.querySelector(".prw-srow-ask"));
      } else if (!clipped && exp) {
        exp.remove();
      }
    }
    function refreshAllRowExpands() {
      chat?.querySelectorAll(".prw-srow:not(.prw-skel)").forEach(refreshRowExpand);
    }
    // Fixed actions are short labels — compact wrapping chips (whole chip asks).
    const quickWrap = document.createElement("div");
    quickWrap.className = "prw-quick";
    options.appendChild(quickWrap);
    (s.general ? QUICK_PR : QUICK).forEach((a) => {
      const b = document.createElement("button");
      b.className = "prw-chip";
      b.textContent = a.label;
      b.onclick = () => ask(a.q);
      quickWrap.appendChild(b);
    });
    // AI suggestions are long — selectable rows (below, in the list style).
    const ai = document.createElement("div");
    ai.className = "prw-ai";
    options.appendChild(ai);

    function addMsg(role, text) {
      const m = document.createElement("div");
      m.className = `prw-msg prw-msg-${role === "user" ? "user" : "bot"}`;
      const body = document.createElement("span");
      if (role === "user") {
        body.textContent = text;
      } else if (text) {
        setBotHtml(body, text); // render markdown (code blocks, inline code, bold)
      }
      m.appendChild(body);
      if (role !== "user") {
        const act = document.createElement("div");
        act.className = "prw-msg-actions";
        const iconBtn = (icon, tip, onClick) => {
          const b = document.createElement("button");
          b.className = "prw-iconbtn";
          b.setAttribute("data-prw-tip", tip);
          b.setAttribute("aria-label", tip);
          b.innerHTML = svgIcon(icon);
          b.onclick = onClick;
          act.appendChild(b);
          return b;
        };
        // Re-ask this question and replace the answer in place.
        iconBtn(REGEN, "Regenerate answer", () => regenerate(m));
        // Jump to the code this answer cites. With several citations, each click
        // advances to the next (the inline links jump to a specific one directly).
        // No citations → fall back to the chat's origin selection.
        iconBtn(LOCATE, "Jump to the cited code", () => {
          const refs = m.querySelectorAll(".prw-ref");
          if (refs.length) {
            const i = (Number(m.dataset.refI) || 0) % refs.length;
            m.dataset.refI = String(i + 1);
            const a = refs[i];
            bifrost.send("jump:ref", {
              file: a.dataset.file,
              start: +a.dataset.line,
              end: a.dataset.end ? +a.dataset.end : null,
            });
          } else if (!session.general) {
            jumpToSelection();
          }
        });
        // Copy the whole message (with a check-mark confirmation).
        const copy = iconBtn(COPY, "Copy message", () => {
          navigator.clipboard?.writeText(body.dataset.raw ?? body.textContent);
          flashOk(copy);
        });
        m.appendChild(act);
      }
      thread.appendChild(m);
      thread.scrollTop = thread.scrollHeight;
      return m.querySelector("span");
    }
    function flashOk(btn) {
      const prev = btn.innerHTML;
      btn.innerHTML = svgIcon(CHECK);
      btn.classList.add("prw-ok");
      clearTimeout(btn._okT);
      btn._okT = setTimeout(() => {
        btn.innerHTML = prev;
        btn.classList.remove("prw-ok");
      }, 1200);
    }
    // Render an assistant message as formatted HTML and stash the raw text (for copy).
    // Each code block gets its own corner copy button, so multi-block answers are
    // unambiguous — you copy exactly the block you want.
    function setBotHtml(el, text) {
      el.dataset.raw = text;
      el.classList.add("prw-md");
      el.innerHTML = renderMarkdown(text);
      el.querySelectorAll("pre.prw-code").forEach((pre) => {
        const code = pre.querySelector("code");
        if (!code) return;
        const b = document.createElement("button");
        b.className = "prw-iconbtn prw-code-copy";
        b.setAttribute("data-prw-tip", "Copy code");
        b.setAttribute("aria-label", "Copy code");
        b.innerHTML = svgIcon(COPY);
        b.onclick = () => {
          navigator.clipboard?.writeText(code.textContent);
          flashOk(b);
        };
        pre.appendChild(b);
      });
      linkifyRefs(el); // make any path:line citations clickable jump-to-code links
    }

    // Cosmetic streaming: reveal progressively. True token streaming needs the
    // fast-model path; the channel returns the whole answer at once.
    function typeInto(el, text) {
      let i = 0;
      const step = Math.max(2, Math.round(text.length / 120));
      const tick = () => {
        i = Math.min(text.length, i + step);
        el.textContent = text.slice(0, i);
        thread.scrollTop = thread.scrollHeight;
        if (i < text.length) setTimeout(tick, 12);
        else setBotHtml(el, text); // done streaming → render formatted markdown
      };
      tick();
    }

    function friendlyError(r) {
      const e = (r.data && r.data.error) || r.error || "";
      if (/timed out/i.test(e))
        return "No response yet — the session may be busy or paused in your terminal.";
      if (/refresh the page/i.test(e)) return "Extension was reloaded — refresh the page, then retry.";
      if (/fetch|reach|no response|network/i.test(e))
        return "Can't reach the channel — is your Claude session running?";
      return e ? `Something went wrong: ${e}` : "No answer came back.";
    }
    // Run the request into an existing assistant bubble. On failure, render a
    // clean notice with a Retry (no bogus message is stored, so retry is clean).
    // replaceIdx set → overwrite that assistant turn in place (regenerate); else push.
    async function sendInto(question, botEl, replaceIdx) {
      const bubble = botEl.closest(".prw-msg");
      const actions = bubble?.querySelector(".prw-msg-actions");
      bubble?.classList.remove("prw-msg-note");
      if (actions) actions.style.display = "none";
      botEl.innerHTML = '<span class="prw-typing"><i></i><i></i><i></i></span>';
      const history =
        typeof replaceIdx === "number"
          ? session.messages.slice(0, replaceIdx - 1)
          : session.messages.slice(0, -1);
      const r = await api("/ask", "POST", {
        pr: prUrl(),
        file: s.file,
        lines: s.lines,
        selection: s.text.slice(0, 6000),
        question,
        review: reviewContext(), // distilled PR understanding, so a fresh session is grounded
        step: session.step, // present when the chat was opened from / scoped to a walkthrough step
        messages: history,
      });
      if (r.ok && r.data?.answer) {
        botEl.textContent = "";
        if (actions) actions.style.display = "";
        typeInto(botEl, r.data.answer);
        if (typeof replaceIdx === "number") {
          session.messages[replaceIdx] = { role: "assistant", content: r.data.answer };
        } else {
          session.messages.push({ role: "assistant", content: r.data.answer });
          if (bubble) bubble.dataset.mi = String(session.messages.length - 1);
        }
        refreshChatsBtn();
        saveChats();
      } else {
        bubble?.classList.add("prw-msg-note");
        botEl.textContent = "⚠ " + friendlyError(r) + "  ";
        const retry = document.createElement("button");
        retry.className = "prw-note-retry";
        retry.textContent = "Retry";
        retry.onclick = () => sendInto(question, botEl, replaceIdx);
        botEl.appendChild(retry);
      }
    }
    // Re-ask the question that produced this answer and overwrite it in place.
    function regenerate(msgEl) {
      const mi = Number(msgEl.dataset.mi);
      if (!Number.isInteger(mi) || mi < 1) return;
      const q = session.messages[mi - 1]?.content;
      if (q) sendInto(q, msgEl.querySelector("span"), mi);
    }
    // Scroll the diff to the lines this chat is about and re-paint the highlight.
    function jumpToSelection() {
      bifrost.send("pick:rehighlight", { file: s.file, text: s.text, scroll: true });
    }
    function ask(question) {
      addMsg("user", question);
      session.messages.push({ role: "user", content: question });
      saveChats();
      sendInto(question, addMsg("assistant", ""));
    }

    // Replay any existing transcript (reopened chat); tag assistant turns with their index.
    session.messages.forEach((m, i) => {
      const span = addMsg(m.role, m.content);
      if (m.role !== "user") span.closest(".prw-msg").dataset.mi = String(i);
    });
    // A trailing user turn means the answer never arrived (the page was refreshed
    // mid-request, dropping the in-flight fetch). Show the typing dots and re-issue
    // it so the answer still lands instead of silently vanishing.
    const pendingTurn = session.messages[session.messages.length - 1];
    if (pendingTurn && pendingTurn.role === "user") {
      sendInto(pendingTurn.content, addMsg("assistant", ""));
    }

    // Grow the textarea with its content up to a cap, then let it scroll.
    function autosize() {
      input.style.height = "auto";
      input.style.height = `${Math.min(input.scrollHeight, 160)}px`;
    }
    function submit() {
      const q = input.value.trim();
      if (!q) return;
      input.value = "";
      autosize();
      ask(q);
    }
    chat.querySelector("#prw-send").onclick = submit;
    input.addEventListener("input", autosize);
    input.addEventListener("keydown", (e) => {
      if (e.key !== "Enter") return;
      // ⌘/Ctrl+Enter inserts a newline at the cursor (a textarea won't on its own);
      // Shift+Enter keeps the browser's native newline; plain Enter sends.
      if (e.metaKey || e.ctrlKey) {
        e.preventDefault();
        const start = input.selectionStart;
        const end = input.selectionEnd;
        input.value = input.value.slice(0, start) + "\n" + input.value.slice(end);
        input.selectionStart = input.selectionEnd = start + 1;
        autosize();
        return;
      }
      if (e.shiftKey) return;
      e.preventDefault();
      submit();
    });
    autosize();
    input.focus();

    // AI suggestions append below the fixed actions, in the same row style, with
    // a subtle divider. They vanish cleanly if none come back (no empty band).
    function renderSuggestions(list) {
      ai.innerHTML = "";
      ai.classList.toggle("prw-has", list.length > 0);
      list.slice(0, 3).forEach((q) => addRow(ai, q, q));
    }
    if (s.general) {
      renderSuggestions([]); // a whole-PR chat has no per-selection AI suggestions
    } else if (session.suggestions) {
      renderSuggestions(session.suggestions);
    } else {
      ai.classList.add("prw-has");
      for (let i = 0; i < 3; i++) {
        const sk = document.createElement("div");
        sk.className = "prw-srow prw-skel";
        ai.appendChild(sk);
      }
      prefetchSuggest(s).then((list) => {
        session.suggestions = list;
        saveChats();
        if (chat && activeSession === session) renderSuggestions(list);
      });
    }
  }

  // Detach the chat window (shared by collapse and delete).
  function detachChat() {
    if (chatRO) {
      chatRO.disconnect();
      chatRO = null;
    }
    const c = chat;
    chat = null;
    activeSession = null;
    c.classList.remove("prw-in");
    setTimeout(() => c.remove(), 160);
  }

  // Collapse → hide the window but keep the chat in the Chats list to reopen.
  function minimizeChat() {
    if (!chat) return;
    bifrost.send("pick:clear", undefined);
    if (activeSession) {
      const r = chat.getBoundingClientRect();
      activeSession.pos = { left: r.left, top: r.top };
      activeSession.size = { w: chat.offsetWidth, h: chat.offsetHeight };
      saveChats();
    }
    detachChat();
    refreshChatsBtn();
  }

  // Close → remove the chat for good (window + history + storage).
  function deleteChat() {
    if (!chat) return;
    bifrost.send("pick:clear", undefined);
    const sess = activeSession;
    detachChat();
    dropSession(sess);
  }

  // Remove a session from history + storage, updating the launcher/list.
  function dropSession(sess) {
    const i = state.chatHistory.indexOf(sess);
    if (i >= 0) state.chatHistory.splice(i, 1);
    saveChats();
    if (!state.chatHistory.length) {
      chatsBtn?.remove();
      chatsBtn = null;
      chatsList?.remove();
      chatsList = null;
    } else {
      refreshChatsBtn();
    }
  }

  // ── reopen past chats ────────────────────────────────────────────────────────
  function chatSnippet(sess) {
    const base = sess.general
      ? "This PR"
      : sess.file.split("/").pop() + (sess.lines ? `:${sess.lines.start}` : "");
    const firstQ = sess.messages.find((m) => m.role === "user");
    const tail = firstQ ? firstQ.content : sess.general ? "" : sess.text.replace(/\s+/g, " ").slice(0, 40);
    return tail ? `${base} — ${tail}` : base;
  }
  function refreshChatsBtn() {
    if (!state.chatHistory.length) return;
    if (!chatsBtn) {
      chatsBtn = document.createElement("button");
      chatsBtn.className = "prw-pill prw-chats-btn";
      chatsBtn.onclick = toggleChatsList;
      document.body.appendChild(chatsBtn);
    }
    chatsBtn.textContent = `Chats (${state.chatHistory.length})`;
  }
  function toggleChatsList() {
    if (chatsList) {
      chatsList.remove();
      chatsList = null;
      return;
    }
    chatsList = document.createElement("div");
    chatsList.className = "prw-chats-list";
    state.chatHistory.forEach((sess) => {
      const row = document.createElement("div");
      row.className = "prw-chats-item-row";
      const open = document.createElement("button");
      open.className = "prw-chats-item";
      open.textContent = chatSnippet(sess);
      open.title = chatSnippet(sess);
      open.onclick = () => {
        chatsList.remove();
        chatsList = null;
        openChat(sess, null);
      };
      const del = document.createElement("button");
      del.className = "prw-chats-del";
      del.textContent = "×";
      del.title = "Delete this chat";
      del.onclick = (e) => {
        e.stopPropagation();
        if (activeSession === sess && chat) detachChat(); // if it's the open one, drop the window
        dropSession(sess);
        row.remove();
      };
      row.append(open, del);
      chatsList.appendChild(row);
    });
    const clear = document.createElement("button");
    clear.className = "prw-chats-clear";
    clear.textContent = "Clear all chats";
    clear.onclick = () => {
      state.chatHistory.length = 0;
      saveChats();
      chatsList?.remove();
      chatsList = null;
      chatsBtn?.remove();
      chatsBtn = null;
    };
    chatsList.appendChild(clear);
    document.body.appendChild(chatsList);
  }

  // Standalone draggable for the chat (the tour card uses its own makeDraggable).
  function makeDraggable2(handle, el) {
    if (!handle) return;
    handle.addEventListener("mousedown", (e) => {
      if (e.target.closest("button, select, input")) return;
      e.preventDefault();
      document.body.classList.add("prw-noselect"); // don't let the drag trigger GitHub's text selection
      window.getSelection?.()?.removeAllRanges?.();
      const r = el.getBoundingClientRect();
      const ox = e.clientX - r.left,
        oy = e.clientY - r.top;
      const move = (ev) => {
        ev.preventDefault();
        el.style.left = `${ev.clientX - ox}px`;
        el.style.top = `${ev.clientY - oy}px`;
      };
      const up = () => {
        document.removeEventListener("mousemove", move);
        document.removeEventListener("mouseup", up);
        document.body.classList.remove("prw-noselect");
        if (activeSession && el === chat) {
          const b = el.getBoundingClientRect();
          activeSession.pos = { left: b.left, top: b.top };
          saveChats();
        }
      };
      document.addEventListener("mousemove", move);
      document.addEventListener("mouseup", up);
    });
  }

  // ── launcher block (Run / Open / Regenerate) ─────────────────────────────────
  let generating = false,
    newCommits = false,
    curHead = null,
    genPoll = null,
    genStartAt = 0,
    genClock = null;

  function ensureLauncher() {
    let block = document.getElementById("prw-launch");
    if (!block) {
      block = document.createElement("div");
      block.id = "prw-launch";
      block.className = "prw-launch";
      document.body.appendChild(block);
    }
    return block;
  }
  function renderLauncher(pr) {
    const block = ensureLauncher();
    block.innerHTML = "";
    // The status timer (below) ticks via genClock; this rebuild drops its element,
    // so always stop the old interval and let the generating branch restart it.
    clearInterval(genClock);
    genClock = null;
    const addBtn = (label, cls, onclick) => {
      const b = document.createElement("button");
      b.className = "prw-pill" + (cls ? " " + cls : "");
      b.textContent = label;
      b.onclick = onclick;
      block.appendChild(b);
    };
    if (generating) {
      const s = document.createElement("div");
      s.className = "prw-launch-status";
      const label = document.createElement("span");
      label.textContent = "⏳ Generating review… ";
      const time = document.createElement("span");
      time.className = "prw-gen-time";
      const tickClock = () => {
        time.textContent = genStartAt ? fmtElapsed(Date.now() - genStartAt) : "0:00";
      };
      tickClock();
      genClock = setInterval(tickClock, 1000);
      const note = document.createElement("span");
      note.className = "prw-gen-note";
      note.textContent = " · runs in your session, blocks chat ";
      const dis = document.createElement("button");
      dis.className = "prw-dismiss";
      dis.textContent = "dismiss";
      dis.title = "Stop watching — generation keeps running in your session; reopen later";
      let armed = false,
        t = null;
      dis.onclick = (e) => {
        e.stopPropagation();
        if (!armed) {
          // first click arms; reverts after a few seconds
          armed = true;
          dis.textContent = "click again to confirm";
          dis.classList.add("prw-dismiss-armed");
          t = setTimeout(() => {
            armed = false;
            dis.textContent = "dismiss";
            dis.classList.remove("prw-dismiss-armed");
          }, 3000);
          return;
        }
        clearTimeout(t);
        clearInterval(genPoll);
        genPoll = null;
        storeRemove(genKey(pr));
        generating = false;
        renderLauncher(pr);
      };
      s.append(label, time, note, dis);
      block.appendChild(s);
      return;
    }
    if (state.spec) {
      addBtn(`▶ Open review (${state.spec.steps.length})`, "", () => startTour());
      addBtn("💬 Ask about PR", "prw-ghost", () => openPrChat());
      // Regenerate is always available; emphasized when there are new commits.
      addBtn(newCommits ? "⟳ Update" : "⟳ Regenerate", "prw-ghost" + (newCommits ? " prw-attn" : ""), () =>
        openRegenDialog(pr),
      );
    } else {
      addBtn("▶ Run review", "", () => requestGenerate(pr, "new"));
    }
  }

  // Content signature — changes on any republish (timestamp, step count, or size),
  // so completion detection doesn't depend on the model bumping generatedAt.
  const specSig = (s) => (s ? `${s.generatedAt}|${(s.steps || []).length}|${JSON.stringify(s).length}` : "");

  // How long to keep watching for a generated spec before giving up. Generation
  // runs in your Claude session and a large PR can take many minutes, so the stop
  // is generous; it only stops the client watching — the session keeps going and a
  // page refresh resumes the poll. (GEN_MAX_TRIES * GEN_POLL_INTERVAL_MS = ~20 min.)
  const GEN_POLL_INTERVAL_MS = 3000;
  const GEN_MAX_TRIES = 400;
  // m:ss elapsed, for the "Generating…" status timer.
  const fmtElapsed = (ms) => {
    const sec = Math.max(0, Math.floor(ms / 1000));
    return `${Math.floor(sec / 60)}:${String(sec % 60).padStart(2, "0")}`;
  };

  // Poll until a spec different from prevSig lands. Shared by a fresh request and
  // by resuming after a page refresh.
  function pollForSpec(pr, prevSig) {
    let tries = 0;
    clearInterval(genPoll);
    genPoll = setInterval(async () => {
      tries++;
      const r = await api(`/walkthrough?pr=${encodeURIComponent(pr)}`);
      const got = r.ok && r.data && r.data.version === 1 ? r.data : null;
      if (got && specSig(got) !== prevSig) {
        clearInterval(genPoll);
        genPoll = null;
        state.spec = got;
        storeSet(specKey(pr), got);
        storeRemove(genKey(pr));
        state.tourState = { ...state.tourState, step: 0 };
        saveTour(); // new review → back to the first step, but keep window pos + size
        newCommits = !!(curHead && got.pr?.headSha && got.pr.headSha !== curHead);
        generating = false;
        renderLauncher(pr);
      } else if (tries > GEN_MAX_TRIES) {
        clearInterval(genPoll);
        genPoll = null;
        storeRemove(genKey(pr));
        generating = false;
        renderLauncher(pr);
      }
    }, GEN_POLL_INTERVAL_MS);
  }

  // Ask the session (via the channel) to (re)generate; persist a marker so the
  // "generating" state survives a refresh, then poll for the new spec.
  async function requestGenerate(pr, mode, sinceSha) {
    const prevSig = specSig(state.spec);
    closeTour(); // don't leave a stale walkthrough open while it regenerates
    generating = true;
    genStartAt = Date.now();
    storeSet(genKey(pr), { prevSig, at: genStartAt });
    renderLauncher(pr);
    await api("/generate", "POST", { pr, mode, sinceSha });
    pollForSpec(pr, prevSig);
  }

  function openRegenDialog(pr) {
    const back = document.createElement("div");
    back.className = "prw-dialog-back";
    const close = () => back.remove();
    const box = document.createElement("div");
    box.className = "prw-dialog";
    box.innerHTML =
      `<div class="prw-dialog-title">${newCommits ? "New commits since this review" : "Regenerate this review"}</div>` +
      '<div class="prw-dialog-body">Regenerating runs in your Claude session and blocks chat while it thinks. Choose how:</div>';
    const opt = (label, desc, fn) => {
      const b = document.createElement("button");
      b.className = "prw-dialog-opt";
      b.innerHTML = `<b>${label}</b><span>${desc}</span>`;
      b.onclick = () => {
        close();
        fn();
      };
      box.appendChild(b);
    };
    if (newCommits)
      opt("Incremental update", "Add steps covering only what changed since the last review.", () =>
        requestGenerate(pr, "incremental", state.spec?.pr?.headSha),
      );
    opt("Regenerate as new", "Rebuild the whole walkthrough from scratch.", () => requestGenerate(pr, "new"));
    const cancel = document.createElement("button");
    cancel.className = "prw-dialog-cancel";
    cancel.textContent = "Cancel";
    cancel.onclick = close;
    box.appendChild(cancel);
    back.onclick = (e) => {
      if (e.target === back) close();
    };
    back.appendChild(box);
    document.body.appendChild(back);
  }

  async function refreshLauncher() {
    const pr = prUrl();
    if (!pr) return;
    let data = null;
    const r = await api(`/walkthrough?pr=${encodeURIComponent(pr)}`);
    if (r.ok && r.data && r.data.version === 1) {
      data = r.data;
      storeSet(specKey(pr), data);
    } // cache fresh spec
    else {
      const cached = await storeGet(specKey(pr));
      if (cached && cached.version === 1) data = cached;
    } // fall back to cache
    state.spec = data || null;
    renderLauncher(pr);
    if (state.spec && onFilesTab() && sessionStorage.getItem("prwAutoStart") === "1") {
      sessionStorage.removeItem("prwAutoStart");
      setTimeout(startTour, 900);
    }
    if (!genPoll) {
      // resume a generation that was in flight before a refresh
      const gen = await storeGet(genKey(pr));
      // Resume within the same window the poll watches, so a refresh mid-generation
      // keeps waiting (and the timer keeps counting from the original start).
      const fresh = gen && Date.now() - (gen.at || 0) < GEN_MAX_TRIES * GEN_POLL_INTERVAL_MS;
      if (fresh && (!state.spec || specSig(state.spec) === gen.prevSig)) {
        generating = true;
        genStartAt = gen.at || Date.now();
        renderLauncher(pr);
        pollForSpec(pr, gen.prevSig);
        return;
      }
      if (gen) storeRemove(genKey(pr)); // finished (spec already changed), or stale — drop it
    }
    if (state.spec && !generating) {
      // detect new commits since the reviewed head
      const h = await api(`/head?pr=${encodeURIComponent(pr)}`);
      if (h.ok && h.data?.headSha) {
        curHead = h.data.headSha;
        newCommits = !!state.spec.pr?.headSha && state.spec.pr.headSha !== curHead;
        renderLauncher(pr);
      }
    }
  }

  applyTheme();
  applyTheme();
  loadPersisted();
  refreshLauncher();
  let lastUrl = location.href;
  let curPr = prUrl();
  const poll = setInterval(() => {
    if (!chrome.runtime?.id) {
      clearInterval(poll);
      return;
    } // orphaned after a reload
    if (location.href !== lastUrl) {
      lastUrl = location.href;
      clearPill();
      const pr = prUrl();
      if (pr !== curPr) {
        // switched to a different PR — load that PR's stored state
        curPr = pr;
        state.chatHistory.length = 0;
        chatsBtn?.remove();
        chatsBtn = null;
        chatsList?.remove();
        chatsList = null;
        state.tourState = { step: 0, pos: null, size: null };
        state.spec = null;
        generating = false;
        newCommits = false;
        curHead = null;
        clearInterval(genPoll);
        genPoll = null;
        loadPersisted();
      }
      refreshLauncher();
    }
  }, 1500);
})();
