// ShieldsService: request blocking, cosmetic filtering, third-party cookie
// blocking, HTTPS-First, and DoH defaults (P1-BRW-03..06, SHD-01/02/04/05/06).
import { app, type WebContents } from 'electron';
import { EventEmitter } from 'node:events';
import { existsSync, mkdirSync, readFileSync, readdirSync, renameSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { isKnownTracker, ShieldsEngine, type CheckResult, type RequestCategory } from '@vz/components/shields_engine/shields_engine';
import { verifyBlob, type ListManifest } from '@vz/components/shields_engine/list_signature';
import { siteOf } from '@vz/common/url';
import type { PrefsService } from '../prefs/prefs_service';
import { initiatorOf, type RequestPipeline } from '../net/request_pipeline';
import { cleanUrl } from './link_privacy';

export interface BlockedEvent {
  webContentsId: number;
  url: string;
  pageUrl: string;
  category: RequestCategory;
}

export interface ShieldsStatus {
  enabled: boolean;
  siteEnabled: boolean;
  blockAds: boolean;
  adsAllowed: boolean;
  strict: boolean;
  site: string;
  blocked: { ads: number; trackers: number; other: number; total: number };
  engineVersion: number;
  ruleSource: 'baseline' | 'signed';
}

const UPDATE_INTERVAL_MS = 24 * 3600_000;

export class ShieldsService extends EventEmitter {
  private engine: ShieldsEngine;
  private engineVersion = 0;
  private ruleSource: 'baseline' | 'signed' = 'baseline';
  /** Per-tab, per-page counts. Reset on top-level navigation. */
  private readonly counts = new Map<number, { ads: number; trackers: number; other: number }>();
  /** Hosts where HTTPS failed and the user continued on HTTP (HTTPS-First fallback). */
  private readonly httpAllowed = new Set<string>();
  private readonly upgraded = new Map<number, string>();
  private updateTimer: NodeJS.Timeout | null = null;

  constructor(
    private readonly prefs: PrefsService,
    private readonly dataDir: string,
    private readonly resourcesDir: string,
    private readonly listUrl: string | null,
  ) {
    super();
    mkdirSync(dataDir, { recursive: true });
    this.engine = this.loadEngine();
  }

  get isEnabled(): boolean {
    return this.prefs.get('shields.enabled');
  }

  isSiteEnabled(url: string): boolean {
    return this.isEnabled && !this.prefs.get('shields.siteExceptions').includes(siteOf(url));
  }

  /** Ads show on this page: blocking turned off everywhere, or allowed for this site. */
  adsAllowed(url: string): boolean {
    return !this.prefs.get('shields.blockAds') || this.prefs.get('shields.adsAllowedSites').includes(siteOf(url));
  }

  setAdsAllowed(url: string, allowed: boolean): void {
    const site = siteOf(url);
    if (!site) return;
    const list = new Set(this.prefs.get('shields.adsAllowedSites'));
    if (allowed) list.add(site);
    else list.delete(site);
    this.prefs.set('shields.adsAllowedSites', [...list].sort());
  }

  setSiteEnabled(url: string, enabled: boolean): void {
    const site = siteOf(url);
    if (!site) return;
    const list = new Set(this.prefs.get('shields.siteExceptions'));
    if (enabled) list.delete(site);
    else list.add(site);
    this.prefs.set('shields.siteExceptions', [...list].sort());
  }

  status(webContentsId: number, url: string): ShieldsStatus {
    const c = this.counts.get(webContentsId) ?? { ads: 0, trackers: 0, other: 0 };
    return {
      enabled: this.isEnabled,
      siteEnabled: this.isSiteEnabled(url),
      blockAds: this.prefs.get('shields.blockAds'),
      adsAllowed: this.adsAllowed(url),
      strict: this.prefs.get('shields.aggressive'),
      site: siteOf(url),
      blocked: { ...c, total: c.ads + c.trackers + c.other },
      engineVersion: this.engineVersion,
      ruleSource: this.ruleSource,
    };
  }

  blockedCount(webContentsId: number): number {
    const c = this.counts.get(webContentsId);
    return c ? c.ads + c.trackers + c.other : 0;
  }

  resetCounts(webContentsId: number): void {
    this.counts.delete(webContentsId);
  }

  /** Installs request filtering, HTTPS-First, and third-party cookie blocking on a session. */
  install(pipeline: RequestPipeline): void {
    pipeline.addBeforeRequest({
      name: 'clean-links',
      priority: 5,
      onBeforeRequest: (d) => {
        if ((d.resourceType !== 'mainFrame' && d.resourceType !== 'subFrame') || !this.prefs.get('shields.cleanLinks') || !this.isSiteEnabled(d.url)) return null;
        const clean = cleanUrl(d.url);
        if (!clean) return null;
        if (d.webContentsId !== undefined) this.count(d.webContentsId, 'trackers');
        return { redirectURL: clean, reason: 'clean-links' };
      },
    });
    pipeline.addBeforeRequest({
      name: 'https-first',
      priority: 10,
      onBeforeRequest: (d) => {
        if (d.resourceType !== 'mainFrame' || !this.prefs.get('shields.httpsFirst') || !d.url.startsWith('http:')) return null;
        const u = new URL(d.url);
        if (isLocalHost(u.hostname) || this.httpAllowed.has(u.hostname)) return null;
        u.protocol = 'https:';
        if (d.webContentsId !== undefined) this.upgraded.set(d.webContentsId, u.hostname);
        return { redirectURL: u.href, reason: 'https-first' };
      },
    });
    pipeline.addBeforeRequest({
      name: 'shields',
      priority: 20,
      onBeforeRequest: (d) => {
        if (!this.isEnabled || d.resourceType === 'mainFrame') return null;
        const pageUrl = initiatorOf(d);
        if (!pageUrl.startsWith('http') || !this.isSiteEnabled(pageUrl)) return null;
        // Hyperlink auditing (<a ping>) and beacons to other sites exist only to track clicks.
        let r: CheckResult = d.resourceType === 'ping' && isCrossSite(d.url, pageUrl) ? { block: true, category: 'trackers' } : this.engine.check(d.url, pageUrl, d.resourceType);
        // Strict mode: known tracking companies embedded by other sites are blocked even
        // when the filter lists miss them.
        if (!r.block && this.prefs.get('shields.aggressive') && isKnownTracker(d.url) && isCrossSite(d.url, pageUrl)) r = { block: true, category: 'trackers' };
        if (!r.block) return null;
        // Ads the user chose to see (everywhere, or on this site); trackers stay blocked.
        if (r.category === 'ads' && this.adsAllowed(pageUrl)) return null;
        if (d.webContentsId !== undefined) {
          this.count(d.webContentsId, r.category);
          this.emit('blocked', { webContentsId: d.webContentsId, url: d.url, pageUrl, category: r.category } satisfies BlockedEvent);
        }
        return r.redirect ? { redirectURL: r.redirect, reason: 'shields-redirect' } : { cancel: true, reason: 'shields' };
      },
    });
    // Third-party cookies (SHD-04) and Global Privacy Control are native Chromium features
    // (see app/main.ts): no per-request header hooks.
  }

  private count(webContentsId: number, category: RequestCategory): void {
    const c = this.counts.get(webContentsId) ?? { ads: 0, trackers: 0, other: 0 };
    c[category]++;
    this.counts.set(webContentsId, c);
  }

  /** HTTPS-First fallback: an upgraded navigation failed, so go back to HTTP and remember the host. */
  handleUpgradeFailure(wc: WebContents, failedUrl: string): boolean {
    const host = this.upgraded.get(wc.id);
    if (!host || !failedUrl.startsWith('https:')) return false;
    const u = new URL(failedUrl);
    if (u.hostname !== host) return false;
    this.upgraded.delete(wc.id);
    this.httpAllowed.add(host);
    u.protocol = 'http:';
    void wc.loadURL(u.href);
    return true;
  }

  /** Element hiding, injected as a user stylesheet when the document is ready. */
  async applyCosmetic(wc: WebContents): Promise<void> {
    const url = wc.getURL();
    // Element hiding removes ad slots: none when ads are allowed here.
    if (!url.startsWith('http') || !this.isSiteEnabled(url) || this.adsAllowed(url)) return;
    const { css } = this.engine.cosmetic(url);
    if (css) await wc.insertCSS(css, { cssOrigin: 'user' }).catch(() => undefined);
  }

  applyDnsConfig(): void {
    const mode = this.prefs.get('shields.doh');
    try {
      app.configureHostResolver({
        secureDnsMode: mode,
        secureDnsServers: mode === 'off' ? [] : [this.prefs.get('shields.dohProvider')],
      });
    } catch (e) {
      console.warn('[vz] DoH config failed', e);
    }
  }

  // ---- Lists ----

  private publicKeys(): string[] {
    const dir = join(this.resourcesDir, 'shields', 'keys');
    if (!existsSync(dir)) return [];
    return readdirSync(dir).filter((f) => f.endsWith('.pem')).map((f) => readFileSync(join(dir, f), 'utf8'));
  }

  private loadEngine(): ShieldsEngine {
    const bin = join(this.dataDir, 'engine.bin');
    const man = join(this.dataDir, 'engine.json');
    if (existsSync(bin) && existsSync(man)) {
      try {
        const blob = readFileSync(bin);
        const manifest = JSON.parse(readFileSync(man, 'utf8')) as ListManifest;
        if (verifyBlob(blob, manifest, this.publicKeys()).ok) {
          this.engineVersion = manifest.version;
          this.ruleSource = 'signed';
          return ShieldsEngine.deserialize(blob);
        }
        console.warn('[vz] cached Shields engine failed verification; using baseline');
      } catch (e) {
        console.warn('[vz] cached Shields engine unreadable', e);
      }
    }
    return ShieldsEngine.fromLists([readFileSync(join(this.resourcesDir, 'shields', 'baseline.txt'), 'utf8')]);
  }

  /** Fetch the signed engine; verify; swap atomically. Returns why it did or didn't update. */
  async updateLists(fetcher: typeof fetch = fetch): Promise<string> {
    if (!this.listUrl) return 'no-list-url';
    try {
      const mres = await fetcher(`${this.listUrl}/engine.json`, { cache: 'no-store' });
      if (!mres.ok) return `manifest-http-${mres.status}`;
      const manifest = (await mres.json()) as ListManifest;
      if (manifest.version <= this.engineVersion) return 'up-to-date';
      const bres = await fetcher(`${this.listUrl}/engine.bin`, { cache: 'no-store' });
      if (!bres.ok) return `blob-http-${bres.status}`;
      const blob = new Uint8Array(await bres.arrayBuffer());
      const v = verifyBlob(blob, manifest, this.publicKeys(), this.engineVersion);
      if (!v.ok) {
        console.warn(`[vz] rejected Shields list: ${v.reason}`);
        return `rejected-${v.reason}`;
      }
      const next = ShieldsEngine.deserialize(blob);
      writeFileSync(join(this.dataDir, 'engine.bin.tmp'), blob);
      writeFileSync(join(this.dataDir, 'engine.json.tmp'), JSON.stringify(manifest));
      renameSync(join(this.dataDir, 'engine.bin.tmp'), join(this.dataDir, 'engine.bin'));
      renameSync(join(this.dataDir, 'engine.json.tmp'), join(this.dataDir, 'engine.json'));
      this.engine = next;
      this.engineVersion = manifest.version;
      this.ruleSource = 'signed';
      this.emit('lists-updated', manifest.version);
      return 'updated';
    } catch (e) {
      return `error-${(e as Error).message}`;
    }
  }

  startUpdates(): void {
    if (this.updateTimer || !this.listUrl) return;
    const tick = () => void this.updateLists();
    setTimeout(tick, 30_000).unref();
    this.updateTimer = setInterval(tick, UPDATE_INTERVAL_MS);
    this.updateTimer.unref();
  }

  stop(): void {
    if (this.updateTimer) clearInterval(this.updateTimer);
  }
}

function isLocalHost(h: string): boolean {
  return h === 'localhost' || h.endsWith('.localhost') || h === '127.0.0.1' || h === '[::1]' || /^(10|192\.168|172\.(1[6-9]|2\d|3[01]))\./.test(h) || /^\d+\.\d+\.\d+\.\d+$/.test(h);
}

function isCrossSite(a: string, b: string): boolean {
  const sa = siteOf(a);
  const sb = siteOf(b);
  return !!sa && !!sb && sa !== sb;
}
