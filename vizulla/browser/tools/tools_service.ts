// Tools (the toolbar's Tools menu, the ⋮ menu and the command bar): screenshot (visible
// area or full page), save as PDF, print, QR code for the page, read aloud,
// picture-in-picture, colour picker, clear site data. All local, nothing leaves the device.
import { app, clipboard, ClipboardItem, nativeImage, shell } from 'electron';
import { existsSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type { BrowserApp } from '../browser_app';
import type { BrowserWindowController } from '../ui/browser_window';
import { t } from '@vz/common/i18n';

const safeName = (s: string) => s.replace(/[\\/:*?"<>|\u0000-\u001f]+/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 80) || 'Vizulla';
const stamp = () => new Date().toISOString().slice(0, 19).replace('T', ' ').replace(/:/g, '.');
/** "name.png", or "name (2).png" if that exists. */
function freePath(dir: string, name: string, ext: string): string {
  let file = join(dir, `${name}.${ext}`);
  for (let n = 2; existsSync(file); n++) file = join(dir, `${name} (${n}).${ext}`);
  return file;
}

export class ToolsService {
  constructor(private readonly app: BrowserApp) {
    const c = app.commandHandlers;
    c.set('tools.menu', (w) => this.openMenu(w));
    c.set('tools.screenshot', (w) => void this.screenshot(w, false));
    c.set('tools.screenshotFull', (w) => void this.screenshot(w, true));
    c.set('tools.savePdf', (w) => void this.savePdf(w));
    c.set('tools.print', (w) => w.activeTab()?.wc?.print({}, () => undefined));
    c.set('tools.qr', (w) => void this.qr(w));
    c.set('tools.readAloud', (w) => void this.readAloud(w));
    c.set('tools.pip', (w) => void this.pip(w));
    c.set('tools.colorPicker', (w) => void this.colorPicker(w));
    c.set('tools.clearSiteData', (w) => void this.clearSiteData(w));
  }

  /** Where the toolbar's Tools button was, so the menu opens under it. */
  readonly anchors = new WeakMap<BrowserWindowController, { x: number; y: number; width: number; height: number }>();

  openMenu(w: BrowserWindowController, anchor = this.anchors.get(w)): void {
    const tab = w.activeTab();
    const web = !!tab?.url && /^(https?|file):/.test(tab.url);
    w.overlay.show({ kind: 'tools', anchor: anchor ?? { x: w.win.getContentBounds().width - 360, y: 8, width: 32, height: 32 }, web });
  }

  private webTab(w: BrowserWindowController) {
    const tab = w.activeTab();
    return tab?.wc && /^(https?|file|vizulla):/.test(tab.url) ? tab : null;
  }

  private saved(w: BrowserWindowController, text: string, file: string): void {
    w.toast(text, { label: t('tool_show_in_folder'), run: () => shell.showItemInFolder(file) });
  }

  async screenshot(w: BrowserWindowController, full: boolean): Promise<string | null> {
    const tab = this.webTab(w);
    if (!tab?.wc) return null;
    const wc = tab.wc;
    let img: Electron.NativeImage;
    if (full) {
      // Whole page through the DevTools protocol (beyond the viewport, capped at 16k px).
      const attached = wc.debugger.isAttached();
      try {
        if (!attached) wc.debugger.attach('1.3');
        const m = (await wc.debugger.sendCommand('Page.getLayoutMetrics')) as { cssContentSize: { width: number; height: number } };
        const width = Math.ceil(m.cssContentSize.width);
        const height = Math.min(16384, Math.ceil(m.cssContentSize.height));
        const shot = (await wc.debugger.sendCommand('Page.captureScreenshot', { format: 'png', captureBeyondViewport: true, clip: { x: 0, y: 0, width, height, scale: 1 } })) as { data: string };
        img = nativeImage.createFromBuffer(Buffer.from(shot.data, 'base64'));
      } catch {
        img = await wc.capturePage();
      } finally {
        if (!attached && wc.debugger.isAttached()) wc.debugger.detach();
      }
    } else {
      img = await wc.capturePage();
    }
    if (img.isEmpty()) return null;
    const host = (() => {
      try {
        return new URL(tab.url).hostname || 'page';
      } catch {
        return 'page';
      }
    })();
    const file = freePath(app.getPath('downloads'), safeName(`${full ? 'Full-page screenshot' : 'Screenshot'} ${host} ${stamp()}`), 'png');
    writeFileSync(file, img.toPNG());
    void clipboard.write([new ClipboardItem({ 'image/png': new Blob([new Uint8Array(img.toPNG())], { type: 'image/png' }) })]).catch(() => undefined);
    this.saved(w, t('tool_screenshot_saved'), file);
    return file;
  }

  async savePdf(w: BrowserWindowController): Promise<string | null> {
    const tab = this.webTab(w);
    if (!tab?.wc) return null;
    const data = await tab.wc.printToPDF({ printBackground: true, preferCSSPageSize: true });
    const file = freePath(app.getPath('downloads'), safeName(tab.title || 'Page'), 'pdf');
    writeFileSync(file, data);
    this.saved(w, t('tool_pdf_saved'), file);
    return file;
  }

  async qr(w: BrowserWindowController): Promise<void> {
    const tab = w.activeTab();
    if (!tab || !/^https?:/.test(tab.url)) return;
    const r = await w.overlay.dialog<{ action: 'copy' | 'save'; png?: string } | null>({ type: 'qr', url: tab.url, title: tab.title });
    if (r?.action === 'copy') {
      clipboard.writeText(tab.url);
      w.toast(t('tool_link_copied'));
    } else if (r?.action === 'save' && r.png?.startsWith('data:image/png;base64,')) {
      const file = freePath(app.getPath('downloads'), safeName(`QR ${tab.title || 'page'}`), 'png');
      writeFileSync(file, Buffer.from(r.png.slice('data:image/png;base64,'.length), 'base64'));
      this.saved(w, t('tool_qr_saved'), file);
    }
  }

  /** Reads the page's main text with the system voice; running it again stops. */
  async readAloud(w: BrowserWindowController): Promise<void> {
    const wc = this.webTab(w)?.wc;
    if (!wc) return;
    const started = (await wc
      .executeJavaScript(
        `(() => {
          const s = window.speechSynthesis;
          if (s.speaking) { s.cancel(); return false; }
          const root = document.querySelector('article, main, [role=main]') || document.body;
          const text = (root.innerText || '').replace(/\\s+/g, ' ').trim().slice(0, 30000);
          if (!text) return false;
          const u = new SpeechSynthesisUtterance(text);
          u.lang = document.documentElement.lang || navigator.language;
          s.speak(u);
          return true;
        })()`,
        true,
      )
      .catch(() => false)) as boolean;
    if (started) w.toast(t('tool_reading_aloud'), { label: t('action_stop'), run: () => void wc.executeJavaScript('speechSynthesis.cancel()').catch(() => undefined) }, 10_000);
  }

  async pip(w: BrowserWindowController): Promise<void> {
    const wc = this.webTab(w)?.wc;
    if (!wc) return;
    const r = (await wc
      .executeJavaScript(
        `(async () => {
          if (document.pictureInPictureElement) { await document.exitPictureInPicture(); return 'exit'; }
          const v = [...document.querySelectorAll('video')].filter((v) => v.readyState > 0 && !v.disablePictureInPicture)
            .sort((a, b) => b.clientWidth * b.clientHeight - a.clientWidth * a.clientHeight)[0];
          if (!v) return 'none';
          await v.requestPictureInPicture();
          return 'ok';
        })()`,
        true,
      )
      .catch(() => 'none')) as string;
    if (r === 'none') w.toast(t('tool_pip_none'));
  }

  async colorPicker(w: BrowserWindowController): Promise<string | null> {
    const wc = this.webTab(w)?.wc;
    if (!wc) return null;
    const hex = (await wc.executeJavaScript('typeof EyeDropper === "function" ? new EyeDropper().open().then((r) => r.sRGBHex) : null', true).catch(() => null)) as string | null;
    if (!hex) return null;
    clipboard.writeText(hex);
    w.toast(t('tool_color_copied', { color: hex }));
    return hex;
  }

  async clearSiteData(w: BrowserWindowController): Promise<void> {
    const tab = w.activeTab();
    if (!tab?.wc || !/^https?:/.test(tab.url)) return;
    const origin = new URL(tab.url).origin;
    const ses = w.profile.session;
    await ses.clearStorageData({ origin });
    const host = new URL(origin).hostname;
    for (const c of await ses.cookies.get({})) {
      const d = (c.domain ?? '').replace(/^\./, '');
      if (d === host || host.endsWith(`.${d}`)) await ses.cookies.remove(`${c.secure ? 'https' : 'http'}://${d}${c.path ?? '/'}`, c.name).catch(() => undefined);
    }
    tab.wc.reload();
    w.toast(t('tool_site_cleared', { site: host }));
  }
}
