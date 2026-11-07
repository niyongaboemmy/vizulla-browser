import { describe, expect, it } from 'vitest';
import { COMMANDS } from './commands';
import { resolveAccept, suggest, type SuggestSources } from './suggest';

const src = (over: Partial<SuggestSources> = {}): SuggestSources => ({
  tabs: () => [
    { id: 1, title: 'Pricing — Example', url: 'https://example.com/pricing', favicon: null, spaceName: 'Work', pinned: false, active: false },
    { id: 2, title: 'Inbox', url: 'https://mail.example/', favicon: null, spaceName: 'Home', pinned: true, active: true },
  ],
  history: (q) => (q.startsWith('ki') ? [{ url: 'https://kigali.example/', title: 'Kigali guide', favicon: null }] : []),
  bookmarks: () => [],
  archive: () => [{ id: 9, url: 'https://old.example/', title: 'Old research', favicon: null }],
  inlineCompletion: (q) => (q === 'exa' ? 'example.com' : null),
  commandTitle: (c) => c.id.replace('.', ' '),
  commandEnabled: () => true,
  shortcutLabel: (a) => a,
  searchEngine: 'duckduckgo',
  aiEnabled: true,
  strings: { goTo: 'Go', searchFor: 'Search with {engine}', ask: 'Ask', switchToTab: 'Switch', restoreArchived: 'Restore' },
  ...over,
});

describe('Command Bar suggestions (P2-BRW-14)', () => {
  it('puts the deterministic route first: URLs navigate, words search', () => {
    expect(suggest('example.com/a', 'address', src()).suggestions[0]).toMatchObject({ id: 'nav:https://example.com/a', kind: 'url' });
    const r = suggest('how to cook isombe', 'address', src());
    expect(r.route).toBe('search');
    expect(r.suggestions.find((s) => s.kind === 'search')!.detail).toBe('Search with DuckDuckGo');
    expect(r.suggestions.some((s) => s.kind === 'ask')).toBe(true);
  });
  it('offers switch-to-tab and inline completion', () => {
    const r = suggest('exa', 'address', src());
    expect(r.suggestions[0]!.id).toBe('nav:https://example.com/');
    expect(r.suggestions.some((s) => s.id === 'tab:1')).toBe(true);
  });
  it('">" lists commands only; tab-search includes the archive', () => {
    expect(suggest('> space', 'palette', src()).suggestions.every((s) => s.kind === 'command')).toBe(true);
    expect(suggest('old', 'tab-search', src()).suggestions.some((s) => s.id === 'archive:9')).toBe(true);
  });
  it('AI off: no ask rows, ever (AI-09)', () => {
    const r = suggest('what does the pro plan include', 'address', src({ aiEnabled: false }));
    expect(r.suggestions.some((s) => s.kind === 'ask')).toBe(false);
    expect(suggest('?what', 'palette', src({ aiEnabled: false })).suggestions).toHaveLength(0);
  });
  it('stays well under the 50 ms keystroke budget (PERF-05)', () => {
    const many = Array.from({ length: 500 }, (_, i) => ({ id: i, title: `Tab number ${i} about topic ${i % 37}`, url: `https://site${i}.example/page`, favicon: null, spaceName: 'S', pinned: false, active: false }));
    const s = src({ tabs: () => many });
    const t: number[] = [];
    for (const q of ['t', 'to', 'top', 'topi', 'topic 3', 'site42', '> tab']) {
      const t0 = performance.now();
      suggest(q, 'address', s);
      t.push(performance.now() - t0);
    }
    expect(Math.max(...t)).toBeLessThan(50);
  });
  it('resolves accepted rows', () => {
    expect(resolveAccept('x', 'tab:5', 'google')).toEqual({ kind: 'switch-tab', tabId: 5 });
    expect(resolveAccept('hello world', undefined, 'google')).toEqual({ kind: 'navigate', url: 'https://www.google.com/search?q=hello%20world', typed: false });
    expect(resolveAccept('x', 'nl:space.switch:{"space":"Work"}', 'google')).toEqual({ kind: 'command', id: 'space.switch', args: { space: 'Work' } });
  });
  it('has at least 30 commands, unique ids and accelerators (P2-BRW-13)', () => {
    expect(COMMANDS.length).toBeGreaterThanOrEqual(30);
    expect(new Set(COMMANDS.map((c) => c.id)).size).toBe(COMMANDS.length);
    const accels = COMMANDS.map((c) => c.accelerator).filter(Boolean);
    expect(new Set(accels).size).toBe(accels.length);
  });
});
