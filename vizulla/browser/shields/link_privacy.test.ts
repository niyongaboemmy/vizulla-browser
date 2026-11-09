import { describe, expect, it } from 'vitest';
import { cleanUrl } from './link_privacy';

describe('cleanUrl', () => {
  it('strips click and campaign trackers, keeps real parameters', () => {
    expect(cleanUrl('https://shop.example/p?id=7&utm_source=x&utm_medium=y&fbclid=abc')).toBe('https://shop.example/p?id=7');
    expect(cleanUrl('https://a.example/?gclid=1&q=rwanda#top')).toBe('https://a.example/?q=rwanda#top');
    expect(cleanUrl('https://a.example/?UTM_Campaign=1')).toBe('https://a.example/');
  });

  it('returns null when nothing changes (no redirect loops)', () => {
    expect(cleanUrl('https://a.example/?q=1&page=2')).toBeNull();
    expect(cleanUrl('https://a.example/')).toBeNull();
    const once = cleanUrl('https://a.example/?id=1&mc_eid=2')!;
    expect(cleanUrl(once)).toBeNull();
  });

  it('skips known redirect hops', () => {
    expect(cleanUrl('https://www.google.com/url?q=https%3A%2F%2Fnews.example%2Fa%3Futm_source%3Dg&sa=D')).toBe('https://news.example/a');
    expect(cleanUrl('https://l.facebook.com/l.php?u=https%3A%2F%2Fex.example%2F&h=AT0')).toBe('https://ex.example/');
    expect(cleanUrl('https://www.youtube.com/redirect?q=https://ex.example/x&event=video')).toBe('https://ex.example/x');
  });

  it('never unwraps to a non-web scheme', () => {
    expect(cleanUrl('https://www.google.com/url?q=javascript:alert(1)')).toBeNull();
    expect(cleanUrl('vizulla://settings?utm_source=x')).toBeNull();
  });
});
