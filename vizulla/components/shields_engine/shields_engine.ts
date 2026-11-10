// Shields filter engine (P1-BRW-02). Wraps a compiled adblock engine (EasyList
// syntax, MPL-2.0 engine, license reviewed) behind three calls:
//   load(serialized) · check(url, sourceUrl, type) · cosmetic(url) · scripts(url)
// The engine runs in the browser process on the request path (DD-3), so check()
// must stay well under 0.1 ms median.
import { FiltersEngine, Request } from '@ghostery/adblocker';

export type RequestCategory = 'ads' | 'trackers' | 'other';

export interface CheckResult {
  block: boolean;
  redirect?: string;
  category: RequestCategory;
  filter?: string;
}

// Known tracker/analytics hosts: used to label blocked requests for the Privacy Dashboard.
const TRACKER_HOSTS = [
  'google-analytics.com', 'googletagmanager.com', 'analytics.google.com', 'connect.facebook.net', 'facebook.com/tr',
  'scorecardresearch.com', 'hotjar.com', 'segment.io', 'segment.com', 'mixpanel.com', 'amplitude.com', 'fullstory.com',
  'quantserve.com', 'chartbeat.com', 'newrelic.com', 'nr-data.net', 'clarity.ms', 'bat.bing.com', 'snap.licdn.com',
  'px.ads.linkedin.com', 'analytics.tiktok.com', 'mc.yandex.ru', 'stats.wp.com', 'matomo', 'piwik', 'branch.io', 'adjust.com',
];

export class ShieldsEngine {
  private engine: FiltersEngine;
  private _ruleCount = 0;

  private constructor(engine: FiltersEngine, rules: number) {
    this.engine = engine;
    this._ruleCount = rules;
  }

  static fromLists(lists: string[]): ShieldsEngine {
    const text = lists.join('\n');
    const rules = text.split('\n').filter((l) => l.trim() && !l.startsWith('!') && !l.startsWith('[')).length;
    return new ShieldsEngine(FiltersEngine.parse(text, { enableCompression: false, loadCosmeticFilters: true, loadNetworkFilters: true }), rules);
  }

  /**
   * The full engine: filter lists plus uBlock Origin's resources (scriptlets such as
   * json-prune for video ads, and surrogate scripts so players work without ad SDKs).
   */
  static fromListsWithResources(lists: string[], resources: string): ShieldsEngine {
    const e = ShieldsEngine.fromLists(lists);
    e.engine.updateResources(resources, String(resources.length));
    return e;
  }

  static deserialize(bytes: Uint8Array): ShieldsEngine {
    return new ShieldsEngine(FiltersEngine.deserialize(bytes), -1);
  }

  serialize(): Uint8Array {
    return this.engine.serialize();
  }

  get ruleCount(): number {
    return this._ruleCount;
  }

  check(url: string, sourceUrl: string, type: string): CheckResult {
    const req = Request.fromRawDetails({ url, sourceUrl, type: normalizeType(type) as never });
    if (!req.isHttp && !req.isHttps) return { block: false, category: 'other' };
    const r = this.engine.match(req);
    if (!r.match && !r.redirect) return { block: false, category: 'other' };
    return {
      block: true,
      redirect: r.redirect?.dataUrl,
      category: categorize(url),
      filter: r.filter?.toString(),
    };
  }

  /** Element-hiding CSS for a page (generic + site-specific rules). */
  cosmetic(url: string): { css: string } {
    let hostname = '';
    try {
      hostname = new URL(url).hostname;
    } catch {
      return { css: '' };
    }
    const r = this.engine.getCosmeticsFilters({
      url,
      hostname,
      domain: hostname.split('.').slice(-2).join('.'),
      getBaseRules: true,
      getInjectionRules: false,
      getExtendedRules: false,
      getRulesFromDOM: false,
      getRulesFromHostname: true,
    });
    return { css: r.styles };
  }

  /**
   * Generic element hiding for what's on the page: EasyList's class/id/link rules are
   * only matched against the classes, ids and hrefs the page actually uses.
   */
  domCosmetic(url: string, f: { classes: string[]; ids: string[]; hrefs: string[] }): string {
    let hostname = '';
    try {
      hostname = new URL(url).hostname;
    } catch {
      return '';
    }
    return this.engine.getCosmeticsFilters({
      url,
      hostname,
      domain: hostname.split('.').slice(-2).join('.'),
      classes: f.classes,
      ids: f.ids,
      hrefs: f.hrefs,
      getBaseRules: false,
      getInjectionRules: false,
      getExtendedRules: false,
      getRulesFromDOM: true,
      getRulesFromHostname: false,
    }).styles;
  }

  /**
   * Scriptlets for a frame (e.g. YouTube's ad fields pruned from the player response).
   * They must run before the page's own scripts: page_preload.ts injects them.
   */
  scripts(url: string): string[] {
    let hostname = '';
    try {
      hostname = new URL(url).hostname;
    } catch {
      return [];
    }
    if (!hostname) return [];
    return this.engine.getCosmeticsFilters({
      url,
      hostname,
      domain: hostname.split('.').slice(-2).join('.'),
      getBaseRules: false,
      getInjectionRules: true,
      getExtendedRules: false,
      getRulesFromDOM: false,
      getRulesFromHostname: true,
    }).scripts;
  }
}

function normalizeType(t: string): string {
  // Electron resourceType values match the engine's Electron request types.
  return t || 'other';
}

/** A request to a known tracking company (used by strict mode beyond the lists). */
export function isKnownTracker(url: string): boolean {
  const u = url.toLowerCase();
  return TRACKER_HOSTS.some((h) => u.includes(h));
}

export function categorize(url: string): RequestCategory {
  const u = url.toLowerCase();
  return TRACKER_HOSTS.some((h) => u.includes(h)) ? 'trackers' : 'ads';
}
