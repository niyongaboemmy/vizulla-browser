// Search (Plan 0.4, phase 4): the address bar suggests Vizulla's own settings, pages
// and tools, supports @scopes, and shows search-engine suggestions (not in private).
import { expect, test, type Page } from '@playwright/test';
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { inMain, launch, waitFor, type Harness } from './harness';

let h: Harness;
let srv: Server | null = null;
const hits: string[] = [];
test.afterEach(async () => {
  await h?.close();
  srv?.close();
  srv = null;
  hits.length = 0;
});

const overlay = async (h: Harness): Promise<Page> => (await waitFor(async () => h.app.windows().find((w) => w.url().startsWith('vizulla://overlay')), (p) => !!p))!;

/** A stand-in search engine: answers OpenSearch suggestion requests and records them. */
async function engine(): Promise<string> {
  srv = createServer((req, res) => {
    const q = new URL(req.url ?? '/', 'http://x').searchParams.get('q') ?? '';
    hits.push(q);
    res.writeHead(200, { 'content-type': 'application/json' });
    res.end(JSON.stringify([q, [`${q} weather`, `${q} map`]]));
  });
  await new Promise<void>((r) => srv!.listen(0, '127.0.0.1', r));
  return `http://127.0.0.1:${(srv!.address() as AddressInfo).port}/suggest?q=%s`;
}

const openBar = async (h: Harness) => {
  await inMain(h, (vz) => vz.runCommand(vz.focused(), 'nav.focusAddress'));
  const ov = await overlay(h);
  const input = ov.locator('vz-overlay input');
  await expect(input).toBeVisible();
  return { ov, input, rows: ov.locator('vz-overlay .row') };
};

test('typing "dark mode" offers the Theme setting and opens Settings right on it', async () => {
  h = await launch();
  await h.chrome();
  const { input, rows } = await openBar(h);
  await input.fill('dark mode');
  const row = rows.filter({ hasText: 'Vizulla settings' }).first();
  await expect(row).toContainText('Theme');
  await row.click();
  await waitFor(() => inMain(h, (vz) => vz.focused().activeTab().url), (u: string) => u.startsWith('vizulla://settings/appearance?q='));
  const page = (await waitFor(async () => h.app.windows().find((w) => w.url().startsWith('vizulla://settings')), (p) => !!p))!;
  await expect(page.getByRole('searchbox').or(page.locator('input[type=search]')).first()).toHaveValue('Theme');
});

test('"@" lists scopes and "@tabs" searches only open tabs', async () => {
  h = await launch();
  await h.chrome();
  await inMain(h, (vz, b) => vz.focused().loadUrl(null, `${b}/article`, { newTab: true }), h.base);
  await waitFor(() => inMain(h, (vz) => vz.focused().activeTab().title), (t) => t === 'Kigali Coffee Guide');
  const { input, rows } = await openBar(h);
  await input.fill('@');
  await expect(rows.first()).toContainText('@tabs');
  await expect(rows).toHaveCount(5);
  await rows.first().click();
  await expect(input).toHaveValue('@tabs ');
  await input.fill('@tabs coffee');
  await expect(rows.first()).toContainText('Kigali Coffee Guide');
  await expect(rows.filter({ hasText: 'Search' })).toHaveCount(0);
});

test('search-engine suggestions appear in normal windows, never from private ones', async () => {
  const url = await engine();
  h = await launch({ env: { VZ_SUGGEST_URL: url } });
  await h.chrome();
  const { input, rows } = await openBar(h);
  await input.fill('kigali');
  await expect(rows.filter({ hasText: 'kigali weather' })).toHaveCount(1);
  expect(hits).toContain('kigali');

  hits.length = 0;
  await inMain(h, (vz) => vz.openWindow({ private: true }));
  await inMain(h, (vz) => vz.runCommand(vz.focused(), 'nav.focusAddress'));
  const pov = (await waitFor(async () => h.app.windows().filter((w) => w.url().startsWith('vizulla://overlay'))[1], (p) => !!p))!;
  const pin = pov.locator('vz-overlay input');
  await expect(pin).toBeVisible();
  await pin.fill('kigali');
  await expect(pov.locator('vz-overlay .row').first()).toBeVisible();
  await new Promise((r) => setTimeout(r, 600));
  expect(hits).toEqual([]);
  await expect(pov.locator('vz-overlay .row').filter({ hasText: 'kigali weather' })).toHaveCount(0);
});
