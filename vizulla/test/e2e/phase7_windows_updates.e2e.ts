// Multi-window tab moves, tab search across windows, and in-app updates
// (against a local release feed: check → download → SHA-256 verify).
import { expect, test } from '@playwright/test';
import { createHash } from 'node:crypto';
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { inMain, launch, waitFor, type Harness } from './harness';

let h: Harness;
let feed: Server | null = null;
test.afterEach(async () => {
  await h?.close();
  feed?.close();
  feed = null;
});

const windows = (h: Harness) =>
  inMain(h, (vz) => [...vz.windows].map((w: any) => ({ key: w.key, tabs: w.model.all().map((m: { id: number }) => m.id), urls: [...w.tabs.values()].map((t: { url: string }) => t.url) })));

test('tabs move between windows, tear off into a new window, and a window left empty closes', async () => {
  h = await launch();
  await h.chrome();
  const ids = await inMain(h, (vz, base) => {
    const w = vz.focused();
    const a = w.createTab({ url: `${base}/?a`, activate: false });
    const b = w.createTab({ url: `${base}/?b`, activate: true });
    return [a.id, b.id];
  }, h.base);
  const wcBefore = await inMain(h, (vz, id) => vz.focused().tabs.get(id).wc?.id, ids[1]);

  // Tear two tabs off into a new window: the page keeps its renderer (no reload).
  await inMain(h, (vz, list) => vz.moveTabs(list, 'new', { point: { x: 300, y: 200 } }), ids);
  let ws = await waitFor(() => windows(h), (x) => x.length === 2);
  const second = ws.find((w) => w.tabs.includes(ids[0]!))!;
  expect(second.tabs).toEqual(ids);
  expect(await inMain(h, (vz, id) => [...vz.windows].find((w: any) => w.tabs.has(id)).tabs.get(id).wc?.id, ids[1])).toBe(wcBefore);
  // The view is attached above the new window's chrome view.
  const stacked = await inMain(h, (vz, id) => {
    const w = [...vz.windows].find((x: any) => x.tabs.has(id));
    const kids = w.win.contentView.children;
    return kids.findIndex((c: any) => c.webContents === w.tabs.get(id).wc) > kids.findIndex((c: any) => c.webContents === w.chrome.webContents);
  }, ids[1]);
  expect(stacked).toBe(true);

  // Tab search from the first window finds tabs of the second.
  const found = await inMain(h, (vz) => vz.suggestSources([...vz.windows][0]).tabs().map((t: { id: number; spaceName: string }) => [t.id, t.spaceName]));
  expect(found.map((x: [number, string]) => x[0])).toEqual(expect.arrayContaining(ids));
  expect(found.find((x: [number, string]) => x[0] === ids[0])[1]).toMatch(/Window 2/);

  // Drag both back onto the first window's strip: the second window is left empty and closes.
  await inMain(h, (vz, list) => vz.moveTabs(list, [...vz.windows][0], { index: 0 }), ids);
  ws = await waitFor(() => windows(h), (x) => x.length === 1);
  expect(ws[0]!.tabs.slice(0, 2)).toEqual(ids);
});

test('the OS window title follows the active tab', async () => {
  h = await launch();
  await h.chrome();
  await inMain(h, (vz, url) => vz.focused().loadUrl(vz.focused().activeTab().id, url), `${h.base}/`);
  await waitFor(() => inMain(h, (vz) => vz.focused().win.getTitle()), (t) => t === 'Vizulla test home — Vizulla');
});

async function startFeed(zip: Buffer, sum: string): Promise<string> {
  const v = '99.0.0';
  const platform = process.platform === 'darwin' ? `mac-${process.arch === 'arm64' ? 'arm64' : 'x64'}.zip` : process.platform === 'win32' ? 'win-x64.exe' : 'linux-amd64.deb';
  const name = `Vizulla-${v}-${platform}`;
  feed = createServer((req, res) => {
    const base = `http://127.0.0.1:${(feed!.address() as AddressInfo).port}`;
    if (req.url?.startsWith('/releases')) {
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(JSON.stringify([
        { tag_name: 'v0.0.1', html_url: `${base}/old`, draft: false, prerelease: true, assets: [] },
        { tag_name: `v${v}`, html_url: `${base}/notes`, draft: false, prerelease: false, assets: [
          { name, browser_download_url: `${base}/dl/${name}`, size: zip.length },
          { name: 'SHA256SUMS.txt', browser_download_url: `${base}/dl/SHA256SUMS.txt`, size: 100 },
        ] },
      ]));
    } else if (req.url === '/dl/SHA256SUMS.txt') {
      res.end(`${sum}  ${name}\n`);
    } else if (req.url === `/dl/${name}`) {
      res.writeHead(200, { 'content-length': String(zip.length) });
      res.end(zip);
    } else {
      res.writeHead(404);
      res.end();
    }
  });
  await new Promise<void>((r) => feed!.listen(0, '127.0.0.1', r));
  return `http://127.0.0.1:${(feed.address() as AddressInfo).port}/releases`;
}

const updateState = (h: Harness) => inMain(h, (vz) => vz.focused().state().update);

test('update button: a newer release is found, downloaded, and verified', async () => {
  const zip = Buffer.alloc(256 * 1024, 7);
  const url = await startFeed(zip, createHash('sha256').update(zip).digest('hex'));
  h = await launch({ env: { VZ_UPDATE_FEED: url } });
  const chrome = await h.chrome();
  const avail = await waitFor(() => updateState(h), (u) => u?.status === 'available', 15_000);
  expect(avail.version).toBe('99.0.0');
  await expect(chrome.locator('vz-toolbar button.upd')).toBeVisible();
  await chrome.locator('vz-toolbar button.upd').click();
  const ready = await waitFor(() => updateState(h), (u) => u?.status === 'ready' || u?.status === 'error', 15_000);
  expect(ready).toMatchObject({ status: 'ready', percent: 100 });
  await expect(chrome.locator('vz-toolbar button.upd.ready')).toBeVisible();
});

test('a download that fails its checksum is rejected', async () => {
  const zip = Buffer.alloc(64 * 1024, 1);
  const url = await startFeed(zip, 'f'.repeat(64));
  h = await launch({ env: { VZ_UPDATE_FEED: url } });
  await h.chrome();
  await waitFor(() => updateState(h), (u) => u?.status === 'available', 15_000);
  await inMain(h, (vz) => vz.updates.activate());
  const u = await waitFor(() => updateState(h), (x) => x?.status === 'error' || x?.status === 'ready', 15_000);
  expect(u).toMatchObject({ status: 'error', error: 'checksum mismatch' });
});

test('password manager: offers to save after a sign-in, then fills the saved account', async () => {
  h = await launch();
  await h.chrome();
  await inMain(h, (vz, url) => vz.focused().loadUrl(vz.focused().activeTab().id, url), `${h.base}/login`);
  const site = await waitFor(async () => h.app.windows().find((w) => w.url().endsWith('/login')), (p) => !!p);
  // The page's password field lights up the key button.
  await waitFor(() => inMain(h, (vz) => vz.focused().state().tabs.find((t: any) => t.id === vz.focused().activeTab().id).passwords), (p) => p.form === true);

  await site!.fill('input[name=email]', 'amina@example.rw');
  await site!.fill('input[type=password]', 'Kigali-Hills-2026');
  await site!.click('button');
  const dlg = await waitFor(() => inMain(h, (vz) => vz.focused().overlay.surface), (s) => s?.kind === 'dialog' && s.dialog.type === 'save-password');
  // The dialog gets the site and username, never the password.
  expect(dlg.dialog).toMatchObject({ site: '127.0.0.1:' + new URL(h.base).port, username: 'amina@example.rw', update: false });
  expect(JSON.stringify(dlg)).not.toContain('Kigali-Hills-2026');
  await inMain(h, (vz, id) => vz.focused().overlay.dialogResult(id, { action: 'save', username: 'amina@example.rw' }), dlg.id);

  const saved = await waitFor(() => inMain(h, (vz) => vz.passwords.vault.list()), (l) => l.length === 1);
  expect(saved[0]).toMatchObject({ origin: h.base, username: 'amina@example.rw' });

  // Reload: fill from the key button's account entry.
  await inMain(h, (vz, url) => vz.focused().loadUrl(vz.focused().activeTab().id, url), `${h.base}/login?again`);
  const again = await waitFor(async () => h.app.windows().find((w) => w.url().endsWith('/login?again')), (p) => !!p);
  await waitFor(() => inMain(h, (vz) => vz.focused().state().tabs.find((t: any) => t.id === vz.focused().activeTab().id).passwords), (p) => p.form && p.logins === 1);
  await inMain(h, (vz) => vz.passwords.fill(vz.focused().activeTab(), vz.passwords.vault.list()[0].id));
  await expect.poll(() => again!.inputValue('input[type=password]')).toBe('Kigali-Hills-2026');
  expect(await again!.inputValue('input[name=email]')).toBe('amina@example.rw');

  // A fill is refused for a page of another origin.
  await inMain(h, (vz) => vz.focused().loadUrl(vz.focused().activeTab().id, 'vizulla://newtab/'));
  const id = await inMain(h, (vz) => vz.passwords.vault.list()[0].id);
  await inMain(h, (vz, x) => vz.passwords.fill(vz.focused().activeTab(), x), id);
});

test('websites get the browser language (Accept-Language and navigator.language)', async () => {
  let header = '';
  feed = createServer((req, res) => {
    if (req.url === '/lang') header = String(req.headers['accept-language'] ?? '');
    res.writeHead(200, { 'content-type': 'text/html' });
    res.end('<!doctype html><title>Lang</title><p>hi</p>');
  });
  await new Promise<void>((r) => feed!.listen(0, '127.0.0.1', r));
  const url = `http://127.0.0.1:${(feed.address() as AddressInfo).port}/lang`;
  h = await launch();
  await h.chrome();
  await inMain(h, (vz) => vz.profile.prefs.set('appearance.locale', 'sw'));
  await inMain(h, (vz, u) => vz.focused().loadUrl(vz.focused().activeTab().id, u), url);
  const p = await waitFor(async () => h.app.windows().find((w) => w.url() === url), (x) => !!x);
  await p!.waitForLoadState('domcontentloaded');
  expect(header).toMatch(/^sw\b/);
  expect(await p!.evaluate(() => navigator.language)).toBe('sw');
  expect(await p!.evaluate(() => navigator.languages.slice(0, 2))).toEqual(['sw', 'sw-KE']);
});

test('profiles: the window knows its profile and the picker lists profiles', async () => {
  h = await launch();
  const chrome = await h.chrome();
  const s = await inMain(h, (vz) => vz.focused().state().profile);
  expect(s).toMatchObject({ id: 'default', name: 'Personal', color: 'blue', count: 1 });
  await expect(chrome.locator('vz-toolbar button.me')).toBeVisible();
  // Creating a profile adds it to the registry (opening it would start another browser process).
  await inMain(h, (vz) => {
    vz.profiles.open = () => undefined;
    vz.profiles.registry.create({ name: 'Work', color: 'violet' });
    vz.profiles.changed();
    vz.broadcastState();
  });
  await waitFor(() => inMain(h, (vz) => vz.focused().state().profile.count), (n) => n === 2);
  await waitFor(() => inMain(h, (vz) => vz.focused().win.getTitle()), (t) => t.endsWith('— Vizulla — Personal'));
  await inMain(h, (vz) => vz.focused().loadUrl(null, 'vizulla://profiles/', { newTab: true }));
  const page = await waitFor(async () => h.app.windows().find((w) => w.url().startsWith('vizulla://profiles')), (x) => !!x);
  await expect(page!.locator('vz-profiles .card-p .name').nth(1)).toHaveText('Work');
});

test('tooltips: a glass bubble replaces the native title, with a keycap, clear of the page area', async () => {
  h = await launch();
  const chrome = await h.chrome();
  const add = chrome.locator('vz-tabstrip button.add');
  await add.hover();
  const tip = chrome.locator('#vz-tooltip.on');
  await expect(tip).toBeVisible();
  await expect(tip).toContainText('New tab');
  await expect(tip.locator('kbd')).toHaveText(/T$/);
  // The native title is gone (no OS tooltip), the accessible name stays.
  expect(await add.getAttribute('title')).toBeNull();
  expect(await add.getAttribute('aria-label')).toBe('New tab');
  // Toolbar tooltips stay off the page area (web pages are drawn above it).
  await chrome.locator('vz-toolbar button[aria-label="Reload"]').hover();
  await expect(tip).toContainText('Reload');
  const overlap = await chrome.evaluate(() => {
    const t = document.getElementById('vz-tooltip')!.getBoundingClientRect();
    const c = document.querySelector('vz-shell')!.shadowRoot!.querySelector('#content')!.getBoundingClientRect();
    return t.bottom > c.top && t.top < c.bottom && t.right > c.left && t.left < c.right;
  });
  expect(overlap).toBe(false);
  // Pressing hides it.
  await chrome.mouse.down();
  await expect(chrome.locator('#vz-tooltip.on')).toHaveCount(0);
  await chrome.mouse.up();
});

test('vertical tabs collapse to a rail of tab icons with a new-tab button (never hidden)', async () => {
  h = await launch();
  const chrome = await h.chrome();
  await inMain(h, (vz) => {
    vz.profile.prefs.set('tabs.layout', 'vertical');
    vz.profile.prefs.set('tabs.sidebarCollapsed', true);
    vz.focused().win.setBounds({ width: 1200, height: 800 });
  });
  const rail = chrome.locator('vz-tab-rail');
  await expect(rail).toBeVisible();
  await expect(rail.getByRole('tab')).toHaveCount(1);
  await rail.getByRole('button', { name: /new tab/i }).click();
  await expect(rail.getByRole('tab')).toHaveCount(2);
  await rail.getByRole('tab').first().click();
  const first = await inMain(h, (vz) => vz.focused().model.all()[0].id);
  await waitFor(() => inMain(h, (vz) => vz.focused().activeTab().id), (id) => id === first);
  // Expanding brings the full sidebar back.
  await rail.getByRole('button', { name: /sidebar/i }).click();
  await expect(chrome.locator('vz-sidebar')).toBeVisible();
  await expect(rail).toHaveCount(0);
});

test('"+" opens a New Tab page right away, like Chrome', async () => {
  h = await launch();
  const chrome = await h.chrome();
  const add = chrome.locator('vz-tabstrip').getByRole('button', { name: 'New tab' });
  await add.click();
  await inMain(h, (vz) => vz.focused().overlay.close());
  await add.click();
  const tabs = await waitFor(() => inMain(h, (vz) => vz.focused().state().tabs.map((t: { url: string }) => t.url)), (u) => u.length === 3);
  expect(tabs.every((u: string) => u.startsWith('vizulla://newtab'))).toBe(true);
  await expect(chrome.locator('vz-tabstrip').getByRole('tab')).toHaveCount(3);
});
