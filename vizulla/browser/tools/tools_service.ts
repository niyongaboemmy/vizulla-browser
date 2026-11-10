// Tools (the toolbar's Tools menu, the ⋮ menu and the command bar): screenshot (visible
// area or full page), save as PDF, print, QR code for the page, read aloud,
// picture-in-picture, colour picker, clear site data. All local, nothing leaves the device.
import { app, clipboard, ClipboardItem, nativeImage, shell } from 'electron';
import { existsSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type { BrowserApp } from '../browser_app';
import type { BrowserWindowController } from '../ui/browser_window';
import { t } from '@vz/common/i18n';
import { detect, pageProbe, probeTargets, type Detected } from './tech/detect';
import { captureFullPage } from './full_page_capture';

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
    c.set('tools.techStack', (w) => void this.techStack(w));
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
      // Scroll and stitch (lazy content loads, sticky headers show once); the DevTools
      // beyond-the-viewport capture is the fallback.
      img = (await captureFullPage(wc).catch((e) => (console.warn('[vz] scrolling screenshot failed', e), null))) ?? (await this.captureBeyondViewport(wc));
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

  private async captureBeyondViewport(wc: Electron.WebContents): Promise<Electron.NativeImage> {
    const attached = wc.debugger.isAttached();
    try {
      if (!attached) wc.debugger.attach('1.3');
      const m = (await wc.debugger.sendCommand('Page.getLayoutMetrics')) as { cssContentSize: { width: number; height: number } };
      const width = Math.ceil(m.cssContentSize.width);
      const height = Math.min(16384, Math.ceil(m.cssContentSize.height));
      const shot = (await wc.debugger.sendCommand('Page.captureScreenshot', { format: 'png', captureBeyondViewport: true, clip: { x: 0, y: 0, width, height, scale: 1 } })) as { data: string };
      return nativeImage.createFromBuffer(Buffer.from(shot.data, 'base64'));
    } catch {
      return wc.capturePage();
    } finally {
      if (!attached && wc.debugger.isAttached()) wc.debugger.detach();
    }
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

  /**
   * Site technologies: probes the page (globals, markup, scripts, resources), re-reads
   * the page's response headers and its cookie names, and matches fingerprints. Runs
   * only when asked: nothing is inspected while browsing.
   */
  async techStack(w: BrowserWindowController): Promise<Detected[] | null> {
    const tab = w.activeTab();
    const wc = tab?.wc;
    if (!tab || !wc || !/^https?:/.test(tab.url)) return null;
    const url = tab.url;
    const host = new URL(url).host;
    const anchor = this.anchors.get(w) ?? { x: w.win.getContentBounds().width - 400, y: 8, width: 32, height: 32 };
    w.overlay.show({ kind: 'tech', anchor, host, url, result: null });
    const ses = w.profile.session;
    const headers = async (): Promise<Record<string, string>> => {
      try {
        const res = await ses.fetch(url, { headers: { accept: 'text/html' }, signal: AbortSignal.timeout(6000), cache: 'no-store' });
        void res.body?.cancel().catch(() => undefined);
        return Object.fromEntries(res.headers.entries());
      } catch {
        return {};
      }
    };
    const [probe, hdrs, cookies] = await Promise.all([
      wc.executeJavaScript(`(${pageProbe.toString()})(${JSON.stringify(probeTargets())})`).catch(() => null) as Promise<ReturnType<typeof pageProbe> | null>,
      headers(),
      ses.cookies.get({ url }).then((cs) => cs.map((c) => c.name)).catch(() => [] as string[]),
    ]);
    const result = detect({ url, headers: hdrs, cookies, meta: probe?.meta ?? {}, js: probe?.js ?? {}, scripts: probe?.scripts ?? [], resources: probe?.resources ?? [], dom: probe?.dom ?? {}, html: probe?.html ?? '' });
    if (w.activeTab() === tab) w.overlay.show({ kind: 'tech', anchor, host, url, result });
    return result;
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
