// 0.4.3: JavaScript dialogs (alert, confirm, prompt) as browser dialogs; theme
// defaults and controls; installable web apps (detect, install, app window,
// OS shortcut, beforeinstallprompt, vizulla://apps, uninstall).
import { expect, test, type Page } from '@playwright/test';
import { existsSync, mkdtempSync, readFileSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { inMain, launch, waitFor, type Harness } from './harness';

let h: Harness;
test.afterEach(async () => h?.close());

const overlay = async (): Promise<Page> => (await waitFor(async () => h.app.windows().find((w) => w.url().startsWith('vizulla://overlay')), (p) => !!p))!;
const go = async (path: string, title: string) => {
  await inMain(h, (vz, u) => vz.focused().loadUrl(vz.focused().activeTab().id, u), `${h.base}${path}`);
  await waitFor(() => inMain(h, (vz) => vz.focused().activeTab().title), (t) => t === title);
};
/** Runs page script without waiting for it (the page blocks while a dialog is open). */
const start = (code: string) => inMain(h, (vz, c) => vz.focused().activeTab().wc.executeJavaScript(c, true), code) as Promise<string>;
const host = () => h.base.replace('http://', '');

test.describe('JavaScript dialogs', () => {
  test('prompt asks in a browser dialog, returns what was typed; Escape returns null', async () => {
    h = await launch();
    await h.chrome();
    await go('/dialogs', 'Dialogs');
    const answer = start(`JSON.stringify({ v: prompt('What is your name?', 'Ada') })`);
    const dlg = (await overlay()).getByRole('dialog');
    await expect(dlg).toContainText(`${host()} says`);
    await expect(dlg).toContainText('What is your name?');
    const input = dlg.getByRole('textbox');
    await expect(input).toHaveValue('Ada');
    await input.fill('Grace');
    await input.press('Enter');
    expect(await answer).toBe('{"v":"Grace"}');

    const cancelled = start(`JSON.stringify({ v: prompt('Again?') })`);
    await expect((await overlay()).getByRole('dialog')).toContainText('Again?');
    await (await overlay()).keyboard.press('Escape');
    expect(await cancelled).toBe('{"v":null}');
  });

  test('confirm returns true for OK and false for Cancel; alert waits for OK', async () => {
    h = await launch();
    await h.chrome();
    await go('/dialogs', 'Dialogs');
    const yes = start(`String(confirm('Delete the draft?'))`);
    const dlg = (await overlay()).getByRole('alertdialog');
    await expect(dlg).toContainText('Delete the draft?');
    await dlg.getByRole('button', { name: 'OK' }).click();
    expect(await yes).toBe('true');

    const no = start(`String(confirm('Really?'))`);
    await (await overlay()).getByRole('alertdialog').getByRole('button', { name: 'Cancel' }).click();
    expect(await no).toBe('false');

    const t0 = Date.now();
    const done = start(`alert('Saved!\\nAll changes are stored.'); 'after'`);
    const a = (await overlay()).getByRole('alertdialog');
    await expect(a).toContainText('All changes are stored.');
    await expect(a.getByRole('button', { name: 'Cancel' })).toHaveCount(0);
    await new Promise((r) => setTimeout(r, 300));
    await a.getByRole('button', { name: 'OK' }).click();
    expect(await done).toBe('after');
    expect(Date.now() - t0).toBeGreaterThanOrEqual(300); // the page really waited
  });

  test('from the second dialog on, the page can be stopped from showing more', async () => {
    h = await launch();
    await h.chrome();
    await go('/dialogs', 'Dialogs');
    const first = start(`alert('one'); 1`);
    const ov = await overlay();
    await expect(ov.getByRole('alertdialog').getByRole('checkbox')).toHaveCount(0);
    await ov.getByRole('alertdialog').getByRole('button', { name: 'OK' }).click();
    await first;
    const second = start(`alert('two'); 2`);
    const dlg = ov.getByRole('alertdialog');
    await dlg.getByRole('checkbox', { name: "Don't let this page show more dialogs" }).check();
    await dlg.getByRole('button', { name: 'OK' }).click();
    await second;
    // Silenced: answers come back at once (confirm false, prompt null), no dialog.
    expect(await start(`JSON.stringify([confirm('x'), prompt('y'), (alert('z'), 'ok')])`)).toBe('[false,null,"ok"]');
  });

  test('an embedded page on another site is named as such', async () => {
    h = await launch();
    await h.chrome();
    await go('/dialogs', 'Dialogs');
    const other = h.base.replace('127.0.0.1', 'localhost');
    await start(`new Promise((r) => { const f = document.getElementById('f'); f.onload = () => r('ok'); f.src = '${other}/'; })`);
    const answer = inMain(h, (vz) => vz.focused().activeTab().wc.mainFrame.frames[0].executeJavaScript(`String(confirm('From the frame'))`, true)) as Promise<string>;
    const dlg = (await overlay()).getByRole('alertdialog');
    await expect(dlg).toContainText(`An embedded page on ${other.replace('http://', '')} says`);
    await dlg.getByRole('button', { name: 'OK' }).click();
    expect(await answer).toBe('true');
  });
});

test.describe('themes', () => {
  test('a new profile follows the computer; the ⋮ menu and Settings switch it', async () => {
    h = await launch();
    const chrome = await h.chrome();
    expect(await inMain(h, (vz) => vz.profile.prefs.get('appearance.theme'))).toBe('system');
    expect(await inMain(h, (_vz, _a, e) => e.nativeTheme.themeSource)).toBe('system');

    await chrome.locator('vz-toolbar').getByRole('button', { name: 'More' }).click();
    const menu = (await overlay()).getByRole('menu');
    await menu.getByRole('menuitemradio', { name: 'Dark' }).click();
    await expect.poll(() => inMain(h, (_vz, _a, e) => e.nativeTheme.themeSource)).toBe('dark');
    await expect(menu.getByRole('menuitemradio', { name: 'Dark' })).toHaveAttribute('aria-checked', 'true'); // the menu stays open
    await inMain(h, (vz) => vz.focused().overlay.close());

    await inMain(h, (vz) => vz.focused().loadUrl(null, 'vizulla://settings/appearance', { newTab: true }));
    const page = (await waitFor(async () => h.app.windows().find((w) => w.url().startsWith('vizulla://settings')), (p) => !!p))!;
    await page.getByRole('radio', { name: 'Automatic' }).click();
    await expect.poll(() => inMain(h, (vz) => vz.profile.prefs.get('appearance.theme'))).toBe('system');
    await expect(page.getByText(/Follows your computer — now (Light|Dark)/)).toBeVisible();
  });

  test('private windows draw a solid dark frame (no light glass under light text)', async () => {
    h = await launch();
    await h.chrome();
    const s = await inMain(h, (vz) => {
      const w = vz.openWindow({ private: true });
      return { glass: w.state().glass, theme: w.resolvedTheme() };
    });
    expect(s).toEqual({ glass: false, theme: 'dark' });
  });
});

test.describe('installable web apps', () => {
  const appsDir = () => mkdtempSync(join(tmpdir(), 'vz-apps-'));

  test('a site with a manifest offers Install; installing opens its own window and adds a shortcut', async () => {
    const dir = appsDir();
    h = await launch({ env: { VZ_APPS_DIR: dir } });
    const chrome = await h.chrome();
    await go('/pwa', 'Vizulla Test App');
    await expect.poll(() => inMain(h, (vz) => vz.focused().state().install)).toEqual({ state: 'installable', name: 'Vizulla Test App' });
    // The page's own install button would work: beforeinstallprompt fired.
    await expect.poll(() => start('!!window.__bip')).toBe(true);
    // A one-time hint toast, with the action in it.
    expect(await inMain(h, (vz) => vz.focused().toasts.map((x: { text: string }) => x.text))).toContain('Available as an app');

    await chrome.locator('vz-toolbar').getByRole('button', { name: 'Install Vizulla Test App' }).click();
    const dlg = (await overlay()).getByRole('dialog');
    await expect(dlg).toContainText('Install app');
    await expect(dlg.getByRole('textbox', { name: 'App name' })).toHaveValue('Vizulla Test App');
    await expect(dlg).toContainText('Opens in its own window');
    await dlg.getByRole('tab', { name: 'Phone or tablet' }).click();
    await expect(dlg).toContainText('Add to Home Screen');
    await dlg.getByRole('tab', { name: 'This computer' }).click();
    await dlg.getByRole('button', { name: 'Install' }).click();

    const apps = await waitFor(() => inMain(h, (vz) => vz.webApps.list()), (l: unknown[]) => l.length === 1) as { id: string; name: string; shortcuts: string[]; iconFile: string }[];
    expect(apps[0]!.name).toBe('Vizulla Test App');
    // Its own window at the app's start page; the tab moved into it.
    await waitFor(() => inMain(h, (vz, id) => vz.webApps.windows.get(id)?.wc.getURL() ?? '', apps[0]!.id), (u) => u.endsWith('/pwa'), 10_000);
    expect(await inMain(h, (vz) => vz.focused().tabs.size)).toBe(1);
    // The OS shortcut exists, launches this browser with the app's id and the same profile.
    expect(apps[0]!.shortcuts.length).toBeGreaterThan(0);
    for (const f of apps[0]!.shortcuts) expect(existsSync(f)).toBe(true);
    if (process.platform === 'darwin') {
      const bundle = apps[0]!.shortcuts[0]!;
      expect(readFileSync(join(bundle, 'Contents', 'Info.plist'), 'utf8')).toContain('<string>Vizulla Test App</string>');
      const script = readFileSync(join(bundle, 'Contents', 'MacOS', 'launcher'), 'utf8');
      expect(script).toContain(`--vz-app=${apps[0]!.id}`);
      expect(script).toContain(`--user-data-dir=${h.profile}`);
      expect(existsSync(join(bundle, 'Contents', 'Resources', 'app.icns'))).toBe(true);
    }
    expect(existsSync(apps[0]!.iconFile)).toBe(true);

    // Back in the browser, the same site now offers "Open in app".
    await inMain(h, (vz, u) => vz.focused().loadUrl(vz.focused().activeTab().id, u), `${h.base}/pwa`);
    await expect.poll(() => inMain(h, (vz) => vz.focused().state().install?.state)).toBe('installed');

    // Removing it closes its window and deletes the shortcut.
    await inMain(h, (vz, id) => vz.webApps.uninstall(id), apps[0]!.id);
    for (const f of apps[0]!.shortcuts) expect(existsSync(f)).toBe(false);
    expect(await inMain(h, (vz) => vz.webApps.list().length)).toBe(0);
  });

  test('a shortcut launch (--vz-app) opens the app; vizulla://apps lists and opens it', async () => {
    h = await launch({ env: { VZ_APPS_DIR: appsDir() } });
    await h.chrome();
    await go('/pwa', 'Vizulla Test App');
    await expect.poll(() => inMain(h, (vz) => vz.focused().state().install?.state)).toBe('installable');
    // The page's own install button: prompt() opens the browser's dialog; cancelling resolves "dismissed".
    const choice = start(`window.__bip.prompt().then((c) => c.outcome)`);
    await (await overlay()).getByRole('dialog').getByRole('button', { name: 'Cancel' }).click();
    expect(await choice).toBe('dismissed');

    // Installed directly (the dialog path is covered above), with the site's icon.
    const id = (await inMain(h, async (vz, base) => {
      const png = `data:image/png;base64,${Buffer.from(await (await fetch(`${base}/icon.png`)).arrayBuffer()).toString('base64')}`;
      const url = `${base}/pwa`;
      const m = { id: url, name: 'Vizulla Test App', shortName: 'Test', description: '', startUrl: url, scope: `${base}/`, display: 'standalone', themeColor: null, backgroundColor: null, icons: [], manifestUrl: '' };
      return vz.webApps.install(m, { name: m.name, desktop: false, png, macPng: png }).id;
    }, h.base)) as string;
    expect(await inMain(h, (vz, x) => vz.webApps.handleArgv([`--vz-app=${x}`]), id)).toBe(true);
    await waitFor(() => inMain(h, (vz, x) => vz.webApps.windows.get(x)?.wc.getURL() ?? '', id), (u) => u.includes('/pwa'), 10_000);
    expect(await inMain(h, (vz) => vz.webApps.handleArgv(['--vz-app=not-an-id']))).toBe(false);

    await inMain(h, (vz) => vz.focused().loadUrl(null, 'vizulla://apps', { newTab: true }));
    const page = (await waitFor(async () => h.app.windows().find((w) => w.url().startsWith('vizulla://apps')), (p) => !!p))!;
    await expect(page.getByText('Vizulla Test App')).toBeVisible();
    await expect(page.getByRole('button', { name: 'Remove Vizulla Test App' })).toBeVisible();
  });

  test('a real-world icon (far bigger than a dialog result) installs, with its icon and shortcut', async () => {
    h = await launch({ env: { VZ_APPS_DIR: appsDir() } });
    const chrome = await h.chrome();
    await go('/pwa-big', 'Big Icon App');
    await expect.poll(() => inMain(h, (vz) => vz.focused().state().install?.state)).toBe('installable');
    await chrome.locator('vz-toolbar').getByRole('button', { name: 'Install Big Icon App' }).click();
    const dlg = (await overlay()).getByRole('dialog');
    await dlg.getByRole('checkbox', { name: 'Open the app now' }).uncheck();
    await dlg.getByRole('button', { name: 'Install' }).click();
    const apps = (await waitFor(() => inMain(h, (vz) => vz.webApps.list()), (l: unknown[]) => l.length === 1, 15_000)) as { shortcuts: string[]; iconFile: string }[];
    expect(statSync(apps[0]!.iconFile).size).toBeGreaterThan(64 * 1024); // the noisy icon itself, not a fallback
    for (const f of apps[0]!.shortcuts) expect(existsSync(f)).toBe(true);
    // The success dialog follows.
    await expect((await overlay()).getByRole('dialog')).toContainText('Big Icon App is installed');
    expect(h.logs.join('')).not.toContain('bad IPC message');
  });

  test("an app window's own dialogs work (alert/confirm in the app)", async () => {
    h = await launch({ env: { VZ_APPS_DIR: appsDir() } });
    await h.chrome();
    const id = (await inMain(h, (vz, base) => {
      const url = `${base}/dialogs`;
      const m = { id: url, name: 'Dialog App', shortName: 'D', description: '', startUrl: url, scope: `${base}/`, display: 'standalone', themeColor: null, backgroundColor: null, icons: [], manifestUrl: '' };
      const rec = vz.webApps.install(m, { name: 'Dialog App', desktop: false, png: '', macPng: '' });
      vz.webApps.launch(rec.id);
      return rec.id;
    }, h.base)) as string;
    await waitFor(() => inMain(h, (vz, x) => vz.webApps.windows.get(x)?.wc.getURL() ?? '', id), (u) => u.endsWith('/dialogs'));
    const answer = inMain(h, (vz, x) => vz.webApps.windows.get(x).wc.executeJavaScript("String(confirm('Inside the app?'))", true), id) as Promise<string>;
    // The only overlay so far is the app window's own.
    const dlg = (await overlay()).getByRole('alertdialog');
    await expect(dlg).toContainText('Inside the app?');
    await dlg.getByRole('button', { name: 'OK' }).click();
    expect(await answer).toBe('true');
    expect(await inMain(h, (vz, x) => vz.webApps.windows.get(x).overlay.isOpen, id)).toBe(false);
  });

  test('vizulla://apps guides first-time users when nothing is installed', async () => {
    h = await launch({ env: { VZ_APPS_DIR: appsDir() } });
    await h.chrome();
    await inMain(h, (vz) => vz.focused().loadUrl(null, 'vizulla://apps', { newTab: true }));
    const page = (await waitFor(async () => h.app.windows().find((w) => w.url().startsWith('vizulla://apps')), (p) => !!p))!;
    await expect(page.getByRole('heading', { name: 'No apps yet' })).toBeVisible();
    await expect(page.getByText('Click Install in the address bar.')).toBeVisible();
  });
});
