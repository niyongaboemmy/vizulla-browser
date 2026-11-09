// Chrome extensions (Plan 0.4, phase 1): a fixture MV3 extension loads, its content
// script and background worker see Vizulla's tabs, its button (with badge) sits in the
// toolbar and opens its popup, its context-menu item appears, and it can be pinned,
// turned off and on, and removed from vizulla://extensions.
import { expect, test, type Page } from '@playwright/test';
import { join } from 'node:path';
import { inMain, launch, ROOT, waitFor, type Harness } from './harness';

let h: Harness;
test.afterEach(async () => h?.close());

const FIXTURE = join(ROOT, 'vizulla/test/data/ext-fixture');
const overlay = async (h: Harness): Promise<Page> => (await waitFor(async () => h.app.windows().find((w) => w.url().startsWith('vizulla://overlay')), (p) => !!p))!;
const dataset = (h: Harness) => inMain(h, (vz) => vz.focused().activeTab().wc.executeJavaScript('JSON.stringify(document.documentElement.dataset)')) as Promise<string>;

test('an extension loads, runs on pages, shows its button and popup, and adds a context-menu item', async () => {
  h = await launch();
  const chrome = await h.chrome();
  const loaded = await inMain(h, (vz, p) => vz.extensions.loadUnpacked(p), FIXTURE);
  expect(loaded.ok).toBe(true);
  const id = loaded.id as string;

  // Content script + background worker (chrome.tabs.query through Vizulla's tabs).
  await inMain(h, (vz, b) => vz.focused().loadUrl(null, `${b}/`, { newTab: true }), h.base);
  const ds = await waitFor(() => dataset(h), (s) => s.includes('vzTabs'), 15_000);
  expect(JSON.parse(ds)).toMatchObject({ vzExtension: 'fixture', vzTabs: '2' });

  // chrome.runtime.onInstalled fired, so its context-menu item exists.
  const items = await waitFor(
    () => inMain(h, (vz) => { const t = vz.focused().activeTab(); return vz.extensions.contextMenuItems(t.wc, { x: 1, y: 1, pageURL: t.url, frameURL: '', linkURL: '', srcURL: '', mediaType: 'none', selectionText: '', isEditable: false, editFlags: {} }).map((i: { label: string }) => i.label); }),
    (l: string[]) => l.length > 0,
  );
  expect(items).toContain('Vizulla fixture action');

  // Pinned toolbar button with the badge the worker set.
  const button = chrome.locator(`vz-toolbar button[data-ext="${id}"]`);
  await expect(button).toBeVisible();
  await expect(button.locator('.badge')).toHaveText('OK');
  await button.click();
  const popup = await waitFor(
    () => inMain(h, (_vz, _a, electron) => electron.webContents.getAllWebContents().map((w) => w.getURL()).find((u) => u.endsWith('/popup.html')) ?? null),
    (u) => !!u,
  );
  expect(popup).toBe(`chrome-extension://${id}/popup.html`);

  // The puzzle menu lists it; unpinning removes the toolbar button.
  await chrome.locator('vz-toolbar').getByRole('button', { name: 'Extensions', exact: true }).click();
  const ov = await overlay(h);
  await expect(ov.getByRole('dialog', { name: 'Extensions' })).toBeVisible();
  await ov.getByRole('button', { name: /^Unpin from toolbar: Vizulla Test Extension$/ }).click();
  await expect(button).toHaveCount(0);
  await ov.getByRole('button', { name: /^Pin to toolbar: / }).click();
  await expect(chrome.locator(`vz-toolbar button[data-ext="${id}"]`)).toBeVisible();
});

test('vizulla://extensions turns an extension off and on, shows details, and removes it', async () => {
  h = await launch();
  await h.chrome();
  const { id } = await inMain(h, (vz, p) => vz.extensions.loadUnpacked(p), FIXTURE);
  await inMain(h, (vz) => vz.focused().loadUrl(null, 'vizulla://extensions/', { newTab: true }));
  const page = (await waitFor(async () => h.app.windows().find((w) => w.url().startsWith('vizulla://extensions')), (p) => !!p))!;
  const card = page.getByRole('article', { name: 'Vizulla Test Extension' });
  await expect(card).toBeVisible();
  await expect(card).toContainText('Version 1.2.0');

  // Off: unloaded (no content script on new pages); on again: back.
  await card.getByRole('switch', { name: /Vizulla Test Extension/ }).click();
  await expect.poll(() => inMain(h, (vz, eid) => !!vz.profile.session.extensions.getExtension(eid), id)).toBe(false);
  await inMain(h, (vz, b) => vz.focused().loadUrl(null, `${b}/?off`, { newTab: true }), h.base);
  await waitFor(() => inMain(h, (vz) => vz.focused().activeTab().title), (t) => t === 'Vizulla test home');
  expect(JSON.parse(await dataset(h)).vzExtension).toBeUndefined();
  expect(await inMain(h, (vz) => vz.profile.prefs.get('extensions.disabled'))).toContain(id);
  await inMain(h, (vz) => vz.focused().activateTab([...vz.focused().tabs.values()].find((t: { url: string }) => t.url.startsWith('vizulla://extensions')).id));
  await card.getByRole('switch', { name: /Vizulla Test Extension/ }).click();
  await expect.poll(() => inMain(h, (vz, eid) => !!vz.profile.session.extensions.getExtension(eid), id)).toBe(true);

  // Details: site access and source.
  await card.getByRole('button', { name: 'Details' }).click();
  await expect(page.getByRole('region', { name: 'Vizulla Test Extension' })).toContainText('127.0.0.1');
  await expect(page.locator('dl')).toContainText('Unpacked');
  await page.getByRole('button', { name: 'All extensions' }).click();

  // Remove (with confirmation).
  await card.getByRole('button', { name: 'Remove' }).click();
  await card.getByRole('button', { name: 'Remove Vizulla Test Extension?' }).click();
  await expect(page.getByRole('article', { name: 'Vizulla Test Extension' })).toHaveCount(0);
  expect(await inMain(h, (vz) => ({ loaded: vz.profile.session.extensions.getAllExtensions().length, unpacked: vz.profile.prefs.get('extensions.unpacked') }))).toEqual({ loaded: 0, unpacked: [] });
});

test('private windows run without extensions; store links open the store page', async () => {
  h = await launch();
  await h.chrome();
  await inMain(h, (vz, p) => vz.extensions.loadUnpacked(p), FIXTURE);
  // The private session shares the registry but never runs extensions (Chrome's default).
  const ext = await inMain(h, (vz, b) => {
    const w = vz.openWindow({ private: true });
    (globalThis as { __pw?: unknown }).__pw = w;
    w.loadUrl(w.activeTab().id, `${b}/`);
    return w.state().extensions;
  }, h.base);
  expect(ext).toEqual({ pinned: [], count: 0, activeWcId: null });
  const pw = () => (globalThis as unknown as { __pw: { activeTab(): { title: string; wc: { executeJavaScript(s: string): Promise<string> } } } }).__pw;
  await waitFor(() => inMain(h, (_vz, f) => (new Function(`return (${f})()`)() as ReturnType<typeof pw>).activeTab().title, pw.toString()), (t) => t === 'Vizulla test home');
  await new Promise((r) => setTimeout(r, 1000));
  const ds = await inMain(h, (_vz, f) => (new Function(`return (${f})()`)() as ReturnType<typeof pw>).activeTab().wc.executeJavaScript('JSON.stringify(document.documentElement.dataset)'), pw.toString());
  expect(JSON.parse(ds).vzExtension).toBeUndefined();
  expect(await inMain(h, (vz) => [vz.extensions.storeUrlFor('https://chromewebstore.google.com/detail/dark-reader/eimadpbcbfnmbkopoojfekhnkhdbieeh'), vz.extensions.storeUrlFor('not a link')])).toEqual([
    'https://chromewebstore.google.com/detail/eimadpbcbfnmbkopoojfekhnkhdbieeh',
    null,
  ]);
});
