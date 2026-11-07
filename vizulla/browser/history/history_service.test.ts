import { describe, expect, it } from 'vitest';
import { HistoryService } from './history_service';

describe('HistoryService', () => {
  it('ranks by frecency and host prefix, completes inline', () => {
    let now = 1_700_000_000_000;
    const h = new HistoryService(':memory:', () => now);
    for (let i = 0; i < 5; i++) h.addVisit('https://www.irembo.gov.rw/home', 'Irembo', { typed: true });
    h.addVisit('https://example.com/irembo-review', 'Review of Irembo');
    h.addVisit('javascript:alert(1)', 'x');
    now += 3600_000;
    const r = h.search('irem');
    expect(r[0]!.url).toBe('https://www.irembo.gov.rw/home');
    expect(r).toHaveLength(2);
    expect(h.inlineCompletion('ire')).toBe('irembo.gov.rw');
    expect(h.count()).toBe(2);
  });
  it('matches title words with diacritics folded', () => {
    const h = new HistoryService(':memory:');
    h.addVisit('https://fr.example/', 'Café et thé à Kigali');
    expect(h.search('cafe kigali')).toHaveLength(1);
  });
  it('notifies listeners on deletion (Memory follows history deletion)', () => {
    const h = new HistoryService(':memory:');
    const seen: unknown[] = [];
    h.onDeleted((u) => seen.push(u));
    h.addVisit('https://a.com/', 'A', { at: 1000 });
    h.addVisit('https://b.com/', 'B', { at: 5000 });
    expect(h.deleteRange(0, 2000)).toBe(1);
    h.clearAll();
    expect(seen).toEqual([['https://a.com/'], 'all']);
    expect(h.count()).toBe(0);
  });
  it('bookmarks dedupe per folder', () => {
    const h = new HistoryService(':memory:');
    expect(h.addBookmark('https://a/', 'A')).toBe(h.addBookmark('https://a/', 'A again'));
    h.addBookmark('https://a/', 'A', 'Work');
    expect(h.bookmarks()).toHaveLength(2);
    expect(h.isBookmarked('https://a/')).toBe(true);
  });
});
