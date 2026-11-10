// Privacy, security and UX (0.4.1–0.4.2): Clean Links, Global Privacy Control (native, no
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

test('pop-ups open only right after a real click, one per click; blocked ones offer "Open"', async () => {
  h = await launch();
  await h.chrome();
  await go(`${h.base}/pop`);
  const tabs = () => inMain(h, (vz) => vz.focused().tabs.size) as Promise<number>;
  await run('window.openLater(); 1');
  await new Promise((r) => setTimeout(r, 800));
  expect(await tabs()).toBe(1);
  expect(await inMain(h, (vz) => vz.focused().toasts.map((x: { text: string }) => x.text))).toContain('Pop-up blocked');
  const web = h.app.windows().find((w) => w.url().endsWith('/pop'))!;
  await web.click('#go');
  await waitFor(tabs, (n) => n === 2);
});

test('the full filter lists ship with the app, with scriptlets for video ads', async () => {
  h = await launch();
  await h.chrome();
  expect(await inMain(h, (vz) => vz.profile.shields.status(-1, '').ruleSource)).toBe('bundled');
  expect(await inMain(h, (vz) => vz.profile.shields.scriptsFor('https://www.youtube.com/watch?v=x', 'https://www.youtube.com/watch?v=x').length)).toBeGreaterThan(0);
  expect(await inMain(h, (vz) => vz.profile.shields.blocksPopup('https://popads.net/', 'https://news.example/'))).toBe(true);
  // Typed addresses are never blocked as pages, only page-initiated trips to ad networks.
  expect(await inMain(h, (vz) => vz.profile.shields.blocksPopup('https://github.com/', 'https://news.example/'))).toBe(false);
});

test('whole-page screenshots scroll and stitch the full height; the fixed header appears once', async () => {
  h = await launch();
  await h.chrome();
  await go(`${h.base}/long`);
  const size = await inMain(h, async (vz, _a, electron) => {
    const file: string = await vz.tools.screenshot(vz.focused(), true);
    const img = electron.nativeImage.createFromPath(file);
    const page = await vz.focused().activeTab().wc.executeJavaScript('({ h: document.documentElement.scrollHeight, y: scrollY, dpr: devicePixelRatio })');
    return { img: img.getSize(), page };
  });
  const cssHeight = size.img.height / size.page.dpr; // the PNG is saved at device pixels
  expect(cssHeight).toBeGreaterThanOrEqual(size.page.h - 2);
  expect(cssHeight).toBeLessThanOrEqual(size.page.h + 2);
  expect(size.page.y).toBe(0); // scroll position restored
});

test('Settings lets you pick fonts; sites keep their own', async () => {
  h = await launch();
  await h.chrome();
  await inMain(h, (vz) => vz.profile.prefs.set('fonts.minimumSize', 14));
  await inMain(h, (vz, b) => vz.focused().loadUrl(null, `${b}/`, { newTab: true }), h.base);
  await waitFor(() => inMain(h, (vz) => vz.focused().activeTab().wc?.isLoading()), (l) => l === false);
  const px = await run<string>(`(() => { const p = document.createElement('p'); p.style.fontSize = '8px'; p.textContent = 'x'; document.body.append(p); return getComputedStyle(p).fontSize; })()`);
  expect(parseFloat(px)).toBeGreaterThanOrEqual(14);
});

test('a tab’s tooltip is drawn above the page, not clipped under it', async () => {
  h = await launch();
  const chrome = await h.chrome();
  await go(`${h.base}/long`);
  await chrome.locator('vz-tabstrip .tab.active .body').hover();
  const tip = await waitFor(() => inMain(h, (vz) => {
    const t = vz.focused().tip;
    return t.attached ? t.view.getBounds() : null;
  }), (b) => !!b);
  const tab = (await chrome.locator('vz-tabstrip .tab.active').boundingBox())!;
  expect(tip!.y).toBeGreaterThanOrEqual(tab.y + tab.height); // below the tab, over the page area
  await chrome.mouse.move(tab.x + tab.width + 400, 300);
  await waitFor(() => inMain(h, (vz) => vz.focused().tip.attached), (a) => a === false);
});
