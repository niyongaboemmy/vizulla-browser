// MemoryService (P4-AI-09, MEM-01/02/03/05/07): opt-in, off by default.
// Eligible pages: http(s), not private, not agent, not excluded, not sensitive
// (MEM-02: when unsure → skip). Indexing runs when the machine is idle and on
// AC power (unless the user allows battery). Deleting history deletes Memory
// items. Stored text is always reinjected as untrusted data (TH-6).
import { powerMonitor } from 'electron';
import { join } from 'node:path';
import type { BrowserApp } from '../browser_app';
import type { BrowserWindowController } from '../ui/browser_window';
import type { WebTab } from '../tabs/web_tab';
import type { AssistantService } from '../ai/assistant_service';
import { UtilityHost } from '../utility/utility_host';
import { sensitivityOf } from '../ai/router/model_router';
import { answerExtractive, tokenize } from '@vz/components/ai_runtime/extractive';
import { v } from '@vz/common/mojom/schema';
import { siteOf } from '@vz/common/url';
import { t } from '@vz/common/i18n';
import { kVizullaMemory } from '../vizulla_features';
import type { MemoryHit } from '@vz/components/memory_index/memory_index';

interface Pending {
  tabId: number;
  window: BrowserWindowController;
  url: string;
  title: string;
  kind: 'visit' | 'save';
  at: number;
}

export class MemoryService {
  readonly host: UtilityHost;
  private queue: Pending[] = [];
  private timer: NodeJS.Timeout;
  private recallCache = new Map<string, MemoryHit[]>();
  readonly stats = { indexed: 0, skipped: 0 };

  constructor(private readonly app: BrowserApp, private readonly assistant: AssistantService) {
    const p = app.profile;
    this.host = new UtilityHost({
      modulePath: app.joinOut('utility', 'memory_index.js'),
      serviceName: 'Vizulla Memory',
      idleMs: 10 * 60_000,
      timeoutMs: 20_000,
      init: () => ({ path: join(p.dir, 'Memory.db'), key: p.keys.getOrCreateKey('memory').toString('base64') }),
    });
    p.register('memory', this, () => this.host.unload());

    app.hooks.windowCreated.push((w) => {
      w.on('tab-loaded', (tab: WebTab) => this.consider(w, tab, 'visit'));
    });
    // History deletion → Memory deletion (MEM-07, doc 06 §7).
    p.history.onDeleted((urls) => {
      if (!this.host.running && !this.enabled) return;
      if (urls === 'all') void this.call('list', { limit: 100000 }).then((items) => this.call('remove', { ids: (items as { id: number; saved: boolean }[]).filter((i) => !i.saved).map((i) => i.id) }));
      else void this.call('removeUrls', { urls });
    });
    p.prefs.observe('memory.enabled', (on) => {
      if (!on) this.queue = [];
    });
    this.timer = setInterval(() => void this.drain(), process.env.VZ_TEST ? 500 : 20_000);
    this.timer.unref();

    app.commandHandlers.set('memory.save', (w) => {
      const tab = w.activeTab();
      if (tab) void this.save(w, tab);
    });
    app.commandHandlers.set('memory.open', async (w, args) => {
      const item = (await this.call('get', { id: Number(args?.id) })) as { url: string } | null;
      if (item) w.loadUrl(null, item.url, { newTab: true });
    });
    app.commandHandlers.set('page.memory', (w) => w.loadUrl(null, 'vizulla://memory', { newTab: true }));

    // Command Bar recall (P4-BRW-01): results are prefetched before the sync suggest pass.
    app.hooks.prefetchSuggest.push(async (_w, q) => {
      if (!this.enabled || q.trim().length < 3 || /^[>?]/.test(q.trim())) return;
      const hits = (await this.call('search', { query: q, limit: 4 }).catch(() => [])) as MemoryHit[];
      this.recallCache.set(q, hits);
      if (this.recallCache.size > 50) this.recallCache.delete(this.recallCache.keys().next().value!);
    });
    app.hooks.suggestSources.push(() => ({
      memory: (q: string, n: number) => (this.recallCache.get(q) ?? []).slice(0, n).map((h) => ({ id: h.id, url: h.url, title: h.title, snippet: h.snippet.slice(0, 120), when: relTime(h.visitedAt) })),
    }));
    this.definePage();
  }

  get enabled(): boolean {
    return this.app.profile.prefs.get('memory.enabled') && this.app.profile.features.isEnabled(kVizullaMemory);
  }

  call<T = unknown>(method: string, params?: unknown): Promise<T> {
    return this.host.call<T>(method, params);
  }

  /** Eligibility rules (MEM-01/02). Returns the reason when skipped. */
  eligibility(w: BrowserWindowController, tab: WebTab, kind: 'visit' | 'save'): string | null {
    if (!this.enabled && kind === 'visit') return 'opted-out';
    if (w.profile.isPrivate) return 'private';
    if (tab.agent) return 'agent';
    if (!/^https?:/.test(tab.url)) return 'scheme';
    if (this.app.profile.prefs.get('memory.excludedSites').includes(siteOf(tab.url))) return 'excluded';
    if (kind === 'visit' && sensitivityOf(tab.url) === 'high') return 'sensitive';
    return null;
  }

  private consider(w: BrowserWindowController, tab: WebTab, kind: 'visit' | 'save'): void {
    const why = this.eligibility(w, tab, kind);
    if (why) {
      this.stats.skipped++;
      return;
    }
    this.queue = this.queue.filter((q) => q.url !== tab.url);
    this.queue.push({ tabId: tab.id, window: w, url: tab.url, title: tab.title, kind, at: Date.now() });
    if (this.queue.length > 200) this.queue.shift();
  }

  /** Indexes queued pages when idle and on AC (or immediately for explicit saves). */
  async drain(force = false): Promise<void> {
    if (!this.queue.length) return;
    const onBattery = powerMonitor.isOnBatteryPower();
    const idle = powerMonitor.getSystemIdleTime() >= 15 || !!process.env.VZ_TEST;
    const batch = this.queue.filter((q) => force || q.kind === 'save' || (idle && (!onBattery || this.app.profile.prefs.get('memory.indexOnBattery'))));
    for (const item of batch.slice(0, 5)) {
      this.queue.splice(this.queue.indexOf(item), 1);
      const tab = item.window.tabs.get(item.tabId);
      if (!tab || tab.url !== item.url || !tab.wc) continue;
      try {
        const r = await this.assistant.extract(tab);
        const texts = r.chunks.map((c) => c.text);
        if (!texts.length) continue;
        const summary = item.kind === 'save' ? answerExtractive({ kind: 'summarize', style: 'tldr' }, r.chunks).replace(/\s*\[c\d+\]/g, '') : '';
        await this.call('add', {
          kind: item.kind, url: item.url, title: item.title || r.title, visitedAt: item.at, chunks: texts, summary, tags: item.kind === 'save' ? topTags(texts.join(' ')) : [],
          expiresAt: null,
        });
        this.stats.indexed++;
      } catch (e) {
        console.warn('[vz] memory index failed', (e as Error).message);
      }
    }
  }

  async save(w: BrowserWindowController, tab: WebTab): Promise<void> {
    const why = this.eligibility(w, tab, 'save');
    if (why) {
      w.toast(t('memory_cant_save'), undefined, 3000);
      return;
    }
    this.consider(w, tab, 'save');
    await this.drain(true);
    w.toast(t('memory_saved'), { label: t('cmd_memory_page'), run: () => w.loadUrl(null, 'vizulla://memory', { newTab: true }) });
  }

  private definePage(): void {
    const p = this.app.profile;
    const data = async () => ({ enabled: p.prefs.get('memory.enabled'), excluded: p.prefs.get('memory.excludedSites'), retentionDays: p.prefs.get('memory.retentionDays'), stats: this.stats, items: this.enabled || this.host.running ? await this.call('list', { limit: 500 }).catch(() => []) : [] });
    this.app.pages.define('memory', {
      init: () => ({ enabled: p.prefs.get('memory.enabled') }),
      load: () => data(),
      search: (payload) => this.call('search', { query: v.string({ max: 500 }).parse(payload, 'q'), limit: 30 }),
      setEnabled: async (payload) => {
        p.prefs.set('memory.enabled', v.bool().parse(payload, 'on'));
        return data();
      },
      remove: async (payload) => {
        await this.call('remove', { ids: v.array(v.int({ min: 0 }), { max: 1000 }).parse(payload, 'ids') });
        return data();
      },
      removeSite: async (payload) => {
        await this.call('removeSite', { site: v.string({ max: 255 }).parse(payload, 'site') });
        return data();
      },
      removeRange: async (payload) => {
        const { from, to } = v.object({ from: v.number(), to: v.number() }).parse(payload, 'range');
        await this.call('removeRange', { from, to });
        return data();
      },
      exclude: async (payload) => {
        const site = v.string({ max: 255 }).parse(payload, 'site').toLowerCase();
        p.prefs.set('memory.excludedSites', [...new Set([...p.prefs.get('memory.excludedSites'), site])].sort());
        await this.call('removeSite', { site });
        return data();
      },
      unexclude: async (payload) => {
        const site = v.string({ max: 255 }).parse(payload, 'site');
        p.prefs.set('memory.excludedSites', p.prefs.get('memory.excludedSites').filter((s) => s !== site));
        return data();
      },
      wipe: async () => {
        await this.call('wipe');
        return data();
      },
      open: (payload, ctx) => {
        const url = v.string({ max: 8192 }).parse(payload, 'url');
        if (/^https?:/.test(url)) (ctx.window ?? this.app.focused())?.loadUrl(null, url, { newTab: true });
      },
    });
  }
}

function topTags(text: string): string[] {
  const freq = new Map<string, number>();
  for (const w of tokenize(text)) if (w.length > 4 && !/^\d+$/.test(w)) freq.set(w, (freq.get(w) ?? 0) + 1);
  return [...freq.entries()].sort((a, b) => b[1] - a[1]).slice(0, 4).map(([w]) => w);
}

function relTime(t: number): string {
  const days = Math.floor((Date.now() - t) / 86_400_000);
  const rtf = new Intl.RelativeTimeFormat(undefined, { numeric: 'auto' });
  return days < 1 ? rtf.format(-Math.round((Date.now() - t) / 3600_000), 'hour') : rtf.format(-days, 'day');
}
