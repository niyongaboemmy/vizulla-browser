// Vizulla tooltips: one glass bubble per document that replaces native `title`
// tooltips everywhere (shell, overlay, every vizulla:// page).
// - Shows after a short hover (or keyboard focus); once one has been shown,
//   neighbours appear instantly for a moment ("warm" mode), like native menus.
// - Springs in from the side it's placed on; hides on press, key, scroll, leave.
// - `data-kbd` on the element adds a keycap (e.g. data-kbd="⌘T").
// - Picks the first side that fits the viewport and stays clear of `avoid`
//   rects (the shell passes the page area: web pages are drawn above it).
//   When no side fits, an `escape` (the shell's) draws the bubble above the page.
// The `title` moves to `data-tip` on first hover so the OS tooltip never shows;
// elements that had no other accessible name keep it as aria-label. The bubble is
// visual only (aria-hidden): controls already carry their names.

type Side = 'top' | 'bottom' | 'right' | 'left';

const SHOW_DELAY = 420;
const WARM_FOR = 700;
const GAP = 8;

let avoid: () => DOMRect[] = () => [];
let installed = false;

export interface TooltipEscape {
  /** Draw this self-contained bubble document at this rect, above everything. */
  show(rect: { x: number; y: number; width: number; height: number }, doc: string): void;
  hide(): void;
}
let escape: TooltipEscape | null = null;

export function setTooltipAvoid(fn: () => DOMRect[], esc?: TooltipEscape): void {
  avoid = fn;
  escape = esc ?? null;
}

/** The bubble as a standalone document: resolved theme values, the same CSS, already "on". */
function escapedDoc(tip: HTMLElement, side: Side): string {
  const cs = getComputedStyle(document.documentElement);
  const vars = ['--vz-text', '--vz-bg', '--vz-font', '--vz-font-mono', '--vz-glass-border'].map((v) => `${v}:${cs.getPropertyValue(v).trim() || 'initial'}`).join(';');
  // No page shows through a separate view, so the glass is drawn solid.
  return `<style>:root{${vars}}${CSS}.vz-tip{position:static;background:color-mix(in srgb,var(--vz-text,#0f172a) 94%,transparent)}</style><div class="vz-tip on" data-side="${side}">${tip.innerHTML}</div>`;
}

export function installTooltips(): void {
  if (installed || typeof document === 'undefined') return;
  installed = true;

  const tip = document.createElement('div');
  tip.setAttribute('aria-hidden', 'true');
  tip.id = 'vz-tooltip';
  tip.className = 'vz-tip';
  const style = document.createElement('style');
  style.textContent = CSS;
  document.head.append(style);
  document.body.append(tip);

  let target: HTMLElement | null = null;
  let timer = 0;
  let warmUntil = 0;
  let quiet: HTMLElement | null = null;

  const textOf = (el: HTMLElement): string => {
    const title = el.getAttribute('title');
    if (title) {
      el.dataset.tip = title;
      el.removeAttribute('title');
      if (!el.hasAttribute('aria-label') && !el.hasAttribute('aria-labelledby') && !el.textContent?.trim()) el.setAttribute('aria-label', title);
    }
    return el.dataset.tip ?? '';
  };

  const find = (e: Event): HTMLElement | null => {
    for (const n of e.composedPath()) {
      if (!(n instanceof HTMLElement)) continue;
      if (n.hasAttribute('title') || n.dataset.tip) return n;
      if (n.dataset.noTip !== undefined) return null;
    }
    return null;
  };

  let escaped = false;
  const hide = (cool = false) => {
    clearTimeout(timer);
    target = null;
    if (escaped) {
      escaped = false;
      escape?.hide();
    }
    tip.classList.remove('on');
    if (cool) warmUntil = 0;
    else if (tip.dataset.shown) warmUntil = Date.now() + WARM_FOR;
    delete tip.dataset.shown;
  };

  const show = (el: HTMLElement) => {
    const text = textOf(el);
    if (!text || !el.isConnected) return;
    tip.textContent = '';
    for (const [i, line] of text.split('\n').entries()) {
      const s = document.createElement('span');
      s.className = i ? 'sub' : 'main';
      s.textContent = line;
      tip.append(s);
    }
    if (el.dataset.kbd) {
      const k = document.createElement('kbd');
      k.textContent = el.dataset.kbd;
      tip.append(k);
    }
    tip.style.left = '0px';
    tip.style.top = '0px';
    tip.dataset.side = 'bottom';
    tip.classList.add('measure');
    const r = el.getBoundingClientRect();
    const w = tip.offsetWidth;
    const h = tip.offsetHeight;
    tip.classList.remove('measure');
    const vw = window.innerWidth;
    const vh = window.innerHeight;
    const pos: Record<Side, [number, number]> = {
      bottom: [r.left + r.width / 2 - w / 2, r.bottom + GAP],
      top: [r.left + r.width / 2 - w / 2, r.top - GAP - h],
      right: [r.right + GAP, r.top + r.height / 2 - h / 2],
      left: [r.left - GAP - w, r.top + r.height / 2 - h / 2],
    };
    const blocked = avoid();
    const fits = ([x, y]: [number, number]) => {
      const cx = Math.max(6, Math.min(vw - w - 6, x));
      const box = new DOMRect(cx, y, w, h);
      const inView = y >= 4 && y + h <= vh - 4 && x >= -w / 2 && x + w <= vw + w / 2;
      return inView && !blocked.some((b) => box.left < b.right && box.right > b.left && box.top < b.bottom && box.bottom > b.top);
    };
    const preferred = (el.dataset.tipSide as Side | undefined) ?? 'bottom';
    const order = [preferred, ...(['bottom', 'top', 'right', 'left'] as Side[]).filter((s) => s !== preferred)];
    const free = order.find((s) => fits(pos[s]));
    if (!free && escape && blocked.length) {
      // Only room over the page: draw it there, in its own view above the page.
      blocked.length = 0;
      const side = order.find((s) => fits(pos[s])) ?? preferred;
      const [x, y] = pos[side];
      escape.show({ x: Math.max(6, Math.min(vw - w - 6, x)), y: Math.max(4, y), width: w, height: h }, escapedDoc(tip, side));
      escaped = true;
      tip.dataset.shown = '1';
      return;
    }
    const side = free ?? preferred;
    const [x, y] = pos[side];
    tip.style.left = `${Math.round(Math.max(6, Math.min(vw - w - 6, x)))}px`;
    tip.style.top = `${Math.round(Math.max(4, Math.min(vh - h - 4, y)))}px`;
    tip.dataset.side = side;
    // Restart the entrance animation.
    tip.classList.remove('on');
    void tip.offsetWidth;
    tip.classList.add('on');
    tip.dataset.shown = '1';
  };

  const arm = (el: HTMLElement) => {
    if (el === target) return;
    hide(true);
    target = el;
    textOf(el);
    const delay = Date.now() < warmUntil ? 0 : SHOW_DELAY;
    timer = window.setTimeout(() => target === el && show(el), delay);
  };

  // pointermove as well as pointerover: Chromium can skip boundary events when
  // the hovered element changes between frames, and arm() is a no-op for the same target.
  const onPointer = (e: PointerEvent) => {
    if (e.pointerType === 'touch') return;
    const el = find(e);
    // After a press, the same control stays quiet until the pointer leaves it.
    if (el && el === quiet) return;
    quiet = null;
    if (el) arm(el);
    else if (target) hide();
  };
  document.addEventListener('pointerover', onPointer, true);
  document.addEventListener('pointermove', onPointer, { capture: true, passive: true });
  document.documentElement.addEventListener('pointerleave', () => hide());
  window.addEventListener('blur', () => hide(true));
  document.addEventListener('focusin', (e) => {
    const el = find(e);
    if (el && (el as HTMLElement).matches(':focus-visible')) arm(el);
  }, true);
  document.addEventListener('focusout', () => hide(), true);
  document.addEventListener('pointerdown', (e) => {
    quiet = find(e);
    hide(true);
  }, { capture: true, passive: true });
  for (const ev of ['keydown', 'wheel', 'scroll'] as const) document.addEventListener(ev, () => hide(true), { capture: true, passive: true });
}

const CSS = `
.vz-tip {
  position: fixed; z-index: 2147483647; pointer-events: none; max-width: 280px;
  display: flex; align-items: center; gap: 8px; flex-wrap: wrap; padding: 6px 10px;
  border-radius: 10px; border: 1px solid var(--vz-glass-border, rgba(37,99,235,.14));
  background: color-mix(in srgb, var(--vz-text, #0f172a) 94%, transparent); color: var(--vz-bg, #fff);
  font: 500 12px/1.35 var(--vz-font, system-ui, sans-serif); letter-spacing: .01em;
  opacity: 0; visibility: hidden; transform-origin: top center;
  --dx: 0px; --dy: -4px;
}
.vz-tip.measure { visibility: hidden !important; opacity: 0 !important; transition: none !important; }
.vz-tip[data-side=top] { transform-origin: bottom center; --dy: 4px; }
.vz-tip[data-side=right] { transform-origin: left center; --dx: -4px; --dy: 0px; }
.vz-tip[data-side=left] { transform-origin: right center; --dx: 4px; --dy: 0px; }
.vz-tip.on { visibility: visible; animation: vz-tip-in 180ms cubic-bezier(.2,.9,.25,1.25) forwards; }
.vz-tip .main { white-space: nowrap; overflow: hidden; text-overflow: ellipsis; max-width: 260px; }
.vz-tip .sub { flex-basis: 100%; opacity: .72; font-weight: 400; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; max-width: 260px; }
.vz-tip kbd {
  font: 600 10.5px/1 var(--vz-font-mono, ui-monospace, monospace); padding: 3px 6px; border-radius: 6px;
  background: color-mix(in srgb, var(--vz-bg, #fff) 18%, transparent); color: inherit;
}
@keyframes vz-tip-in {
  from { opacity: 0; transform: translate(var(--dx), var(--dy)) scale(.92); }
  to { opacity: 1; transform: none; }
}
@media (prefers-reduced-motion: reduce) { .vz-tip.on { animation: none; opacity: 1; } }
`;
