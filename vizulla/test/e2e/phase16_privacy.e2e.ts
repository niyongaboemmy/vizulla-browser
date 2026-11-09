// Privacy & security (0.4.1): Clean Links, Global Privacy Control (native, no
// header hooks), cross-site referrers, WebRTC IP protection, the Settings privacy checkup, and the
// tab close button's alignment.
import { expect, test } from '@playwright/test';
import { inMain, launch, waitFor, type Harness } from './harness';

let h: Harness;
test.afterEach(async () => h?.close());

const run = <T>(code: string) => inMain(h, (vz, c) => vz.focused().activeTab().wc.executeJavaScript(c, true), code) as Promise<T>;
const go = async (url: string) => {
  await inMain(h, (vz, u) => vz.focused().loadUrl(vz.focused().activeTab().id, u), url);
  await waitFor(() => inMain(h, (vz) => vz.focused().activeTab().wc.isLoading()), (l) => !l);
};

test('Clean Links strips tracking parameters before the page loads', async () => {
  h = await launch();
  await h.chrome();
  await go(`${h.base}/?id=7&utm_source=news&fbclid=abc`);
  expect(await inMain(h, (vz) => vz.focused().activeTab().wc.getURL())).toBe(`${h.base}/?id=7`);
  // Off: the link loads exactly as given.
  await inMain(h, (vz) => vz.profile.prefs.set('shields.cleanLinks', false));
  await go(`${h.base}/?id=7&utm_source=news`);
  expect(await inMain(h, (vz) => vz.focused().activeTab().wc.getURL())).toBe(`${h.base}/?id=7&utm_source=news`);
});

test('every request carries Global Privacy Control; pages see navigator.globalPrivacyControl', async () => {
  h = await launch();
  await h.chrome();
  await go(`${h.base}/`);
  expect(await run<boolean>('navigator.globalPrivacyControl')).toBe(true);
  const headers = await run<Record<string, string>>(`fetch('/echo-headers').then((r) => r.json())`);
  expect(headers['sec-gpc']).toBe('1');
  expect(await inMain(h, (vz) => vz.profile.pipeline['headers'].length)).toBe(0);
});

test('cross-site requests get only the referring origin by default', async () => {
  h = await launch();
  await h.chrome();
  await go(`${h.base}/?secret=token`);
  const other = h.base.replace('127.0.0.1', 'localhost');
  const cross = await run<Record<string, string>>(`fetch('${other}/echo-headers').then((r) => r.json())`);
  expect(cross.referer).toBe(`${h.base}/`);
});

test('WebRTC is limited to the public interface in normal tabs', async () => {
  h = await launch();
  await h.chrome();
  await go(`${h.base}/`);
  expect(await inMain(h, (vz) => vz.focused().activeTab().wc.getWebRTCIPHandlingPolicy())).toBe('default_public_interface_only');
});

test('the privacy checkup counts protections and turns them all on in one click', async () => {
  h = await launch();
  await h.chrome();
  await inMain(h, (vz) => vz.profile.prefs.set('privacy.gpc', false));
  await inMain(h, (vz) => vz.focused().loadUrl(null, 'vizulla://settings/shields', { newTab: true }));
  const page = (await waitFor(async () => h.app.windows().find((w) => w.url().startsWith('vizulla://settings')), (p) => !!p))!;
  const card = page.locator('.checkup');
  await expect(card).toContainText('Privacy checkup');
  await expect(card).toContainText('9 of 10 protections are on');
  await card.getByRole('button', { name: 'Turn on all' }).click();
  await expect(card).toContainText('All 10 protections are on');
  expect(await inMain(h, (vz) => vz.profile.prefs.get('privacy.gpc'))).toBe(true);
});

test('the tab close × is centred in its button', async () => {
  h = await launch();
  const chrome = await h.chrome();
  const x = chrome.locator('vz-tabstrip .tab.active .x');
  await expect(x).toBeVisible();
  const [btn, glyph] = await Promise.all([x.boundingBox(), x.locator('svg').boundingBox()]);
  expect(Math.abs(btn!.x + btn!.width / 2 - (glyph!.x + glyph!.width / 2))).toBeLessThan(0.6);
  expect(Math.abs(btn!.y + btn!.height / 2 - (glyph!.y + glyph!.height / 2))).toBeLessThan(0.6);
});
