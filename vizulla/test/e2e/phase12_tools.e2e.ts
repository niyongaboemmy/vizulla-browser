// Tools and the glass menu (Plan 0.4, phase 5): the Tools menu, screenshot and PDF to
// Downloads, the QR code dialog, the glass ⋮ menu (zoom keeps it open), clear site data.
import { expect, test, type Page } from '@playwright/test';
import { existsSync, mkdtempSync, readdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { inMain, launch, waitFor, type Harness } from './harness';

let h: Harness;
test.afterEach(async () => h?.close());

const overlay = async (h: Harness): Promise<Page> => (await waitFor(async () => h.app.windows().find((w) => w.url().startsWith('vizulla://overlay')), (p) => !!p))!;

async function setup(): Promise<{ chrome: Page; downloads: string }> {
  h = await launch();
  const chrome = await h.chrome();
  const downloads = mkdtempSync(join(tmpdir(), 'vz-dl-'));
  await inMain(h, (_vz, dir, electron) => electron.app.setPath('downloads', dir), downloads);
  await inMain(h, (vz, b) => vz.focused().loadUrl(vz.focused().activeTab().id, `${b}/article`), h.base);
  await waitFor(() => inMain(h, (vz) => vz.focused().activeTab().title), (t) => t === 'Kigali Coffee Guide');
  return { chrome, downloads };
}

test('the Tools menu takes screenshots and saves PDFs to Downloads', async () => {
  const { chrome, downloads } = await setup();
  await chrome.locator('vz-toolbar').getByRole('button', { name: 'Tools', exact: true }).click();
  const ov = await overlay(h);
  const menu = ov.getByRole('menu', { name: 'Tools' });
  await expect(menu).toBeVisible();
  await menu.getByRole('menuitem', { name: 'Screenshot of visible area', exact: true }).click();
  await expect.poll(() => readdirSync(downloads).filter((f) => f.endsWith('.png')).length).toBe(1);
  await inMain(h, (vz) => vz.runCommand(vz.focused(), 'tools.screenshotFull'));
  await expect.poll(() => readdirSync(downloads).filter((f) => f.endsWith('.png')).length).toBe(2);
  await inMain(h, (vz) => vz.runCommand(vz.focused(), 'tools.savePdf'));
  await expect.poll(() => existsSync(join(downloads, 'Kigali Coffee Guide.pdf'))).toBe(true);
});

test('the QR dialog shows a code for the page and copies its link', async () => {
  await setup();
  await inMain(h, (vz) => vz.runCommand(vz.focused(), 'tools.qr'));
  const ov = await overlay(h);
  const dlg = ov.getByRole('dialog');
  await expect(dlg.getByRole('img', { name: 'QR code' }).locator('svg')).toBeVisible();
  await dlg.getByRole('button', { name: 'Copy link' }).click();
  await expect.poll(() => inMain(h, (_vz, _a, electron) => electron.clipboard.readText())).toBe(`${h.base}/article`);
});

test('the ⋮ menu is a glass menu; zoom keeps it open and shows the level', async () => {
  const { chrome } = await setup();
  await chrome.locator('vz-toolbar').getByRole('button', { name: 'More' }).click();
  const ov = await overlay(h);
  const menu = ov.getByRole('menu', { name: 'More' });
  await expect(menu).toBeVisible();
  await expect(menu.getByRole('menuitem', { name: /New private window/ })).toBeVisible();
  await expect(menu.getByRole('menuitem', { name: /Extensions/ })).toBeVisible();
  await menu.getByRole('menuitem', { name: 'Zoom in' }).click();
  await expect(menu.getByRole('menuitem', { name: 'Reset zoom' })).toHaveText('110%');
  await menu.getByRole('menuitem', { name: /^Tools/ }).click();
  await expect(ov.getByRole('menu', { name: 'Tools' })).toBeVisible();
});

test('clear site data removes the site’s cookies', async () => {
  await setup();
  expect(await inMain(h, async (vz) => (await vz.profile.session.cookies.get({ name: 'vzt' })).length)).toBeGreaterThan(0);
  await inMain(h, (vz) => vz.runCommand(vz.focused(), 'tools.clearSiteData'));
  await expect.poll(async () => inMain(h, async (vz) => (await vz.profile.session.cookies.get({ name: 'vzt', domain: '127.0.0.1' })).length)).toBe(0);
});

test('the frame takes the site colour (theme-color, else page background); white/black without one; menus are solid', async () => {
  const { chrome } = await setup();
  const frame = () => chrome.evaluate(() => getComputedStyle(document.querySelector('vz-shell')!).getPropertyValue('--fr-bg').trim());
  const go = async (path: string, title: string) => {
    await inMain(h, (vz, u) => vz.focused().loadUrl(vz.focused().activeTab().id, u), `${h.base}${path}`);
    await waitFor(() => inMain(h, (vz) => vz.focused().activeTab().title), (t) => t === title);
  };
  await go('/brand', 'Brand');
  await expect.poll(frame).toBe('#1a73e8');
  // White ink on a brand blue, and the frame goes monochrome (no blue-on-blue accents).
  expect(await chrome.evaluate(() => getComputedStyle(document.querySelector('vz-shell')!).getPropertyValue('--fr-text').trim())).toBe('#f5f7fa');
  expect(await chrome.evaluate(() => document.querySelector('vz-shell')!.hasAttribute('tinted'))).toBe(true);
  await go('/painted', 'Painted');
  await expect.poll(frame).toBe('#0f766e');
  // No site colour (an internal page): white in light theme, black in dark.
  await inMain(h, (vz) => vz.profile.prefs.set('appearance.theme', 'light'));
  await inMain(h, (vz) => vz.focused().loadUrl(vz.focused().activeTab().id, 'vizulla://settings/'));
  await expect.poll(frame).toBe('#ffffff');
  await inMain(h, (vz) => vz.profile.prefs.set('appearance.theme', 'dark'));
  await expect.poll(frame).toBe('#000000');
  // The setting turns it off.
  await go('/brand', 'Brand');
  await inMain(h, (vz) => vz.profile.prefs.set('appearance.siteColors', false));
  await expect.poll(frame).toBe('#000000');
  // Menus over the page are opaque (CSS blur can't reach the page from the overlay).
  await chrome.locator('vz-toolbar').getByRole('button', { name: 'Tools', exact: true }).click();
  const ov = await overlay(h);
  expect(await ov.locator('.pop').first().evaluate((el) => getComputedStyle(el).backgroundColor)).toMatch(/^rgb\(/);
});
