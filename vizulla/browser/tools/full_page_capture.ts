// Whole-page screenshots by scrolling: the page is scrolled one screen at a time
// (so lazy images and infinite lists load), each screen is captured, and the
// slices are stitched into one image. Fixed and sticky elements (headers, cookie
// bars, chat bubbles) show once, on the first screen. Works for pages that scroll
// an inner container instead of the document. The page's scroll position and
// styles are restored afterwards.
import { nativeImage, type NativeImage, type WebContents } from 'electron';

/** Tallest image, in CSS px (memory: ~2900 px wide × 2 × 15000 × 4 B ≈ 350 MB worst case at 2×). */
const MAX_CSS_HEIGHT = 15_000;
const MAX_STEPS = 60;
const SETTLE_MS = 180;
const WORLD = 1_002_002;

interface Geometry {
  /** The region that scrolls, in CSS px within the viewport. */
  region: { x: number; y: number; width: number; height: number };
  total: number;
  dpr: number;
}

const PREPARE = `(() => {
  const vh = innerHeight, vw = innerWidth;
  const doc = document.scrollingElement || document.documentElement;
  let el = null;
  if (doc.scrollHeight <= vh + 4) {
    // The document doesn't scroll: find the biggest scrolling container.
    let best = 0;
    const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_ELEMENT);
    for (let n = walker.currentNode, i = 0; n && i < 8000; n = walker.nextNode(), i++) {
      if (n.scrollHeight <= n.clientHeight + 40) continue;
      const oy = getComputedStyle(n).overflowY;
      if (oy !== 'auto' && oy !== 'scroll' && oy !== 'overlay') continue;
      const r = n.getBoundingClientRect();
      const area = Math.max(0, Math.min(r.right, vw) - Math.max(r.left, 0)) * Math.max(0, Math.min(r.bottom, vh) - Math.max(r.top, 0));
      if (area > best) { best = area; el = n; }
    }
  }
  const s = el || doc;
  window.__vzShot = { el: s, start: s.scrollTop, behavior: s.style.scrollBehavior, docBehavior: document.documentElement.style.scrollBehavior };
  s.style.scrollBehavior = 'auto';
  document.documentElement.style.scrollBehavior = 'auto';
  // No scrollbar thumb in every slice.
  const css = document.createElement('style');
  css.textContent = '*{scrollbar-width:none!important}*::-webkit-scrollbar{display:none!important}';
  document.documentElement.append(css);
  window.__vzShot.css = css;
  const r = el ? el.getBoundingClientRect() : { x: 0, y: 0, width: vw, height: vh };
  return { region: { x: Math.max(0, r.x), y: Math.max(0, r.y), width: Math.min(r.width, vw), height: Math.min(el ? el.clientHeight : vh, vh) }, total: s.scrollHeight, dpr: devicePixelRatio };
})()`;

const scrollTo = (y: number) => `(async () => {
  const st = window.__vzShot; st.el.scrollTop = ${y};
  await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
  // Wait for images that just came into view (lazy loading), briefly.
  const imgs = [...document.images].filter((i) => !i.complete && i.getBoundingClientRect().top < innerHeight && i.getBoundingClientRect().bottom > 0);
  await Promise.race([Promise.all(imgs.map((i) => new Promise((r) => (i.onload = i.onerror = r)))), new Promise((r) => setTimeout(r, 900))]);
  return { top: st.el.scrollTop, total: st.el.scrollHeight };
})()`;

/** After the first screen: hide fixed and sticky elements so they don't repeat on every slice. */
const HIDE_FIXED = `(() => {
  if (window.__vzShot.hidden) return;
  const hidden = [];
  const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_ELEMENT);
  for (let n = walker.currentNode, i = 0; n && i < 20000; n = walker.nextNode(), i++) {
    const p = getComputedStyle(n).position;
    if ((p === 'fixed' || p === 'sticky') && n !== window.__vzShot.el && !n.contains(window.__vzShot.el)) {
      hidden.push([n, n.style.getPropertyValue('visibility'), n.style.getPropertyPriority('visibility')]);
      n.style.setProperty('visibility', 'hidden', 'important');
    }
  }
  window.__vzShot.hidden = hidden;
})()`;

const RESTORE = `(() => {
  const st = window.__vzShot; if (!st) return;
  for (const [n, v, p] of st.hidden || []) v ? n.style.setProperty('visibility', v, p) : n.style.removeProperty('visibility');
  st.css.remove();
  st.el.scrollTop = st.start; st.el.style.scrollBehavior = st.behavior; document.documentElement.style.scrollBehavior = st.docBehavior;
  delete window.__vzShot;
})()`;

/** A BGRA bitmap: the format NativeImage.toBitmap() returns and createFromBitmap() takes. */
export interface Bitmap {
  data: Buffer;
  width: number;
  height: number;
}

export function toBitmap(img: NativeImage): Bitmap {
  const data = img.toBitmap();
  const sf = img.getScaleFactors?.()[0] ?? 1;
  const width = Math.round(img.getSize().width * sf);
  return { data, width, height: Math.floor(data.length / 4 / Math.max(1, width)) };
}

/** Rows [from, to) of a region [x, x + w) of a bitmap. */
export function rows(b: Bitmap, x: number, w: number, from: number, to: number): Buffer {
  const out = Buffer.alloc(Math.max(0, to - from) * w * 4);
  for (let y = from, o = 0; y < to; y++, o += w * 4) b.data.copy(out, o, (y * b.width + x) * 4, (y * b.width + x + w) * 4);
  return out;
}

export async function captureFullPage(wc: WebContents): Promise<NativeImage | null> {
  const run = <T>(code: string) => wc.executeJavaScriptInIsolatedWorld(WORLD, [{ code }]) as Promise<T>;
  const g = await run<Geometry>(PREPARE);
  try {
    const px = (v: number) => Math.round(v * g.dpr);
    const rx = px(g.region.x);
    const rw = px(g.region.width);
    const ry = px(g.region.y);
    const step = Math.max(100, Math.floor(g.region.height));
    const parts: Buffer[] = [];
    let first: Bitmap | null = null;
    let last: Bitmap | null = null;
    let done = 0; // CSS px of the scrolling content already in `parts`
    let total = Math.min(g.total, MAX_CSS_HEIGHT);
    for (let i = 0, y = 0; i < MAX_STEPS && done < total; i++, y += step) {
      if (i === 1) await run(HIDE_FIXED);
      const pos = await run<{ top: number; total: number }>(scrollTo(y));
      total = Math.min(Math.max(total, pos.total), MAX_CSS_HEIGHT);
      const shot = toBitmap(await wc.capturePage());
      if (!first) first = shot;
      last = shot;
      // This screen shows content [pos.top, pos.top + region.height); keep only what's new.
      const from = Math.max(done, pos.top);
      const to = Math.min(pos.top + g.region.height, total);
      if (to > from) {
        const a = ry + px(from - pos.top);
        const b = Math.min(shot.height, ry + px(to - pos.top));
        parts.push(rows(shot, rx, rw, a, b));
        done = to;
      }
      if (pos.top + g.region.height >= pos.total) break; // reached the end
    }
    if (!first || !last) return null;
    // An inner scroller: keep what's around it (the site's header above, footer below) from the first and last screens.
    const head = ry > 0 ? rows(first, rx, rw, 0, ry) : Buffer.alloc(0);
    const footFrom = ry + px(g.region.height);
    const foot = footFrom < last.height ? rows(last, rx, rw, footFrom, last.height) : Buffer.alloc(0);
    const data = Buffer.concat([head, ...parts, foot]);
    const height = data.length / 4 / rw;
    return nativeImage.createFromBitmap(data, { width: rw, height, scaleFactor: g.dpr });
  } finally {
    await run(RESTORE).catch(() => undefined);
  }
}
