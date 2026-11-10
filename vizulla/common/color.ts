// Colours for the window frame: the visited site's colour (its theme-color, else its
// page background), and the ink that reads on it. Pure functions (color.test.ts),
// shared by the browser process (caption buttons) and the shell (the frame itself).

export interface Rgba {
  r: number;
  g: number;
  b: number;
  a: number;
}

/** Parses the colours pages and computed styles produce: #rgb, #rgba, #rrggbb, #rrggbbaa, rgb(), rgba(). */
export function parseColor(css: string | null | undefined): Rgba | null {
  if (!css) return null;
  const s = css.trim().toLowerCase();
  const hex = /^#([0-9a-f]{3,8})$/.exec(s);
  if (hex) {
    let h = hex[1]!;
    if (h.length === 3 || h.length === 4) h = [...h].map((c) => c + c).join('');
    if (h.length !== 6 && h.length !== 8) return null;
    const n = (i: number) => parseInt(h.slice(i, i + 2), 16);
    return { r: n(0), g: n(2), b: n(4), a: h.length === 8 ? n(6) / 255 : 1 };
  }
  const fn = /^rgba?\(\s*([\d.]+)[\s,]+([\d.]+)[\s,]+([\d.]+)(?:[\s,/]+([\d.]+%?))?\s*\)$/.exec(s);
  if (fn) {
    const alpha = fn[4] === undefined ? 1 : fn[4].endsWith('%') ? parseFloat(fn[4]) / 100 : parseFloat(fn[4]);
    const c = (v: string) => Math.max(0, Math.min(255, Math.round(parseFloat(v))));
    return { r: c(fn[1]!), g: c(fn[2]!), b: c(fn[3]!), a: Math.max(0, Math.min(1, alpha)) };
  }
  return null;
}

export function toHex(c: Rgba): string {
  return `#${[c.r, c.g, c.b].map((v) => v.toString(16).padStart(2, '0')).join('')}`;
}

/** A page colour usable for the frame: opaque enough to mean something, as #rrggbb (else null). */
export function frameColor(css: string | null | undefined): string | null {
  const c = parseColor(css);
  return c && c.a >= 0.5 ? toHex(c) : null;
}

/** WCAG relative luminance (0 black … 1 white). */
export function luminance(hex: string): number {
  const c = parseColor(hex);
  if (!c) return 1;
  const lin = (v: number) => {
    const x = v / 255;
    return x <= 0.03928 ? x / 12.92 : ((x + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * lin(c.r) + 0.7152 * lin(c.g) + 0.0722 * lin(c.b);
}

/**
 * Dark ink on light colours, light ink on dark ones: whichever contrasts more
 * (ink colours are the theme's text colours).
 */
export function inkFor(hex: string): 'dark' | 'light' {
  const l = luminance(hex);
  const vsDark = (l + 0.05) / (luminance('#0f172a') + 0.05);
  const vsLight = (luminance('#f5f7fa') + 0.05) / (l + 0.05);
  return vsDark >= vsLight ? 'dark' : 'light';
}

/**
 * The site's colour for the frame: its declared theme-color when it agrees with what's on screen
 * (both light or both dark: the brand's exact shade), else what's actually visible at the top of
 * the page. Sites often declare one light theme-color and keep it in their dark mode.
 */
export function choosePageColor(declared: string | null, visible: string | null): string | null {
  if (!declared) return visible;
  if (!visible) return declared;
  return inkFor(declared) === inkFor(visible) ? declared : visible;
}

/** The frame without a site colour: white in light theme, black in dark. */
export function neutralFrame(theme: 'light' | 'dark' | 'high-contrast'): string {
  return theme === 'light' ? '#ffffff' : '#000000';
}
