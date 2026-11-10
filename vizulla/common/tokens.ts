// Design tokens: the single source for colors, spacing, radius, and type
// (handbook §6, SET-03). WebUI gets them as CSS custom properties; the browser
// process uses them for native surfaces (window background, view corners).
import type { SpaceColor } from './types';

// The keys are stored identifiers (Spaces, profiles, prefs), so they never change; what
// they look like may. One family with the brand blue, and no violet: `indigo` is
// Vizulla blue and `violet` is coral (see ACCENT_LABELS for their names).
export const ACCENTS: Record<SpaceColor, { light: string; dark: string; soft: string; softDark: string }> = {
  indigo: { light: '#2563eb', dark: '#60a5fa', soft: '#e8f0fe', softDark: '#16294a' },
  teal: { light: '#0d9488', dark: '#2dd4bf', soft: '#e6f7f5', softDark: '#123735' },
  amber: { light: '#b45309', dark: '#fbbf24', soft: '#fdf3e2', softDark: '#3a2e12' },
  rose: { light: '#e11d48', dark: '#fb7185', soft: '#fdecef', softDark: '#3d1a22' },
  violet: { light: '#c2410c', dark: '#fb923c', soft: '#fff1e8', softDark: '#3a2214' },
  emerald: { light: '#059669', dark: '#34d399', soft: '#e7f7ef', softDark: '#143326' },
  sky: { light: '#0284c7', dark: '#38bdf8', soft: '#e6f4fb', softDark: '#13304a' },
  slate: { light: '#475569', dark: '#94a3b8', soft: '#eef1f5', softDark: '#262c36' },
};

/** What each accent is called in the UI. */
export const ACCENT_LABELS: Record<SpaceColor, string> = {
  indigo: 'Blue', teal: 'Teal', amber: 'Amber', rose: 'Rose', violet: 'Coral', emerald: 'Emerald', sky: 'Sky', slate: 'Slate',
};

/** Brand primary (Vizulla blue). Space colors tint Space chips only. */
export const BRAND = { light: '#2563eb', dark: '#60a5fa', soft: '#e8f0fe', softDark: '#16294a' } as const;

/** Profile avatar colors (white initial on top; all pass 4.5:1). */
export const PROFILE_HEX: Record<string, string> = {
  blue: '#2563eb', violet: '#c2410c', rose: '#e11d48', amber: '#b45309', emerald: '#047857', teal: '#0f766e', sky: '#0369a1', slate: '#475569',
};

export const THEMES = {
  light: {
    '--vz-frame': '#e7ecf3',
    '--vz-toolbar': '#ffffff',
    '--vz-omnibox': '#edf1f7',
    '--vz-omnibox-hover': '#e4e9f1',
    '--vz-tab-hover': 'rgba(255,255,255,0.6)',
    '--vz-glass': 'rgba(255,255,255,0.68)',
    '--vz-glass-strong': 'rgba(255,255,255,0.82)',
    '--vz-glass-border': 'rgba(37,99,235,0.14)',
    '--vz-glass-shadow': 'none',
    '--vz-bg': '#eef2f8',
    '--vz-bg-elev': '#ffffff',
    '--vz-surface': 'rgba(255,255,255,0.72)',
    '--vz-surface-2': 'rgba(15,23,42,0.045)',
    '--vz-surface-hover': 'rgba(15,23,42,0.07)',
    '--vz-surface-active': 'rgba(15,23,42,0.11)',
    '--vz-border': 'rgba(15,23,42,0.10)',
    '--vz-border-strong': 'rgba(15,23,42,0.18)',
    '--vz-text': '#0f172a',
    '--vz-text-2': '#475569',
    '--vz-text-3': '#5b6577',
    '--vz-danger': '#dc2626',
    '--vz-warn': '#92400e',
    '--vz-ok': '#166534',
    '--vz-shadow': 'none',
    '--vz-shadow-pop': 'none',
    '--vz-backdrop': 'rgba(15,23,42,0.28)',
    '--vz-focus': '#2563eb',
  },
  dark: {
    '--vz-frame': '#1a1c21',
    '--vz-toolbar': '#26282e',
    '--vz-omnibox': '#1c1e23',
    '--vz-omnibox-hover': '#15171b',
    '--vz-tab-hover': 'rgba(255,255,255,0.06)',
    '--vz-glass': 'rgba(30,34,44,0.66)',
    '--vz-glass-strong': 'rgba(30,34,44,0.84)',
    '--vz-glass-border': 'rgba(147,197,253,0.16)',
    '--vz-glass-shadow': 'none',
    '--vz-bg': '#16181d',
    '--vz-bg-elev': '#1f2229',
    '--vz-surface': 'rgba(32,35,43,0.78)',
    '--vz-surface-2': 'rgba(255,255,255,0.05)',
    '--vz-surface-hover': 'rgba(255,255,255,0.08)',
    '--vz-surface-active': 'rgba(255,255,255,0.13)',
    '--vz-border': 'rgba(255,255,255,0.09)',
    '--vz-border-strong': 'rgba(255,255,255,0.18)',
    '--vz-text': '#eef1f6',
    '--vz-text-2': '#a7b0bf',
    '--vz-text-3': '#9aa3b2',
    '--vz-danger': '#f87171',
    '--vz-warn': '#fbbf24',
    '--vz-ok': '#4ade80',
    '--vz-shadow': 'none',
    '--vz-shadow-pop': 'none',
    '--vz-backdrop': 'rgba(0,0,0,0.45)',
    '--vz-focus': '#60a5fa',
  },
  'high-contrast': {
    '--vz-frame': '#000000',
    '--vz-toolbar': '#000000',
    '--vz-omnibox': '#000000',
    '--vz-omnibox-hover': '#1a1a1a',
    '--vz-tab-hover': '#1a1a1a',
    '--vz-glass': '#000000',
    '--vz-glass-strong': '#000000',
    '--vz-glass-border': '#ffffff',
    '--vz-glass-shadow': 'none',
    '--vz-bg': '#000000',
    '--vz-bg-elev': '#000000',
    '--vz-surface': '#000000',
    '--vz-surface-2': '#000000',
    '--vz-surface-hover': '#1a1a1a',
    '--vz-surface-active': '#333333',
    '--vz-border': '#ffffff',
    '--vz-border-strong': '#ffffff',
    '--vz-text': '#ffffff',
    '--vz-text-2': '#ffffff',
    '--vz-text-3': '#e5e5e5',
    '--vz-danger': '#ff6b6b',
    '--vz-warn': '#ffd60a',
    '--vz-ok': '#3cff8f',
    '--vz-shadow': 'none',
    '--vz-shadow-pop': 'none',
    '--vz-backdrop': 'rgba(0,0,0,0.8)',
    '--vz-focus': '#ffd60a',
  },
} as const;

export type ResolvedTheme = keyof typeof THEMES;

export const SCALE = {
  '--vz-radius-s': '6px',
  '--vz-radius': '10px',
  '--vz-radius-l': '14px',
  '--vz-radius-xl': '20px',
  '--vz-space-1': '4px',
  '--vz-space-2': '8px',
  '--vz-space-3': '12px',
  '--vz-space-4': '16px',
  '--vz-space-6': '24px',
  '--vz-font': "system-ui, -apple-system, 'Segoe UI Variable', 'Segoe UI', Roboto, 'Noto Sans', Ubuntu, sans-serif",
  '--vz-font-mono': "ui-monospace, 'SF Mono', 'Cascadia Code', Menlo, Consolas, monospace",
  '--vz-text-xs': '11px',
  '--vz-text-s': '12px',
  '--vz-text-m': '13px',
  '--vz-text-l': '15px',
  '--vz-text-xl': '20px',
  '--vz-text-2xl': '28px',
  '--vz-ease': 'cubic-bezier(.2,.8,.2,1)',
  '--vz-dur': '160ms',
} as const;

/** Native surfaces that must match WebUI (window background behind views). */
export function windowBackground(theme: ResolvedTheme): string {
  return THEMES[theme]['--vz-bg'];
}

export function cssVariables(theme: ResolvedTheme, accent: SpaceColor): Record<string, string> {
  const a = ACCENTS[accent];
  const dark = theme !== 'light';
  return {
    ...SCALE,
    ...THEMES[theme],
    '--vz-accent': theme === 'high-contrast' ? '#ffd60a' : dark ? BRAND.dark : BRAND.light,
    '--vz-accent-soft': theme === 'high-contrast' ? '#000000' : dark ? BRAND.softDark : BRAND.soft,
    '--vz-space': theme === 'high-contrast' ? '#ffd60a' : dark ? a.dark : a.light,
    '--vz-on-accent': dark ? '#0b0d12' : '#ffffff',
  };
}
