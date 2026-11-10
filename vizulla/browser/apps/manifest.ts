// Web app manifests (W3C Web Application Manifest): parsing with the spec's URL rules
// and Chrome's installability criteria. Pure functions, no Electron (manifest.test.ts).
//   Installable = a name, an icon, a start URL on the page's origin, and a display mode
//   that opens in its own window (standalone, fullscreen, minimal-ui, window-controls-overlay).

export type DisplayMode = 'fullscreen' | 'standalone' | 'minimal-ui' | 'browser' | 'window-controls-overlay';

export interface ManifestIcon {
  src: string;
  sizes: number[]; // largest edge of each declared size; 0 = "any" (scalable)
  type: string;
  purpose: ('any' | 'maskable' | 'monochrome')[];
}

export interface WebAppManifest {
  /** Stable identity (manifest `id`, else the start URL): reinstalling the same app updates it. */
  id: string;
  name: string;
  shortName: string;
  description: string;
  startUrl: string;
  scope: string;
  display: DisplayMode;
  themeColor: string | null;
  backgroundColor: string | null;
  icons: ManifestIcon[];
  manifestUrl: string;
}

const DISPLAYS: DisplayMode[] = ['fullscreen', 'standalone', 'minimal-ui', 'browser', 'window-controls-overlay'];
const WINDOWED: DisplayMode[] = ['fullscreen', 'standalone', 'minimal-ui', 'window-controls-overlay'];

const str = (v: unknown, max = 200): string => (typeof v === 'string' ? v.trim().replace(/\s+/g, ' ').slice(0, max) : '');

function resolve(raw: unknown, base: string): URL | null {
  if (typeof raw !== 'string' || !raw.trim()) return null;
  try {
    return new URL(raw.trim(), base);
  } catch {
    return null;
  }
}

/** A CSS colour the manifest declared, kept only if it's a plain hex/rgb/hsl/name value. */
function color(v: unknown): string | null {
  const s = str(v, 40);
  return /^(#[0-9a-f]{3,8}|rgba?\([\d\s.,%]+\)|hsla?\([\d\s.,%deg]+\)|[a-z]{3,20})$/i.test(s) ? s : null;
}

function within(url: URL, scope: URL): boolean {
  return url.origin === scope.origin && url.pathname.startsWith(scope.pathname);
}

/**
 * Parses a manifest the page at `documentUrl` linked from `manifestUrl`. Returns null when it
 * isn't JSON, or can't describe an app (no usable start URL on the page's origin).
 */
export function parseManifest(text: string, manifestUrl: string, documentUrl: string): WebAppManifest | null {
  let json: Record<string, unknown>;
  try {
    const v = JSON.parse(text) as unknown;
    if (!v || typeof v !== 'object' || Array.isArray(v)) return null;
    json = v as Record<string, unknown>;
  } catch {
    return null;
  }
  const doc = resolve(documentUrl, documentUrl);
  if (!doc) return null;
  // start_url: resolved against the manifest; must share the document's origin, else the document.
  let start = resolve(json.start_url, manifestUrl);
  if (!start || start.origin !== doc.origin) start = doc;
  start.hash = '';
  // scope: resolved against the manifest; the start URL must be inside it, else the start URL's directory.
  let scope = resolve(json.scope, manifestUrl);
  const defaultScope = new URL('.', start);
  if (!scope || !within(start, scope)) scope = defaultScope;
  scope.search = '';
  scope.hash = '';
  // id: resolved against the start URL's origin; must share it, else the start URL.
  let id = resolve(json.id, start.origin);
  if (!id || id.origin !== start.origin) id = new URL(start.href);
  id.hash = '';
  const icons: ManifestIcon[] = (Array.isArray(json.icons) ? json.icons : [])
    .slice(0, 50)
    .map((i): ManifestIcon | null => {
      const o = (i ?? {}) as Record<string, unknown>;
      const src = resolve(o.src, manifestUrl);
      if (!src || !/^(https?|data):$/.test(src.protocol)) return null;
      const sizes = str(o.sizes, 100)
        .toLowerCase()
        .split(' ')
        .filter(Boolean)
        .map((s) => (s === 'any' ? 0 : Math.max(...s.split('x').map((n) => Number(n) || 0))));
      const purpose = str(o.purpose, 60).toLowerCase().split(' ').filter((p): p is ManifestIcon['purpose'][number] => p === 'any' || p === 'maskable' || p === 'monochrome');
      return { src: src.href, sizes: sizes.length ? sizes : [0], type: str(o.type, 40).toLowerCase(), purpose: purpose.length ? purpose : ['any'] };
    })
    .filter((x): x is ManifestIcon => !!x);
  const name = str(json.name) || str(json.short_name);
  const display = DISPLAYS.includes(json.display as DisplayMode) ? (json.display as DisplayMode) : 'browser';
  return {
    id: id.href,
    name,
    shortName: str(json.short_name, 60) || name,
    description: str(json.description, 400),
    startUrl: start.href,
    scope: scope.href,
    display,
    themeColor: color(json.theme_color),
    backgroundColor: color(json.background_color),
    icons,
    manifestUrl,
  };
}

/** Why a manifest can't be installed (Chrome's criteria), or null when it can. */
export function notInstallable(m: WebAppManifest | null): 'no-manifest' | 'no-name' | 'no-icon' | 'browser-display' | null {
  if (!m) return 'no-manifest';
  if (!m.name) return 'no-name';
  if (!m.icons.some((i) => i.purpose.includes('any') || i.purpose.includes('maskable'))) return 'no-icon';
  if (!WINDOWED.includes(m.display)) return 'browser-display';
  return null;
}

/**
 * The icon to use for an app at `want` px: a regular ("any") icon at least that big, else the
 * biggest; maskable icons only when nothing else exists (they're drawn full-bleed).
 */
export function bestIcon(icons: ManifestIcon[], want = 512): ManifestIcon | null {
  const score = (i: ManifestIcon) => {
    const size = i.sizes.includes(0) ? 4096 : Math.max(...i.sizes);
    const raster = /svg/.test(i.type) || /\.svg(\?|$)/i.test(i.src) ? 0 : 1;
    // Prefer: "any" purpose, big enough (but the smallest such), raster (OS icons need pixels).
    return (i.purpose.includes('any') ? 1e7 : 0) + (size >= want ? 1e6 - size : size) + raster * 10;
  };
  return [...icons].filter((i) => !i.purpose.every((p) => p === 'monochrome')).sort((a, b) => score(b) - score(a))[0] ?? null;
}

/** Whether a URL belongs in the app's window (inside its scope) or opens in the browser. */
export function inScope(url: string, scope: string): boolean {
  try {
    return within(new URL(url), new URL(scope));
  } catch {
    return false;
  }
}

/** A file-system-safe, readable name for shortcuts ("My App: Tasks" → "My App Tasks"). */
export function shortcutName(name: string): string {
  const s = name.replace(/[\\/:*?"<>|\u0000-\u001f]+/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 60);
  return s || 'Web App';
}
