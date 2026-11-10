// 0.4.7: passkey requests (WebAuthn) no longer hang silently. While a site waits for a passkey the
// browser shows a sheet: a security key completes it, "Sign in another way" ends the request with
// NotAllowedError (as Chrome's Cancel does) so the site offers its other methods, "Keep waiting"
// hides the sheet. Requests the user isn't asked to complete (conditional) show nothing.
import { expect, test, type Page } from '@playwright/test';
import { inMain, launch, waitFor, type Harness } from './harness';

let h: Harness;
test.afterEach(async () => h?.close());

const overlay = async (): Promise<Page> => (await waitFor(async () => h.app.windows().find((w) => w.url().startsWith('vizulla://overlay')), (p) => !!p))!;
const run = (code: string) => inMain(h, (vz, c) => vz.focused().activeTab().wc.executeJavaScript(c, true), code);
/** Starts a passkey request on the page; its outcome lands in window.__pk. */
const ask = (opts: string) =>
  run(`window.__ac = new AbortController(); window.__pk = 'pending'; window.__t0 = Date.now();
    navigator.credentials.${opts}.then(() => (window.__pk = 'resolved'), (e) => (window.__pk = e.name)); 1`);
const outcome = () => run('window.__pk') as Promise<string>;
const sheetOpen = () => inMain(h, (vz) => vz.focused().overlay.surface?.dialog?.type === 'passkey');
const GET = (extra = '') => `get({ publicKey: { challenge: new Uint8Array(32), rpId: 'localhost', timeout: 60000 }${extra} })`;

async function open() {
  h = await launch();
  await h.chrome();
  // localhost is a secure context and a valid relying party ID (127.0.0.1 is not).
  await inMain(h, (vz, u) => vz.focused().loadUrl(vz.focused().activeTab().id, u), `${h.base.replace('127.0.0.1', 'localhost')}/long`);
  await waitFor(() => inMain(h, (vz) => vz.focused().activeTab().title), (t) => t === 'Long page');
}

test('a passkey request shows the sheet; Sign in another way ends it so the site can offer other methods', async () => {
  await open();
  await ask(GET());
  const dlg = (await overlay()).getByRole('dialog');
  await expect(dlg).toContainText('Use a passkey for localhost');
  await expect(dlg).toContainText('Insert your security key and touch it.');
  await expect(dlg).toContainText('Sign in another way to use your password');
  await dlg.getByRole('button', { name: 'Sign in another way' }).click();
  expect(await waitFor(outcome, (o) => o !== 'pending')).toBe('NotAllowedError');
  expect(await sheetOpen()).toBe(false);
});

test('Escape also ends the request; Keep waiting hides the sheet and leaves it running', async () => {
  await open();
  await ask(GET());
  await expect((await overlay()).getByRole('dialog')).toContainText('Use a passkey');
  await (await overlay()).keyboard.press('Escape');
  expect(await waitFor(outcome, (o) => o !== 'pending')).toBe('NotAllowedError');

  await ask(GET(', signal: window.__ac.signal'));
  const dlg = (await overlay()).getByRole('dialog');
  await dlg.getByRole('button', { name: 'Keep waiting' }).click();
  await waitFor(sheetOpen, (o) => !o);
  await new Promise((r) => setTimeout(r, 400));
  expect(await outcome()).toBe('pending');
  // The page can still give up on its own.
  await run('window.__ac.abort(); 1');
  expect(await waitFor(outcome, (o) => o !== 'pending')).toBe('AbortError');
});

test('the sheet goes away by itself when the page stops waiting', async () => {
  await open();
  await ask(GET(', signal: window.__ac.signal'));
  await expect((await overlay()).getByRole('dialog')).toContainText('Use a passkey');
  await run('window.__ac.abort(); 1');
  expect(await waitFor(outcome, (o) => o !== 'pending')).toBe('AbortError');
  await waitFor(sheetOpen, (o) => !o);
});

test('creating a passkey offers Not now; autofill-style (conditional) requests show nothing', async () => {
  await open();
  await ask(`create({ publicKey: { challenge: new Uint8Array(32), rp: { id: 'localhost', name: 'Test' }, user: { id: new Uint8Array(8), name: 'ada', displayName: 'Ada' }, pubKeyCredParams: [{ type: 'public-key', alg: -7 }], timeout: 60000 } })`);
  const dlg = (await overlay()).getByRole('dialog');
  await expect(dlg).toContainText('Create a passkey for localhost');
  await dlg.getByRole('button', { name: 'Not now' }).click();
  expect(await waitFor(outcome, (o) => o !== 'pending')).toBe('NotAllowedError');

  await ask(GET(", mediation: 'conditional', signal: window.__ac.signal"));
  await new Promise((r) => setTimeout(r, 900));
  expect(await sheetOpen()).toBe(false);
  expect(await outcome()).toBe('pending');
  await run('window.__ac.abort(); 1');
});

test('passwords and other credential requests are untouched', async () => {
  await open();
  // Answered by Electron as before (it has no password credentials), straight away and with no sheet.
  expect(await run(`navigator.credentials.get({ password: true }).then((c) => String(c), (e) => e.name)`)).toMatch(/^(null|NotSupportedError)$/);
  expect(await run('navigator.credentials.get.name')).toBe('get');
  expect(await sheetOpen()).toBe(false);
});
