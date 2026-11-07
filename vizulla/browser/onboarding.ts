// First run (P2-BRW-19): import → layout → AI mode → search provider → finish.
// No account required. Every step can be skipped; defaults are private.
import type { BrowserApp } from './browser_app';
import { v } from '@vz/common/mojom/schema';
import { WRITABLE_PREFS, type PrefKey } from './prefs/prefs_schema';
import { SEARCH_ENGINES } from '@vz/common/url';
import { LOCALES } from '@vz/common/i18n';

export function installOnboarding(app: BrowserApp): void {
  const p = app.profile;
  app.pages.define('onboarding', {
    init: () => ({
      prefs: { layout: p.prefs.get('tabs.layout'), aiMode: p.prefs.get('ai.mode'), engine: p.prefs.get('search.engine'), theme: p.prefs.get('appearance.theme'), locale: p.prefs.get('appearance.locale') },
      engines: Object.entries(SEARCH_ENGINES).map(([id, e]) => ({ id, name: e.name })),
      locales: Object.entries(LOCALES).map(([id, name]) => ({ id, name })),
    }),
    set: (payload) => {
      const { key, value } = v.object({ key: v.string({ max: 64 }), value: v.json({ maxBytes: 1024 }) }).parse(payload, 'set');
      const check = WRITABLE_PREFS[key as PrefKey];
      if (!check?.(value)) throw new Error('not writable');
      p.prefs.set(key as PrefKey, value as never);
      if (key === 'ai.mode') p.prefs.set('ai.provider', value === 'cloud' ? 'gateway' : value === 'byo' ? 'anthropic' : 'local');
      return true;
    },
    detectImport: (x, ctx) => app.pageHandlers.get('settings')!.detectImport!(x, ctx),
    runImport: (x, ctx) => app.pageHandlers.get('settings')!.runImport!(x, ctx),
    finish: (_x, ctx) => {
      p.prefs.set('onboarding.completed', true);
      p.prefs.set('search.chosen', true);
      const w = ctx.window;
      const tab = w && [...w.tabs.values()].find((x) => x.wc === ctx.sender);
      if (w && tab) w.loadUrl(tab.id, 'vizulla://newtab/');
    },
  });
  app.hooks.windowCreated.push((w) => {
    if (p.prefs.get('onboarding.completed') || w.profile.isPrivate || process.env.VZ_TEST) return;
    const tab = w.activeTab();
    if (tab?.url.startsWith('vizulla://newtab')) w.loadUrl(tab.id, 'vizulla://onboarding/');
  });
}
