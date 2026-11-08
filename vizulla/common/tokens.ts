// Design tokens: the single source for colors, spacing, radius, and type
// (handbook §6, SET-03). WebUI gets them as CSS custom properties; the browser
// process uses them for native surfaces (window background, view corners).
import type { SpaceColor } from './types';

export const ACCENTS: Record<SpaceColor, { light: string; dark: string; soft: string; softDark: string }> = {
  indigo: { light: '#4f46e5', dark: '#8b8cf8', soft: '#eef0ff', softDark: '#25264a' },
  teal: { light: '#0d9488', dark: '#2dd4bf', soft: '#e6f7f5', softDark: '#123735' },
  amber: { light: '#b45309', dark: '#fbbf24', soft: '#fdf3e2', softDark: '#3a2e12' },
  rose: { light: '#e11d48', dark: '#fb7185', soft: '#fdecef', softDark: '#3d1a22' },
  violet: { light: '#7c3aed', dark: '#a78bfa', soft: '#f3edff', softDark: '#2e2245' },
  emerald: { light: '#059669', dark: '#34d399', soft: '#e7f7ef', softDark: '#143326' },
  sky: { light: '#0284c7', dark: '#38bdf8', soft: '#e6f4fb', softDark: '#13304a' },
  slate: { light: '#475569', dark: '#94a3b8', soft: '#eef1f5', softDark: '#262c36' },
};

export const THEMES = {
  light: {
    '--vz-frame': '#e3e7ee',
    '--vz-toolbar': '#ffffff',
    '--vz-omnibox': '#eef1f6',
    '--vz-omnibox-hover': '#e4e8ef',
    '--vz-tab-hover': 'rgba(255,255,255,0.55)',
    '--vz-glass': 'rgba(255,255,255,0.74)',
    '--vz-glass-strong': 'rgba(255,255,255,0.88)',
    '--vz-glass-border': 'rgba(255,255,255,0.7)',
    '--vz-glass-shadow': '0 0 0 1px rgba(15,23,42,.06), 0 12px 32px -8px rgba(15,23,42,.18), 0 32px 80px -24px rgba(15,23,42,.28)',
    '--vz-bg': '#eceef3',
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
    '--vz-shadow': '0 1px 2px rgba(15,23,42,.06), 0 8px 24px rgba(15,23,42,.08)',
    '--vz-shadow-pop': '0 2px 6px rgba(15,23,42,.08), 0 24px 64px rgba(15,23,42,.22)',
    '--vz-backdrop': 'rgba(15,23,42,0.28)',
    '--vz-focus': '#2563eb',
  },
  dark: {
    '--vz-frame': '#1a1c21',
    '--vz-toolbar': '#26282e',
    '--vz-omnibox': '#1c1e23',
    '--vz-omnibox-hover': '#15171b',
    '--vz-tab-hover': 'rgba(255,255,255,0.06)',
    '--vz-glass': 'rgba(38,40,46,0.72)',
    '--vz-glass-strong': 'rgba(38,40,46,0.9)',
    '--vz-glass-border': 'rgba(255,255,255,0.09)',
    '--vz-glass-shadow': '0 0 0 1px rgba(0,0,0,.4), 0 12px 32px -8px rgba(0,0,0,.5), 0 32px 80px -24px rgba(0,0,0,.6)',
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
    '--vz-shadow': '0 1px 2px rgba(0,0,0,.4), 0 8px 24px rgba(0,0,0,.35)',
    '--vz-shadow-pop': '0 2px 8px rgba(0,0,0,.5), 0 24px 64px rgba(0,0,0,.55)',
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
    '--vz-accent': theme === 'high-contrast' ? '#ffd60a' : dark ? a.dark : a.light,
    '--vz-accent-soft': theme === 'high-contrast' ? '#000000' : dark ? a.softDark : a.soft,
    '--vz-on-accent': dark ? '#0b0d12' : '#ffffff',
  };
}
