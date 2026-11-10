// Google accounts signed in on the web, as Chrome's account menu shows them: parsed from
// accounts.google.com/ListAccounts (the endpoint Chromium's GaiaCookieManager reads), plus the
// URLs that switch, add, manage and sign out accounts. Pure functions (accounts.test.ts).

export interface GoogleAccount {
  /** The `authuser` index Google services take (/u/N/); -1 for a signed-out account. */
  index: number;
  id: string;
  name: string;
  email: string;
  photo: string | null;
  /** Remembered on this computer but signed out: shown dimmed, with "Sign in again". */
  signedOut: boolean;
}

/**
 * ListAccounts body: ["gaia.l.a.r", [["gaia.l.a", 1, name, email, photo, valid, …, gaiaId (10), …, signedOut (14)], …]].
 * Signed-in accounts come first, in authuser order.
 */
export function parseListAccounts(body: string): GoogleAccount[] {
  let data: unknown;
  try {
    data = JSON.parse(body.replace(/^\)\]\}'\s*/, ''));
  } catch {
    return [];
  }
  if (!Array.isArray(data) || data[0] !== 'gaia.l.a.r' || !Array.isArray(data[1])) return [];
  const out: GoogleAccount[] = [];
  let next = 0;
  for (const a of data[1] as unknown[]) {
    if (!Array.isArray(a) || typeof a[3] !== 'string' || !a[3].includes('@')) continue;
    if (a[5] === 0) continue; // an invalid session Google is about to drop
    const signedOut = a[14] === 1;
    out.push({
      index: signedOut ? -1 : next++,
      id: typeof a[10] === 'string' ? a[10] : a[3],
      name: typeof a[2] === 'string' && a[2].trim() ? a[2].trim() : a[3].split('@')[0]!,
      email: a[3],
      photo: typeof a[4] === 'string' && /^https:\/\//.test(a[4]) ? a[4] : null,
      signedOut,
    });
  }
  return out;
}

/** A Google profile photo URL at a given square size (both the old /s48-c/photo.jpg and the =s48-c forms). */
export function photoAt(url: string, px: number): string {
  if (/\/s\d+(-c)?\/photo\.jpg$/.test(url)) return url.replace(/\/s\d+(-c)?\/photo\.jpg$/, `/s${px}-c/photo.jpg`);
  if (/=[sw]\d+[^/]*$/.test(url)) return url.replace(/=[sw]\d+[^/]*$/, `=s${px}-c`);
  return `${url}=s${px}-c`;
}

export function isGoogleHost(host: string): boolean {
  return /(^|\.)google\.com$/.test(host);
}

/** Hosts the Gemini panel may show itself (sign-in, images); anything else opens in a tab. */
export function isGeminiPanelHost(host: string): boolean {
  return isGoogleHost(host) || /(^|\.)(gstatic|googleusercontent|googleapis)\.com$/.test(host);
}

export function geminiUrl(index: number): string {
  return index > 0 ? `https://gemini.google.com/u/${index}/app` : 'https://gemini.google.com/app';
}

const PATH_SERVICES: Record<string, string> = {
  'mail.google.com': '/mail/u/N/',
  'drive.google.com': '/drive/u/N/',
  'calendar.google.com': '/calendar/u/N/r',
  'gemini.google.com': '/u/N/app',
  'photos.google.com': '/u/N/',
  'keep.google.com': '/u/N/',
  'meet.google.com': '/?authuser=N',
};

/**
 * The same Google page as another signed-in account: services with /u/N/ paths switch the number,
 * mail/drive/calendar/Gemini go to their home as that account, the rest take ?authuser=N.
 * Non-Google URLs come back unchanged.
 */
export function withAuthUser(url: string, index: number): string {
  let u: URL;
  try {
    u = new URL(url);
  } catch {
    return url;
  }
  if (u.protocol !== 'https:' || !isGoogleHost(u.hostname) || index < 0) return url;
  if (/^(\/[^/]+)?\/u\/\d+(\/|$)/.test(u.pathname)) {
    u.pathname = u.pathname.replace(/\/u\/\d+(\/|$)/, `/u/${index}$1`);
    u.searchParams.delete('authuser');
    return u.toString();
  }
  const home = PATH_SERVICES[u.hostname];
  if (home) return `https://${u.hostname}${home.replace('N', String(index))}`;
  u.searchParams.set('authuser', String(index));
  return u.toString();
}

const enc = encodeURIComponent;
export const googleUrls = {
  add: (continueUrl = 'https://www.google.com/') => `https://accounts.google.com/AddSession?continue=${enc(continueUrl)}`,
  signIn: (continueUrl = 'https://www.google.com/') => `https://accounts.google.com/ServiceLogin?continue=${enc(continueUrl)}`,
  signInAgain: (email: string) => `https://accounts.google.com/AccountChooser?Email=${enc(email)}&continue=${enc('https://www.google.com/')}`,
  manage: (index: number) => `https://myaccount.google.com/?authuser=${Math.max(0, index)}`,
  signOut: () => 'https://accounts.google.com/Logout',
};
