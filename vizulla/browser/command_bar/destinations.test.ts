import { describe, expect, it } from 'vitest';
import { DESTINATIONS, destinationUrl, keywordScore, matchDestinations } from './destinations';

const title = (d: { title: string }) => d.title.replace(/^(cmd|set|settings)_/, '').replace(/_/g, ' ');
const top = (q: string, group?: 'settings' | 'pages' | 'tools') => matchDestinations(q, title, 3, group)[0]?.d.id;

describe('destinations', () => {
  it('finds settings the way people phrase them, in four languages', () => {
    expect(top('dark mode')).toBe('theme');
    expect(top('mode sombre')).toBe('theme');
    expect(top('umwijima')).toBe('theme');
    expect(top('delete history')).toBe('clear-data');
    expect(top('block ads')).toBe('block-ads');
    expect(top('matangazo')).toBe('block-ads');
    expect(top('incognito')).toBe('new-private');
    expect(top('langue')).toBe('language');
    expect(top('search engine')).toBe('search-engine');
    expect(top('slow')).toBe('task-manager');
    expect(top('nenosiri')).toMatch(/passwords/);
  });

  it('ignores accents and very short queries', () => {
    expect(keywordScore('parametres', 'réglages paramètres')).toBeGreaterThan(0);
    expect(keywordScore('a', 'anything at all')).toBe(0);
  });

  it('scopes to a group and builds settings deep links', () => {
    expect(matchDestinations('', title, 50, 'tools').every((m) => m.d.group === 'tools')).toBe(true);
    const theme = DESTINATIONS.find((d) => d.id === 'theme')!;
    expect(destinationUrl(theme, () => 'Theme')).toBe('vizulla://settings/appearance?q=Theme');
    expect(destinationUrl(DESTINATIONS.find((d) => d.id === 'privacy')!, () => 'x')).toBe('vizulla://settings/shields');
    expect(destinationUrl(DESTINATIONS.find((d) => d.id === 'history')!, () => 'x')).toBe('vizulla://history/');
  });

  it('every destination has a unique id and a target', () => {
    expect(new Set(DESTINATIONS.map((d) => d.id)).size).toBe(DESTINATIONS.length);
    for (const d of DESTINATIONS) expect(!!(d.url || d.settings || d.command)).toBe(true);
  });
});
