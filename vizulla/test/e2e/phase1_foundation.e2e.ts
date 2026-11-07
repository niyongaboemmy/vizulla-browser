// Phase 1 exit checks that can run on a developer machine: a branded, clean
// browser that loads pages, blocks ads/trackers, keeps internal pages private,
// and restores the session.
import { expect, test } from '@playwright/test';
import { inMain, launch, waitFor, type Harness } from './harness';

let h: Harness;
test.afterEach(async () => h?.close());

const activeTab = (h: Harness) => inMain(h, (vz) => {
  const w = vz.focused();
  const t = w.activeTab();
  return { id: t?.id, url: t?.url, title: t?.title, wcId: t?.wc?.id };
});

test('launches branded with the shell and a start page', async () => {
  h = await launch();
  const chrome = await h.chrome();
  await expect(chrome.locator('vz-sidebar')).toBeVisible();
  const info = await inMain(h, (vz, _a, electron) => ({ name: electron.app.getName(), windows: vz.windows.size, state: vz.focused().state() }));
  expect(info.name).toBe('Vizulla');
  expect(info.windows).toBe(1);
  expect(info.state.tabs[0].url).toMatch(/^vizulla:\/\/newtab/);
  const text = await chrome.locator('body').innerText();
  expect(text).not.toMatch(/chromium|electron/i);
  await chrome.screenshot({ path: 'test-results/phase1-shell.png' });
});

test('navigates, records history, and shows security state', async () => {
  h = await launch();
  await h.chrome();
  await inMain(h, (vz, url) => vz.focused().loadUrl(vz.focused().activeTab().id, url, { typed: true }), `${h.base}/`);
  const tab = await waitFor(() => activeTab(h), (t) => t.title === 'Vizulla test home');
  expect(tab.url).toBe(`${h.base}/`);
  const state = await inMain(h, (vz) => vz.focused().state().tabs.find((t: { id: number }) => t.id === vz.focused().activeTab().id));
  expect(state.security).toBe('internal'); // 127.0.0.1 is a secure context
  const hist = await inMain(h, (vz) => vz.profile.history.search('Vizulla test', 5).map((e: { url: string }) => e.url));
  expect(hist).toContain(`${h.base}/`);
});

test('Shields blocks ad scripts and hides ad elements (SHD-01/02)', async () => {
  h = await launch();
  await h.chrome();
  await inMain(h, (vz, url) => vz.focused().loadUrl(vz.focused().activeTab().id, url), `${h.base}/ads`);
  await waitFor(() => activeTab(h), (t) => t.title === 'Ad test');
  const page = await waitFor(async () => h.app.windows().find((w) => w.url().endsWith('/ads')), (p) => !!p);
  await page!.waitForFunction(() => (window as unknown as { __appLoaded?: boolean }).__appLoaded === true);
  const flags = await page!.evaluate(() => ({ ad: (window as any).__adLoaded ?? false, prebid: (window as any).__prebidLoaded ?? false, app: (window as any).__appLoaded }));
  expect(flags).toEqual({ ad: false, prebid: false, app: true });
  await expect.poll(() => page!.evaluate(() => getComputedStyle(document.getElementById('ad1')!).display)).toBe('none');
  const blocked = await waitFor(() => inMain(h, (vz) => vz.focused().state().tabs.find((t: { id: number }) => t.id === vz.focused().activeTab().id).blocked), (n) => n >= 2);
  expect(blocked).toBeGreaterThanOrEqual(2);
  // Turning Shields off for the site lets the scripts load.
  await inMain(h, (vz) => {
    const t = vz.focused().activeTab();
    vz.profile.shields.setSiteEnabled(t.url, false);
    t.wc.reload();
  });
  await expect.poll(() => page!.evaluate(() => (window as any).__adLoaded ?? false).catch(() => false), { timeout: 10_000 }).toBe(true);
});

test('web pages get no IPC bridge; vizulla:// pages do, and only for their host', async () => {
  h = await launch();
  await h.chrome();
  await inMain(h, (vz, url) => vz.focused().loadUrl(vz.focused().activeTab().id, url), `${h.base}/`);
  const web = await waitFor(async () => h.app.windows().find((w) => w.url() === `${h.base}/`), (p) => !!p);
  expect(await web!.evaluate(() => typeof (window as any).vz)).toBe('undefined');
  // A web page cannot navigate itself to an internal page.
  await web!.evaluate(() => (location.href = 'vizulla://settings'));
  await new Promise((r) => setTimeout(r, 800));
  expect((await activeTab(h)).url).toBe(`${h.base}/`);
  // The settings page can use its own handler but not the Shell interface.
  await inMain(h, (vz) => vz.focused().loadUrl(vz.focused().activeTab().id, 'vizulla://settings'));
  const settings = await waitFor(async () => h.app.windows().find((w) => w.url().startsWith('vizulla://settings')), (p) => !!p);
  await settings!.waitForFunction(() => !!(window as any).vz);
  const ok = await settings!.evaluate(() => (window as any).vz.call('Pages', 'invoke', 'detectImport').then(() => 'ok', (e: Error) => e.message));
  expect(ok).toBe('ok');
  const denied = await settings!.evaluate(() => (window as any).vz.call('Shell', 'closeTab', 1).then(() => 'ok', (e: Error) => e.message));
  expect(denied).toMatch(/unauthorized/);
  const bad = await settings!.evaluate(() => (window as any).vz.call('Pages', 'invoke', 'set', { key: 'agent.testerOptIn', value: 'yes' }).then(() => 'ok', (e: Error) => e.message));
  expect(bad).not.toBe('ok');
});

test('restores tabs into their Spaces after restart (CORE-09)', async () => {
  h = await launch();
  await h.chrome();
  const profile = h.profile;
  await inMain(h, (vz, base) => {
    const w = vz.focused();
    w.loadUrl(w.activeTab().id, `${base}/`);
    const s = vz.profile.spaces.create({ name: 'Work', color: 'teal', icon: 'briefcase' });
    w.switchSpace(s.id);
    w.loadUrl(w.activeTab().id, `${base}/article`);
    w.saveNow();
  }, h.base);
  await waitFor(() => activeTab(h), (t) => t.title === 'Kigali Coffee Guide');
  await inMain(h, (vz) => vz.focused().saveNow());
  await h.close();
  h = await launch({ profile });
  await h.chrome();
  const restored = await waitFor(
    () => inMain(h, (vz) => {
      const w = vz.focused();
      const names = new Map(vz.profile.spaces.list().map((s: { id: string; name: string }) => [s.id, s.name]));
      return { active: names.get(w.model.activeSpaceId), tabs: w.state().tabs.map((t: { url: string; spaceId: string }) => `${names.get(t.spaceId)}|${t.url.replace(/^http:\/\/127\.0\.0\.1:\d+/, '')}`) };
    }),
    (r) => r.tabs.length >= 2,
  );
  expect(restored.active).toBe('Work');
  expect(restored.tabs).toEqual(expect.arrayContaining(['Personal|/', 'Work|/article']));
});
