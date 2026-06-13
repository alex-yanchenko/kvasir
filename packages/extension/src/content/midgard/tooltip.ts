// Fast tooltips for Midgard's light-DOM widgets (grip, ask bar): the native title
// waits ~1s; this shows a styled tip ~350ms after hover. Driven by a data-prw-tip
// attribute. Self-contained — owns its own tip element and hover timer. (Asgard
// has its own shadow-scoped Tooltips component — events don't cross the boundary.)

let tipEl: HTMLElement | null = null;
let tipTimer: ReturnType<typeof setTimeout> | null = null;

function hideTip(): void {
  if (tipTimer !== null) clearTimeout(tipTimer);
  tipTimer = null;
  if (tipEl) tipEl.style.display = "none";
}

function showTip(target: Element): void {
  const text = target.getAttribute("data-prw-tip");
  if (!text) return;
  if (!tipEl) {
    tipEl = document.createElement("div");
    tipEl.className = "prw-tip";
    document.body.append(tipEl);
  }
  tipEl.textContent = text;
  tipEl.style.display = "block";
  const r = target.getBoundingClientRect();
  const tr = tipEl.getBoundingClientRect();
  let top = r.top - tr.height - 6;
  if (top < 4) top = r.bottom + 6;
  const left = Math.max(6, Math.min(r.left + r.width / 2 - tr.width / 2, window.innerWidth - tr.width - 6));
  tipEl.style.left = `${left}px`;
  tipEl.style.top = `${top}px`;
}

// Called by Heimdall's boot after its re-injection guard so the document listeners
// bind exactly once, even if the content script is injected twice.
export function initTooltips(): void {
  document.addEventListener("mouseover", (e) => {
    const t = e.target instanceof Element ? e.target.closest("[data-prw-tip]") : null;
    if (!t) return;
    if (tipTimer !== null) clearTimeout(tipTimer);
    tipTimer = setTimeout(() => showTip(t), 350);
  });
  document.addEventListener("mouseout", (e) => {
    if (e.target instanceof Element && e.target.closest("[data-prw-tip]")) hideTip();
  });
  document.addEventListener("mousedown", hideTip, true);
}
