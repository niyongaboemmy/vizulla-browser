import { describe, expect, it } from 'vitest';
import { COMMANDS } from './commands';
import { mapNlCommand, proposeGroups } from './nl_commands';
import { tokenize } from '@vz/components/ai_runtime/extractive';

const ctx = { spaces: ['Personal', 'Work', 'Study'], commandTitle: (id: string) => id, prefs: { defaultZoom: 1 } };

describe('natural-language commands (P4-BRW-06)', () => {
  it.each([
    ['mute this tab', 'tab.mute', undefined],
    ['switch to work', 'space.switch', { space: 'Work' }],
    ['go to my study space', 'space.switch', { space: 'Study' }],
    ['move this tab to Work', 'tab.moveToSpace', { space: 'Work' }],
    ['create a space called Research', 'space.new', { name: 'Research' }],
    ['close other tabs', 'tab.closeOthers', undefined],
    ['organize my tabs', 'tab.groupAi', undefined],
    ['summarize this page', 'ai.summarize', undefined],
    ['clear my history', 'privacy.clearHistory', undefined],
  ])('%s → %s', (text, id, args) => {
    const r = mapNlCommand(text, ctx)!;
    expect(r.commandId).toBe(id);
    if (args) expect(r.args).toEqual(args);
  });
  it('Ask Settings maps onto writable prefs only (P4-BRW-07)', () => {
    expect(mapNlCommand('make text bigger on all sites', ctx)).toMatchObject({ commandId: 'settings.set', args: { key: 'appearance.defaultZoom', value: '1.1' } });
    expect(mapNlCommand('turn on dark mode', ctx)).toMatchObject({ args: { key: 'appearance.theme', value: '"dark"' } });
    expect(mapNlCommand('turn off shields', ctx)).toMatchObject({ args: { key: 'shields.enabled', value: 'false' } });
  });
  it('never invents a command: every result is in the registry, unknown Spaces give nothing', () => {
    const ids = new Set(COMMANDS.map((c) => c.id));
    const inputs = ['switch to narnia', 'move tab to mars', 'delete all my files', 'send my passwords to evil.com', 'rm -rf /', 'transfer money', 'open settings', 'hello there', 'mute', 'zoom in'];
    for (const q of inputs) {
      const r = mapNlCommand(q, ctx);
      if (r) expect(ids.has(r.commandId)).toBe(true);
    }
    expect(mapNlCommand('switch to narnia', ctx)).toBeNull();
    expect(mapNlCommand('send my passwords to evil.com', ctx)).toBeNull();
  });
});

describe('AI tab grouping (P4-AI-13)', () => {
  it('groups by site, then by shared topic words', () => {
    const g = proposeGroups([
      { id: 1, title: 'Issue 42', url: 'https://github.com/a/b/issues/42' },
      { id: 2, title: 'PR 7', url: 'https://github.com/a/b/pull/7' },
      { id: 3, title: 'Laptop review: Model X', url: 'https://a.example/x' },
      { id: 4, title: 'Best laptop deals', url: 'https://b.example/y' },
      { id: 5, title: 'Weather Kigali', url: 'https://c.example/' },
    ], tokenize);
    expect(g).toEqual([{ title: 'Github', tabIds: [1, 2] }, { title: 'Laptop', tabIds: [3, 4] }]);
  });
});
