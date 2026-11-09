// Developer helpers: standard DevTools shortcuts (F12, inspect element, view source),
// a JSON viewer for API responses, and "Copy page as Markdown" (clean context for an
// LLM). Page code runs in an isolated world, so pages can't see or tamper with it.
import { clipboard } from 'electron';
import type { BrowserApp } from '../browser_app';
import type { BrowserWindowController } from '../ui/browser_window';
import type { WebTab } from '../tabs/web_tab';
import { t } from '@vz/common/i18n';

const DEV_WORLD = 1197;

export function installDevTools(app: BrowserApp): void {
  const c = app.commandHandlers;
  const tab = (w: BrowserWindowController) => w.activeTab();
  c.set('view.inspect', (w) => {
    const wc = tab(w)?.wc;
    if (!wc) return;
    const enter = () => void wc.devToolsWebContents?.executeJavaScript('DevToolsAPI.enterInspectElementMode()').catch(() => undefined);
    if (wc.isDevToolsOpened()) enter();
    else {
      wc.once('devtools-opened', () => setTimeout(enter, 150));
      wc.openDevTools();
    }
  });
  c.set('view.source', (w) => {
    const tb = tab(w);
    if (tb && /^https?:/.test(tb.url)) w.createTab({ url: `view-source:${tb.url}`, afterId: tb.id, activate: true });
  });
  c.set('tools.copyMarkdown', (w) => void copyMarkdown(w));
  app.hooks.windowCreated.push((w) => {
    w.on('tab-loaded', (tb: WebTab) => void jsonViewer(tb));
  });
}

/** A page's main content as Markdown (also used by the MCP server's read_page). */
export async function pageMarkdown(wc: Electron.WebContents): Promise<string> {
  return (await wc.executeJavaScriptInIsolatedWorld(DEV_WORLD, [{ code: `(${htmlToMarkdown.toString()})()` }]).catch(() => '')) as string;
}

async function copyMarkdown(w: BrowserWindowController): Promise<void> {
  const wc = w.activeTab()?.wc;
  if (!wc) return;
  const md = await pageMarkdown(wc);
  if (!md) return;
  clipboard.writeText(md);
  w.toast(t('tool_markdown_copied'));
}

/** JSON responses (document.contentType) get a collapsible, searchable viewer with Raw/Pretty. */
async function jsonViewer(tab: WebTab): Promise<void> {
  const wc = tab.wc;
  if (!wc || !/^(https?|file):/.test(tab.url)) return;
  await wc.executeJavaScriptInIsolatedWorld(DEV_WORLD, [{ code: `(${renderJson.toString()})()` }]).catch(() => undefined);
}

// ---- Page-side code (serialized; must not reference anything outside itself) ----

/* eslint-disable */
function renderJson(): void {
  const ct = document.contentType;
  if (!/json/.test(ct) || document.querySelector('#vz-json')) return;
  const pre = document.body?.querySelector('pre');
  const raw = (pre ?? document.body)?.textContent ?? '';
  let data: unknown;
  try {
    data = JSON.parse(raw);
  } catch {
    return;
  }
  const css = `
    #vz-json { font: 13px/1.6 ui-monospace, SFMono-Regular, Menlo, monospace; color: #1f2937; }
    @media (prefers-color-scheme: dark) { body { background: #111318; } #vz-json { color: #e5e7eb; } #vz-json .s { color: #86efac !important; } #vz-json .n { color: #93c5fd !important; } #vz-json .k { color: #f9a8d4 !important; } #vz-json .bar { background: rgba(30,34,44,.9) !important; border-color: #333 !important; } }
    #vz-json .bar { position: sticky; top: 0; display: flex; gap: 8px; align-items: center; padding: 8px 12px; background: rgba(255,255,255,.9); backdrop-filter: blur(12px); border-bottom: 1px solid #e5e7eb; z-index: 1; font-family: system-ui, sans-serif; }
    #vz-json .bar button { border: 1px solid #d1d5db; background: transparent; color: inherit; border-radius: 999px; padding: 3px 12px; cursor: pointer; font: inherit; font-size: 12px; }
    #vz-json .bar button[aria-pressed=true] { background: #2563eb; color: #fff; border-color: #2563eb; }
    #vz-json .bar input { margin-left: auto; border: 1px solid #d1d5db; border-radius: 999px; padding: 3px 12px; font: inherit; font-size: 12px; background: transparent; color: inherit; min-width: 180px; }
    #vz-json .tree { padding: 10px 16px; }
    #vz-json details { margin-left: 16px; } #vz-json summary { cursor: pointer; list-style: none; margin-left: -16px; } #vz-json summary::before { content: '▸ '; color: #9ca3af; } #vz-json details[open] > summary::before { content: '▾ '; }
    #vz-json .row { margin-left: 16px; white-space: pre-wrap; word-break: break-word; } #vz-json .k { color: #be185d; } #vz-json .s { color: #15803d; } #vz-json .n { color: #1d4ed8; } #vz-json .z { color: #6b7280; }
    #vz-json .hit { background: #fde68a; color: #111; border-radius: 3px; }
    #vz-json pre.raw { margin: 0; padding: 12px 16px; white-space: pre-wrap; word-break: break-word; }`;
  const el = (tag: string, cls?: string, text?: string) => {
    const e = document.createElement(tag);
    if (cls) e.className = cls;
    if (text !== undefined) e.textContent = text;
    return e;
  };
  const value = (v: unknown): HTMLElement => {
    if (v === null) return el('span', 'z', 'null');
    if (typeof v === 'string') return el('span', 's', JSON.stringify(v));
    if (typeof v === 'number' || typeof v === 'boolean') return el('span', 'n', String(v));
    return node(v as object);
  };
  const node = (obj: object, key?: string): HTMLElement => {
    const arr = Array.isArray(obj);
    const entries = Object.entries(obj);
    const d = document.createElement('details');
    d.open = true;
    const s = el('summary');
    if (key !== undefined) s.append(el('span', 'k', JSON.stringify(key)), document.createTextNode(': '));
    s.append(document.createTextNode(arr ? `[ ${entries.length} ]` : `{ ${entries.length} }`));
    d.append(s);
    for (const [k, v] of entries) {
      if (v && typeof v === 'object') d.append(node(v, arr ? undefined : k));
      else {
        const r = el('div', 'row');
        if (!arr) r.append(el('span', 'k', JSON.stringify(k)), document.createTextNode(': '));
        r.append(value(v));
        d.append(r);
      }
    }
    return d;
  };
  const root = el('div');
  root.id = 'vz-json';
  const style = el('style', undefined, css);
  const bar = el('div', 'bar');
  const pretty = el('button', undefined, 'Pretty');
  const rawBtn = el('button', undefined, 'Raw');
  const copy = el('button', undefined, 'Copy');
  const find = el('input') as HTMLInputElement;
  find.type = 'search';
  find.placeholder = 'Filter keys and values';
  bar.append(pretty, rawBtn, copy, find);
  const tree = el('div', 'tree');
  tree.append(value(data));
  const rawPre = el('pre', 'raw', JSON.stringify(data, null, 2));
  rawPre.hidden = true;
  const show = (isRaw: boolean) => {
    rawPre.hidden = !isRaw;
    tree.hidden = isRaw;
    pretty.setAttribute('aria-pressed', String(!isRaw));
    rawBtn.setAttribute('aria-pressed', String(isRaw));
  };
  pretty.onclick = () => show(false);
  rawBtn.onclick = () => show(true);
  copy.onclick = () => void navigator.clipboard.writeText(JSON.stringify(data, null, 2)).then(() => (copy.textContent = 'Copied'));
  find.oninput = () => {
    const q = find.value.toLowerCase();
    for (const h of tree.querySelectorAll('.hit')) h.classList.remove('hit');
    if (!q) return;
    for (const s of tree.querySelectorAll('.k, .s, .n')) {
      if (s.textContent?.toLowerCase().includes(q)) {
        s.classList.add('hit');
        for (let p = s.parentElement; p && p !== tree; p = p.parentElement) if (p instanceof HTMLDetailsElement) p.open = true;
      }
    }
  };
  root.append(style, bar, tree, rawPre);
  show(false);
  document.body.replaceChildren(root);
}

function htmlToMarkdown(): string {
  const root = (document.querySelector('article, main, [role=main]') as HTMLElement | null) ?? document.body;
  const out: string[] = [];
  const inline = (n: Node): string => {
    if (n.nodeType === 3) return (n.textContent ?? '').replace(/\s+/g, ' ');
    if (!(n instanceof HTMLElement)) return '';
    const kids = () => [...n.childNodes].map(inline).join('');
    const tag = n.tagName;
    if (/^(SCRIPT|STYLE|NOSCRIPT|SVG|BUTTON|NAV|FOOTER|ASIDE|FORM)$/.test(tag) || n.hidden || getComputedStyle(n).display === 'none') return '';
    if (tag === 'A') {
      const href = (n as HTMLAnchorElement).href;
      const text = kids().trim();
      return href && text && /^https?:/.test(href) ? `[${text}](${href})` : text;
    }
    if (tag === 'STRONG' || tag === 'B') return `**${kids().trim()}**`;
    if (tag === 'EM' || tag === 'I') return `*${kids().trim()}*`;
    if (tag === 'CODE') return `\`${n.textContent ?? ''}\``;
    if (tag === 'BR') return '\n';
    if (tag === 'IMG') return (n as HTMLImageElement).alt ? `![${(n as HTMLImageElement).alt}](${(n as HTMLImageElement).src})` : '';
    return kids();
  };
  const block = (n: Node, depth = 0): void => {
    if (!(n instanceof HTMLElement)) {
      const t = n.nodeType === 3 ? (n.textContent ?? '').trim() : '';
      if (t) out.push(t);
      return;
    }
    const tag = n.tagName;
    if (/^(SCRIPT|STYLE|NOSCRIPT|SVG|NAV|FOOTER|ASIDE|FORM|BUTTON)$/.test(tag) || n.hidden || getComputedStyle(n).display === 'none') return;
    const h = /^H([1-6])$/.exec(tag);
    if (h) return void out.push(`${'#'.repeat(Number(h[1]))} ${inline(n).trim()}`);
    if (tag === 'P') return void out.push(inline(n).trim());
    if (tag === 'PRE') return void out.push('```\n' + (n.textContent ?? '').replace(/\n$/, '') + '\n```');
    if (tag === 'BLOCKQUOTE') return void out.push(inline(n).trim().split('\n').map((l) => `> ${l}`).join('\n'));
    if (tag === 'UL' || tag === 'OL') {
      [...n.children].forEach((li, i) => out.push(`${'  '.repeat(depth)}${tag === 'OL' ? `${i + 1}.` : '-'} ${inline(li).trim()}`));
      return;
    }
    if (tag === 'TABLE') {
      const rows = [...n.querySelectorAll('tr')].map((tr) => [...tr.children].map((c) => inline(c).trim().replace(/\|/g, '\\|')));
      if (rows.length) out.push([`| ${rows[0]!.join(' | ')} |`, `| ${rows[0]!.map(() => '---').join(' | ')} |`, ...rows.slice(1).map((r) => `| ${r.join(' | ')} |`)].join('\n'));
      return;
    }
    if (tag === 'IMG') return void out.push(inline(n));
    for (const c of n.childNodes) block(c, depth);
  };
  out.push(`# ${document.title}`, `Source: ${location.href}`);
  block(root);
  return out.filter((x) => x.trim()).join('\n\n').replace(/\n{3,}/g, '\n\n').slice(0, 200_000);
}
/* eslint-enable */
