// R2 privacy features (Track G): fingerprinting protection config, cookie banner
// auto-reject (P4-BRW-10/11) and WebRTC IP-leak protection. All respect Shields site exceptions.
import { app as electronApp, ipcMain, webContents, type Session, type WebContents } from 'electron';
import { createHmac, randomBytes } from 'node:crypto';
import type { BrowserApp } from '../browser_app';
import { WebTab } from '../tabs/web_tab';
import { t } from '@vz/common/i18n';
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
  // Farbling changes every browser session, and every private window has its own secret,
  // so private browsing can't be linked to normal browsing.
  const secrets = new WeakMap<Session, Buffer>();
  app.farbleConfig = (ses, top) => {
    let secret = secrets.get(ses);
    if (!secret) secrets.set(ses, (secret = randomBytes(32)));
    // Private windows always get strict protection (unless the site is an exception).
    const level = !p.shields.isSiteEnabled(top) ? 'off' : ses !== p.session ? 'strict' : p.prefs.get('shields.fingerprinting');
    return { level, seed: createHmac('sha256', secret).update(siteOf(top)).digest().readUInt32LE(0) };
  };
  // WebRTC never reveals local addresses (or the real IP behind a VPN): normal windows use
  // the public interface only; private windows send no UDP outside a proxy at all.
  const applyWebRtc = (wc: WebContents) => {
    if (wc.session === app.chromeSession) return;
    const policy = !p.prefs.get('shields.webrtcProtection') ? 'default' : wc.session.storagePath === null ? 'disable_non_proxied_udp' : 'default_public_interface_only';
    wc.setWebRTCIPHandlingPolicy(policy);
  };
  electronApp.on('web-contents-created', (_e, wc) => applyWebRtc(wc));
  p.prefs.observe('shields.webrtcProtection', () => {
    for (const wc of webContents.getAllWebContents()) if (wc.getType() !== 'window') applyWebRtc(wc);
  });
  // Popups (Chrome's rules; Electron has no popup blocker): a page opens a tab only right
  // after a real click or key press, one per gesture, and never to a popup/popunder network.
  const ACTIVATION_MS = 5000;
  const activations = new WeakMap<WebContents, number>();
  ipcMain.on('vz:activation', (e) => activations.set(e.sender, Date.now()));
  WebTab.popupPolicy = (opener, url, disposition) => {
    const from = opener.getURL();
    if (!/^https?:/.test(from)) return true;
    const listed = p.shields.blocksPopup(url, from);
    const gesture = Date.now() - (activations.get(opener) ?? 0) < ACTIVATION_MS;
    if (!listed && gesture) {
      if (disposition !== 'background-tab') activations.delete(opener); // one popup per gesture
      return true;
    }
    const found = app.findTabByWebContents(opener);
    if (found && /^https?:/.test(url) && !listed) found.window.toast(t('popup_blocked'), { label: t('action_open'), run: () => found.window.loadUrl(null, url, { newTab: true }) });
    if (opener.id !== undefined && listed) p.shields.countBlocked(opener.id, 'ads');
    return false;
  };
  app.hooks.windowCreated.push((w) => {
    w.on('tab-dom-ready', (tab: WebTab) => {
      if (!p.prefs.get('shields.cookieBanners') || !tab.wc || !/^https?:/.test(tab.url) || !p.shields.isSiteEnabled(tab.url)) return;
      void tab.wc.executeJavaScriptInIsolatedWorld(ISOLATED_WORLD_ID + 1, [{ code: cookieBannerScript() }]).catch(() => undefined);
    });
  });
}
