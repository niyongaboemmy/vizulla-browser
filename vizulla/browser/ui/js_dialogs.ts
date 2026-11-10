// JavaScript dialogs (alert, confirm, prompt) as browser-owned overlay dialogs.
// Electron draws alert/confirm as native boxes and doesn't support prompt at all,
// so page_preload.ts replaces the three with synchronous calls into this module:
// the page blocks exactly as with real dialogs while the overlay asks the user.
// - The dialog names who is asking ("example.com says"; an embedded frame says so).
// - From a page's second dialog on, the user can stop it from showing more until it
//   navigates (Chrome's protection against dialog loops).
// - Closing the tab, or the page navigating away, dismisses the dialog.
import { ipcMain, type WebContents } from 'electron';
import type { BrowserApp } from '../browser_app';
import type { OverlayController } from './overlay';

export type JsDialogKind = 'alert' | 'confirm' | 'prompt';

export interface DialogHost {
  overlay: OverlayController;
  /** Bring the asking page forward (activate its tab). */
  focus(): void;
  favicon: string | null;
}

const MAX_TEXT = 10_000;

/** What the page gets back when the user dismisses (or the page may not ask). */
export function fallback(kind: JsDialogKind): boolean | null {
  return kind === 'confirm' ? false : null;
}

/** The dialog's answer as the page sees it. */
export function answer(kind: JsDialogKind, r: { ok?: boolean; value?: string } | null): boolean | string | null {
  if (kind === 'alert') return null;
  if (kind === 'confirm') return !!r?.ok;
  return r?.ok ? String(r.value ?? '').slice(0, MAX_TEXT) : null;
}

export function installJsDialogs(app: BrowserApp): void {
  // Per page (webContents + URL): how many dialogs it has shown, and whether the user stopped it.
  const pages = new WeakMap<WebContents, { url: string; shown: number; blocked: boolean }>();
  const stateOf = (wc: WebContents) => {
    const url = wc.getURL();
    let s = pages.get(wc);
    if (!s || s.url !== url) pages.set(wc, (s = { url, shown: 0, blocked: false }));
    return s;
  };

  ipcMain.on('vz:js-dialog', (e, raw: unknown) => {
    const req = (raw ?? {}) as { kind?: unknown; message?: unknown; value?: unknown };
    const kind: JsDialogKind = req.kind === 'confirm' || req.kind === 'prompt' ? req.kind : 'alert';
    const reply = (v: unknown) => {
      e.returnValue = v;
    };
    const wc = e.sender;
    const host = app.dialogHost(wc);
    const page = stateOf(wc);
    if (!host || page.blocked) return reply(fallback(kind));
    page.shown++;
    host.focus();
    const frameUrl = e.senderFrame?.url ?? wc.getURL();
    const topUrl = wc.getURL();
    let origin = '';
    try {
      origin = new URL(frameUrl).host || new URL(topUrl).host;
    } catch {
      /* about:blank and friends: no origin line */
    }
    let settled = false;
    const done = () => {
      settled = true;
      wc.off('destroyed', onGone);
      wc.off('did-start-navigation', onNav);
    };
    // The page's tab closed, or it left: nothing is waiting for an answer any more.
    const onGone = () => {
      if (!settled && host.overlay.surface?.kind === 'dialog' && (host.overlay.surface.dialog as { wcId?: number }).wcId === wc.id) host.overlay.close();
    };
    const onNav = (_e: unknown, _url: string, _inPlace: boolean, isMainFrame: boolean) => isMainFrame && onGone();
    wc.once('destroyed', onGone);
    wc.on('did-start-navigation', onNav);
    void host.overlay
      .dialog<{ ok?: boolean; value?: string; suppress?: boolean } | null>({
        type: 'js-dialog',
        kind,
        wcId: wc.id,
        message: String(req.message ?? '').slice(0, MAX_TEXT),
        value: String(req.value ?? '').slice(0, MAX_TEXT),
        origin,
        embedded: !!origin && (() => {
          try {
            return new URL(frameUrl).origin !== new URL(topUrl).origin;
          } catch {
            return false;
          }
        })(),
        favicon: host.favicon,
        offerSuppress: page.shown > 1,
      })
      .then((r) => {
        done();
        if (r?.suppress) page.blocked = true;
        if (!wc.isDestroyed()) reply(answer(kind, r));
      });
  });
}
