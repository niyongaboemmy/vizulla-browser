// Handlers behind vizulla:// pages (the PageHandler half of each WebUI page).
// Each host has its own method table; payloads are validated per method.
import { app, dialog, shell, systemPreferences } from 'electron';
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import type { BrowserApp, PageMethod } from '../browser_app';
import { v } from '@vz/common/mojom/schema';
import { emitTo } from './ipc_router';
import { WRITABLE_PREFS, type PrefKey } from '../prefs/prefs_schema';
import { SEARCH_ENGINES } from '@vz/common/url';
import { LOCALES, t } from '@vz/common/i18n';
import { ALL_FEATURES } from '../vizulla_features';
import { detectSources, importFrom, parsePasswordCsv, type ImportSource } from '../importers/importers';
import { PasswordVault } from '../passwords/password_vault';
import { BRANDING } from '@vz/app/branding';

const SHELL_HOSTS = new Set(['chrome', 'overlay']);

export class InternalPages {
  readonly hosts: string[];
  private importSources: ImportSource[] = [];
  readonly vault: PasswordVault | null;

  constructor(private readonly app: BrowserApp) {
    const dir = join(app.outDir, 'webui');
    this.hosts = existsSync(dir) ? readdirSync(dir).filter((d) => !SHELL_HOSTS.has(d) && statSync(join(dir, d)).isDirectory()) : [];
    const p = app.profile;
    this.vault = p.register('vault', new PasswordVault(join(p.dir, 'Vault.db'), p.keys), () => this.vault?.close());
    this.registerAll();
    p.downloads.on('changed', () => this.notify('downloads', 'changed', p.downloads.list()));
    p.downloads.on('started', () => this.notify('downloads', 'changed', p.downloads.list()));
  }

  /** Sends an event to every open tab showing vizulla://<host>. */
  notify(host: string, event: string, payload?: unknown): void {
    for (const w of this.app.windows) {
      for (const tab of w.tabs.values()) {
        if (tab.wc && tab.url.startsWith(`vizulla://${host}`)) emitTo(tab.wc, 'Pages', event, payload);
      }
    }
  }

  define(host: string, methods: Record<string, PageMethod>): void {
    this.app.pageHandlers.set(host, { ...(this.app.pageHandlers.get(host) ?? {}), ...methods });
  }

  private registerAll(): void {
    const a = this.app;
    const p = a.profile;
    const open: PageMethod = (payload, ctx) => {
      const { url, newTab } = v.object({ url: v.string({ max: 8192 }), newTab: v.optional(v.bool()) }).parse(payload, 'open');
      const w = ctx.window ?? a.focused();
      if (!w) return;
      const tab = [...w.tabs.values()].find((x) => x.wc === ctx.sender);
      w.loadUrl(newTab ? null : (tab?.id ?? null), url, { newTab });
    };
    const command: PageMethod = (payload, ctx) => {
      const { id, args } = v.object({ id: v.string({ max: 64 }), args: v.optional(v.json({ maxBytes: 4096 })) }).parse(payload, 'command');
      return a.runCommand(ctx.window, id, args as Record<string, unknown> | undefined);
    };

    // ---- New tab: calm start page (P2-BRW-17). No remote content.
    this.define('newtab', {
      init: (_x, ctx) => {
        const w = ctx.window ?? a.focused();
        const spaceId = w?.model.activeSpaceId ?? p.spaces.list()[0]!.id;
        const space = p.spaces.get(spaceId);
        const pins = w ? w.model.visible(spaceId).filter((m) => m.pinned).map((m) => w.tabInfo(m.id)) : [];
        const recent = p.history.recent(8).map((h) => ({ url: h.url, title: h.title, favicon: h.favicon }));
        const archived = p.spaces.listArchive(spaceId, 4).map((x) => ({ id: x.id, url: x.url, title: x.title, favicon: x.favicon }));
        return { space, pins, recent, archived, engine: SEARCH_ENGINES[p.prefs.get('search.engine')].name, onboarded: p.prefs.get('onboarding.completed'), aiMode: p.prefs.get('ai.mode') };
      },
      open,
      command,
      openCommandBar: (_x, ctx) => ctx.window && a.openCommandBar(ctx.window, 'address'),
      restoreArchived: (payload, ctx) => ctx.window?.restoreArchived(v.int().parse(payload, 'id')),
    });

    // ---- Settings (P2-BRW-20)
    this.define('settings', {
      init: () => this.settingsData(),
      set: (payload) => {
        const { key, value } = v.object({ key: v.string({ max: 64 }), value: v.json({ maxBytes: 4096 }) }).parse(payload, 'set');
        const check = WRITABLE_PREFS[key as PrefKey];
        if (!check || !check(value)) throw new Error(`pref ${key} not writable`);
        p.prefs.set(key as PrefKey, value as never);
        return this.settingsData();
      },
      command,
      open,
      detectImport: () => {
        this.importSources = detectSources();
        return this.importSources.map((s, i) => ({ index: i, browser: s.browser, name: s.name, profile: s.profileName }));
      },
      runImport: (payload) => {
        const { index, bookmarks, history } = v.object({ index: v.int({ min: 0 }), bookmarks: v.bool(), history: v.bool() }).parse(payload, 'runImport');
        const src = this.importSources[index];
        if (!src) throw new Error('unknown source');
        const data = importFrom(src, { bookmarks, history });
        for (const b of data.bookmarks) p.history.addBookmark(b.url, b.title, b.folder ? `${src.name}/${b.folder}` : src.name, `import:${src.browser}`, b.addedAt || Date.now());
        for (const h of data.history) {
          p.history.addVisit(h.url, h.title, { at: h.lastVisit || Date.now(), typed: h.typedCount > 0 });
        }
        return { bookmarks: data.bookmarks.length, history: data.history.length };
      },
      importPasswordsCsv: async (_x, ctx) => {
        const w = ctx.window ?? a.focused();
        const r = await dialog.showOpenDialog(w?.win as unknown as Electron.BrowserWindow, { title: t('import_passwords_title'), filters: [{ name: 'CSV', extensions: ['csv'] }], properties: ['openFile'] });
        if (r.canceled || !r.filePaths[0]) return { imported: 0 };
        const rows = parsePasswordCsv(readFileSync(r.filePaths[0], 'utf8'));
        for (const row of rows) this.vault!.add(row.origin, row.username, row.password, row.note);
        return { imported: rows.length, reminder: t('import_passwords_delete_csv') };
      },
      listPasswords: () => this.vault!.list(),
      revealPassword: async (payload) => {
        const id = v.int({ min: 0 }).parse(payload, 'id');
        // Ask the OS to confirm it's the user before revealing a secret (where available).
        if (process.platform === 'darwin' && systemPreferences.canPromptTouchID()) {
          try {
            await systemPreferences.promptTouchID(t('reveal_password_reason'));
          } catch {
            return null;
          }
        }
        return this.vault!.reveal(id);
      },
      deletePassword: (payload) => this.vault!.remove(v.int({ min: 0 }).parse(payload, 'id')),
      checkBreaches: async () => {
        const n = await this.vault!.checkBreaches(async (prefix) => {
          const r = await fetch(`https://api.pwnedpasswords.com/range/${prefix}`, { headers: { 'Add-Padding': 'true' } });
          return r.ok ? r.text() : '';
        });
        return { breached: n, logins: this.vault!.list() };
      },
      clearData: async (payload) => {
        const kinds = v.array(v.literal('history', 'cookies', 'cache', 'archive', 'privacy', 'permissions'), { max: 6 }).parse(payload, 'kinds');
        if (kinds.includes('history')) p.history.clearAll();
        if (kinds.includes('cookies')) await p.session.clearStorageData({ storages: ['cookies', 'localstorage', 'indexdb', 'serviceworkers', 'cachestorage'] });
        if (kinds.includes('cache')) await p.session.clearCache();
        if (kinds.includes('archive')) p.spaces.clearArchive();
        if (kinds.includes('privacy')) p.privacy.clearAll();
        if (kinds.includes('permissions')) p.permissions.clear();
        return true;
      },
      removePermission: (payload) => {
        const { origin, permission } = v.object({ origin: v.string({ max: 512 }), permission: v.string({ max: 64 }) }).parse(payload, 'perm');
        p.permissions.set(origin, permission, null);
        return p.permissions.list();
      },
      removeShieldsException: (payload) => {
        const site = v.string({ max: 255 }).parse(payload, 'site');
        p.prefs.set('shields.siteExceptions', p.prefs.get('shields.siteExceptions').filter((s) => s !== site));
        return this.settingsData();
      },
      updateShieldsLists: async () => p.shields.updateLists(),
      setDefaultBrowser: () => {
        app.setAsDefaultProtocolClient('http');
        app.setAsDefaultProtocolClient('https');
        return app.isDefaultProtocolClient('https');
      },
    });

    // ---- History
    this.define('history', {
      init: () => ({ total: p.history.count() }),
      list: (payload) => {
        const { query, offset } = v.object({ query: v.optional(v.string({ max: 200 })), offset: v.optional(v.int({ min: 0 })) }).parse(payload, 'list');
        if (query) return p.history.search(query, 100);
        return p.history.recent(100, offset ?? 0);
      },
      remove: (payload) => p.history.deleteUrl(v.string({ max: 8192 }).parse(payload, 'url')),
      clearRange: (payload) => {
        const { from, to } = v.object({ from: v.number(), to: v.number() }).parse(payload, 'range');
        return p.history.deleteRange(from, to);
      },
      open,
      command,
    });

    this.define('bookmarks', {
      init: () => p.history.bookmarks(),
      remove: (payload) => {
        p.history.removeBookmark(v.int({ min: 0 }).parse(payload, 'id'));
        return p.history.bookmarks();
      },
      open,
      command,
    });

    this.define('downloads', {
      init: () => p.downloads.list(),
      action: (payload) => {
        const { id, what } = v.object({ id: v.int({ min: 0 }), what: v.literal('pause', 'resume', 'cancel', 'open', 'show', 'remove') }).parse(payload, 'action');
        p.downloads.action(id, what);
        return p.downloads.list();
      },
      clear: () => {
        p.downloads.clear();
        return p.downloads.list();
      },
      openFolder: () => shell.openPath(app.getPath('downloads')),
    });

    this.define('privacy', {
      init: () => ({ ...p.privacy.summary(30), shieldsEnabled: p.shields.isEnabled, aiMode: p.prefs.get('ai.mode'), retentionDays: p.prefs.get('privacy.logRetentionDays') }),
      clear: () => {
        p.privacy.clearAll();
        return p.privacy.summary(30);
      },
      command,
      open,
    });

    this.define('archive', {
      init: () => ({ items: p.spaces.listArchive(undefined, 500), spaces: p.spaces.list(), retentionDays: p.prefs.get('tabs.archiveRetentionDays') }),
      restore: (payload, ctx) => {
        const id = v.int({ min: 0 }).parse(payload, 'id');
        (ctx.window ?? a.focused())?.restoreArchived(id);
        return p.spaces.listArchive(undefined, 500);
      },
      remove: (payload) => {
        p.spaces.removeArchived(v.int({ min: 0 }).parse(payload, 'id'));
        return p.spaces.listArchive(undefined, 500);
      },
      clear: () => {
        p.spaces.clearArchive();
        return [];
      },
    });

    this.define('flags', {
      init: () => this.flagsData(),
      set: (payload) => {
        const { name, value } = v.object({ name: v.string({ max: 64 }), value: v.optional(v.bool()) }).parse(payload, 'flag');
        if (!ALL_FEATURES.some((f) => f.name === name)) throw new Error('unknown flag');
        const user = { ...p.prefs.get('flags.user') };
        if (value === undefined) delete user[name];
        else user[name] = value;
        p.prefs.set('flags.user', user);
        a.buildMenu();
        return this.flagsData();
      },
      restart: () => {
        app.relaunch();
        app.quit();
      },
    });

    this.define('about', {
      init: () => ({
        name: BRANDING.productName,
        version: app.getVersion(),
        channel: BRANDING.channel,
        chromium: process.versions.chrome,
        electron: process.versions.electron,
        v8: process.versions.v8,
        node: process.versions.node,
        platform: `${process.platform} ${process.arch}`,
        commands: a.commandList(),
        shields: p.shields.status(-1, ''),
      }),
      open,
    });

    this.define('error', { init: () => ({}), open });
  }

  settingsData() {
    const p = this.app.profile;
    const keys = p.service<{ hasKey(id: string): boolean }>('providerKeys');
    return {
      prefs: p.prefs.all(),
      engines: Object.entries(SEARCH_ENGINES).map(([id, e]) => ({ id, name: e.name })),
      locales: Object.entries(LOCALES).map(([id, name]) => ({ id, name })),
      providerKeys: Object.fromEntries(['anthropic', 'openai', 'google', 'openai-compatible', 'gateway'].map((id) => [id, keys?.hasKey(id) ?? false])),
      permissions: p.permissions.list(),
      passwords: this.vault?.count() ?? 0,
      shields: p.shields.status(-1, ''),
      isDefaultBrowser: app.isDefaultProtocolClient('https'),
      encryption: p.keys.constructor.name === 'KeychainKeyProvider' ? 'os-keychain' : 'memory',
      features: p.features.snapshot(),
      sync: p.service<{ status(): unknown }>('sync')?.status() ?? null,
    };
  }

  private flagsData() {
    const p = this.app.profile;
    const user = p.prefs.get('flags.user');
    return ALL_FEATURES.map((f) => ({ ...f, enabled: p.features.isEnabled(f), override: f.name in user ? user[f.name] : null }));
  }
}
