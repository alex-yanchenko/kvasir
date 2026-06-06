// PR Walkthrough — content script. Renders the Claude-authored walkthrough on a
// GitHub PR and provides the select-code-and-ask modal. All server calls go
// through the background service worker (see background.js) to dodge CORS.
import { escapeHtml, renderMarkdown } from "@prw/shared/markdown";
import {
  filePathFromContainer,
  diffContainerOf,
  lineRangeOf,
  rowForLine,
  rowForText,
  lineOfRow,
  rowsOf,
  cleanLine,
  rowsBetween,
  rowsInRange,
  codeForRows,
  rowRect,
  containerForFile,
  rowBandsOf,
  rowAtY,
} from "./content/github/diff";
import { api } from "./content/api";
import { state } from "./content/state";
import { initTooltips } from "./content/ui/tooltip";
import { sanitizeSpecHtml } from "./content/sanitize";
import { storeGet, storeSet, storeRemove } from "./content/storage";

(() => {
  if (window.__prwLoaded) return;
  window.__prwLoaded = true;

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
  // "auto" is resolved in CSS via @media (prefers-color-scheme); just reflect the
  // raw choice onto the body and let the stylesheet pick the palette.
  const applyTheme = () => {
    document.body.dataset.prwTheme = state.theme;
  };
  const applyHl = () => {
    document.body.dataset.prwHl = state.hlStyle;
  };

  // ── per-step code highlight (data-line-number based; no fragile geometry) ─────
  const clearHL = () =>
    document.querySelectorAll("tr.prw-line").forEach((r) => r.classList.remove("prw-line"));

  // Prefer the spec's exact line range; fall back to substring matches. Robust to
  // GitHub's lazy rendering — unrendered lines resolve to null and are skipped.
  function highlightStep(step) {
    clearHL();
    const cont = document.getElementById(step.anchor);
    if (!cont) return [];
    const rows = [];
    if (step.lines) {
      const { start, end } = step.lines;
      for (let n = start; n <= end; n++) {
        const r = rowForLine(cont, n);
        if (r && !rows.includes(r)) rows.push(r);
      }
    }
    if (!rows.length && Array.isArray(step.highlight)) {
      step.highlight.forEach((t) => {
        const r = rowForText(cont, t);
        if (r && !rows.includes(r)) rows.push(r);
      });
    }
    rows.forEach((r) => r.classList.add("prw-line"));
    return rows;
  }

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
    const cont = document.getElementById(s.anchor);
    if (cont) cont.scrollIntoView({ block: "start" });
    // Highlight as soon as the rows exist. Most files are already rendered, so
    // this lands on the first try (immediate); only a still-lazy-loading file
    // makes us poll, and only until it appears.
    let tries = 0;
    const tryHighlight = () => {
      const rows = highlightStep(s);
      if (rows.length) {
        rows[0].scrollIntoView({ behavior: "smooth", block: "center" });
      } else if (++tries < 20) {
        setTimeout(tryHighlight, 40); // up to ~0.8s, only if the file isn't there yet
      }
    };
    tryHighlight();
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
    applyHl();
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
    clearHL();
    if (cardRO) {
      cardRO.disconnect();
      cardRO = null;
    }
    card?.remove();
    card = null;
    moved = false;
    pointerOverFooter = false;
    state.activeStep = null;
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

  // ── gutter line selection ────────────────────────────────────────────────────
  // Two steps. A "grip" follows the hovered line: click it = select one line,
  // drag it = select a range — both only SELECT (highlight). Then a chat icon
  // appears at the selection; click it to ask. No text selection, so GitHub's own
  // (buggy) line selection never triggers; clean code is rebuilt from the rows.
  let grip = null; // hover handle that initiates selection
  let askBtn = null; // chat icon shown after a selection
  let hoverInfo = null; // { row, line, container }
  let picking = false; // true while a drag-select is in progress
  let sel = null; // current selection { container, rows: [tr...] }

  const clearPick = () =>
    document.querySelectorAll("tr.prw-pick").forEach((r) => r.classList.remove("prw-pick"));
  function highlightRows(rows) {
    clearPick();
    rows.forEach((r) => r.classList.add("prw-pick"));
  }
  // Re-paint a stored selection by matching its code text against the live rows —
  // side-agnostic, so it works for added, deleted, or mixed selections.
  function rehighlightSession(s) {
    const container = s.container && s.container.isConnected ? s.container : containerForFile(s.file);
    if (!container || !s.text) return;
    s.container = container;
    const want = s.text.split("\n");
    const rows = rowsOf(container);
    for (let i = 0; i + want.length <= rows.length; i++) {
      let ok = true;
      for (let k = 0; k < want.length; k++) {
        if (cleanLine(rows[i + k]) !== want[k]) {
          ok = false;
          break;
        }
      }
      if (ok) {
        highlightRows(rows.slice(i, i + want.length));
        return;
      }
    }
  }
  function clearSel() {
    clearPick();
    sel = null;
    if (askBtn) askBtn.style.display = "none";
  }

  function ensureGrip() {
    if (grip) return;
    grip = document.createElement("button");
    grip.className = "prw-grip";
    grip.setAttribute("data-prw-tip", "Click to select a line · drag to select a range");
    grip.setAttribute("aria-label", "Select line");
    grip.innerHTML =
      '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M4 9h16M4 15h16"/></svg>';
    grip.style.display = "none";
    document.body.appendChild(grip);
    grip.addEventListener("mousedown", onGripDown);
  }
  function ensureAskBtn() {
    if (askBtn) return;
    askBtn = document.createElement("div"); // a bar holding 1-2 chat icons
    askBtn.className = "prw-askbar";
    askBtn.style.display = "none";
    document.body.appendChild(askBtn);
  }
  const BUBBLE = '<path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/>';
  const COPY = '<rect x="9" y="9" width="11" height="11" rx="2"/><path d="M5 15V5a2 2 0 0 1 2-2h10"/>';
  const CHECK = '<path d="M4 12l5 5L20 6"/>';
  const REGEN = '<path d="M21 12a9 9 0 1 1-2.64-6.36"/><path d="M21 3v6h-6"/>';
  const LOCATE = '<circle cx="12" cy="12" r="3"/><path d="M12 2v3M12 19v3M2 12h3M19 12h3"/>';
  const svgIcon = (inner) =>
    `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">${inner}</svg>`;
  function showGripAt(row, container, line) {
    ensureGrip();
    const r = row.getBoundingClientRect();
    // Over the line-number gutter, so a vertical drag stays atop the diff rows.
    grip.style.left = `${r.left + 10}px`;
    grip.style.top = `${r.top + (r.height - 20) / 2}px`;
    grip.style.display = "flex";
    hoverInfo = { row, line, container };
  }
  function showAskBtn(rows) {
    ensureAskBtn();
    askBtn.innerHTML = "";
    const mk = (title, withStep, cls) => {
      const b = document.createElement("button");
      b.className = "prw-askbtn" + (cls ? " " + cls : "");
      b.setAttribute("data-prw-tip", title); // fast custom tooltip
      b.setAttribute("aria-label", title);
      b.innerHTML = svgIcon(BUBBLE);
      b.onclick = () => openSelectedChat(withStep);
      askBtn.appendChild(b);
    };
    // Order left→right: context chat on the left, plain chat always rightmost.
    if (state.activeStep)
      mk("Ask about these lines — with the current step's context", true, "prw-askbtn-ctx");
    mk("Ask about these lines — plain chat", false);
    const r = rowRect(rows[0]);
    askBtn.style.top = `${r.top + (r.height - 22) / 2}px`;
    askBtn.style.display = "flex";
    // Sit in the empty left margin, ending just before the line-number gutter, so
    // it never covers GitHub's hover "+" (in the gutter) or the code (to the right).
    const bw = askBtn.offsetWidth || 52;
    askBtn.style.left = `${Math.max(6, r.left - bw - 8)}px`;
  }
  function openSelectedChat(withStep) {
    if (!sel || !sel.rows.length) return;
    const { container, rows } = sel;
    const file = filePathFromContainer(container);
    const text = codeForRows(rows);
    if (!file || !text) return;
    if (askBtn) askBtn.style.display = "none";
    const rect = rowRect(rows[0]);
    const a = lineOfRow(rows[0]),
      b = lineOfRow(rows[rows.length - 1]);
    const lines = a != null && b != null ? { start: Math.min(a, b), end: Math.max(a, b) } : null;
    const session = startSession({ text, file, container, lines, rect });
    if (withStep) session.step = stepContext();
    openChat(session, rect);
  }
  function onGripDown(e) {
    e.preventDefault();
    e.stopPropagation();
    if (!hoverInfo) return;
    clearSel(); // a new selection replaces the previous one
    document.body.classList.add("prw-noselect");
    window.getSelection?.()?.removeAllRanges?.();
    const container = hoverInfo.container;
    const startRow = hoverInfo.row;
    const bands = rowBandsOf(container);
    picking = true;
    if (grip) grip.style.display = "none";
    highlightRows([startRow]);
    const move = (ev) => {
      ev.preventDefault();
      // Resolve the row at the cursor's Y and select the DOM range between it and
      // the start row — order-based, so deleted/added/mixed spans all work.
      const row = rowAtY(bands, ev.clientY, startRow);
      if (row && container.contains(row)) highlightRows(rowsBetween(container, startRow, row));
    };
    const up = (ev) => {
      document.removeEventListener("mousemove", move);
      document.removeEventListener("mouseup", up);
      document.body.classList.remove("prw-noselect");
      let endRow = rowAtY(bands, ev.clientY, startRow);
      if (!endRow || !container.contains(endRow)) endRow = startRow;
      const rows = rowsBetween(container, startRow, endRow);
      picking = false;
      sel = { container, rows }; // selection set — but don't open chat
      highlightRows(rows);
      showAskBtn(rows); // chat icon to ask
    };
    document.addEventListener("mousemove", move);
    document.addEventListener("mouseup", up);
  }
  document.addEventListener("mouseover", (e) => {
    if (picking) return; // mid-drag
    if (grip && (e.target === grip || grip.contains(e.target))) return;
    if (askBtn && (e.target === askBtn || askBtn.contains(e.target))) return;
    const row = e.target.closest?.("tr.diff-line-row");
    if (row) {
      const container = diffContainerOf(row);
      const line = lineOfRow(row);
      if (container && line != null) showGripAt(row, container, line);
    } else if (grip && !e.target.closest?.('[id^="diff-"]')) {
      grip.style.display = "none";
    }
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

  function openChat(session, anchorRect) {
    if (chat) minimizeChat(); // only one open; the current one collapses to the list
    activeSession = session;
    const s = session;
    rehighlightSession(s); // re-paint the selected rows (matches by code text, side-agnostic)
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
        <input class="prw-input prw-chat-input" id="prw-q" placeholder="Ask…  (Enter to send)" />
        <button class="prw-btn prw-btn-primary" id="prw-send">Ask</button>
      </div>`;
    document.body.appendChild(chat);
    // Set the file label via textContent/title (never innerHTML) — the path comes
    // from GitHub's DOM, so escaping it avoids any markup injection into the panel.
    const fileEl = chat.querySelector(".prw-chat-file");
    fileEl.textContent = s.file.split("/").pop() + lineLabel;
    fileEl.title = s.file + lineLabel;

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
    QUICK.forEach((a) => {
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
        // Scroll the diff to the lines this chat is about and re-highlight them.
        iconBtn(LOCATE, "Jump to these lines", () => jumpToSelection());
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
      rehighlightSession(s);
      const row = document.querySelector("tr.prw-pick");
      if (row) row.scrollIntoView({ behavior: "smooth", block: "center" });
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

    chat.querySelector("#prw-send").onclick = () => {
      const q = input.value.trim();
      if (q) {
        input.value = "";
        ask(q);
      }
    };
    input.addEventListener("keydown", (e) => {
      if (e.key === "Enter") {
        const q = input.value.trim();
        if (q) {
          input.value = "";
          ask(q);
        }
      }
    });
    input.focus();

    // AI suggestions append below the fixed actions, in the same row style, with
    // a subtle divider. They vanish cleanly if none come back (no empty band).
    function renderSuggestions(list) {
      ai.innerHTML = "";
      ai.classList.toggle("prw-has", list.length > 0);
      list.slice(0, 3).forEach((q) => addRow(ai, q, q));
    }
    if (session.suggestions) {
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
    clearSel();
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
    clearSel();
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
    const base = sess.file.split("/").pop() + (sess.lines ? `:${sess.lines.start}` : "");
    const firstQ = sess.messages.find((m) => m.role === "user");
    return `${base} — ${firstQ ? firstQ.content : sess.text.replace(/\s+/g, " ").slice(0, 40)}`;
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

  // ── settings gear (global; works with or without a review) ───────────────────
  let gearBtn = null,
    settingsPop = null;
  function ensureGearBtn() {
    if (gearBtn) return;
    gearBtn = document.createElement("button");
    gearBtn.className = "prw-gear";
    gearBtn.title = "PR Walkthrough settings";
    gearBtn.setAttribute("aria-label", "Settings");
    gearBtn.innerHTML =
      '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z"/></svg>';
    gearBtn.onclick = toggleSettings;
    document.body.appendChild(gearBtn);
  }
  function toggleSettings() {
    if (settingsPop) {
      settingsPop.remove();
      settingsPop = null;
      return;
    }
    settingsPop = document.createElement("div");
    settingsPop.className = "prw-settings-pop";
    settingsPop.innerHTML = `
      <label>theme
        <select id="prw-theme"><option value="auto">auto</option><option value="light">light</option><option value="dark">dark</option></select>
      </label>
      <label>highlight
        <select id="prw-style"><option value="tint">tint</option><option value="github">github-style</option></select>
      </label>`;
    document.body.appendChild(settingsPop);
    const themeSel = settingsPop.querySelector("#prw-theme");
    themeSel.value = state.theme;
    themeSel.onchange = () => {
      state.theme = themeSel.value;
      localStorage.setItem("prwTheme", state.theme);
      applyTheme();
    };
    const styleSel = settingsPop.querySelector("#prw-style");
    styleSel.value = state.hlStyle;
    styleSel.onchange = () => {
      state.hlStyle = styleSel.value;
      localStorage.setItem("prwHl", state.hlStyle);
      applyHl();
    };
  }

  // ── launcher block (Run / Open / Regenerate) ─────────────────────────────────
  let generating = false,
    newCommits = false,
    curHead = null,
    genPoll = null;

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
      label.textContent = "⏳ Generating review… (runs in your session, blocks chat) ";
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
      s.append(label, dis);
      block.appendChild(s);
      return;
    }
    if (state.spec) {
      addBtn(`▶ Open review (${state.spec.steps.length})`, "", () => startTour());
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
      } else if (tries > 80) {
        // ~4 min safety stop
        clearInterval(genPoll);
        genPoll = null;
        storeRemove(genKey(pr));
        generating = false;
        renderLauncher(pr);
      }
    }, 3000);
  }

  // Ask the session (via the channel) to (re)generate; persist a marker so the
  // "generating" state survives a refresh, then poll for the new spec.
  async function requestGenerate(pr, mode, sinceSha) {
    const prevSig = specSig(state.spec);
    closeTour(); // don't leave a stale walkthrough open while it regenerates
    generating = true;
    storeSet(genKey(pr), { prevSig, at: Date.now() });
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
      const fresh = gen && Date.now() - (gen.at || 0) < 4 * 60 * 1000; // ignore stale markers
      if (fresh && (!state.spec || specSig(state.spec) === gen.prevSig)) {
        generating = true;
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
  applyHl();
  ensureGearBtn();
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
