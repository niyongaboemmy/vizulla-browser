// Chrome extensions (EXT-01/02). Electron loads unpacked extensions per session;
// electron-chrome-extensions adds the chrome.* APIs real extensions use (action
// buttons and popups, tabs, windows, context menus, cookies, notifications) and
// electron-chrome-web-store installs and auto-updates extensions from the Chrome Web
// Store. Vizulla tells them about its tabs and windows, keeps the enabled/pinned
// state, and shows everything at vizulla://extensions. Private windows run without
// extensions (their sessions are in-memory, as in Chrome's default).
import { app, dialog, nativeImage, session as electronSession, type BaseWindow, type Session, type WebContents } from 'electron';
import { EventEmitter } from 'node:events';
import { existsSync, mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type { BrowserApp } from '../browser_app';
import type { BrowserWindowController } from '../ui/browser_window';
import type { Profile } from '../profile';
import { compareVersions } from '../updates/update_logic';
import { parseStoreId } from './store_id';
import { describePermissions } from './permissions';

/** The partition name the toolbar uses to reach the profile's (default) session. */
export const EXTENSION_PARTITION = 'vizulla-extensions';

export interface ExtensionInfo {
  id: string;
  name: string;
  version: string;
  description: string;
  icon: string | null;
  enabled: boolean;
  pinned: boolean;
  source: 'store' | 'unpacked';
  path: string;
  permissions: string[];
  hostPermissions: string[];
  hasAction: boolean;
  optionsUrl: string | null;
  homepage: string | null;
  error: string | null;
}

interface Found {
  id: string | null;
  path: string;
  manifest: chrome.runtime.Manifest;
  source: 'store' | 'unpacked';
}

type Lib = typeof import('electron-chrome-extensions');
type StoreLib = typeof import('electron-chrome-web-store');

export class ExtensionsService extends EventEmitter {
  readonly dir: string;
  private lib: InstanceType<Lib['ElectronChromeExtensions']> | null = null;
  private store: StoreLib | null = null;
  /** Load errors by extension id or folder. */
  private readonly errors = new Map<string, string>();
  /** Folder of every extension we know (loaded or disabled), by id. */
  private readonly known = new Map<string, Found>();
  private started: Promise<void> | null = null;

  constructor(private readonly app: BrowserApp, private readonly profile: Profile) {
    super();
    this.dir = join(app.userDataPath(), 'Extensions');
  }

  private get session(): Session {
    return this.profile.session;
  }

  /** Loads the APIs, the Chrome Web Store support and every enabled extension. */
  start(): Promise<void> {
    this.started ??= this.boot().catch((err) => {
      console.error('[vz] extensions failed to start', err);
    });
    return this.started;
  }

  private async boot(): Promise<void> {
    const [lib, store] = await Promise.all([import('electron-chrome-extensions'), import('electron-chrome-web-store')]);
    this.store = store;
    const ses = this.session;
    lib.setSessionPartitionResolver((p: string) => (p === EXTENSION_PARTITION ? ses : electronSession.fromPartition(p)));
    // Extension icons (crx://) are drawn in the browser UI and on vizulla://extensions.
    for (const s of new Set([ses, this.app.chromeSession])) lib.ElectronChromeExtensions.handleCRXProtocol(s);
    this.lib = new lib.ElectronChromeExtensions({
      session: ses,
      createTab: async (details) => {
        const w = this.windowFor(details.windowId) ?? this.app.focused() ?? this.app.openWindow();
        const tab = w.createTab({ url: details.url ?? 'vizulla://newtab/', activate: details.active !== false });
        return [tab.ensureLive(), w.win as unknown as Electron.BrowserWindow];
      },
      selectTab: (wc) => {
        const found = this.app.findTabByWebContents(wc);
        if (found) {
          found.window.activateTab(found.tab.id);
          found.window.win.focus();
        }
      },
      removeTab: (wc) => {
        const found = this.app.findTabByWebContents(wc);
        if (found) found.window.closeTab(found.tab.id);
      },
      createWindow: async (details) => {
        const w = this.app.openWindow();
        const url = Array.isArray(details.url) ? details.url[0] : details.url;
        if (url) w.loadUrl(w.activeTab()?.id ?? null, url);
        return w.win as unknown as Electron.BrowserWindow;
      },
      removeWindow: (win) => {
        const w = [...this.app.windows].find((x) => (x.win as unknown) === win);
        w?.win.close();
      },
      assignTabDetails: (details, wc) => {
        const found = this.app.findTabByWebContents(wc);
        if (!found) return;
        details.pinned = !!found.window.model.get(found.tab.id)?.pinned;
        details.discarded = false;
      },
    } as ConstructorParameters<Lib['ElectronChromeExtensions']>[0]);
    this.lib.on('browser-action-popup-created', () => this.emit('changed'));
    await store.installChromeWebStore({
      session: ses,
      extensionsPath: this.dir,
      loadExtensions: false,
      autoUpdate: true,
      beforeInstall: (d) => this.confirmInstall(d.localizedName || d.manifest.name, d.icon, d.manifest),
    });
    ses.registerPreloadScript({ type: 'service-worker', id: 'vz-ext-worker', filePath: this.app.joinOut('preload', 'ext_worker_preload.js') });
    ses.serviceWorkers.on('running-status-changed', ({ versionId, runningStatus }) => {
      if (runningStatus !== 'starting') return;
      const sw = ses.serviceWorkers.getWorkerFromVersionID(versionId);
      const id = /^chrome-extension:\/\/([a-p]{32})\//.exec(sw?.scope ?? '')?.[1];
      if (!sw || !id) return;
      sw.ipc.removeHandler('vz:ext-installed');
      sw.ipc.handle('vz:ext-installed', () => this.installedEvent(id));
    });
    await this.loadAll();
    ses.extensions.on('extension-loaded', () => this.changed());
    ses.extensions.on('extension-unloaded', () => this.changed());
    // Tabs and windows that already exist.
    for (const w of this.app.windows) if (w.profile === this.profile) for (const t of w.tabs.values()) if (t.wc) this.addTab(t.wc, w);
  }

  /** chrome.runtime.onInstalled details the first time a version runs, else null. */
  private installedEvent(id: string): { reason: 'install' | 'update'; previousVersion?: string } | null {
    const version = this.session.extensions.getExtension(id)?.version;
    if (!version) return null;
    const file = join(this.dir, '.vizulla-installed.json');
    let seen: Record<string, string> = {};
    try {
      seen = JSON.parse(readFileSync(file, 'utf8')) as Record<string, string>;
    } catch {
      /* first run */
    }
    const prev = seen[id];
    if (prev === version) return null;
    seen[id] = version;
    try {
      mkdirSync(this.dir, { recursive: true });
      writeFileSync(file, JSON.stringify(seen));
    } catch {
      /* not fatal */
    }
    return prev ? { reason: 'update', previousVersion: prev } : { reason: 'install' };
  }

  private changed(): void {
    this.emit('changed');
    for (const w of this.app.windows) w.pushState();
    this.app.pages.notify('extensions', 'changed');
  }

  /** Store installs live in Extensions/<id>/<version>/; unpacked ones are remembered folders. */
  private discover(): Found[] {
    const found: Found[] = [];
    if (existsSync(this.dir)) {
      for (const id of readdirSync(this.dir)) {
        if (!/^[a-p]{32}$/.test(id)) continue;
        const base = join(this.dir, id);
        let best: Found | null = null;
        for (const v of safeList(base)) {
          const manifest = readManifest(join(base, v));
          if (manifest && (!best || compareVersions(manifest.version, best.manifest.version) > 0)) best = { id, path: join(base, v), manifest, source: 'store' };
        }
        if (best) found.push(best);
      }
    }
    for (const path of this.profile.prefs.get('extensions.unpacked')) {
      const manifest = readManifest(path);
      if (manifest) found.push({ id: null, path, manifest, source: 'unpacked' });
      else this.errors.set(path, 'manifest.json is missing or invalid');
    }
    return found;
  }

  private async loadAll(): Promise<void> {
    const disabled = new Set(this.profile.prefs.get('extensions.disabled'));
    for (const f of this.discover()) {
      if (f.id) this.known.set(f.id, f);
      if (f.id && disabled.has(f.id)) continue;
      await this.loadOne(f, disabled);
    }
  }

  private async loadOne(f: Found, disabled = new Set(this.profile.prefs.get('extensions.disabled'))): Promise<Electron.Extension | null> {
    try {
      const ext = await this.session.extensions.loadExtension(f.path, { allowFileAccess: f.source === 'unpacked' });
      this.known.set(ext.id, { ...f, id: ext.id });
      this.errors.delete(f.path);
      this.errors.delete(ext.id);
      if (disabled.has(ext.id)) {
        this.session.extensions.removeExtension(ext.id);
        return null;
      }
      if (ext.manifest.manifest_version === 3 && ext.manifest.background?.service_worker) {
        await this.session.serviceWorkers.startWorkerForScope(`chrome-extension://${ext.id}/`).catch(() => undefined);
      }
      return ext;
    } catch (err) {
      this.errors.set(f.id ?? f.path, err instanceof Error ? err.message : String(err));
      return null;
    }
  }

  /** "Add <name>?" with the extension's permissions; resolves allow/deny. */
  private async confirmInstall(name: string, icon: Electron.NativeImage | null, manifest: chrome.runtime.Manifest): Promise<{ action: 'allow' | 'deny' }> {
    const w = this.app.focused();
    if (!w) return { action: 'deny' };
    const r = await w.overlay.dialog<{ action: 'add' | 'cancel' } | null>({
      type: 'add-extension',
      name,
      icon: icon && !icon.isEmpty() ? icon.resize({ width: 48 }).toDataURL() : null,
      permissions: describePermissions(manifest),
    });
    return { action: r?.action === 'add' ? 'allow' : 'deny' };
  }

  // ---- Public API (vizulla://extensions, toolbar, command bar) ----

  list(): ExtensionInfo[] {
    const loaded = new Map(this.session.extensions.getAllExtensions().map((e) => [e.id, e]));
    const pinned = new Set(this.profile.prefs.get('extensions.pinned'));
    const disabled = new Set(this.profile.prefs.get('extensions.disabled'));
    const out: ExtensionInfo[] = [];
    const seen = new Set<string>();
    for (const [id, f] of this.known) {
      seen.add(id);
      out.push(this.info(id, f.path, (loaded.get(id)?.manifest as chrome.runtime.Manifest) ?? f.manifest, f.source, !disabled.has(id) && loaded.has(id), pinned.has(id)));
    }
    for (const [id, e] of loaded) if (!seen.has(id)) out.push(this.info(id, e.path, e.manifest as chrome.runtime.Manifest, 'unpacked', true, pinned.has(id)));
    // Unpacked folders that failed to load still appear, with their error.
    for (const path of this.profile.prefs.get('extensions.unpacked')) {
      if (out.some((x) => x.path === path)) continue;
      const m = readManifest(path);
      out.push({ ...this.info(path, path, m ?? ({ name: path.split(/[\\/]/).pop(), version: '' } as chrome.runtime.Manifest), 'unpacked', false, false), error: this.errors.get(path) ?? 'Could not load' });
    }
    return out.sort((a, b) => a.name.localeCompare(b.name));
  }

  private info(id: string, path: string, m: chrome.runtime.Manifest, source: 'store' | 'unpacked', enabled: boolean, pinned: boolean): ExtensionInfo {
    const msg = (s: string | undefined) => (s && /^__MSG_/.test(s) ? localized(path, m, s) : s) ?? '';
    const perms = (m.permissions ?? []).filter((p): p is string => typeof p === 'string');
    const hosts = [...((m as { host_permissions?: string[] }).host_permissions ?? []), ...(m.content_scripts ?? []).flatMap((c) => c.matches ?? [])];
    const options = (m as { options_ui?: { page?: string } }).options_ui?.page ?? m.options_page;
    return {
      id,
      name: msg(m.name) || id,
      version: m.version ?? '',
      description: msg(m.description),
      icon: iconData(path, m),
      enabled,
      pinned,
      source,
      path,
      permissions: perms,
      hostPermissions: [...new Set(hosts)],
      hasAction: !!(m.action || m.browser_action),
      optionsUrl: options ? `chrome-extension://${id}/${options}` : null,
      homepage: (m.homepage_url as string | undefined) ?? (source === 'store' ? `https://chromewebstore.google.com/detail/${id}` : null),
      error: this.errors.get(id) ?? null,
    };
  }

  /** Rows for the toolbar's extensions menu: loaded extensions only. */
  menuItems(): { id: string; name: string; icon: string | null; pinned: boolean; hasAction: boolean }[] {
    return this.list()
      .filter((e) => e.enabled)
      .map(({ id, name, icon, pinned, hasAction }) => ({ id, name, icon, pinned, hasAction }));
  }

  /** Opens an extension's popup (or sends its click) for the window's active tab. */
  activate(w: BrowserWindowController, id: string, anchor: { x: number; y: number; width: number; height: number }): void {
    const wc = w.activeTab()?.wc;
    const api = (this.lib as unknown as { api?: { browserAction?: { activateClick(d: unknown): void } } } | null)?.api?.browserAction;
    if (!wc || !api) return;
    try {
      api.activateClick({ extensionId: id, tabId: wc.id, anchorRect: anchor, alignment: 'bottom left' });
    } catch (err) {
      console.warn('[vz] extension action failed', err);
    }
  }

  /** Pinned extensions with a toolbar button, in pin order (toolbar state). */
  toolbar(): { pinned: string[]; count: number } {
    const loaded = new Set(this.session.extensions.getAllExtensions().map((e) => e.id));
    return { pinned: this.profile.prefs.get('extensions.pinned').filter((id) => loaded.has(id)), count: loaded.size };
  }

  async setEnabled(id: string, on: boolean): Promise<void> {
    const prefs = this.profile.prefs;
    const disabled = new Set(prefs.get('extensions.disabled'));
    if (on) {
      disabled.delete(id);
      prefs.set('extensions.disabled', [...disabled]);
      const f = this.known.get(id);
      if (f && !this.session.extensions.getExtension(id)) await this.loadOne(f, disabled);
    } else {
      disabled.add(id);
      prefs.set('extensions.disabled', [...disabled]);
      if (this.session.extensions.getExtension(id)) this.session.extensions.removeExtension(id);
    }
    this.changed();
  }

  setPinned(id: string, on: boolean): void {
    const pinned = this.profile.prefs.get('extensions.pinned').filter((x) => x !== id);
    this.profile.prefs.set('extensions.pinned', on ? [...pinned, id] : pinned);
    this.changed();
  }

  async remove(id: string): Promise<void> {
    const f = this.known.get(id);
    if (f?.source === 'store' && this.store) {
      await this.store.uninstallExtension(id, { session: this.session, extensionsPath: this.dir }).catch(() => undefined);
    } else if (this.session.extensions.getExtension(id)) {
      this.session.extensions.removeExtension(id);
    }
    if (f?.source === 'unpacked' || !f) {
      const path = f?.path ?? id;
      this.profile.prefs.set('extensions.unpacked', this.profile.prefs.get('extensions.unpacked').filter((p) => p !== path));
    }
    this.known.delete(id);
    const prefs = this.profile.prefs;
    prefs.set('extensions.pinned', prefs.get('extensions.pinned').filter((x) => x !== id));
    prefs.set('extensions.disabled', prefs.get('extensions.disabled').filter((x) => x !== id));
    this.changed();
  }

  /**
   * A Chrome Web Store link or 32-letter ID opens that extension's store page, where
   * "Add to Vizulla" shows the install prompt with its real name, icon and permissions.
   */
  storeUrlFor(input: string): string | null {
    const id = parseStoreId(input);
    return id ? `https://chromewebstore.google.com/detail/${id}` : null;
  }

  /** Developer mode: load an unpacked extension folder. */
  async loadUnpacked(path?: string): Promise<{ ok: boolean; error?: string; id?: string }> {
    await this.start();
    if (!path) {
      const w = this.app.focused();
      const r = await dialog.showOpenDialog(w?.win as unknown as Electron.BrowserWindow, { properties: ['openDirectory'] });
      if (r.canceled || !r.filePaths[0]) return { ok: false, error: 'cancelled' };
      path = r.filePaths[0];
    }
    const manifest = readManifest(path);
    if (!manifest) return { ok: false, error: 'manifest.json is missing or invalid' };
    const prefs = this.profile.prefs;
    if (!prefs.get('extensions.unpacked').includes(path)) prefs.set('extensions.unpacked', [...prefs.get('extensions.unpacked'), path]);
    const ext = await this.loadOne({ id: null, path, manifest, source: 'unpacked' });
    this.changed();
    if (!ext) return { ok: false, error: this.errors.get(path) ?? 'Could not load' };
    if (ext.manifest.action || ext.manifest.browser_action) this.setPinned(ext.id, true);
    return { ok: true, id: ext.id };
  }

  /** Reloads an unpacked extension from disk (developer mode). */
  async reload(id: string): Promise<void> {
    const f = this.known.get(id);
    if (!f) return;
    if (this.session.extensions.getExtension(id)) this.session.extensions.removeExtension(id);
    await this.loadOne(f);
    this.changed();
  }

  async updateAll(): Promise<void> {
    await this.start();
    await this.store?.updateExtensions(this.session).catch(() => undefined);
    this.known.clear();
    await this.loadAll();
    this.changed();
  }

  // ---- Tabs and windows ----

  addTab(wc: WebContents, w: BrowserWindowController): void {
    if (!this.lib || w.profile !== this.profile || wc.isDestroyed() || wc.session !== this.session) return;
    this.lib.addTab(wc, w.win as unknown as Electron.BrowserWindow);
  }

  selectTab(wc: WebContents): void {
    // Private and agent tabs live in other sessions: extensions never see them.
    if (this.lib && !wc.isDestroyed() && wc.session === this.session) this.lib.selectTab(wc);
  }

  contextMenuItems(wc: WebContents, params: Electron.ContextMenuParams): Electron.MenuItem[] {
    if (!this.lib || wc.session !== this.session) return [];
    try {
      return this.lib.getContextMenuItems(wc, params);
    } catch {
      return [];
    }
  }

  private windowFor(windowId?: number): BrowserWindowController | null {
    if (windowId === undefined) return null;
    return [...this.app.windows].find((w) => (w.win as BaseWindow).id === windowId) ?? null;
  }
}

function safeList(dir: string): string[] {
  try {
    return readdirSync(dir).filter((n) => statSync(join(dir, n)).isDirectory());
  } catch {
    return [];
  }
}

export function readManifest(dir: string): chrome.runtime.Manifest | null {
  try {
    const m = JSON.parse(readFileSync(join(dir, 'manifest.json'), 'utf8')) as chrome.runtime.Manifest;
    return m && typeof m.name === 'string' ? m : null;
  } catch {
    return null;
  }
}

/** "__MSG_appName__" → the default locale's message. */
function localized(dir: string, m: chrome.runtime.Manifest, s: string): string {
  const key = s.replace(/^__MSG_(.+)__$/, '$1');
  for (const loc of [app.getLocale().replace('-', '_'), app.getLocale().split('-')[0], m.default_locale ?? 'en']) {
    try {
      const msgs = JSON.parse(readFileSync(join(dir, '_locales', String(loc), 'messages.json'), 'utf8')) as Record<string, { message: string }>;
      const hit = Object.entries(msgs).find(([k]) => k.toLowerCase() === key.toLowerCase());
      if (hit) return hit[1].message;
    } catch {
      /* try the next locale */
    }
  }
  return s;
}

function iconData(dir: string, m: chrome.runtime.Manifest): string | null {
  const icons = (m.icons ?? {}) as Record<string, string>;
  const size = Object.keys(icons).map(Number).sort((a, b) => Math.abs(a - 48) - Math.abs(b - 48))[0];
  if (!size) return null;
  const img = nativeImage.createFromPath(join(dir, icons[String(size)]!));
  return img.isEmpty() ? null : img.resize({ width: 48, height: 48 }).toDataURL();
}
