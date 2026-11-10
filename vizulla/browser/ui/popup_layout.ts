// Where a popup window goes and what its title bar says (ui/popup_window.ts). Pure functions.

/** window.open features ("width=500,height=600,left=10,top=20") → the window's bounds, kept on screen. */
export function popupBounds(features: string, opener: { x: number; y: number; width: number; height: number }, area: { x: number; y: number; width: number; height: number }) {
  const f = Object.fromEntries(features.split(',').map((p) => p.trim().split('=').map((s) => s.trim().toLowerCase())).filter((kv) => kv.length === 2)) as Record<string, string>;
  const num = (k: string, alt?: string) => {
    const v = parseInt(f[k] ?? (alt ? f[alt] : '') ?? '', 10);
    return Number.isFinite(v) ? v : null;
  };
  const width = Math.min(area.width, Math.max(320, num('width', 'innerwidth') ?? 500));
  const height = Math.min(area.height, Math.max(320, num('height', 'innerheight') ?? 620));
  const left = num('left', 'screenx');
  const top = num('top', 'screeny');
  // No position given: centred over the window that opened it.
  const x = left ?? Math.round(opener.x + (opener.width - width) / 2);
  const y = top ?? Math.round(opener.y + Math.min(80, (opener.height - height) / 2));
  return {
    width,
    height,
    x: Math.max(area.x, Math.min(x, area.x + area.width - width)),
    y: Math.max(area.y, Math.min(y, area.y + area.height - height)),
  };
}

/** What the title bar says: always the site (marked when the connection isn't secure), then the page's title. */
export function popupTitle(url: string, title: string, notSecure: string): string {
  let site = url;
  let secure = false;
  try {
    const u = new URL(url);
    site = u.host || url;
    secure = u.protocol === 'https:';
  } catch {
    /* about:blank while it starts */
  }
  if (!site || site === 'about:blank') return title || ' ';
  const head = secure ? site : `${notSecure} · ${site}`;
  return title && title !== site && title !== url ? `${head} — ${title}` : head;
}
