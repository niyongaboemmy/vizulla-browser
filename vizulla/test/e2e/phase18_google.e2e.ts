// 0.4.6: Google accounts in the toolbar avatar (switch between the accounts signed in on the
// web, add, manage, sign out) and "Ask Gemini" (Gemini beside the page, as the chosen account).
// The harness stands in for accounts.google.com/ListAccounts and gemini.google.com.
import { expect, test, type Page } from '@playwright/test';
import { inMain, launch, waitFor, type Harness } from './harness';

let h: Harness;
test.afterEach(async () => h?.close());

const env = { VZ_GOOGLE_ACCOUNTS_URL: '{base}/ListAccounts', VZ_GEMINI_URL: '{base}/gemini' };
const overlay = async (): Promise<Page> => (await waitFor(async () => h.app.windows().find((w) => w.url().startsWith('vizulla://overlay')), (p) => !!p))!;
const google = () => inMain(h, (vz) => vz.focused().state().google);
const signedIn = async () => {
  await inMain(h, (vz) => vz.google.refresh());
  return waitFor(google, (g) => g?.accounts?.length === 3);
};
const geminiText = () =>
  inMain(h, (_vz, _a, electron) => {
    const wc = electron.webContents.getAllWebContents().find((x) => x.getURL().endsWith('/gemini'));
    return wc ? wc.executeJavaScript(`document.querySelector('[role=textbox]').innerText`) : null;
  });

test.describe('Google accounts', () => {
  test('the avatar menu lists every signed-in account and switches between them', async () => {
    h = await launch({ env });
    const chrome = await h.chrome();
    const g = await signedIn();
    expect(g.active).toBe('ada@gmail.com');
    expect(g.accounts.map((a: { email: string; index: number; signedOut: boolean }) => [a.email, a.index, a.signedOut])).toEqual([
      ['ada@gmail.com', 0, false],
      ['ada@work.example', 1, false],
      ['old@gmail.com', -1, true],
    ]);

    // The avatar is the Google account now, and opens the account menu.
    const avatar = chrome.getByRole('button', { name: /ada@gmail\.com/ });
    await expect(avatar).toHaveText('A');
    await avatar.click();
    const menu = (await overlay()).getByRole('menu', { name: 'Accounts and profiles' });
    await expect(menu).toContainText('Ada Lovelace');
    await expect(menu.getByRole('menuitem', { name: 'Manage your Google Account' })).toBeVisible();
    await expect(menu.getByRole('menuitem', { name: /old@gmail\.com · Sign in again/ })).toContainText('Signed out');
    await expect(menu.getByRole('menuitem', { name: 'Add another account' })).toBeVisible();
    await expect(menu).toContainText('Vizulla profiles');

    await menu.getByRole('menuitem', { name: 'Switch to ada@work.example' }).click();
    await waitFor(google, (x) => x?.active === 'ada@work.example');
    await expect(chrome.getByRole('status')).toContainText('Now using ada@work.example');
    expect(await inMain(h, (vz) => vz.profile.prefs.get('google.activeAccount'))).toBe('ada@work.example');
  });

  test('signed-out accounts go to Google to sign in again; Add opens Google sign-in', async () => {
    h = await launch({ env });
    const chrome = await h.chrome();
    await signedIn();
    await chrome.getByRole('button', { name: /ada@gmail\.com/ }).click();
    await (await overlay()).getByRole('menuitem', { name: 'Add another account' }).click();
    await waitFor(() => inMain(h, (vz) => vz.focused().activeTab().url), (u) => /accounts\.google\.com\/AddSession/.test(u ?? ''), 15_000);
  });

  test('no Google sign-in: the avatar is the profile, the menu offers Sign in, no Gemini button', async () => {
    h = await launch({ env });
    const chrome = await h.chrome();
    // An empty account list, as Google answers when nobody is signed in.
    (h.server as unknown as { googleAccounts: unknown[] }).googleAccounts = [];
    await inMain(h, (vz) => vz.google.refresh());
    await waitFor(google, (g) => g && g.accounts.length === 0);
    await expect(chrome.getByRole('button', { name: 'Ask Gemini' })).toHaveCount(0);
    await chrome.getByRole('button', { name: /^Profile/ }).click();
    const menu = (await overlay()).getByRole('menu', { name: 'Accounts and profiles' });
    await expect(menu.getByRole('menuitem', { name: 'Sign in to Google' })).toBeVisible();
    await expect(menu.getByRole('menuitem', { name: 'Ask Gemini' })).toHaveCount(0);
  });

  test('Settings can hide Google accounts and the Gemini button', async () => {
    h = await launch({ env });
    const chrome = await h.chrome();
    await signedIn();
    await expect(chrome.getByRole('button', { name: 'Ask Gemini' })).toBeVisible();
    await inMain(h, (vz) => vz.profile.prefs.set('google.gemini', false));
    await expect(chrome.getByRole('button', { name: 'Ask Gemini' })).toHaveCount(0);
    await inMain(h, (vz) => vz.profile.prefs.set('google.accounts', false));
    await waitFor(google, (g) => g === null);
  });
});

test.describe('Ask Gemini', () => {
  test('opens Gemini beside the page as the chosen account and asks about the page', async () => {
    h = await launch({ env });
    const chrome = await h.chrome();
    await signedIn();
    await inMain(h, (vz, u) => vz.focused().loadUrl(vz.focused().activeTab().id, u), `${h.base}/long`);
    await waitFor(() => inMain(h, (vz) => vz.focused().activeTab().url), (u) => u?.endsWith('/long'));

    await chrome.getByRole('button', { name: 'Ask Gemini' }).click();
    await waitFor(() => inMain(h, (vz) => vz.focused().state().panel), (p) => p === 'gemini');
    await waitFor(() => inMain(h, (vz) => vz.google.panelUrl(vz.focused())), (u) => !!u?.endsWith('/gemini'));
    // The page sits in the panel's box, beside the tab, not over it.
    const placed = await waitFor(
      () => inMain(h, (_vz, _a, electron) => {
        const wc = electron.webContents.getAllWebContents().find((x) => x.getURL().endsWith('/gemini'));
        const w = (globalThis as any).__vz.focused();
        const view = w.win.contentView.children.find((v: any) => v.webContents === wc);
        const tab = w.activeTab().view.getBounds();
        return view ? { panel: view.getBounds(), tab } : null;
      }),
      (r) => !!r && r.panel.width > 200 && r.panel.height > 200,
    );
    expect(placed!.panel.x).toBeGreaterThanOrEqual(placed!.tab.x + placed!.tab.width);
    await expect(chrome.getByRole('button', { name: 'Gemini as ada@gmail.com' })).toBeVisible();

    await chrome.getByRole('button', { name: 'Ask about this page' }).click();
    const text = await waitFor(geminiText, (x) => !!x && x.includes('/long'));
    expect(text).toContain('Help me with this page');

    // Closing the panel takes the page away; reopening keeps the conversation.
    await chrome.getByRole('button', { name: 'Ask Gemini' }).click();
    await waitFor(() => inMain(h, (vz) => vz.focused().state().panel), (p) => p === null);
    const attached = await inMain(h, (_vz, _a, electron) => {
      const wc = electron.webContents.getAllWebContents().find((x) => x.getURL().endsWith('/gemini'));
      return (globalThis as any).__vz.focused().win.contentView.children.some((v: any) => v.webContents === wc);
    });
    expect(attached).toBe(false);
    await chrome.getByRole('button', { name: 'Ask Gemini' }).click();
    expect(await waitFor(geminiText, (x) => !!x?.includes('/long'))).toContain('/long');
  });

  test('a selection can be asked about from the page menu', async () => {
    h = await launch({ env });
    await h.chrome();
    await signedIn();
    await inMain(h, (vz) => vz.google.ask(vz.focused(), '“the selected words”\n\n'));
    expect(await waitFor(geminiText, (x) => !!x?.includes('selected'))).toContain('“the selected words”');
    expect(await inMain(h, (vz) => vz.focused().state().panel)).toBe('gemini');
  });
});
