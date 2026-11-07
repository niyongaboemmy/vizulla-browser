// SyncService: E2EE sync of Spaces, bookmarks, settings, and open tabs (P4-BRW-08/09).
// The sync code is kept encrypted with the keychain key; the server sees only
// ciphertext and opaque ids. Leaving sync forgets the code (no recovery without it).
import { hostname } from 'node:os';
import { randomBytes } from 'node:crypto';
import { join } from 'node:path';
import type { BrowserApp } from '../browser_app';
import { CryptoBox } from '../storage/crypto_box';
import { readJson, writeJsonAtomic } from '../storage/json_store';
import { httpTransport, newSyncCode, normalizeCode, SyncEngine, type SyncAdapter, type SyncState } from './sync_engine';
import { v } from '@vz/common/mojom/schema';
import { WRITABLE_PREFS, type PrefKey } from '../prefs/prefs_schema';
import type { SpaceColor, SpaceIcon } from '@vz/common/types';
import { kVizullaSync } from '../vizulla_features';

const SYNCED_PREFS: PrefKey[] = ['appearance.theme', 'appearance.accent', 'appearance.density', 'appearance.defaultZoom', 'tabs.layout', 'search.engine', 'shields.enabled', 'shields.blockThirdPartyCookies', 'shields.httpsFirst', 'shields.fingerprinting', 'shields.cookieBanners', 'tabs.archiveAfterHours'];

interface Persisted {
  codeSealed?: string;
  deviceId: string;
  state: SyncState;
  lastSync: number | null;
  lastError: string | null;
}

export class SyncService {
  private data: Persisted;
  private readonly box: CryptoBox;
  private engine: SyncEngine | null = null;
  private timer: NodeJS.Timeout | null = null;
  private devices: { id: string; name: string; lastSeen: number }[] = [];
  readonly remoteTabs = new Map<string, { device: string; tabs: { url: string; title: string }[] }>();
  private justCreatedCode: string | null = null;

  constructor(private readonly app: BrowserApp) {
    const p = app.profile;
    this.box = new CryptoBox(p.keys.getOrCreateKey('sync'));
    this.data = readJson<Persisted>(this.path, { deviceId: randomBytes(16).toString('hex'), state: { seq: 0, known: {} }, lastSync: null, lastError: null });
    p.register('sync', this, () => this.stopTimer());
    if (this.code()) this.start();
    app.pages.define('settings', {
      syncCreate: async () => {
        const code = newSyncCode();
        await this.enable(code);
        this.justCreatedCode = code;
        return this.status();
      },
      syncJoin: async (payload) => {
        await this.enable(normalizeCode(v.string({ max: 64 }).parse(payload, 'code')));
        return this.status();
      },
      syncNow: async () => {
        await this.syncNow();
        return this.status();
      },
      syncLeave: async () => {
        await this.engine?.leave().catch(() => undefined);
        this.stopTimer();
        this.engine = null;
        this.data = { deviceId: this.data.deviceId, state: { seq: 0, known: {} }, lastSync: null, lastError: null };
        this.save();
        p.prefs.set('sync.enabled', false);
        return this.status();
      },
    });
  }

  private get path(): string {
    return join(this.app.profile.dir, 'Sync.json');
  }

  private save(): void {
    writeJsonAtomic(this.path, this.data);
  }

  private code(): string | null {
    try {
      return this.data.codeSealed ? this.box.openString(this.data.codeSealed, 'sync-code') : null;
    } catch {
      return null;
    }
  }

  status() {
    const code = this.justCreatedCode;
    this.justCreatedCode = null; // shown once, right after creating the chain
    return {
      enabled: !!this.engine,
      deviceName: this.app.profile.prefs.get('sync.deviceName') || hostname(),
      devices: this.devices,
      lastSync: this.data.lastSync,
      error: this.data.lastError,
      ...(code ? { code } : {}),
    };
  }

  async enable(code: string): Promise<void> {
    if (!this.app.profile.features.isEnabled(kVizullaSync)) throw new Error('sync disabled');
    if (normalizeCode(code).replace(/-/g, '').length < 24) throw new Error('invalid sync code');
    this.data.codeSealed = this.box.sealString(normalizeCode(code), 'sync-code');
    this.data.state = { seq: 0, known: {} };
    this.save();
    this.start();
    await this.engine!.join(this.app.profile.prefs.get('sync.deviceName') || hostname());
    this.app.profile.prefs.set('sync.enabled', true);
    await this.syncNow();
  }

  private start(): void {
    const code = this.code();
    if (!code) return;
    this.engine = new SyncEngine(code, this.data.deviceId, httpTransport(this.app.profile.prefs.get('sync.serverUrl')), this.adapters(), this.data.state);
    this.stopTimer();
    this.timer = setInterval(() => void this.syncNow(), 5 * 60_000);
    this.timer.unref();
  }

  private stopTimer(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  }

  async syncNow(): Promise<{ pulled: number; pushed: number } | null> {
    if (!this.engine) return null;
    try {
      const r = await this.engine.sync();
      this.devices = await this.engine.devices().catch(() => this.devices);
      this.data.state = this.engine.state;
      this.data.lastSync = Date.now();
      this.data.lastError = null;
      this.save();
      return r;
    } catch (e) {
      this.data.lastError = (e as Error).message;
      this.save();
      return null;
    }
  }

  private adapters(): SyncAdapter[] {
    const p = this.app.profile;
    const types = new Set(p.prefs.get('sync.types'));
    const all: SyncAdapter[] = [
      {
        type: 'spaces',
        snapshot: () => new Map(p.spaces.list().map((s) => [s.id, { name: s.name, color: s.color, icon: s.icon, order: s.order }])),
        apply: (id, d) => {
          if (d === null) return void p.spaces.remove(id);
          const x = d as { name: string; color: SpaceColor; icon: SpaceIcon; order: number };
          p.spaces.upsert({ id, ...x });
        },
      },
      {
        type: 'bookmarks',
        snapshot: () => new Map(p.history.bookmarks().map((b) => [`${b.url}|${b.folder}`, { url: b.url, title: b.title, folder: b.folder }])),
        apply: (key, d) => {
          if (d === null) {
            const [url, folder] = [key.slice(0, key.lastIndexOf('|')), key.slice(key.lastIndexOf('|') + 1)];
            const b = p.history.bookmarks().find((x) => x.url === url && x.folder === folder);
            if (b) p.history.removeBookmark(b.id);
            return;
          }
          const x = d as { url: string; title: string; folder: string };
          if (/^(https?|file):/.test(x.url)) p.history.addBookmark(x.url, x.title, x.folder, 'sync');
        },
      },
      {
        type: 'settings',
        snapshot: () => new Map(SYNCED_PREFS.map((k) => [k, p.prefs.get(k)])),
        apply: (key, d) => {
          const k = key as PrefKey;
          if (d !== null && SYNCED_PREFS.includes(k) && WRITABLE_PREFS[k]?.(d)) p.prefs.set(k, d as never);
        },
      },
      {
        type: 'tabs',
        snapshot: () => {
          const tabs = [...this.app.windows].filter((w) => !w.profile.isPrivate).flatMap((w) => [...w.tabs.values()].filter((t) => /^https?:/.test(t.url)).map((t) => ({ url: t.url, title: t.title })));
          return new Map([[this.data.deviceId, { device: p.prefs.get('sync.deviceName') || hostname(), tabs: tabs.slice(0, 200) }]]);
        },
        apply: (key, d) => {
          if (key === this.data.deviceId) return;
          if (d === null) this.remoteTabs.delete(key);
          else this.remoteTabs.set(key, d as { device: string; tabs: { url: string; title: string }[] });
        },
      },
    ];
    return all.filter((a) => types.has(a.type));
  }
}
