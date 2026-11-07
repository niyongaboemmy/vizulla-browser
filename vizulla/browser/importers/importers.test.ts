import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { describe, expect, it } from 'vitest';
import { chromeTimeToMs, detectSources, importFrom, parsePasswordCsv } from './importers';

const chromeTime = (ms: number) => (BigInt(ms) * 1000n + 11644473600000000n).toString();

function fakeHome() {
  const home = mkdtempSync(join(tmpdir(), 'vz-home-'));
  // Chrome (macOS layout) with Default + Profile 1
  const chrome = join(home, 'Library/Application Support/Google/Chrome');
  for (const p of ['Default', 'Profile 1']) mkdirSync(join(chrome, p), { recursive: true });
  writeFileSync(join(chrome, 'Default', 'Bookmarks'), JSON.stringify({
    roots: {
      bookmark_bar: { type: 'folder', name: 'Bookmarks bar', children: [
        { type: 'url', name: 'Irembo', url: 'https://irembo.gov.rw/', date_added: chromeTime(1_700_000_000_000) },
        { type: 'folder', name: 'Work', children: [{ type: 'url', name: 'Docs', url: 'https://docs.example/' }, { type: 'url', name: 'JS', url: 'javascript:void(0)' }] },
      ] },
      other: { type: 'folder', name: 'Other bookmarks', children: [] },
      sync_transaction_version: '1',
    },
  }));
  const db = new DatabaseSync(join(chrome, 'Default', 'History'));
  db.exec('CREATE TABLE urls (id INTEGER PRIMARY KEY, url TEXT, title TEXT, visit_count INTEGER, typed_count INTEGER, last_visit_time INTEGER, hidden INTEGER)');
  db.prepare('INSERT INTO urls (url, title, visit_count, typed_count, last_visit_time, hidden) VALUES (?, ?, ?, ?, ?, ?)').run('https://news.example/', 'News', 9, 2, BigInt(chromeTime(1_700_000_100_000)), 0);
  db.prepare('INSERT INTO urls (url, title, visit_count, typed_count, last_visit_time, hidden) VALUES (?, ?, ?, ?, ?, ?)').run('chrome://settings', 'Settings', 1, 0, BigInt(chromeTime(1_700_000_100_000)), 0);
  db.close();
  writeFileSync(join(chrome, 'Profile 1', 'Bookmarks'), JSON.stringify({ roots: {} }));
  // Firefox
  const ff = join(home, 'Library/Application Support/Firefox/Profiles/abc123.default-release');
  mkdirSync(ff, { recursive: true });
  const fdb = new DatabaseSync(join(ff, 'places.sqlite'));
  fdb.exec(`CREATE TABLE moz_places (id INTEGER PRIMARY KEY, url TEXT, title TEXT, visit_count INTEGER, typed INTEGER, last_visit_date INTEGER, hidden INTEGER DEFAULT 0);
    CREATE TABLE moz_bookmarks (id INTEGER PRIMARY KEY, type INTEGER, fk INTEGER, parent INTEGER, title TEXT, dateAdded INTEGER);
    INSERT INTO moz_places VALUES (1, 'https://mozilla.org/', 'Mozilla', 4, 1, 1700000000000000, 0);
    INSERT INTO moz_bookmarks VALUES (1, 2, NULL, 0, 'toolbar', 0);
    INSERT INTO moz_bookmarks VALUES (2, 1, 1, 1, 'Mozilla', 1700000000000000);`);
  fdb.close();
  return home;
}

describe('importers (P1-BRW-07/08)', () => {
  const home = fakeHome();

  it('detects Chromium-family and Firefox profiles', () => {
    const s = detectSources(home, 'darwin');
    expect(s.map((x) => `${x.browser}:${x.profileName}`).sort()).toEqual(['chrome:Default', 'chrome:Profile 1', 'firefox:default-release']);
  });

  it('imports Chrome bookmarks (with folders) and history, skipping non-web URLs', () => {
    const src = detectSources(home, 'darwin').find((x) => x.browser === 'chrome' && x.profileName === 'Default')!;
    const d = importFrom(src, { bookmarks: true, history: true });
    expect(d.bookmarks.map((b) => [b.title, b.folder])).toEqual([['Irembo', ''], ['Docs', 'Work']]);
    expect(d.bookmarks[0]!.addedAt).toBe(1_700_000_000_000);
    expect(d.history).toEqual([{ url: 'https://news.example/', title: 'News', visitCount: 9, typedCount: 2, lastVisit: 1_700_000_100_000 }]);
  });

  it('imports Firefox places', () => {
    const src = detectSources(home, 'darwin').find((x) => x.browser === 'firefox')!;
    const d = importFrom(src, { bookmarks: true, history: true });
    expect(d.bookmarks).toEqual([{ url: 'https://mozilla.org/', title: 'Mozilla', folder: '', addedAt: 1_700_000_000_000 }]);
    expect(d.history[0]).toMatchObject({ url: 'https://mozilla.org/', visitCount: 4, lastVisit: 1_700_000_000_000 });
  });

  it('converts Chrome time', () => expect(chromeTimeToMs(chromeTime(123456789))).toBe(123456789));

  it('parses password CSVs from Chrome and Firefox with quoting', () => {
    const chrome = 'name,url,username,password,note\nIrembo,https://irembo.gov.rw/login,alice,"p,""q",\n';
    const firefox = 'url,username,password,httpRealm,formActionOrigin,guid,timeCreated\r\n"https://mozilla.org","bob","s3cret",,"",{x},1\r\n';
    expect(parsePasswordCsv(chrome)).toEqual([{ origin: 'https://irembo.gov.rw', username: 'alice', password: 'p,"q', note: 'Irembo' }]);
    expect(parsePasswordCsv(firefox)[0]).toMatchObject({ origin: 'https://mozilla.org', username: 'bob', password: 's3cret' });
    expect(parsePasswordCsv('url,password\njavascript:alert(1),x\nftp://a,y\n')).toEqual([]);
    expect(() => parsePasswordCsv('a,b\n1,2')).toThrow();
  });
});
