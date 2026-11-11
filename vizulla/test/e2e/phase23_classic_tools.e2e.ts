// 0.4.12: the toolbar's tools work in the classic layout (horizontal tabs and a bookmarks bar).
// Gemini, the Assistant and Notes open their side panel there too, as Chrome's side panel does;
// before, classic hid every side panel, so those buttons did nothing.
import { expect, test, type Page } from '@playwright/test';
import { join } from 'node:path';
import { inMain, launch, ROOT, waitFor, type Harness } from './harness';

let h: Harness;
test.afterEach(async () => h?.close());

const env = { VZ_GOOGLE_ACCOUNTS_URL: '{base}/ListAccounts', VZ_GEMINI_URL: '{base}/gemini' };
const surface = () => inMain(h, (vz) => vz.focused().overlay.surface?.kind ?? null);
const overlay = async (): Promise<Page> => (await waitFor(async () => h.app.windows().find((w) => w.url().startsWith('vizulla://overlay')), (p) => !!p))!;

test('in the classic layout every toolbar tool opens: Gemini, Tools, Extensions, Assistant, Notes', async () => {
  h = await launch({ env });
  const chrome = await h.chrome();
  await inMain(h, (vz) => vz.focused().win.setSize(1280, 800));
  await inMain(h, (vz) => vz.runCommand(vz.focused(), 'view.classic'));
  await waitFor(() => inMain(h, (vz) => vz.focused().state().classic), (c) => c === true);
  await inMain(h, (vz) => vz.google.refresh());
  await waitFor(() => inMain(h, (vz) => vz.focused().state().google?.accounts?.length), (n) => n === 3);
  await inMain(h, (vz, p) => vz.extensions.loadUnpacked(p), join(ROOT, 'vizulla/test/data/ext-fixture'));
  const bar = chrome.locator('vz-toolbar');

  // Side panels: each button opens its panel, and a second click closes it.
  for (const [name, panel, tag] of [
    [/Gemini/i, 'gemini', 'vz-gemini-panel'],
    [/Assistant|AI/i, 'assistant', 'vz-assistant'],
    [/Notes/i, 'notes', 'vz-notes'],
  ] as const) {
    const btn = bar.getByRole('button', { name, exact: false }).first();
    await btn.click();
    await waitFor(() => inMain(h, (vz) => vz.focused().state().panel), (p) => p === panel);
    await expect(chrome.locator(tag)).toBeVisible();
    // The page makes room for the panel.
    const box = await chrome.locator('vz-panels').boundingBox();
    expect(box!.width).toBeGreaterThan(250);
    await btn.click();
    await waitFor(() => inMain(h, (vz) => vz.focused().state().panel), (p) => p === null);
  }

  // Menus: Tools and Extensions open in the overlay.
  await bar.getByRole('button', { name: /Tools/i }).click();
  await waitFor(surface, (k) => k !== null);
  await (await overlay()).keyboard.press('Escape');
  await waitFor(surface, (k) => k === null);
  await bar.getByRole('button', { name: 'Extensions', exact: true }).click();
  expect(await waitFor(surface, (k) => k !== null)).toBe('extensions');
});
