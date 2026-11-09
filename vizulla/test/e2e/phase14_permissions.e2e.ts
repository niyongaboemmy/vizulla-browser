// Site permissions (0.4.1): Chrome-style prompt (allow while visiting / this time /
// never), in-use indicators, embargo after dismissals, site-info panel, Settings
// defaults, and the screen-sharing picker.
import { expect, test, type Page } from '@playwright/test';
import { inMain, launch, waitFor, type Harness } from './harness';

let h: Harness;
test.afterEach(async () => h?.close());

const overlay = async (h: Harness): Promise<Page> => (await waitFor(async () => h.app.windows().find((w) => w.url().startsWith('vizulla://overlay')), (p) => !!p))!;
const run = (h: Harness, code: string) => inMain(h, (vz, c) => vz.focused().activeTab().wc.executeJavaScript(c, true), code);
const camera = `navigator.mediaDevices.getUserMedia({ video: true }).then((s) => (window.__cam = s, 'ok'), (e) => e.name)`;

async function open(): Promise<Page> {
  h = await launch({ args: ['--use-fake-device-for-media-stream'] });
  const chrome = await h.chrome();
  await inMain(h, (vz, b) => vz.focused().loadUrl(vz.focused().activeTab().id, `${b}/`), h.base);
  await waitFor(() => inMain(h, (vz) => vz.focused().activeTab().title), (t) => t === 'Vizulla test home');
  return chrome;
}

test('the prompt allows notifications while visiting and remembers it', async () => {
  await open();
  const ask = run(h, 'Notification.requestPermission()');
  const dlg = (await overlay(h)).getByRole('dialog');
  await expect(dlg).toContainText('wants to');
  await expect(dlg).toContainText('Show notifications');
  await dlg.getByRole('button', { name: 'Allow while visiting the site' }).click();
  expect(await ask).toBe('granted');
  expect(await inMain(h, (vz) => vz.profile.permissions.list())).toEqual([{ origin: h.base, permission: 'notifications', decision: 'allow' }]);
});

test('"allow this time" for the camera shows the in-use indicator until the page navigates', async () => {
  const chrome = await open();
  const ask = run(h, camera);
  await (await overlay(h)).getByRole('dialog').getByRole('button', { name: 'Allow this time' }).click();
  expect(await ask).toBe('ok');
  await expect(chrome.locator('vz-tabstrip .tab.active .live')).toBeVisible();
  await expect(chrome.locator('vz-toolbar button.sec.live')).toBeVisible();
  expect(await inMain(h, (vz) => vz.profile.permissions.list())).toEqual([]); // nothing remembered

  await inMain(h, (vz, b) => vz.focused().loadUrl(vz.focused().activeTab().id, `${b}/?again`), h.base);
  await expect(chrome.locator('vz-tabstrip .tab.active .live')).toHaveCount(0);
  const again = run(h, camera);
  await expect((await overlay(h)).getByRole('dialog')).toContainText('Use your camera');
  await (await overlay(h)).getByRole('dialog').getByRole('button', { name: 'Never allow' }).click();
  expect(await again).toBe('NotAllowedError');
});

test('dismissing a prompt three times blocks the site from asking for a while', async () => {
  await open();
  for (let i = 0; i < 3; i++) {
    const ask = run(h, camera);
    const dlg = (await overlay(h)).getByRole('dialog');
    await expect(dlg).toBeVisible();
    await (await overlay(h)).keyboard.press('Escape');
    expect(await ask).toBe('NotAllowedError');
  }
  expect(await run(h, camera)).toBe('NotAllowedError'); // no prompt this time
  expect(await inMain(h, (vz, o) => vz.profile.permissions.embargoed(o, 'camera'), h.base)).toBe(true);
});

test('the site-info panel changes a site’s permission; Settings defaults apply everywhere', async () => {
  const chrome = await open();
  await chrome.locator('vz-toolbar button.sec').click();
  const ov = await overlay(h);
  const panel = ov.getByRole('dialog', { name: 'Site information and permissions' });
  await expect(panel).toContainText('Camera');
  await expect(panel).toContainText('Notifications');
  await inMain(h, (vz) => vz.focused().overlay.close());
  await inMain(h, (vz, o) => vz.profile.permissions.set(o, 'camera', 'block'), h.base);
  expect(await run(h, camera)).toBe('NotAllowedError');

  // Settings → Permissions: camera blocked by default for every site.
  await inMain(h, (vz, o) => vz.profile.permissions.resetSite(o), h.base);
  await inMain(h, (vz) => vz.focused().loadUrl(null, 'vizulla://settings/permissions', { newTab: true }));
  const page = (await waitFor(async () => h.app.windows().find((w) => w.url().startsWith('vizulla://settings')), (p) => !!p))!;
  await expect(page.getByText('Default behavior')).toBeVisible();
  await inMain(h, (vz) => vz.profile.prefs.set('permissions.defaults', { camera: 'block' }));
  await inMain(h, (vz) => vz.focused().activateTab([...vz.focused().tabs.values()][0].id));
  expect(await run(h, camera)).toBe('NotAllowedError');
});

test('screen sharing opens the picker; sharing a tab gives the site a video stream', async () => {
  await open();
  await inMain(h, (vz, b) => {
    const w = vz.focused();
    const first = w.activeTab().id;
    w.loadUrl(null, `${b}/article`, { newTab: true });
    setTimeout(() => w.activateTab(first), 400);
  }, h.base);
  await waitFor(() => inMain(h, (vz) => vz.focused().activeTab().title), (t) => t === 'Vizulla test home');
  const share = run(h, `navigator.mediaDevices.getDisplayMedia({ video: true }).then((s) => s.getVideoTracks().length, (e) => e.name)`);
  const dlg = (await overlay(h)).getByRole('dialog');
  await expect(dlg).toContainText('Choose what to share');
  await dlg.getByRole('option', { name: /Kigali Coffee Guide/ }).click();
  await dlg.getByRole('button', { name: 'Share' }).click();
  expect(await share).toBe(1);
  await expect.poll(() => inMain(h, (vz) => vz.focused().tabInfo(vz.focused().activeTab().id).inUse)).toContain('display-capture');
});
