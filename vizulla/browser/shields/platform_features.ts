// R2 privacy features (Track G): fingerprinting protection config and cookie
// banner auto-reject (P4-BRW-10/11). Both respect Shields site exceptions.
import { ipcMain } from 'electron';
import { createHmac, randomBytes } from 'node:crypto';
import type { BrowserApp } from '../browser_app';
import type { WebTab } from '../tabs/web_tab';
import { siteOf } from '@vz/common/url';
import { ISOLATED_WORLD_ID } from '../ai/context/page_scripts';

// Consent-management platforms: the reject button first, then the banner to hide.
export const COOKIE_RULES: { reject: string[]; hide: string[] }[] = [
  { reject: ['#onetrust-reject-all-handler', '.ot-pc-refuse-all-handler'], hide: ['#onetrust-consent-sdk'] },
  { reject: ['#CybotCookiebotDialogBodyButtonDecline', '#CybotCookiebotDialogBodyLevelButtonLevelOptinDeclineAll'], hide: ['#CybotCookiebotDialog'] },
  { reject: ['#didomi-notice-disagree-button', '.didomi-continue-without-agreeing'], hide: ['#didomi-host'] },
  { reject: ['.qc-cmp2-summary-buttons button[mode="secondary"]'], hide: ['.qc-cmp2-container'] },
  { reject: ['[data-testid="uc-deny-all-button"]', '#uc-btn-deny-banner'], hide: ['#usercentrics-root'] },
  { reject: ['.cc-deny', '.cc-dismiss[aria-label*="reject" i]'], hide: ['.cc-window'] },
  { reject: ['#truste-consent-required', '.trustarc-reject-btn'], hide: ['#truste-consent-track'] },
  { reject: ['.fc-cta-do-not-consent'], hide: ['.fc-consent-root'] },
];

const REJECT_TEXT = /^(reject( all)?|decline( all)?|refuse( all)?|deny( all)?|tout refuser|refuser( tout)?|continuer sans accepter|only (necessary|essential)|necessary only|ablehnen|rechazar( todo)?|kanga( byose)?|kataa( yote)?)$/i;

export function cookieBannerScript(): string {
  return `(() => {
    const rules = ${JSON.stringify(COOKIE_RULES)};
    const textRe = ${REJECT_TEXT.toString()};
    let done = false;
    const tryReject = () => {
      if (done) return true;
      for (const r of rules) {
        for (const sel of r.reject) {
          const el = document.querySelector(sel);
          if (el && el.offsetParent !== null) { el.click(); done = true; return true; }
        }
      }
      const banner = [...document.querySelectorAll('[id*="cookie" i], [class*="cookie" i], [id*="consent" i], [class*="consent" i], [aria-label*="cookie" i]')].slice(0, 20);
      for (const b of banner) {
        for (const btn of b.querySelectorAll('button, a[role="button"], [role="button"]')) {
          if (textRe.test((btn.textContent || '').trim())) { btn.click(); done = true; return true; }
        }
      }
      return false;
    };
    if (tryReject()) return true;
    const mo = new MutationObserver(() => { if (tryReject()) mo.disconnect(); });
    mo.observe(document.documentElement, { childList: true, subtree: true });
    setTimeout(() => mo.disconnect(), 10000);
    return false;
  })()`;
}

export function installPlatformFeatures(app: BrowserApp): void {
  const p = app.profile;
  const sessionSecret = randomBytes(32); // farbling changes every browser session
  ipcMain.on('vz:farble-config', (e) => {
    const top = e.senderFrame?.top?.url ?? e.sender.getURL();
    const level = p.shields.isSiteEnabled(top) ? p.prefs.get('shields.fingerprinting') : 'off';
    const seed = createHmac('sha256', sessionSecret).update(siteOf(top)).digest().readUInt32LE(0);
    e.returnValue = { level, seed };
  });
  try {
    p.session.registerPreloadScript({ type: 'frame', id: 'vz-farble', filePath: app.joinOut('preload', 'farble_preload.js') });
  } catch (err) {
    console.warn('[vz] fingerprinting protection unavailable', err);
  }
  app.hooks.windowCreated.push((w) => {
    w.on('tab-dom-ready', (tab: WebTab) => {
      if (!p.prefs.get('shields.cookieBanners') || !tab.wc || !/^https?:/.test(tab.url) || !p.shields.isSiteEnabled(tab.url)) return;
      void tab.wc.executeJavaScriptInIsolatedWorld(ISOLATED_WORLD_ID + 1, [{ code: cookieBannerScript() }]).catch(() => undefined);
    });
  });
}
