import { randomBytes } from 'node:crypto';
import { mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { MemoryIndex, parseQuery } from './memory_index';

const DAY = 86_400_000;
const now = new Date('2027-06-10T15:00:00Z').getTime();
const path = () => join(mkdtempSync(join(tmpdir(), 'vz-mem-')), 'memory.db');

function seeded(p = path(), key = randomBytes(32)) {
  const m = new MemoryIndex(p, key, () => now);
  m.add({ kind: 'visit', url: 'https://techsite.example/laptop-a-review', title: 'Laptop A review', visitedAt: now - DAY - 3600_000, chunks: ['Laptop A has a 14 inch screen and 18 hours of battery life.', 'The keyboard is excellent for typing.'] });
  m.add({ kind: 'visit', url: 'https://maker.example/laptop-b', title: 'Laptop B specs', visitedAt: now - DAY - 7200_000, chunks: ['Laptop B weighs 1.2 kg with an OLED display.'] });
  m.add({ kind: 'visit', url: 'https://www.youtube.com/watch?v=1', title: 'Isombe recipe video', visitedAt: now - 10 * DAY, chunks: ['How to cook isombe with cassava leaves and eggplant.'] });
  m.add({ kind: 'save', url: 'https://irembo.gov.rw/passport', title: 'Passport application', visitedAt: now - 40 * DAY, chunks: ['Apply for a passport online and pay the fee with mobile money.'] });
  return { m, p, key };
}

describe('memory_index (P4-AI-08, DD-8/9)', () => {
  it('recalls by meaning and words, ranked, with snippets', () => {
    const { m } = seeded();
    const r = m.search('laptop battery');
    expect(r[0]!.title).toBe('Laptop A review');
    expect(r[0]!.snippet).toContain('battery');
    expect(m.search('cassava')[0]!.title).toBe('Isombe recipe video');
  });
  it('parses time and site filters from the query', () => {
    const { m } = seeded();
    expect(m.search('laptops I looked at yesterday').map((h) => h.title).sort()).toEqual(['Laptop A review', 'Laptop B specs']);
    expect(m.search('recipe on youtube').map((h) => h.title)).toEqual(['Isombe recipe video']);
    const q = parseQuery('the laptop review I read yesterday', now);
    expect(q.text).toBe('laptop review');
    expect(q.to! - q.from!).toBe(DAY);
  });
  it('encrypts at rest: the file contains no page text, and another key reads nothing', () => {
    const { m, p } = seeded();
    m.close();
    const raw = readFileSync(p).toString('latin1');
    for (const s of ['Laptop', 'battery', 'isombe', 'irembo', 'passport']) expect(raw.toLowerCase()).not.toContain(s.toLowerCase());
    const stranger = new MemoryIndex(p, randomBytes(32), () => now);
    expect(stranger.stats().items).toBe(0);
    expect(stranger.search('laptop')).toEqual([]);
  });
  it('survives reopen with the right key', () => {
    const { m, p, key } = seeded();
    m.close();
    const again = new MemoryIndex(p, key, () => now);
    expect(again.stats().items).toBe(4);
    expect(again.search('passport mobile money')[0]!.saved).toBe(true);
  });
  it('deletes by URL (history deletion), site, time range; vectors too', () => {
    const { m } = seeded();
    expect(m.removeUrls(['https://maker.example/laptop-b'])).toBe(1);
    expect(m.removeSite('youtube.com')).toBe(1);
    expect(m.removeRange(now - 2 * DAY, now)).toBe(1);
    expect(m.stats()).toEqual({ items: 1, chunks: 1 });
    expect(m.search('laptop')).toEqual([]);
  });
  it('expires unsaved items past retention but keeps saved ones', () => {
    const { m } = seeded();
    expect(m.expire(30)).toBe(0);
    expect(m.expire(5)).toBe(1);
    expect(m.list().map((i) => i.title)).toEqual(['Laptop A review', 'Laptop B specs', 'Passport application']);
  });
  it('replaces the item when the same URL is indexed again', () => {
    const { m } = seeded();
    m.add({ kind: 'visit', url: 'https://maker.example/laptop-b', title: 'Laptop B specs (updated)', visitedAt: now, chunks: ['Now with 32 GB of memory.'] });
    expect(m.stats().items).toBe(4);
    expect(m.search('32 GB memory')[0]!.title).toContain('updated');
  });
  it('searches 5,000 pages fast (PERF-08 budget ≤ 200 ms p95 at 50k on RD-1)', () => {
    const m = new MemoryIndex(':memory:', randomBytes(32), () => now);
    const words = 'coffee tea laptop phone recipe passport visa bank loan school exam football music film travel hotel bus moto price review guide'.split(' ');
    for (let i = 0; i < 5000; i++) {
      const w = (k: number) => words[(i * 7 + k * 13) % words.length];
      m.add({ kind: 'visit', url: `https://s${i}.example/p`, title: `${w(1)} ${w(2)} page ${i}`, visitedAt: now - (i % 90) * DAY, chunks: [`About ${w(3)} and ${w(4)} in Kigali, item ${i}.`] });
    }
    const times: number[] = [];
    for (const q of ['coffee price', 'laptop review last week', 'bus travel', 'exam school', 'hotel on s42']) {
      const t = performance.now();
      m.search(q);
      times.push(performance.now() - t);
    }
    expect(Math.max(...times)).toBeLessThan(200);
  });
});
