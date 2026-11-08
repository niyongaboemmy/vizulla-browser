// URL fixup, display, and the deterministic input classifier (P2-BRW-12).
// The classifier never consults a model: the URL route always wins (CMD-07, AIQ-04).
import type { SecurityState } from './types';

// ISO 3166 country-code TLDs (all assigned two-letter codes) and the generic TLDs
// people actually type. Enough to avoid "readme.txt" being treated as a host while
// accepting "irembo.gov.rw" and "example.co.uk".
const CC_TLDS = new Set(
  ('ac ad ae af ag ai al am ao aq ar as at au aw ax az ba bb bd be bf bg bh bi bj bm bn bo br bs bt bw by bz ca cc cd cf cg ch ci ck cl cm cn co cr cu cv cw cx cy cz de dj dk dm do dz ec ee eg er es et eu fi fj fk fm fo fr ga gd ge gf gg gh gi gl gm gn gp gq gr gs gt gu gw gy hk hm hn hr ht hu id ie il im in io iq ir is it je jm jo jp ke kg kh ki km kn kp kr kw ky kz la lb lc li lk lr ls lt lu lv ly ma mc md me mg mh mk ml mm mn mo mp mq mr ms mt mu mv mw mx my mz na nc ne nf ng ni nl no np nr nu nz om pa pe pf pg ph pk pl pm pn pr ps pt pw py qa re ro rs ru rw sa sb sc sd se sg sh si sk sl sm sn so sr ss st su sv sx sy sz tc td tf tg th tj tk tl tm tn to tr tt tv tw tz ua ug uk us uy uz va vc ve vg vi vn vu wf ws ye yt za zm zw').split(' '),
);
const G_TLDS = new Set(
  ('com org net edu gov mil int info biz name pro mobi app dev io ai xyz online site tech store shop blog cloud page news art design studio space live world today life one top club agency digital email group media network services solutions systems company africa kigali local localhost test example onion').split(' '),
);

const ALLOWED_SCHEMES = new Set(['http:', 'https:', 'file:', 'vizulla:', 'chrome:', 'about:', 'data:', 'view-source:', 'mailto:', 'blob:']);
/** Never navigated to from the Command Bar (javascript: is a classic self-XSS vector). */
const BLOCKED_SCHEMES = new Set(['javascript:', 'vbscript:']);

export type InputRoute =
  | { route: 'empty' }
  | { route: 'navigate'; url: string }
  | { route: 'command'; text: string }
  | { route: 'ask'; text: string }
  | { route: 'search'; text: string };

function isIPv4(host: string): boolean {
  const parts = host.split('.');
  return parts.length === 4 && parts.every((p) => /^\d{1,3}$/.test(p) && Number(p) <= 255);
}

function isHostLike(host: string): boolean {
  const h = host.toLowerCase().replace(/\.$/, '');
  if (h === 'localhost' || h.endsWith('.localhost')) return true;
  if (isIPv4(h)) return true;
  if (/^\[[0-9a-f:.]+\]$/.test(h)) return true;
  const labels = h.split('.');
  if (labels.length < 2) return false;
  // Unicode letters allowed for IDNs ("café.fr", "рф" style names via punycode too).
  if (!labels.every((l) => /^[\p{L}\p{N}](?:[\p{L}\p{N}-]{0,61}[\p{L}\p{N}])?$/u.test(l))) return false;
  const tld = labels.at(-1)!;
  return CC_TLDS.has(tld) || G_TLDS.has(tld) || tld.startsWith('xn--') || /^\p{L}{2,}$/u.test(tld) && !/^[a-z]+$/.test(tld);
}

/** Classifies Command Bar input deterministically. p95 must stay < 5 ms (P2-BRW-12). */
export function classifyInput(raw: string): InputRoute {
  const input = raw.trim();
  if (!input) return { route: 'empty' };
  if (input.startsWith('>')) return { route: 'command', text: input.slice(1).trim() };
  if (input.startsWith('?')) return { route: 'ask', text: input.slice(1).trim() };

  const schemeMatch = /^([a-z][a-z0-9+.-]*:)/i.exec(input);
  if (schemeMatch) {
    const scheme = schemeMatch[1]!.toLowerCase();
    if (BLOCKED_SCHEMES.has(scheme)) return { route: 'search', text: input };
    if (ALLOWED_SCHEMES.has(scheme)) {
      try {
        // "localhost:3000" parses as scheme "localhost:", handled below.
        const u = new URL(input);
        if (scheme === 'http:' || scheme === 'https:') {
          if (!u.hostname) return { route: 'search', text: input };
        }
        return { route: 'navigate', url: u.href };
      } catch {
        if (/\s/.test(input)) return { route: 'search', text: input };
      }
    }
  }

  if (/\s/.test(input)) return { route: 'search', text: input };

  // host[:port][/path][?query][#frag]
  const m = /^((?:\[[0-9a-f:.]+\])|[^/:?#]+)(:\d{1,5})?([/?#].*)?$/i.exec(input);
  if (m) {
    const host = m[1]!;
    const port = m[2] ?? '';
    if (port && Number(port.slice(1)) > 65535) return { route: 'search', text: input };
    if (isHostLike(host) || (port && /^[a-z0-9-]+$/i.test(host) && host.toLowerCase() === 'localhost')) {
      const local = host === 'localhost' || host.endsWith('.localhost') || isIPv4(host) || host.startsWith('[');
      const scheme = local ? 'http://' : 'https://';
      try {
        return { route: 'navigate', url: new URL(scheme + input).href };
      } catch {
        return { route: 'search', text: input };
      }
    }
  }
  return { route: 'search', text: input };
}

export const SEARCH_ENGINES = {
  duckduckgo: { name: 'DuckDuckGo', url: 'https://duckduckgo.com/?q=%s' },
  google: { name: 'Google', url: 'https://www.google.com/search?q=%s' },
  bing: { name: 'Bing', url: 'https://www.bing.com/search?q=%s' },
  brave: { name: 'Brave Search', url: 'https://search.brave.com/search?q=%s' },
  startpage: { name: 'Startpage', url: 'https://www.startpage.com/do/search?q=%s' },
  ecosia: { name: 'Ecosia', url: 'https://www.ecosia.org/search?q=%s' },
  qwant: { name: 'Qwant', url: 'https://www.qwant.com/?q=%s' },
} as const;
export type BuiltinEngineId = keyof typeof SEARCH_ENGINES;
/** 'custom' is the user's own engine (Settings → Search engine). */
export type SearchEngineId = BuiltinEngineId | 'custom';

export interface CustomEngine {
  name: string;
  /** An https URL template with one %s for the query. */
  url: string;
}

let customEngine: CustomEngine | null = null;

/** The browser process keeps this in sync with the `search.custom` pref. */
export function setCustomEngine(e: CustomEngine | null): void {
  customEngine = e && isValidEngineTemplate(e.url) ? e : null;
}

export function isValidEngineTemplate(url: string): boolean {
  if (typeof url !== 'string' || url.length > 2048 || url.split('%s').length !== 2) return false;
  try {
    const u = new URL(url.replace('%s', 'q'));
    return u.protocol === 'https:' && !!u.hostname && !u.username && !u.password;
  } catch {
    return false;
  }
}

function engineOf(id: SearchEngineId): { name: string; url: string } {
  if (id === 'custom') return customEngine ?? SEARCH_ENGINES.duckduckgo;
  return SEARCH_ENGINES[id] ?? SEARCH_ENGINES.duckduckgo;
}

export function engineName(id: SearchEngineId): string {
  return engineOf(id).name;
}

export function searchUrl(engine: SearchEngineId, text: string): string {
  return engineOf(engine).url.replace('%s', encodeURIComponent(text));
}

/** vizulla://x is shown and typed; it maps to the internal pages (DD-6). */
export function isInternalUrl(url: string): boolean {
  return url.startsWith('vizulla://');
}

export function securityStateOf(url: string, certError = false): SecurityState {
  if (certError) return 'dangerous';
  if (url.startsWith('https:')) return 'secure';
  if (url.startsWith('http:')) {
    try {
      const h = new URL(url).hostname;
      // Loopback is a secure context per the spec; don't scare developers.
      if (h === 'localhost' || h === '127.0.0.1' || h === '[::1]') return 'internal';
    } catch {
      /* fallthrough */
    }
    return 'insecure';
  }
  if (url.startsWith('vizulla:') || url.startsWith('about:')) return 'internal';
  if (url.startsWith('file:')) return 'file';
  return 'none';
}

/**
 * The URL as shown in the Command Bar. Like upstream: drop the https:// scheme and
 * a lone trailing slash; keep everything that matters for spoofing (full host).
 * Hosts are shown in punycode when they mix scripts (anti-homograph, CMD-01).
 */
export function displayUrl(url: string): string {
  if (!url || url === 'about:blank') return '';
  try {
    const u = new URL(url);
    if (u.protocol === 'vizulla:' && u.hostname === 'newtab') return '';
    if (u.protocol === 'https:' || u.protocol === 'http:') {
      const host = u.host; // URL already serializes IDNs to punycode: never shows lookalikes.
      let rest = u.pathname === '/' ? '' : u.pathname;
      rest += u.search + u.hash;
      return (u.protocol === 'http:' ? 'http://' : '') + host + safeDecode(rest);
    }
    return url;
  } catch {
    return url;
  }
}

function safeDecode(s: string): string {
  try {
    // Keep encoded spaces and control characters encoded so a URL can't hide its real path.
    return decodeURI(s).replace(/[\s\u0000-\u001f​-‏‪-‮⁦-⁩]/g, encodeURIComponent);
  } catch {
    return s;
  }
}

export function originOf(url: string): string {
  try {
    const u = new URL(url);
    return u.origin === 'null' ? `${u.protocol}//${u.host}` : u.origin;
  } catch {
    return '';
  }
}

export function hostOf(url: string): string {
  try {
    return new URL(url).hostname;
  } catch {
    return '';
  }
}

/** eTLD+1 approximation used for site grouping (Shields exceptions, disclosures). */
export function siteOf(url: string): string {
  const host = hostOf(url);
  if (!host || isIPv4(host) || host.startsWith('[')) return host;
  const labels = host.split('.');
  if (labels.length <= 2) return host;
  const sld = labels.at(-2)!;
  const tld = labels.at(-1)!;
  // co.uk, gov.rw, ac.rw, com.au …
  if (CC_TLDS.has(tld) && /^(co|com|gov|ac|org|net|edu|or|ne|go|mil)$/.test(sld)) return labels.slice(-3).join('.');
  return labels.slice(-2).join('.');
}
