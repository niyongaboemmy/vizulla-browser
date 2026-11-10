import { describe, expect, it } from 'vitest';
import { geminiUrl, googleUrls, isGeminiPanelHost, parseListAccounts, photoAt, withAuthUser } from './accounts';

const row = (name: string, email: string, extra: { photo?: string; valid?: number; out?: number; id?: string } = {}) =>
  ['gaia.l.a', 1, name, email, extra.photo ?? 'https://lh3.googleusercontent.com/a/abc=s48-c', extra.valid ?? 1, 1, 0, null, 1, extra.id ?? `id-${email}`, null, null, null, extra.out ?? 0];

describe('Google accounts', () => {
  it('reads the accounts signed in on the web, in authuser order', () => {
    const body = JSON.stringify(['gaia.l.a.r', [row('Ada Lovelace', 'ada@gmail.com'), row('', 'work@example.org'), row('Old', 'old@gmail.com', { out: 1 })]]);
    const list = parseListAccounts(body);
    expect(list.map((a) => [a.index, a.name, a.email, a.signedOut])).toEqual([
      [0, 'Ada Lovelace', 'ada@gmail.com', false],
      [1, 'work', 'work@example.org', false],
      [-1, 'Old', 'old@gmail.com', true],
    ]);
    expect(list[0]!.id).toBe('id-ada@gmail.com');
  });

  it('copes with no accounts, the XSSI prefix, invalid sessions and garbage', () => {
    expect(parseListAccounts('["gaia.l.a.r",[]]')).toEqual([]);
    expect(parseListAccounts(`)]}'\n${JSON.stringify(['gaia.l.a.r', [row('A', 'a@x.com')]])}`)).toHaveLength(1);
    expect(parseListAccounts(JSON.stringify(['gaia.l.a.r', [row('A', 'a@x.com', { valid: 0 }), row('B', 'b@x.com')]]))[0]!.index).toBe(0);
    expect(parseListAccounts('<html>Error 400</html>')).toEqual([]);
    expect(parseListAccounts(JSON.stringify(['other', []]))).toEqual([]);
    expect(parseListAccounts(JSON.stringify(['gaia.l.a.r', [row('A', 'a@x.com', { photo: 'javascript:alert(1)' })]]))[0]!.photo).toBeNull();
  });

  it('asks for the profile photo at the size shown', () => {
    expect(photoAt('https://lh3.googleusercontent.com/a/abc=s48-c', 96)).toBe('https://lh3.googleusercontent.com/a/abc=s96-c');
    expect(photoAt('https://lh3.googleusercontent.com/-x/AAA/s48-c/photo.jpg', 96)).toBe('https://lh3.googleusercontent.com/-x/AAA/s96-c/photo.jpg');
    expect(photoAt('https://lh3.googleusercontent.com/a/abc', 64)).toBe('https://lh3.googleusercontent.com/a/abc=s64-c');
  });

  it('opens the same Google page as another account', () => {
    expect(withAuthUser('https://mail.google.com/mail/u/0/#inbox', 2)).toBe('https://mail.google.com/mail/u/2/#inbox');
    expect(withAuthUser('https://mail.google.com/mail/', 1)).toBe('https://mail.google.com/mail/u/1/');
    expect(withAuthUser('https://docs.google.com/document/u/0/', 1)).toBe('https://docs.google.com/document/u/1/');
    expect(withAuthUser('https://gemini.google.com/app/123', 1)).toBe('https://gemini.google.com/u/1/app');
    expect(withAuthUser('https://www.google.com/search?q=x', 1)).toBe('https://www.google.com/search?q=x&authuser=1');
    expect(withAuthUser('https://www.google.com/search?q=x&authuser=0', 3)).toBe('https://www.google.com/search?q=x&authuser=3');
    expect(withAuthUser('https://example.com/u/0/', 1)).toBe('https://example.com/u/0/');
    expect(withAuthUser('https://notgoogle.com/', 1)).toBe('https://notgoogle.com/');
  });

  it('builds Gemini and account URLs', () => {
    expect(geminiUrl(0)).toBe('https://gemini.google.com/app');
    expect(geminiUrl(2)).toBe('https://gemini.google.com/u/2/app');
    expect(googleUrls.manage(1)).toBe('https://myaccount.google.com/?authuser=1');
    expect(googleUrls.add()).toContain('AddSession?continue=https%3A%2F%2Fwww.google.com%2F');
    expect(isGeminiPanelHost('accounts.google.com')).toBe(true);
    expect(isGeminiPanelHost('lh3.googleusercontent.com')).toBe(true);
    expect(isGeminiPanelHost('evil-google.com')).toBe(false);
    expect(isGeminiPanelHost('example.com')).toBe(false);
  });
});
