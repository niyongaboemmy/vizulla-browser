// Site technologies (Tools): headers, cookies, globals and markup become a grouped,
// versioned report, on demand only.
import { expect, test, type Page } from '@playwright/test';
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { inMain, launch, waitFor, type Harness } from './harness';

let h: Harness;
let srv: Server | null = null;
test.afterEach(async () => {
  await h?.close();
  srv?.close();
});

const overlay = async (h: Harness): Promise<Page> => (await waitFor(async () => h.app.windows().find((w) => w.url().startsWith('vizulla://overlay')), (p) => !!p))!;

test('Site technologies finds the server, framework and libraries with versions', async () => {
  srv = createServer((_req, res) => {
    res.writeHead(200, { 'content-type': 'text/html', server: 'nginx/1.25.3', 'x-powered-by': 'Express', 'set-cookie': 'connect.sid=1; Path=/' });
    res.end(`<!doctype html><title>Shop</title><meta name="generator" content="Hugo 0.128.0">
      <div class="container"><div class="row"><div class="col-md-6">Hello</div></div></div>
      <script>window.jQuery = { fn: { jquery: '3.7.1' } }; window.gtag = function () {};</script>`);
  });
  await new Promise<void>((r) => srv!.listen(0, '127.0.0.1', r));
  const url = `http://127.0.0.1:${(srv.address() as AddressInfo).port}/`;
  h = await launch();
  await h.chrome();
  await inMain(h, (vz, u) => vz.focused().loadUrl(vz.focused().activeTab().id, u), url);
  await waitFor(() => inMain(h, (vz) => vz.focused().activeTab().title), (t) => t === 'Shop');
  await inMain(h, (vz) => vz.runCommand(vz.focused(), 'tools.techStack'));
  const panel = (await overlay(h)).getByRole('dialog', { name: 'Site technologies' });
  await expect(panel.getByRole('region', { name: 'Web servers' })).toContainText('Nginx');
  await expect(panel).toContainText('1.25.3');
  await expect(panel.getByRole('region', { name: 'Back-end' })).toContainText('Express');
  await expect(panel.getByRole('region', { name: 'JavaScript libraries' })).toContainText('jQuery');
  await expect(panel).toContainText('3.7.1');
  await expect(panel.getByRole('region', { name: 'Web frameworks' })).toContainText('Hugo');
  await expect(panel).toContainText('Google Analytics');
  await expect(panel.getByRole('region', { name: 'Languages' })).toContainText('Node.js'); // implied by Express
});
