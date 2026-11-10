// Applies design tokens as CSS custom properties (one source, handbook §6).
import { cssVariables, type ResolvedTheme } from '@vz/common/tokens';
import type { SpaceColor, ThemePref } from '@vz/common/types';
import { isRtl, setLocale } from '@vz/common/i18n';

let lastPref: ThemePref = 'system';
let lastAccent: SpaceColor = 'indigo';
const media = matchMedia('(prefers-color-scheme: dark)');
const contrast = matchMedia('(forced-colors: active)');

export function resolveTheme(pref: ThemePref | string): ResolvedTheme {
  if (pref === 'high-contrast' || contrast.matches) return 'high-contrast';
  if (pref === 'light' || pref === 'dark') return pref;
  return media.matches ? 'dark' : 'light';
}

export function applyTheme(pref: ThemePref | string, accent: SpaceColor | string, density: 'comfortable' | 'compact' = 'comfortable'): ResolvedTheme {
  lastPref = pref as ThemePref;
  lastAccent = accent as SpaceColor;
  const resolved = resolveTheme(pref);
  const root = document.documentElement;
  // Switching between light and dark cross-fades the whole page (View Transitions), instead of snapping.
  const before = root.dataset.theme;
  const fade = before && before !== resolved && 'startViewTransition' in document && !matchMedia('(prefers-reduced-motion: reduce)').matches;
  if (fade) {
    (document as Document & { startViewTransition(cb: () => void): unknown }).startViewTransition(() => paint(resolved, accent as SpaceColor, density));
    return resolved;
  }
  paint(resolved, accent as SpaceColor, density);
  return resolved;
}

function paint(resolved: ResolvedTheme, accent: SpaceColor, density: 'comfortable' | 'compact'): void {
  const root = document.documentElement;
  for (const [k, val] of Object.entries(cssVariables(resolved, accent as SpaceColor))) root.style.setProperty(k, val);
  root.dataset.theme = resolved;
  root.dataset.density = density;
  root.style.colorScheme = resolved === 'light' ? 'light' : 'dark';
}

media.addEventListener('change', () => applyTheme(lastPref, lastAccent, (document.documentElement.dataset.density as 'compact') ?? 'comfortable'));

export function applyLocale(locale: string): void {
  setLocale(locale);
  document.documentElement.lang = locale === 'pseudo' ? 'en' : locale;
  document.documentElement.dir = isRtl(locale) ? 'rtl' : 'ltr';
}
