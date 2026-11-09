// Speed (Plan 0.4, phase 2): no header hooks on every request, third-party cookies
// blocked natively, one page-config call per frame, Task Manager.
import { expect, test } from '@playwright/test';
import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import { inMain, launch, waitFor, type Harness } from './harness';

let h: Harness;
test.afterEach(async () => h?.close());

test('requests only pass one hook; third-party cookies are blocked by Chromium itself', async () => {
  const srv = createServer((req, res) => {
    const u = req.url ?? '/';
    if (u.startsWith('/set')) {
      res.writeHead(200, { 'content-type': 'text/html', 'set-cookie': 'tp=1; SameSite=None; Secure; Path=/' });
      return res.end('set');
    }
    if (u.startsWith('/read')) {
      res.writeHead(200, { 'content-type': 'text/html' });
      return res.end(`<script>parent.postMessage(document.cookie || 'none', '*')</script>`);
    }
    res.writeHead(200, { 'content-type': 'text/html' });
    res.end('<!doctype html><title>top</title>');
  });
  await new Promise<void>((r) => srv.listen(0, '127.0.0.1', r));
  const port = (srv.address() as AddressInfo).port;
  h = await launch();
  await h.chrome();
  // No header listeners at all (they copied every request's headers through the browser process).
  expect(await inMain(h, (vz) => vz.profile.pipeline['headers'].length)).toBe(0);
  const seen = await inMain(h, async (vz, p) => {
    const wc = vz.focused().activeTab().wc;
    await wc.loadURL(`http://localhost:${p}/set`);
    await wc.loadURL(`http://127.0.0.1:${p}/`);
    return wc.executeJavaScript(`new Promise((res) => { addEventListener('message', (e) => res(e.data)); const f = document.createElement('iframe'); f.src = 'http://localhost:${p}/read'; document.body.append(f); setTimeout(() => res('timeout'), 4000); })`);
  }, port);
  expect(seen).toBe('none');
  srv.close();
});

test('web frames get language and fingerprinting settings from a single call', async () => {
  h = await launch();
  await h.chrome();
  await inMain(h, (_vz, _a, electron) => {
    const { ipcMain } = electron;
    const g = globalThis as unknown as { __cfgCalls: number };
    g.__cfgCalls = 0;
    ipcMain.prependListener('vz:page-config', () => g.__cfgCalls++);
  });
  await inMain(h, (vz, b) => vz.focused().loadUrl(vz.focused().activeTab().id, `${b}/canvas`), h.base);
  await waitFor(() => inMain(h, (vz) => vz.focused().activeTab().title), (t) => t === 'Canvas');
  const r = await inMain(h, async (vz) => ({
    calls: (globalThis as unknown as { __cfgCalls: number }).__cfgCalls,
    lang: await vz.focused().activeTab().wc.executeJavaScript('navigator.languages.length > 0'),
  }));
  expect(r.lang).toBe(true);
  expect(r.calls).toBe(1);
});

test('Task Manager lists processes with the tabs they host and puts a tab process to sleep', async () => {
  h = await launch();
  await h.chrome();
  await inMain(h, (vz, b) => {
    const w = vz.focused();
    w.loadUrl(null, `${b}/article`, { newTab: true });
    w.loadUrl(null, 'vizulla://task-manager/', { newTab: true });
  }, h.base);
  const page = (await waitFor(async () => h.app.windows().find((w) => w.url().startsWith('vizulla://task-manager')), (p) => !!p))!;
  const table = page.getByRole('table', { name: 'Task Manager' });
  await expect(table).toContainText('Browser');
  await expect(table).toContainText('GPU process');
  const row = table.getByRole('row').filter({ hasText: 'Kigali Coffee Guide' });
  await expect(row).toHaveCount(1);
  await row.getByRole('button', { name: 'End process' }).click();
  await expect.poll(() => inMain(h, (vz) => [...vz.focused().tabs.values()].find((t: { title: string }) => t.title === 'Kigali Coffee Guide')?.discarded)).toBe(true);
  await expect(page.locator('.note')).toContainText('1 sleeping tab');
});
