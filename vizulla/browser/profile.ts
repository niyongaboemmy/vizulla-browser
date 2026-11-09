// A Profile owns per-profile services (the KeyedService pattern, handbook §5).
// Regular profiles persist to disk; private profiles keep everything in memory
// and share only the read-mostly services of their parent (prefs, Shields engine).
import { safeStorage, session as electronSession, webContents, type Session } from 'electron';
import { randomUUID } from 'node:crypto';
import { join } from 'node:path';
import { FeatureList, parseFeatureSwitches } from './vizulla_features';
import { PrefsService } from './prefs/prefs_service';
import { SpacesService } from './spaces/spaces_service';
import { HistoryService } from './history/history_service';
import { PrivacyLog } from './privacy/privacy_log';
import { ShieldsService } from './shields/shields_service';
import { DownloadService } from './downloads/download_service';
import { SitePermissions } from './permissions/site_permissions';
import { RequestPipeline } from './net/request_pipeline';
import { KeychainKeyProvider } from './storage/keychain';
import { MemoryKeyProvider, type KeyProvider } from './storage/crypto_box';

export interface ProfileOptions {
  dir: string;
  outDir: string;
  argv: readonly string[];
  shieldsListUrl: string | null;
}

export class Profile {
  readonly id: string;
  readonly isPrivate: boolean;
  readonly dir: string;
  readonly outDir: string;
  readonly prefs: PrefsService;
  readonly features: FeatureList;
  readonly keys: KeyProvider;
  readonly spaces: SpacesService;
  readonly history: HistoryService;
  readonly privacy: PrivacyLog;
  readonly shields: ShieldsService;
  readonly downloads: DownloadService;
  readonly permissions: SitePermissions;
  readonly session: Session;
  readonly pipeline: RequestPipeline;
  readonly parent: Profile | null;
  /** Late-bound services registered by later phases (assistant, memory, notes, agent, sync). */
  private readonly services = new Map<string, unknown>();
  private readonly closers: (() => void)[] = [];

  private constructor(init: {
    id: string; isPrivate: boolean; dir: string; outDir: string; prefs: PrefsService; features: FeatureList; keys: KeyProvider;
    spaces: SpacesService; history: HistoryService; privacy: PrivacyLog; shields: ShieldsService; downloads: DownloadService;
    permissions: SitePermissions; session: Session; parent: Profile | null;
  }) {
    this.id = init.id;
    this.isPrivate = init.isPrivate;
    this.dir = init.dir;
    this.outDir = init.outDir;
    this.prefs = init.prefs;
    this.features = init.features;
    this.keys = init.keys;
    this.spaces = init.spaces;
    this.history = init.history;
    this.privacy = init.privacy;
    this.shields = init.shields;
    this.downloads = init.downloads;
    this.permissions = init.permissions;
    this.session = init.session;
    this.parent = init.parent;
    this.pipeline = new RequestPipeline(this.session);
    this.shields.install(this.pipeline);
    this.downloads.attach(this.session, { private: this.isPrivate });
  }

  static createRegular(opts: ProfileOptions): Profile {
    const prefs = new PrefsService(join(opts.dir, 'Preferences.json'));
    const features = new FeatureList({ commandLine: parseFeatureSwitches(opts.argv), user: prefs.get('flags.user') });
    prefs.observe('flags.user', (user) => features.update({ user }));
    const keys: KeyProvider = safeStorage.isEncryptionAvailable() ? new KeychainKeyProvider(join(opts.dir, 'Keys'), safeStorage) : new MemoryKeyProvider();
    const shields = new ShieldsService(prefs, join(opts.dir, 'Shields'), join(opts.outDir, 'resources'), opts.shieldsListUrl);
    const p = new Profile({
      id: 'default',
      isPrivate: false,
      dir: opts.dir,
      outDir: opts.outDir,
      prefs,
      features,
      keys,
      spaces: new SpacesService(join(opts.dir, 'vizulla_spaces.db')),
      history: new HistoryService(join(opts.dir, 'History.db')),
      privacy: new PrivacyLog(join(opts.dir, 'Privacy.db')),
      shields,
      downloads: new DownloadService(),
      permissions: new SitePermissions(join(opts.dir, 'Permissions.json')),
      session: electronSession.defaultSession,
      parent: null,
    });
    shields.on('blocked', (e: { pageUrl: string; category: string; webContentsId?: number }) => {
      // Shields is shared with private windows; their activity never reaches the log.
      const wc = e.webContentsId !== undefined ? webContents.fromId(e.webContentsId) : null;
      if (wc && wc.session !== p.session) return;
      try {
        p.privacy.recordBlocked(new URL(e.pageUrl).hostname, e.category);
      } catch {
        /* ignore */
      }
    });
    return p;
  }

  /** Private window profile: in-memory stores, a fresh non-persistent session, no history. */
  createPrivate(): Profile {
    const id = `private-${randomUUID()}`;
    return new Profile({
      id,
      isPrivate: true,
      dir: this.dir,
      outDir: this.outDir,
      prefs: this.prefs,
      features: this.features,
      keys: new MemoryKeyProvider(),
      spaces: new SpacesService(':memory:'),
      history: new HistoryService(':memory:'),
      privacy: this.privacy,
      shields: this.shields,
      downloads: this.downloads,
      permissions: new SitePermissions(null),
      session: electronSession.fromPartition(id, { cache: false }),
      parent: this,
    });
  }

  register<T>(name: string, service: T, close?: () => void): T {
    this.services.set(name, service);
    if (close) this.closers.push(close);
    return service;
  }

  service<T>(name: string): T | undefined {
    return this.services.get(name) as T | undefined;
  }

  shutdown(): void {
    for (const c of this.closers.reverse()) {
      try {
        c();
      } catch (e) {
        console.warn('[vz] shutdown', e);
      }
    }
    if (!this.isPrivate) {
      this.prefs.flush();
      this.privacy.close();
      this.shields.stop();
    }
    this.spaces.close();
    this.history.close();
  }
}
