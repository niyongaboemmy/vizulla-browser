// Passkey sign-in (WebAuthn) without a silent hang. Electron has no WebAuthn UI: a passkey
// request waits for a security key with nothing on screen, and sites (Google's "Verifying it's
// you…") look stuck. page_preload.ts reports each pending request; this shows a browser-owned
// sheet for it:
// - Insert and touch a security key: the request completes and the sheet goes away by itself.
// - "Sign in another way" (or Escape) ends the request as Chrome's Cancel does (NotAllowedError),
//   so the site offers its other methods: password, a code, a prompt on your phone.
// - "Keep waiting" hides the sheet and leaves the request running.
// Passkeys in iCloud Keychain, password managers or on a phone need OS integration Electron only
// grants to Apple-provisioned, signed browsers, so the sheet says so instead of pretending.
// Windows routes WebAuthn to its own system dialog (Windows Hello, phone, keys): no sheet there.
import { ipcMain, type WebContents, type WebFrameMain } from 'electron';
import type { BrowserApp } from '../browser_app';

/** Requests that settle this fast (a key already touched, an immediate error) never show a sheet. */
const SHOW_AFTER_MS = 350;

interface Pending {
  wc: WebContents;
  frame: WebFrameMain | null;
  id: number;
  ended: boolean;
  timer: NodeJS.Timeout | null;
  shown: boolean;
  cleanup: () => void;
}

export function installPasskeys(app: BrowserApp): void {
  const pending = new Map<string, Pending>();
  const keyOf = (wc: WebContents, frame: WebFrameMain | null, id: number) => `${wc.id}:${frame?.processId ?? 0}:${frame?.routingId ?? 0}:${id}`;

  const cancel = (p: Pending) => {
    try {
      if (p.frame && !p.frame.isDestroyed()) p.frame.send('vz:webauthn-cancel', p.id);
    } catch {
      /* the frame went away: its request went with it */
    }
  };

  const finish = (key: string) => {
    const p = pending.get(key);
    if (!p) return;
    pending.delete(key);
    p.ended = true;
    p.cleanup();
    if (p.timer) clearTimeout(p.timer);
    // The key was touched or the page gave up: take the sheet down without cancelling anything.
    const host = p.shown ? app.dialogHost(p.wc) : null;
    const s = host?.overlay.surface;
    if (s?.kind === 'dialog' && (s.dialog as { passkey?: string }).passkey === key) host!.overlay.close();
  };

  const show = (key: string, kind: 'get' | 'create', site: string) => {
    const p = pending.get(key);
    if (!p || p.ended) return;
    const host = app.dialogHost(p.wc);
    if (!host) return;
    p.shown = true;
    host.focus();
    void host.overlay
      .dialog<{ action?: 'other' | 'wait' } | null>({ type: 'passkey', passkey: key, kind, site, platform: process.platform, favicon: host.favicon })
      .then((r) => {
        if (p.ended || r?.action === 'wait') return;
        cancel(p);
      });
  };

  ipcMain.on('vz:webauthn', (e, raw: unknown) => {
    const m = (raw ?? {}) as { op?: unknown; id?: unknown; kind?: unknown; rpId?: unknown };
    if (typeof m.id !== 'number' || !Number.isSafeInteger(m.id)) return;
    const wc = e.sender;
    const frame = e.senderFrame ?? null;
    const key = keyOf(wc, frame, m.id);
    if (m.op === 'end') return finish(key);
    if (m.op !== 'begin' || pending.has(key)) return;
    const kind = m.kind === 'create' ? 'create' : 'get';
    const site = typeof m.rpId === 'string' && /^[a-z0-9.-]{1,253}$/i.test(m.rpId) ? m.rpId : (() => {
      try {
        return new URL(frame?.url ?? wc.getURL()).hostname;
      } catch {
        return '';
      }
    })();
    // The page left or its tab closed: nothing is waiting any more.
    const gone = () => finish(key);
    const nav = (_e: unknown, _url: string, _inPlace: boolean, isMainFrame: boolean) => isMainFrame && gone();
    wc.once('destroyed', gone);
    wc.on('did-start-navigation', nav);
    const p: Pending = {
      wc, frame, id: m.id, ended: false, shown: false, timer: null,
      cleanup: () => {
        if (wc.isDestroyed()) return;
        wc.off('destroyed', gone);
        wc.off('did-start-navigation', nav);
      },
    };
    p.timer = setTimeout(() => show(key, kind, site), SHOW_AFTER_MS);
    pending.set(key, p);
  });
}
