// Scripts run in an isolated world (never the page's main world) to read and
// highlight page content. They only read the DOM; they never act on the page.
export const ISOLATED_WORLD_ID = 1999;

/** Readability-style extraction: visible main-content blocks with structure (DD-4 alternative, see notes). */
export const EXTRACT_SCRIPT = `(() => {
  const SKIP = new Set(['SCRIPT','STYLE','NOSCRIPT','SVG','CANVAS','IFRAME','TEMPLATE','BUTTON','SELECT','INPUT','TEXTAREA','OPTION']);
  const BLOCK = /^(H[1-6]|P|LI|BLOCKQUOTE|PRE|TD|TH|DT|DD|FIGCAPTION|CAPTION|SUMMARY)$/;
  const NOISE = /(^|[-_ ])(nav|menu|footer|sidebar|comment|cookie|banner|promo|advert|ads?|share|social|related|newsletter|popup|modal)([-_ ]|$)/i;
  const root = document.querySelector('article, main, [role=main]') || document.body;
  const inArticle = root !== document.body;
  const blocks = [];
  let chars = 0;
  const visible = (el) => {
    if (el.checkVisibility && !el.checkVisibility({ checkOpacity: true, checkVisibilityCSS: true })) return false;
    const r = el.getBoundingClientRect();
    return r.width > 1 && r.height > 1;
  };
  const walk = (el) => {
    if (chars > 400000 || SKIP.has(el.tagName)) return;
    if (el.getAttribute('aria-hidden') === 'true' || el.hidden) return;
    const tag = el.tagName;
    if (!inArticle && /^(NAV|FOOTER|ASIDE|HEADER)$/.test(tag)) return;
    if (!inArticle && NOISE.test((el.className && el.className.baseVal === undefined ? el.className : '') + ' ' + (el.id || ''))) return;
    if (!visible(el)) return;
    if (BLOCK.test(tag)) {
      const text = (el.innerText || '').trim();
      if (text) {
        blocks.push({ tag: tag.toLowerCase(), text, level: /^H[1-6]$/.test(tag) ? Number(tag[1]) : 0 });
        chars += text.length;
      }
      return;
    }
    if (tag === 'TR') {
      const cells = [...el.children].map((c) => (c.innerText || '').trim()).filter(Boolean);
      if (cells.length) blocks.push({ tag: 'tr', text: cells.join(' | '), level: 0 });
      return;
    }
    // Loose text directly inside containers (div-soup pages).
    let own = '';
    for (const n of el.childNodes) if (n.nodeType === 3) own += n.textContent;
    own = own.trim();
    if (own.length > 40) blocks.push({ tag: 'div', text: own, level: 0 });
    for (const c of el.children) walk(c);
  };
  walk(root);
  if (!blocks.length && document.body) blocks.push({ tag: 'p', text: (document.body.innerText || '').slice(0, 200000), level: 0 });
  const sel = String(window.getSelection() || '').slice(0, 8000);
  return { title: document.title, lang: document.documentElement.lang || '', blocks, selection: sel };
})()`;

/** Scroll to and highlight a passage (citation reveal, DD-5). Returns whether it was found. */
export function revealScript(span: string): string {
  return `((span) => {
    const norm = (s) => s.replace(/\\s+/g, ' ').trim().toLowerCase();
    const target = norm(span);
    const probe = target.split(' ').slice(0, 8).join(' ');
    const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
    let node;
    while ((node = walker.nextNode())) {
      const text = node.textContent || '';
      const idx = norm(text).indexOf(probe);
      if (idx < 0) continue;
      // Map the normalized index back to the raw string (approximate: collapse runs of whitespace).
      let raw = 0, n = 0;
      while (raw < text.length && n < idx) { if (!/\\s/.test(text[raw]) || (raw > 0 && !/\\s/.test(text[raw - 1]))) n++; raw++; }
      const range = document.createRange();
      range.setStart(node, Math.min(raw, text.length));
      range.setEnd(node, Math.min(text.length, raw + span.length));
      if (window.CSS && CSS.highlights) { CSS.highlights.set('vz-cite', new Highlight(range)); }
      const el = node.parentElement;
      el && el.scrollIntoView({ behavior: 'smooth', block: 'center' });
      setTimeout(() => window.CSS && CSS.highlights && CSS.highlights.delete('vz-cite'), 6000);
      return true;
    }
    return false;
  })(${JSON.stringify(span)})`;
}

export const HIGHLIGHT_CSS = '::highlight(vz-cite) { background-color: rgba(250, 204, 21, 0.55); color: inherit; }';
