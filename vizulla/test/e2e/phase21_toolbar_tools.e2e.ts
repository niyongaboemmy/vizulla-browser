// 0.4.10: a site's favicon shows exactly as the site draws it (the fallback letter no longer sits
// underneath and shows through transparent icons), and the Assistant answers a typed
// "Summarize this page" with the page's key points instead of "I couldn't find that".
import { expect, test } from '@playwright/test';
import { inMain, launch, waitFor, type Harness } from './harness';

let h: Harness;
test.afterEach(async () => h?.close());

const load = async (path: string, title: string) => {
  await inMain(h, (vz, u) => vz.focused().loadUrl(vz.focused().activeTab().id, u), `${h.base}${path}`);
  await waitFor(() => inMain(h, (vz) => vz.focused().activeTab()?.title), (t) => t === title);
};

test('favicons show as the site draws them: nothing behind a transparent icon, the letter only when it fails', async () => {
  h = await launch();
  const chrome = await h.chrome();
  await load('/fav', 'Ring icon');
  const fav = chrome.locator('vz-tabstrip .fav').first();
  await expect(fav.locator('img')).toBeVisible();
  // The fallback letter is there but hidden while the image shows.
  expect(await fav.locator('.fav-fallback').evaluate((e) => getComputedStyle(e).display)).toBe('none');
  expect(await fav.locator('img').evaluate((e) => getComputedStyle(e).borderRadius)).toBe('0px');
  // A broken icon: the letter takes its place.
  await inMain(h, (vz) => { const t = vz.focused().activeTab(); t.favicon = 'data:image/png;base64,AAAA'; vz.focused().pushState(true); });
  await waitFor(() => fav.locator('img').count(), (n) => n === 0);
  expect(await fav.locator('.fav-fallback').evaluate((e) => getComputedStyle(e).display)).not.toBe('none');
});

test('typing "Summarize this page" in the Assistant gives the page’s key points, with sources', async () => {
  h = await launch();
  const chrome = await h.chrome();
  await load('/article', 'Kigali Coffee Guide');
  await inMain(h, (vz) => vz.focused().setPanel('assistant'));
  await expect(chrome.locator('vz-assistant')).toBeVisible();
  for (const q of ['Summarize this page', 'Résume cette page']) {
    await chrome.evaluate((q) => (window as any).vz.call('Assistant', 'ask', q), q);
    const s = await waitFor(() => chrome.evaluate(() => (window as any).vz.call('Assistant', 'getState')), (s: any) => !s.busy && s.messages.at(-1)?.role === 'assistant' && s.messages.at(-1).status !== 'streaming', 20_000);
    const msg = s.messages.at(-1);
    expect(msg.status).toBe('done');
    expect(msg.sourcing).toBe('sourced');
    expect(msg.citations.length).toBeGreaterThan(0);
    expect(msg.text).not.toMatch(/couldn.t find/i);
    expect(s.messages.at(-2).text).toBe('Key points of this page');
  }
});
