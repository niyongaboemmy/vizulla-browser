// Installable web apps (PWAs). When a page links a manifest that meets Chrome's
// installability rules, the address bar offers "Install" (and a one-time hint per
// site); pages also get `beforeinstallprompt`, so their own install buttons work.
// Installing saves the app, gives it a place on the computer (os_integration.ts)
// and opens it in its own window (app_window.ts). vizulla://apps manages them.
// Private windows never offer installs.
import { app as electronApp, BaseWindow, ipcMain, type WebContents } from 'electron';
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type { BrowserApp } from '../browser_app';
import type { BrowserWindowController } from '../ui/browser_window';
import { t } from '@vz/common/i18n';
import { AppWindow } from './app_window';
import { bestIcon, inScope, notInstallable, parseManifest, type WebAppManifest } from './manifest';
import { createShortcuts, iconFromDataUrl, removeShortcuts, shortcutsExist, type Shortcuts } from './os_integration';

export interface InstalledApp {
  id: string;
  manifestId: string;
  name: string;
  startUrl: string;
  scope: string;
  origin: string;
  display: string;
  themeColor: string | null;
  backgroundColor: string | null;
  iconFile: string | null;
  shortcuts: string[];
  where: Shortcuts['where'];
  installedAt: number;
  bounds?: { x: number; y: number; width: number; height: number };
}

interface Store {
  apps: InstalledApp[];
  /** Sites already shown the one-time "can be installed" hint. */
  hinted: string[];
}

export type InstallState = { state: 'installable' | 'installed'; name: string; id?: string } | null;

const MAX_MANIFEST = 512 * 1024;
const MAX_ICON = 2 * 1024 * 1024;
const MANIFEST_TTL = 10 * 60_000;

export const appIdFor = (manifestId: string) => createHash('sha256').update(manifestId).digest('hex').slice(0, 16);

export class WebAppsService {
  private store: Store;
  private readonly file: string;
  private readonly iconDir: string;
  private readonly pages = new WeakMap<WebContents, WebAppManifest | null>();
  private readonly manifests = new Map<string, { at: number; text: string | null }>();
  private readonly windows = new Map<string, AppWindow>();

  constructor(private readonly app: BrowserApp) {
    const dir = app.profile.dir;
    this.file = join(dir, 'WebApps.json');
    this.iconDir = join(dir, 'WebApps', 'icons');
    this.store = this.load();
    app.appDialogHost = (wc) => {
      const w = this.windowFor(wc);
      return w ? { overlay: w.overlay, favicon: null, focus: () => w.focus() } : null;
    };
    app.appCommand = (id) => {
      const focused = BaseWindow.getFocusedWindow();
      const w = [...this.windows.values()].find((x) => x.win === focused);
      return !!w && w.command(id);
    };
    // Detect on every page load of regular (not private) web tabs.
    electronApp.on('web-contents-created', (_e, wc) => {
      // (Tabs' web contents report type 'window'; extension background pages are skipped.)
      if (wc.session !== app.profile.session || wc.getType() === 'backgroundPage') return;
      const check = () => void this.detect(wc);
      wc.on('did-finish-load', check);
      wc.on('did-navigate-in-page', (_e2, _url, isMainFrame) => isMainFrame && check());
    });
    // The page's own install button (beforeinstallprompt.prompt()).
    ipcMain.handle('vz:install-prompt', async (e) => {
      const found = app.findTabByWebContents(e.sender);
      if (!found) return 'dismissed';
      return this.promptInstall(found.window, found.tab.id);
    });
  }

  // ---- registry

  list(): InstalledApp[] {
    return [...this.store.apps].sort((a, b) => a.name.localeCompare(b.name));
  }

  get(id: string): InstalledApp | undefined {
    return this.store.apps.find((a) => a.id === id);
  }

  private load(): Store {
    try {
      const s = JSON.parse(readFileSync(this.file, 'utf8')) as Partial<Store>;
      return { apps: Array.isArray(s.apps) ? s.apps : [], hinted: Array.isArray(s.hinted) ? s.hinted.slice(-500) : [] };
    } catch {
      return { apps: [], hinted: [] };
    }
  }

  private save(): void {
    mkdirSync(join(this.file, '..'), { recursive: true });
    writeFileSync(`${this.file}.tmp`, JSON.stringify(this.store, null, 1));
    renameSync(`${this.file}.tmp`, this.file);
  }

  // ---- detection

  /** What the address bar offers for this page: install it, open it in its app, or nothing. */
  stateFor(wc: WebContents | null | undefined): InstallState {
    if (!wc || wc.isDestroyed() || wc.session !== this.app.profile.session) return null;
    const url = wc.getURL();
    const installed = this.store.apps.find((a) => inScope(url, a.scope));
    if (installed) return { state: 'installed', name: installed.name, id: installed.id };
    const m = this.pages.get(wc);
    return m && !notInstallable(m) ? { state: 'installable', name: m.name } : null;
  }

  private async detect(wc: WebContents): Promise<void> {
    if (wc.isDestroyed() || !/^https:|^http:\/\/(localhost|127\.0\.0\.1)/.test(wc.getURL())) {
      this.pages.set(wc, null);
      return;
    }
    const docUrl = wc.getURL();
    let link = null as { href: string; credentials: boolean } | null;
    try {
      link = (await wc.executeJavaScriptInIsolatedWorld(1_002_003, [
        { code: `(() => { const l = document.querySelector('link[rel~="manifest" i][href]'); return l ? { href: l.href, credentials: l.crossOrigin === 'use-credentials' } : null; })()` },
      ])) as typeof link;
    } catch {
      /* page gone */
    }
    const m = link ? await this.fetchManifest(link.href, docUrl, link.credentials) : null;
    if (wc.isDestroyed() || wc.getURL() !== docUrl) return;
    const before = this.stateFor(wc)?.state;
    this.pages.set(wc, m);
    const now = this.stateFor(wc);
    if (now?.state !== before) this.app.findTabByWebContents(wc)?.window.pushState();
    if (now?.state === 'installable') {
      // The page's own install button, if it has one, now works.
      wc.mainFrame.send('vz:installable');
      this.hint(wc, m!);
    }
  }

  /** The manifest's text is cached briefly per URL; it's parsed per page (defaults depend on the page). */
  private async fetchManifest(url: string, docUrl: string, credentials: boolean): Promise<WebAppManifest | null> {
    let hit = this.manifests.get(url);
    if (!hit || Date.now() - hit.at > MANIFEST_TTL) {
      let text: string | null = null;
      try {
        const r = await this.app.profile.session.fetch(url, { credentials: credentials ? 'include' : 'omit', signal: AbortSignal.timeout(6000) } as RequestInit);
        if (r.ok) text = (await r.text()).slice(0, MAX_MANIFEST);
      } catch {
        /* offline, blocked, slow */
      }
      this.manifests.set(url, (hit = { at: Date.now(), text }));
    }
    return hit.text === null ? null : parseManifest(hit.text, url, docUrl);
  }

  /** Once per site: a gentle toast that it can be installed, with the action right there. */
  private hint(wc: WebContents, m: WebAppManifest): void {
    const found = this.app.findTabByWebContents(wc);
    if (!found || found.window.activeTab()?.id !== found.tab.id) return;
    const origin = new URL(m.startUrl).origin;
    if (this.store.hinted.includes(origin)) return;
    this.store.hinted.push(origin);
    this.save();
    found.window.toast(t('app_hint', { name: m.name }), { label: t('app_install'), run: () => void this.promptInstall(found.window, found.tab.id) }, 9000);
  }

  // ---- install

  private async iconDataUrl(m: WebAppManifest): Promise<string | null> {
    const icon = bestIcon(m.icons);
    if (!icon) return null;
    try {
      const r = await this.app.profile.session.fetch(icon.src, { signal: AbortSignal.timeout(8000) } as RequestInit);
      if (!r.ok) return null;
      const buf = Buffer.from(await r.arrayBuffer());
      if (buf.length > MAX_ICON) return null;
      const type = (r.headers.get('content-type') ?? icon.type ?? 'image/png').split(';')[0]!.trim();
      if (!/^image\/(png|jpeg|webp|gif|svg\+xml|x-icon|vnd\.microsoft\.icon|avif)$/.test(type)) return null;
      return `data:${type};base64,${buf.toString('base64')}`;
    } catch {
      return null;
    }
  }

  /** The install dialog for a tab's app. Resolves as beforeinstallprompt's userChoice. */
  async promptInstall(w: BrowserWindowController, tabId: number): Promise<'accepted' | 'dismissed'> {
    const tab = w.tabs.get(tabId);
    const m = tab?.wc ? this.pages.get(tab.wc) : null;
    if (!tab?.wc || !m || notInstallable(m) || w.profile.isPrivate) return 'dismissed';
    const icon = await this.iconDataUrl(m);
    const r = await w.overlay.dialog<{ name: string; desktop: boolean; open: boolean; png: string; macPng: string } | null>({
      type: 'app-install',
      name: m.name,
      origin: new URL(m.startUrl).host,
      description: m.description,
      icon,
      maskable: !!bestIcon(m.icons) && !bestIcon(m.icons)!.purpose.includes('any'),
      themeColor: m.themeColor,
      platform: process.platform,
      startUrl: m.startUrl,
    });
    if (!r) return 'dismissed';
    const rec = this.install(m, { name: r.name?.trim() || m.name, desktop: !!r.desktop, png: r.png, macPng: r.macPng });
    if (!tab.wc.isDestroyed()) tab.wc.mainFrame.send('vz:appinstalled');
    w.pushState();
    if (r.open) {
      // Like Chrome: the page moves into its new window.
      const url = tab.url;
      this.launch(rec.id, url);
      if (inScope(url, rec.scope)) w.closeTab(tab.id);
    } else {
      void this.showInstalled(w, rec);
    }
    return 'accepted';
  }

  private async showInstalled(w: BrowserWindowController, rec: InstalledApp): Promise<void> {
    const r = await w.overlay.dialog<{ action: 'open' } | null>({
      type: 'app-installed',
      name: rec.name,
      icon: rec.iconFile && existsSync(rec.iconFile) ? `data:image/png;base64,${readFileSync(rec.iconFile).toString('base64')}` : null,
      where: rec.where,
    });
    if (r?.action === 'open') this.launch(rec.id);
  }

  install(m: WebAppManifest, o: { name: string; desktop: boolean; png: string; macPng: string }): InstalledApp {
    const id = appIdFor(m.id);
    const old = this.get(id);
    if (old) removeShortcuts(old.shortcuts);
    mkdirSync(this.iconDir, { recursive: true });
    const icon = iconFromDataUrl(o.png);
    const iconFile = icon ? join(this.iconDir, `${id}.png`) : null;
    if (icon && iconFile) writeFileSync(iconFile, icon.toPNG());
    const name = o.name.slice(0, 80);
    let shortcuts: Shortcuts = { paths: [], where: process.platform === 'darwin' ? 'launchpad' : process.platform === 'win32' ? 'start-menu' : 'apps-menu' };
    const osIcon = iconFromDataUrl(process.platform === 'darwin' ? o.macPng : o.png) ?? icon;
    if (osIcon) {
      try {
        shortcuts = createShortcuts({ id, name, icon: osIcon }, { desktop: o.desktop });
      } catch (e) {
        console.warn('[vz] app shortcut failed', e);
      }
    }
    const rec: InstalledApp = {
      id,
      manifestId: m.id,
      name,
      startUrl: m.startUrl,
      scope: m.scope,
      origin: new URL(m.startUrl).origin,
      display: m.display,
      themeColor: m.themeColor,
      backgroundColor: m.backgroundColor,
      iconFile,
      shortcuts: shortcuts.paths,
      where: shortcuts.where,
      installedAt: Date.now(),
      bounds: old?.bounds,
    };
    this.store.apps = [...this.store.apps.filter((a) => a.id !== id), rec];
    this.save();
    this.app.broadcastState();
    return rec;
  }

  uninstall(id: string): boolean {
    const rec = this.get(id);
    if (!rec) return false;
    this.windows.get(id)?.win.close();
    removeShortcuts([...rec.shortcuts, ...(rec.iconFile ? [rec.iconFile] : [])]);
    this.store.apps = this.store.apps.filter((a) => a.id !== id);
    this.save();
    this.app.broadcastState();
    return true;
  }

  /** Puts the shortcut back (e.g. someone deleted it from Launchpad or the Start menu). */
  repairShortcuts(id: string): boolean {
    const rec = this.get(id);
    if (!rec?.iconFile || !existsSync(rec.iconFile)) return false;
    const png = `data:image/png;base64,${readFileSync(rec.iconFile).toString('base64')}`;
    const icon = iconFromDataUrl(png);
    if (!icon) return false;
    removeShortcuts(rec.shortcuts);
    const s = createShortcuts({ id: rec.id, name: rec.name, icon }, { desktop: false });
    rec.shortcuts = s.paths;
    this.save();
    return shortcutsExist(rec.shortcuts);
  }

  // ---- windows

  launch(id: string, url?: string): AppWindow | null {
    const rec = this.get(id);
    if (!rec) return null;
    const open = this.windows.get(id);
    if (open && !open.win.isDestroyed()) {
      if (url && inScope(url, rec.scope)) void open.wc.loadURL(url);
      open.focus();
      return open;
    }
    const w = new AppWindow(this.app, rec, rec.iconFile, url);
    this.windows.set(id, w);
    w.on('bounds', (b: InstalledApp['bounds']) => {
      const cur = this.get(id);
      if (cur) {
        cur.bounds = b;
        this.save();
      }
    });
    w.on('closed', () => this.windows.get(id) === w && this.windows.delete(id));
    return w;
  }

  /** "Open in app" from the address bar: the tab's page moves into the app's window. */
  openInApp(w: BrowserWindowController, tabId: number): void {
    const tab = w.tabs.get(tabId);
    const s = this.stateFor(tab?.wc);
    if (!tab || s?.state !== 'installed' || !s.id) return;
    this.launch(s.id, tab.url);
    w.closeTab(tab.id);
  }

  windowFor(wc: WebContents): AppWindow | null {
    return [...this.windows.values()].find((w) => !w.win.isDestroyed() && w.wc === wc) ?? null;
  }

  /** --vz-app=<id> on the command line (an app's shortcut). Returns whether it opened an app. */
  handleArgv(argv: string[]): boolean {
    const id = argv.find((a) => a.startsWith('--vz-app='))?.slice('--vz-app='.length);
    if (!id || !/^[0-9a-f]{16}$/.test(id)) return false;
    return !!this.launch(id);
  }
}
