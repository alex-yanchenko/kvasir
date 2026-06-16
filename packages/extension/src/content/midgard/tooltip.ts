// Fast tooltips for Midgard's light-DOM widgets (grip, ask bar): the native title
// waits ~1s; this shows a styled tip ~350ms after hover. Driven by a data-kvasir-tip
// attribute. Self-contained — owns its own tip element and hover timer. (Asgard
// has its own shadow-scoped Tooltips component — events don't cross the boundary.)

let tipElement: HTMLElement | null = null;
let tipTimer: ReturnType<typeof setTimeout> | null = null;

function hideTip(): void {
  if (tipTimer !== null) clearTimeout(tipTimer);
  tipTimer = null;
  if (tipElement) tipElement.style.display = "none";
}

function showTip(target: HTMLElement): void {
  const text = target.dataset.kvasirTip;
  if (!text) return;
  if (!tipElement) {
    tipElement = document.createElement("div");
    tipElement.className = "kvasir-tip";
    document.body.append(tipElement);
  }
  tipElement.textContent = text;
  tipElement.style.display = "block";
  const r = target.getBoundingClientRect();
  const tr = tipElement.getBoundingClientRect();
  let top = r.top - tr.height - 6;
  if (top < 4) top = r.bottom + 6;
  const left = Math.max(6, Math.min(r.left + r.width / 2 - tr.width / 2, window.innerWidth - tr.width - 6));
  tipElement.style.left = `${left}px`;
  tipElement.style.top = `${top}px`;
}

// Called by Heimdall's boot after its re-injection guard so the document listeners
// bind exactly once, even if the content script is injected twice.
export function initTooltips(): void {
  document.addEventListener("mouseover", (event) => {
    const t = event.target instanceof Element ? event.target.closest<HTMLElement>("[data-kvasir-tip]") : null;
    if (!t) return;
    if (tipTimer !== null) clearTimeout(tipTimer);
    tipTimer = setTimeout(() => showTip(t), 350);
  });
  document.addEventListener("mouseout", (event) => {
    if (!(event instanceof MouseEvent) || !(event.target instanceof Element)) return;
    const owner = event.target.closest("[data-kvasir-tip]");
    // mouseout bubbles and fires when the cursor crosses into a child (e.g. the icon
    // <svg>); don't hide while still inside the same tip owner, or the tip flickers.
    if (!owner || (event.relatedTarget instanceof Node && owner.contains(event.relatedTarget))) return;
    hideTip();
  });
  document.addEventListener("mousedown", hideTip, true);
}
