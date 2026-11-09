// Matches collected page evidence against the fingerprint rules (rules.ts). Pure:
// the probe that gathers evidence runs in the page only when the user opens the tool.
import { RULES, type TechCategory, type TechRule } from './rules';

export interface Evidence {
  url: string;
  headers: Record<string, string>;
  cookies: string[];
  meta: Record<string, string>;
  js: Record<string, string | true>;
  scripts: string[];
  resources: string[];
  dom: Record<string, boolean>;
  html: string;
}

export interface Detected {
  name: string;
  category: TechCategory;
  version: string | null;
  confidence: 'certain' | 'likely';
  evidence: string[];
  website?: string;
}

const re = (p: string) => new RegExp(p, 'i');
const version = (m: RegExpMatchArray | null): string | null => (m && m[1] && /\d/.test(m[1]) ? m[1].replace(/\.$/, '') : null);

/** The JS paths and DOM selectors the page probe must look up. */
export function probeTargets(rules: TechRule[] = RULES): { js: string[]; dom: string[] } {
  return { js: [...new Set(rules.flatMap((r) => Object.keys(r.js ?? {})))], dom: [...new Set(rules.flatMap((r) => r.dom ?? []))] };
}

export function detect(ev: Evidence, rules: TechRule[] = RULES): Detected[] {
  const found = new Map<string, Detected & { score: number }>();
  const hit = (r: TechRule, score: number, why: string, v: string | null) => {
    const cur = found.get(r.name) ?? { name: r.name, category: r.category, version: null, confidence: 'likely' as const, evidence: [], website: r.website, score: 0 };
    cur.score += score;
    if (!cur.evidence.includes(why) && cur.evidence.length < 4) cur.evidence.push(why);
    cur.version ??= v;
    found.set(r.name, cur);
  };
  const headers = Object.fromEntries(Object.entries(ev.headers).map(([k, v]) => [k.toLowerCase(), v]));
  const html = ev.html.slice(0, 400_000);
  for (const r of rules) {
    for (const [h, p] of Object.entries(r.headers ?? {})) {
      const val = headers[h];
      if (val === undefined) continue;
      const m = p ? val.match(re(p)) : ([val] as RegExpMatchArray);
      if (m) hit(r, 100, `${h}: ${val.slice(0, 60)}`, version(m));
    }
    for (const p of r.cookies ?? []) {
      const c = ev.cookies.find((x) => re(p).test(x));
      if (c) hit(r, 100, `cookie ${c}`, null);
    }
    for (const [name, p] of Object.entries(r.meta ?? {})) {
      const val = ev.meta[name.toLowerCase()];
      if (val === undefined) continue;
      const m = p ? val.match(re(p)) : ([val] as RegExpMatchArray);
      if (m) hit(r, 100, `<meta ${name}="${val.slice(0, 60)}">`, version(m));
    }
    for (const [path, p] of Object.entries(r.js ?? {})) {
      const val = ev.js[path];
      if (val === undefined) continue;
      const m = p && typeof val === 'string' ? val.match(re(p)) : null;
      if (!p || m || val === true) hit(r, 100, `window.${path}`, version(m));
    }
    for (const p of r.scripts ?? []) {
      const s = ev.scripts.find((x) => re(p).test(x));
      if (s) hit(r, 70, `script ${short(s)}`, version(s.match(re(p))));
    }
    for (const p of r.resources ?? []) {
      const s = ev.resources.find((x) => re(p).test(x)) ?? ev.scripts.find((x) => re(p).test(x));
      if (s) hit(r, 60, `loads ${short(s)}`, null);
    }
    for (const sel of r.dom ?? []) if (ev.dom[sel]) hit(r, 50, `element ${sel}`, null);
    for (const p of r.html ?? []) {
      const m = html.match(re(p));
      if (m) hit(r, 45, 'page markup', version(m));
    }
  }
  // A technology implies its foundations (Next.js → React, WordPress → PHP).
  for (const d of [...found.values()]) {
    for (const name of rules.find((r) => r.name === d.name)?.implies ?? []) {
      const r = rules.find((x) => x.name === name);
      if (r && !found.has(name)) found.set(name, { name, category: r.category, version: null, confidence: 'likely', evidence: [`used by ${d.name}`], website: r.website, score: 50 });
    }
  }
  return [...found.values()]
    .map(({ score, ...d }) => ({ ...d, confidence: score >= 100 ? ('certain' as const) : ('likely' as const) }))
    .sort((a, b) => ORDER.indexOf(a.category) - ORDER.indexOf(b.category) || a.name.localeCompare(b.name));
}

function short(u: string): string {
  try {
    const x = new URL(u);
    return `${x.hostname}${x.pathname}`.slice(0, 70);
  } catch {
    return u.slice(0, 70);
  }
}

export const ORDER: TechCategory[] = [
  'cms', 'site-builder', 'ecommerce', 'meta-framework', 'framework', 'ui', 'css', 'library', 'build', 'language', 'backend', 'server', 'hosting', 'cdn',
  'analytics', 'tag-manager', 'advertising', 'ab-testing', 'consent', 'payments', 'auth', 'security', 'chat', 'video', 'maps', 'search', 'monitoring', 'fonts',
];

/**
 * Runs in the page (main world, on demand): meta tags, script and resource URLs, the
 * listed globals (value as text, or true) and DOM markers, and the start of the HTML.
 * Self-contained: it's serialized.
 */
export function pageProbe(targets: { js: string[]; dom: string[] }) {
  const read = (path: string): string | true | undefined => {
    let v: unknown = window;
    for (const part of path.split('.')) {
      if (v === null || v === undefined) return undefined;
      try {
        v = (v as Record<string, unknown>)[part];
      } catch {
        return undefined;
      }
    }
    if (v === undefined || v === null) return undefined;
    return typeof v === 'string' || typeof v === 'number' ? String(v) : true;
  };
  const js: Record<string, string | true> = {};
  for (const p of targets.js) {
    const v = read(p);
    if (v !== undefined) js[p] = v;
  }
  const dom: Record<string, boolean> = {};
  for (const s of targets.dom) {
    try {
      if (document.querySelector(s)) dom[s] = true;
    } catch {
      /* selector unsupported */
    }
  }
  const meta: Record<string, string> = {};
  for (const m of document.querySelectorAll('meta[name], meta[property], meta[http-equiv]')) {
    const k = (m.getAttribute('name') ?? m.getAttribute('property') ?? m.getAttribute('http-equiv') ?? '').toLowerCase();
    if (k && !(k in meta)) meta[k] = (m.getAttribute('content') ?? '').slice(0, 200);
  }
  return {
    js,
    dom,
    meta,
    scripts: [...document.scripts].map((s) => s.src).filter(Boolean).slice(0, 300),
    resources: performance.getEntriesByType('resource').map((e) => e.name).slice(0, 600),
    html: document.documentElement.outerHTML.slice(0, 400_000),
  };
}
