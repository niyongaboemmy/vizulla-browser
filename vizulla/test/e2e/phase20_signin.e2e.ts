// 0.4.8: "Sign in with Google / Apple / Microsoft…" as in Chrome. Sign-in popups (window.open with a
// size) open as a small window over the page that keeps window.opener, names its site in the title
// bar, closes itself when the provider is done, and has its own dialogs. FedCM, which Electron can't
// show, is off so providers use their popup or redirect flows. Sites see Chrome's user agent.
import { expect, test, type Page } from '@playwright/test';
import { inMain, launch, waitFor, type Harness } from './harness';

let h: Harness;
test.afterEach(async () => h?.close());

const site = () => h.base.replace('127.0.0.1', 'localhost');
const page = async (suffix: string): Promise<Page> => (await waitFor(async () => h.app.windows().find((w) => w.url().endsWith(suffix)), (p) => !!p))!;
const popups = () => inMain(h, (vz) => [...vz.popups].filter((p: any) => !p.win.isDestroyed()).map((p: any) => ({ title: p.win.getTitle(), visible: p.win.isVisible(), bounds: p.win.getBounds() })));

async function open() {
  h = await launch();
  await h.chrome();
  await inMain(h, (vz, u) => vz.focused().loadUrl(vz.focused().activeTab().id, u), `${site()}/sso`);
  await waitFor(() => inMain(h, (vz) => vz.focused().activeTab().title), (t) => t === 'Shop');
}

test('a sign-in popup opens as a small window that keeps the opener, hands back the result and closes', async () => {
  await open();
  await (await page('/sso')).click('#signin', { delay: 60 });
  const p = (await waitFor(popups, (l) => l.length === 1 && !!l[0]?.visible))[0]!;
  expect(p.bounds.width).toBeLessThan(700);
  // The title bar names the site the popup is on.
  await waitFor(popups, (l) => /127\.0\.0\.1:\d+/.test(l[0]?.title ?? ''));
  expect((await popups())[0]!.title).toContain('Provider sign-in');
  // Still one tab: the popup isn't a tab.
  expect(await inMain(h, (vz) => vz.focused().tabs.size)).toBe(1);

  const provider = await page('/sso-provider');
  await expect(provider.locator('#who')).toHaveText('opener ok');
  await provider.click('#allow');
  await waitFor(() => inMain(h, (vz) => vz.focused().activeTab().title), (t) => t === 'Signed in: token-123');
  await waitFor(popups, (l) => l.length === 0);
});

test('plain new-tab links still open tabs; the popup has its own dialogs', async () => {
  await open();
  await (await page('/sso')).click('#tab', { delay: 60 });
  await waitFor(() => inMain(h, (vz) => vz.focused().tabs.size), (n) => n === 2);
  expect(await popups()).toHaveLength(0);

  await inMain(h, (vz) => vz.focused().activateTab([...vz.focused().tabs.keys()][0]));
  await waitFor(() => inMain(h, (vz) => vz.focused().activeTab().title), (t) => t === 'Shop');
  await new Promise((r) => setTimeout(r, 300)); // the page's view is back on screen before clicking
  await (await page('/sso')).click('#signin', { delay: 60 });
  await waitFor(popups, (l) => l.length === 1);
  const provider = await page('/sso-provider');
  const answer = provider.evaluate(() => String(confirm('Share your email with Shop?')));
  const dlg = (await waitFor(async () => {
    const pages = h.app.windows().filter((w) => w.url().startsWith('vizulla://overlay'));
    for (const o of pages) if (await o.getByRole('alertdialog').count()) return o;
    return null;
  }, (o) => !!o))!.getByRole('alertdialog');
  await expect(dlg).toContainText('Share your email with Shop?');
  await dlg.getByRole('button', { name: 'OK' }).click();
  expect(await answer).toBe('true');
  // Closed by the user: the opener page carries on.
  await inMain(h, (vz) => [...vz.popups][0].win.close());
  await waitFor(popups, (l) => l.length === 0);
});

test('FedCM is off (Electron has no UI for it), so providers fall back instead of hanging; Chrome user agent', async () => {
  await open();
  const run = (c: string) => inMain(h, (vz, c) => vz.focused().activeTab().wc.executeJavaScript(c, true), c);
  expect(await run('typeof IdentityCredential')).toBe('undefined');
  expect(await run(`navigator.credentials.get({ identity: { providers: [{ configURL: location.origin + '/fedcm.json', clientId: 'x' }] } }).then(() => 'ok', (e) => e.name)`)).toBe('NotSupportedError');
  const ua = (await run('navigator.userAgent')) as string;
  expect(ua).toMatch(/Chrome\/\d+/);
  expect(ua).not.toMatch(/Electron|Vizulla/i);
});
