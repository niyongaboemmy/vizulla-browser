// Handlers behind vizulla:// pages (the PageHandler half of each WebUI page).
// Each host has its own method table; payloads are validated per method.
import { app, clipboard, dialog, shell, systemPreferences } from 'electron';
import { existsSync, readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type { BrowserApp, PageMethod } from '../browser_app';
import { v } from '@vz/common/mojom/schema';
import { emitTo } from './ipc_router';
import { WRITABLE_PREFS, type PrefKey } from '../prefs/prefs_schema';
import { engineName, SEARCH_ENGINES } from '@vz/common/url';
import { LOCALES, t } from '@vz/common/i18n';
import { ALL_FEATURES } from '../vizulla_features';
import { detectSources, importFrom, parsePasswordCsv, type ImportSource } from '../importers/importers';
import { generatePassword, type PasswordVault } from '../passwords/password_vault';
import { PROFILE_COLORS } from '../profiles/profile_registry';
import { BRANDING } from '@vz/app/branding';
import { endProcess, taskRows } from './task_manager';

const SHELL_HOSTS = new Set(['chrome', 'overlay']);

export class InternalPages {
  readonly hosts: string[];
  private importSources: ImportSource[] = [];
  readonly vault: PasswordVault | null;

  constructor(private readonly app: BrowserApp) {
    const dir = join(app.outDir, 'webui');
    this.hosts = existsSync(dir) ? readdirSync(dir).filter((d) => !SHELL_HOSTS.has(d) && statSync(join(dir, d)).isDirectory()) : [];
    const p = app.profile;
    this.vault = app.passwords.vault;
    this.registerAll();
    p.downloads.on('changed', () => this.notify('downloads', 'changed', p.downloads.list()));
    p.downloads.on('started', () => this.notify('downloads', 'changed', p.downloads.list()));
  }

  private authorizedUntil = 0;

  /** Asks the OS to confirm it's the user (Touch ID on macOS) before a secret leaves the vault. One minute of grace, like other browsers. */
  private async authorize(reason: string): Promise<boolean> {
    if (Date.now() < this.authorizedUntil) return true;
    if (process.platform === 'darwin' && systemPreferences.canPromptTouchID()) {
      try {
        await systemPreferences.promptTouchID(reason);
      } catch {
        return false;
      }
    }
    this.authorizedUntil = Date.now() + 60_000;
    return true;
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
        // Private windows: the private start page, nothing from the regular profile.
        if (w?.profile.isPrivate) {
          return { private: { capture: p.prefs.get('privacy.privateCaptureProtection') }, space: null, pins: [], recent: [], archived: [], engine: engineName(p.prefs.get('search.engine')), onboarded: true, aiMode: p.prefs.get('ai.mode') };
        }
        const spaceId = w?.model.activeSpaceId ?? p.spaces.list()[0]!.id;
        const space = p.spaces.get(spaceId);
        const pins = w ? w.model.visible(spaceId).filter((m) => m.pinned).map((m) => w.tabInfo(m.id)) : [];
        const recent = p.history.recent(8).map((h) => ({ url: h.url, title: h.title, favicon: h.favicon }));
        const archived = p.spaces.listArchive(spaceId, 4).map((x) => ({ id: x.id, url: x.url, title: x.title, favicon: x.favicon }));
        return { space, pins, recent, archived, engine: engineName(p.prefs.get('search.engine')), onboarded: p.prefs.get('onboarding.completed'), aiMode: p.prefs.get('ai.mode') };
      },
      open,
      command,
      openCommandBar: (_x, ctx) => ctx.window && a.openCommandBar(ctx.window, 'address'),
      restoreArchived: (payload, ctx) => ctx.window?.restoreArchived(v.int().parse(payload, 'id')),
    });

    // ---- Password Manager (ID-01): list, edit, checkup, import/export.
    const vault = this.vault!;
    const pwData = () => {
      const health = vault.health();
      return {
        logins: vault.list().map((l) => ({ ...l, ...(health.get(l.id) ?? { weak: false, reused: false }) })),
        offerToSave: p.prefs.get('passwords.offerToSave'),
        neverSave: p.prefs.get('passwords.neverSave'),
        biometric: process.platform === 'darwin' && systemPreferences.canPromptTouchID(),
      };
    };
    const changed = () => this.notify('passwords', 'changed');
    const id = (x: unknown) => v.int({ min: 0 }).parse(x, 'id');
    this.define('passwords', {
      init: () => pwData(),
      reveal: async (x) => ((await this.authorize(t('reveal_password_reason'))) ? vault.reveal(id(x)) : null),
      copy: async (x) => {
        const { id: lid, field } = v.object({ id: v.int({ min: 0 }), field: v.literal('username', 'password') }).parse(x, 'copy');
        const s = vault.reveal(lid);
        if (!s || (field === 'password' && !(await this.authorize(t('reveal_password_reason'))))) return false;
        clipboard.writeText(field === 'password' ? s.password : s.username);
        // Clear a copied password from the clipboard after a minute (if it's still there).
        if (field === 'password') {
          setTimeout(async () => {
            if ((await clipboard.readText()) === s.password) clipboard.clear();
          }, 60_000);
        }
        return true;
      },
      update: (x) => {
        const { id: lid, username, password, note } = v.object({ id: v.int({ min: 0 }), username: v.optional(v.string({ max: 256 })), password: v.optional(v.string({ min: 1, max: 1024 })), note: v.optional(v.string({ max: 2000 })) }).parse(x, 'update');
        vault.update(lid, { username, password, note });
        changed();
        return pwData();
      },
      add: (x) => {
        const { site, username, password, note } = v.object({ site: v.string({ max: 2048 }), username: v.string({ max: 256 }), password: v.string({ min: 1, max: 1024 }), note: v.optional(v.string({ max: 2000 })) }).parse(x, 'add');
        const u = new URL(/^https?:\/\//.test(site) ? site : `https://${site}`);
        if (!/^https?:$/.test(u.protocol) || !u.hostname.includes('.')) throw new Error('bad site');
        vault.add(u.origin, username, password, note ?? '');
        changed();
        return pwData();
      },
      remove: (x) => {
        vault.remove(id(x));
        changed();
        return pwData();
      },
      generate: () => generatePassword(),
      checkBreaches: async () => {
        const n = await vault.checkBreaches(async (prefix) => {
          const r = await fetch(`https://api.pwnedpasswords.com/range/${prefix}`, { headers: { 'Add-Padding': 'true' } });
          return r.ok ? r.text() : '';
        });
        return { breached: n, ...pwData() };
      },
      setOfferToSave: (x) => (p.prefs.set('passwords.offerToSave', v.bool().parse(x, 'on')), pwData()),
      allowSaving: (x) => {
        const origin = v.string({ max: 512 }).parse(x, 'origin');
        p.prefs.set('passwords.neverSave', p.prefs.get('passwords.neverSave').filter((o) => o !== origin));
        return pwData();
      },
      importCsv: async (_x, ctx) => {
        const w = ctx.window ?? a.focused();
        const r = await dialog.showOpenDialog(w?.win as unknown as Electron.BrowserWindow, { title: t('import_passwords_title'), filters: [{ name: 'CSV', extensions: ['csv'] }], properties: ['openFile'] });
        if (r.canceled || !r.filePaths[0]) return { imported: 0, ...pwData() };
        const rows = parsePasswordCsv(readFileSync(r.filePaths[0], 'utf8'));
        for (const row of rows) vault.add(row.origin, row.username, row.password, row.note);
        changed();
        return { imported: rows.length, ...pwData() };
      },
      exportCsv: async (_x, ctx) => {
        if (!(await this.authorize(t('pw_export_reason')))) return false;
        const w = ctx.window ?? a.focused();
        const r = await dialog.showSaveDialog(w?.win as unknown as Electron.BrowserWindow, { title: t('pw_export'), defaultPath: 'Vizulla Passwords.csv', filters: [{ name: 'CSV', extensions: ['csv'] }] });
        if (r.canceled || !r.filePath) return false;
        writeFileSync(r.filePath, vault.exportCsv(), { mode: 0o600 });
        return true;
      },
      open: (x) => {
        const url = v.string({ max: 2048 }).parse(x, 'url');
        if (/^https?:\/\//.test(url)) (a.focused() ?? a.openWindow()).loadUrl(null, url, { newTab: true });
      },
    });

    // ---- Profiles: who's using Vizulla (each profile has its own data folder).
    const prof = a.profiles;
    const profData = () => {
      prof.changed();
      return { current: prof.currentId, profiles: prof.list().map((x) => ({ ...x, running: prof.isRunning(x.id) })), colors: PROFILE_COLORS };
    };
    const profileInput = v.object({ name: v.optional(v.string({ max: 40 })), color: v.optional(v.literal(...PROFILE_COLORS)) });
    this.define('profiles', {
      init: () => profData(),
      open: (x) => prof.open(v.string({ max: 64 }).parse(x, 'id')),
      create: (x) => {
        const { name, color } = profileInput.parse(x, 'create');
        const entry = prof.registry.create({ name: name ?? '', color });
        prof.changed();
        a.broadcastState();
        prof.open(entry.id);
        return profData();
      },
      update: (x) => {
        const { id: pid, patch } = v.object({ id: v.string({ max: 64 }), patch: profileInput }).parse(x, 'update');
        prof.registry.update(pid, patch);
        prof.changed();
        a.broadcastState();
        return profData();
      },
      remove: (x) => {
        const pid = v.string({ max: 64 }).parse(x, 'id');
        if (prof.isRunning(pid)) throw new Error('profile is open');
        prof.registry.remove(pid);
        prof.changed();
        a.broadcastState();
        return profData();
      },
    });

    // ---- Task Manager (Shift+Esc)
    this.define('task-manager', {
      init: () => taskRows(a),
      list: () => taskRows(a),
      end: (x) => {
        endProcess(a, v.int({ min: 1, max: 2 ** 31 }).parse(x, 'pid'));
        return taskRows(a);
      },
    });

    // ---- Extensions (EXT-01/02)
    const ext = a.extensions;
    const extData = () => ({ list: ext.list(), devMode: p.prefs.get('extensions.devMode') });
    const extId = v.string({ max: 300 });
    this.define('extensions', {
      init: async () => {
        await ext.start();
        return extData();
      },
      setEnabled: async (x) => {
        const { id: eid, on } = v.object({ id: extId, on: v.bool() }).parse(x, 'setEnabled');
        await ext.setEnabled(eid, on);
        return extData();
      },
      setPinned: (x) => {
        const { id: eid, on } = v.object({ id: extId, on: v.bool() }).parse(x, 'setPinned');
        ext.setPinned(eid, on);
        return extData();
      },
      remove: async (x) => {
        await ext.remove(extId.parse(x, 'id'));
        return extData();
      },
      reload: async (x) => {
        await ext.reload(extId.parse(x, 'id'));
        return extData();
      },
      loadUnpacked: async () => {
        await ext.loadUnpacked();
        return extData();
      },
      update: async () => {
        await ext.updateAll();
        return extData();
      },
      setDevMode: (x) => {
        p.prefs.set('extensions.devMode', v.bool().parse(x, 'on'));
        return extData();
      },
      // A store link or ID opens its store page; empty opens the store home.
      openStore: (x) => {
        const input = v.string({ max: 2048 }).parse(x, 'input').trim();
        const url = input ? ext.storeUrlFor(input) : 'https://chromewebstore.google.com/category/extensions';
        if (!url) return false;
        a.openInTab(url);
        return true;
      },
      openUrl: (x) => {
        const url = v.string({ max: 2048 }).parse(x, 'url');
        if (!/^chrome-extension:\/\/[a-p]{32}\//.test(url)) throw new Error('not an extension page');
        a.openInTab(url);
      },
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
      mcpCopy: (payload) => {
        const what = v.string({ max: 16 }).parse(payload, 'what');
        const token = p.prefs.get('dev.mcpToken');
        const url = a.mcp.url ?? `http://127.0.0.1:${p.prefs.get('dev.mcpPort')}/mcp`;
        clipboard.writeText(what === 'token' ? token : `claude mcp add --transport http vizulla ${url} --header "Authorization: Bearer ${token}"`);
        return true;
      },
      mcpNewToken: () => {
        a.mcp.regenerateToken();
        return this.settingsData();
      },
      mcpRemoveClient: (payload) => {
        const name = v.string({ max: 80 }).parse(payload, 'client');
        p.prefs.set('dev.mcpClients', p.prefs.get('dev.mcpClients').filter((c) => c !== name));
        return this.settingsData();
      },
      removeAdsAllowed: (payload) => {
        const site = v.string({ max: 255 }).parse(payload, 'site');
        p.prefs.set('shields.adsAllowedSites', p.prefs.get('shields.adsAllowedSites').filter((s) => s !== site));
        return this.settingsData();
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
      engines: [
        ...Object.entries(SEARCH_ENGINES).map(([id, e]) => ({ id, name: e.name, hint: new URL(e.url.replace('%s', '')).hostname })),
        ...(p.prefs.get('search.custom') ? [{ id: 'custom', name: p.prefs.get('search.custom')!.name, hint: new URL(p.prefs.get('search.custom')!.url.replace('%s', 'q')).hostname }] : []),
      ],
      locales: Object.entries(LOCALES).map(([id, name]) => ({ id, name })),
      providerKeys: Object.fromEntries(['anthropic', 'openai', 'google', 'openai-compatible', 'gateway'].map((id) => [id, keys?.hasKey(id) ?? false])),
      permissions: p.permissions.list(),
      passwords: this.vault?.count() ?? 0,
      shields: p.shields.status(-1, ''),
      isDefaultBrowser: app.isDefaultProtocolClient('https'),
      encryption: p.keys.constructor.name === 'KeychainKeyProvider' ? 'os-keychain' : 'memory',
      touchId: process.platform === 'darwin' && systemPreferences.canPromptTouchID(),
      mcp: this.app.mcp ? { url: this.app.mcp.url, token: p.prefs.get('dev.mcpToken'), clients: p.prefs.get('dev.mcpClients'), activity: this.app.mcp.activity.slice(0, 8) } : null,
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
