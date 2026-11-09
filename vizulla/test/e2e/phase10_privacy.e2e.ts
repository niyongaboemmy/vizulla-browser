// Privacy (Plan 0.4, phase 3): ads are off by default and can be allowed per site or
// everywhere (trackers stay blocked); private windows get their own start page, dark
// look, capture protection, strict fingerprinting and leave nothing in the privacy log.
import { expect, test, type Page } from '@playwright/test';
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { inMain, launch, waitFor, type Harness } from './harness';

let h: Harness;
let srv: Server | null = null;
test.afterEach(async () => {
  await h?.close();
  srv?.close();
  srv = null;
});

const overlay = async (h: Harness): Promise<Page> => (await waitFor(async () => h.app.windows().find((w) => w.url().startsWith('vizulla://overlay')), (p) => !!p))!;

/** A page with an ad script (ads list) and an analytics script (trackers list). */
async function adServer(): Promise<string> {
  srv = createServer((req, res) => {
    const u = req.url ?? '/';
    if (u.startsWith('/pagead/js/adsbygoogle.js')) {
      res.writeHead(200, { 'content-type': 'text/javascript' });
      return res.end('window.__adLoaded = true;');
    }
    res.writeHead(200, { 'content-type': 'text/html' });
    res.end(`<!doctype html><title>Ads page</title><h1>News</h1>
      <script src="/pagead/js/adsbygoogle.js"></script>
      <script src="https://www.google-analytics.com/analytics.js"></script>`);
  });
  await new Promise<void>((r) => srv!.listen(0, '127.0.0.1', r));
  return `http://127.0.0.1:${(srv!.address() as AddressInfo).port}`;
}

const loadAds = async (h: Harness, url: string) => {
  await inMain(h, (vz, u) => vz.focused().loadUrl(vz.focused().activeTab().id, u), url);
  await waitFor(() => inMain(h, (vz) => vz.focused().activeTab().title), (t) => t === 'Ads page');
  await new Promise((r) => setTimeout(r, 400));
  return inMain(h, async (vz) => {
    const tab = vz.focused().activeTab();
    return { ad: await tab.wc.executeJavaScript('!!window.__adLoaded'), counts: vz.profile.shields.status(tab.wc.id, tab.url).blocked };
  });
};

test('ads are blocked by default; the panel allows them on one site while trackers stay blocked', async () => {
  const base = await adServer();
  h = await launch();
  const chrome = await h.chrome();
  expect(await inMain(h, (vz) => vz.profile.prefs.get('shields.blockAds'))).toBe(true);
  const before = await loadAds(h, `${base}/`);
  expect(before.ad).toBe(false);
  expect(before.counts.ads).toBeGreaterThan(0);
  expect(before.counts.trackers).toBeGreaterThan(0);

  // The toolbar shield opens the Ads & trackers panel.
  await chrome.locator('vz-toolbar .chip-btn').first().click();
  const ov = await overlay(h);
  const panel = ov.getByRole('dialog', { name: 'Ads & trackers' });
  await expect(panel).toBeVisible();
  await panel.getByRole('switch', { name: 'Show ads on this site' }).click();
  await expect(panel.getByRole('switch', { name: 'Show ads on this site' })).toHaveAttribute('aria-checked', 'true');
  expect(await inMain(h, (vz) => vz.profile.prefs.get('shields.adsAllowedSites'))).toEqual(['127.0.0.1']);

  const after = await loadAds(h, `${base}/?again`);
  expect(after.ad).toBe(true);
  expect(after.counts.ads).toBe(0);
  expect(after.counts.trackers).toBeGreaterThan(0);
});

test('turning ad blocking off in Settings shows ads everywhere', async () => {
  const base = await adServer();
  h = await launch();
  await h.chrome();
  await inMain(h, (vz) => vz.focused().loadUrl(null, 'vizulla://settings/shields', { newTab: true }));
  const page = (await waitFor(async () => h.app.windows().find((w) => w.url().startsWith('vizulla://settings')), (p) => !!p))!;
  await page.getByRole('switch', { name: 'Block ads' }).click();
  await expect.poll(() => inMain(h, (vz) => vz.profile.prefs.get('shields.blockAds'))).toBe(false);
  await inMain(h, (vz) => vz.focused().loadUrl(null, 'about:blank', { newTab: true }));
  expect((await loadAds(h, `${base}/`)).ad).toBe(true);
});

test('private windows: own start page, dark, capture-protected, strict fingerprinting, nothing logged', async () => {
  const base = await adServer();
  h = await launch();
  await h.chrome();
  const info = await inMain(h, (vz) => {
    const w = vz.openWindow({ private: true });
    (globalThis as unknown as { __pw: unknown }).__pw = w;
    return { theme: w.state().theme, protected: w.win.isContentProtected() };
  });
  expect(info).toEqual({ theme: 'dark', protected: true });

  // The private window's start page is the second new-tab page.
  const ntp = (await waitFor(async () => h.app.windows().filter((w) => w.url().startsWith('vizulla://newtab'))[1], (p) => !!p))!;
  await expect(ntp.getByRole('heading', { name: "You're browsing privately" })).toBeVisible();
  await expect(ntp.getByRole('region', { name: 'On in this window' })).toContainText('Screenshots blocked');

  // Strict fingerprinting in the private session; regular stays at the user's level.
  const fp = await inMain(h, (vz) => {
    const pw = (globalThis as unknown as { __pw: { profile: { session: unknown } } }).__pw;
    return { priv: vz.farbleConfig(pw.profile.session, 'https://example.com/').level, regular: vz.farbleConfig(vz.profile.session, 'https://example.com/').level };
  });
  expect(fp.priv).toBe('strict');
  expect(fp.regular).not.toBe('strict');

  // Blocked requests in a private tab never reach the persistent privacy log.
  await inMain(h, (vz) => vz.profile.privacy.flush());
  const logBefore = await inMain(h, (vz) => JSON.stringify(vz.profile.privacy.summary()));
  await inMain(h, (_vz, u) => {
    const pw = (globalThis as unknown as { __pw: { loadUrl(id: number, u: string): void; activeTab(): { id: number } } }).__pw;
    pw.loadUrl(pw.activeTab().id, u);
  }, `${base}/`);
  await waitFor(() => inMain(h, () => (globalThis as unknown as { __pw: { activeTab(): { title: string } } }).__pw.activeTab().title), (t) => t === 'Ads page');
  await inMain(h, (vz) => vz.profile.privacy.flush());
  expect(await inMain(h, (vz) => JSON.stringify(vz.profile.privacy.summary()))).toBe(logBefore);

  // Close all private windows.
  await inMain(h, (vz) => vz.runCommand(vz.focused(), 'window.closePrivate'));
  await expect.poll(() => inMain(h, (vz) => [...vz.windows].filter((w: { profile: { isPrivate: boolean } }) => w.profile.isPrivate).length)).toBe(0);
});
