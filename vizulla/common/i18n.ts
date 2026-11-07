// String resources (the .grd role). UI text is never hard-coded: components call
// t('key'). Catalogs ship in the bundle (no remote strings). Missing keys fall back
// to English, then to the key itself so gaps are visible in pseudo-locale runs.
import en from '../strings/en.json';
import fr from '../strings/fr.json';
import rw from '../strings/rw.json';
import sw from '../strings/sw.json';

export type StringKey = keyof typeof en;
export const LOCALES = { en: 'English', fr: 'Français', rw: 'Ikinyarwanda', sw: 'Kiswahili' } as const;
export type Locale = keyof typeof LOCALES;

const CATALOGS: Record<Locale, Partial<Record<StringKey, string>>> = { en, fr, rw, sw };

let current: Locale = 'en';
let pseudo = false;

export function setLocale(locale: string): void {
  if (locale === 'pseudo') {
    pseudo = true;
    current = 'en';
    return;
  }
  pseudo = false;
  const base = locale.split(/[-_]/)[0] as Locale;
  current = base in CATALOGS ? base : 'en';
}

export function getLocale(): Locale {
  return current;
}

export function resolveLocale(preferred: readonly string[]): Locale {
  for (const p of preferred) {
    const base = p.split(/[-_]/)[0]!.toLowerCase();
    if (base in CATALOGS) return base as Locale;
  }
  return 'en';
}

const ACCENTED: Record<string, string> = { a: 'á', e: 'é', i: 'í', o: 'ö', u: 'ü', c: 'ç', n: 'ñ', A: 'Å', E: 'É', I: 'Î', O: 'Ø', U: 'Û' };

/** Pseudo-locale: accented and 40% longer, to catch truncation and hard-coded text (P2-UX-01). */
function pseudoize(s: string): string {
  const body = s.replace(/\{[^}]+\}|./g, (m) => (m.length > 1 ? m : (ACCENTED[m] ?? m)));
  return `[${body}${'·'.repeat(Math.ceil(s.length * 0.4))}]`;
}

export function t(key: StringKey, params?: Record<string, string | number>): string {
  let s = CATALOGS[current][key] ?? en[key] ?? key;
  if (params) s = s.replace(/\{(\w+)\}/g, (m, k: string) => (k in params ? String(params[k]) : m));
  return pseudo ? pseudoize(s) : s;
}

/** Plural helper: keys `x_one` / `x_other`. */
export function tn(base: string, count: number, params: Record<string, string | number> = {}): string {
  const rule = new Intl.PluralRules(current).select(count);
  const key = (`${base}_${rule}` in en ? `${base}_${rule}` : `${base}_other`) as StringKey;
  return t(key, { count, ...params });
}

export function isRtl(locale: string): boolean {
  return /^(ar|he|fa|ur)\b/.test(locale);
}
