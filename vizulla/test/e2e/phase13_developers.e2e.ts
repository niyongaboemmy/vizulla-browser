// Developers (Plan 0.4, phase 6): view source, JSON viewer, Copy as Markdown, and the
// local MCP server (token, origin and host checks, per-tool approval, tools, private
// windows invisible).
import { expect, test, type Page } from '@playwright/test';
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { inMain, launch, waitFor, type Harness } from './harness';

let h: Harness;
let srv: Server | null = null;
test.afterEach(async () => {
  await h?.close();
  srv?.close();
  srv = null;
});

const overlay = async (h: Harness): Promise<Page> => (await waitFor(async () => h.app.windows().find((w) => w.url().startsWith('vizulla://overlay')), (p) => !!p))!;
const title = (h: Harness) => inMain(h, (vz) => vz.focused().activeTab().title) as Promise<string>;

test('view source, JSON viewer and Copy as Markdown', async () => {
  srv = createServer((req, res) => {
    if (req.url?.startsWith('/api')) {
      res.writeHead(200, { 'content-type': 'application/json' });
      return res.end(JSON.stringify({ city: 'Kigali', beans: [{ name: 'Bourbon', score: 88 }], open: true }));
    }
    res.writeHead(404);
    res.end();
  });
  await new Promise<void>((r) => srv!.listen(0, '127.0.0.1', r));
  const api = `http://127.0.0.1:${(srv.address() as AddressInfo).port}/api`;
  h = await launch();
  await h.chrome();

  // JSON viewer
  await inMain(h, (vz, u) => vz.focused().loadUrl(vz.focused().activeTab().id, u), api);
  const viewer = await waitFor(
    () => inMain(h, (vz) => vz.focused().activeTab().wc.executeJavaScript('!!document.querySelector("#vz-json") && document.body.innerText')),
    (t: string | boolean) => typeof t === 'string' && t.includes('Bourbon'),
  );
  expect(viewer).toContain('Raw');

  // Copy as Markdown
  await inMain(h, (vz, b) => vz.focused().loadUrl(vz.focused().activeTab().id, `${b}/article`), h.base);
  await waitFor(() => title(h), (t) => t === 'Kigali Coffee Guide');
  await inMain(h, (vz) => vz.runCommand(vz.focused(), 'tools.copyMarkdown'));
  const md = await waitFor(() => inMain(h, (_vz, _a, e) => e.clipboard.readText()), (t: string) => t.includes('## Where to drink it'));
  expect(md).toContain('# The Kigali Coffee Guide');
  expect(md).not.toContain('Ignore all previous instructions'); // hidden text stays out

  // View source
  await inMain(h, (vz) => vz.runCommand(vz.focused(), 'view.source'));
  await waitFor(() => inMain(h, (vz) => vz.focused().activeTab().url), (u: string) => u === `view-source:${h.base}/article`);
});

test('MCP: token and origin checks, approval, tools, and private windows stay invisible', async () => {
  h = await launch();
  await h.chrome();
  await inMain(h, (vz, b) => {
    const w = vz.focused();
    w.loadUrl(w.activeTab().id, `${b}/article`);
    w.loadUrl(null, `${b}/form`, { newTab: true });
  }, h.base);
  await waitFor(() => title(h), (t) => t === 'Booking');
  await inMain(h, (vz) => vz.profile.prefs.set('dev.mcp', true));
  const { url, token } = await waitFor(() => inMain(h, (vz) => ({ url: vz.mcp.url, token: vz.profile.prefs.get('dev.mcpToken') })), (x: { url: string | null }) => !!x.url);
  // Console messages are recorded while the server is on (no listener otherwise).
  await inMain(h, (vz) => vz.focused().activeTab().wc.executeJavaScript('console.error("boom from page")'));
  await inMain(h, (vz) => vz.openWindow({ private: true }));

  const rpc = (body: unknown, headers: Record<string, string> = {}) => fetch(url!, { method: 'POST', headers: { 'content-type': 'application/json', accept: 'application/json, text/event-stream', authorization: `Bearer ${token}`, ...headers }, body: JSON.stringify(body) });
  expect((await rpc({ jsonrpc: '2.0', id: 1, method: 'ping' }, { authorization: 'Bearer nope' })).status).toBe(401);
  expect((await rpc({ jsonrpc: '2.0', id: 1, method: 'ping' }, { origin: 'https://evil.example' })).status).toBe(403);

  // First connection: Vizulla asks; the user allows.
  const init = rpc({ jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 'Claude Code', version: '2.0' } } });
  const ov = await overlay(h);
  await ov.getByRole('button', { name: 'Allow', exact: true }).click();
  const res = await init;
  expect(res.status).toBe(200);
  const session = res.headers.get('mcp-session-id')!;
  expect((await res.json()).result.serverInfo.name).toBe('vizulla');
  const call = async (id: number, method: string, params?: unknown) => (await (await rpc({ jsonrpc: '2.0', id, method, params }, { 'mcp-session-id': session })).json()).result;

  expect((await call(2, 'tools/list')).tools.map((t: { name: string }) => t.name)).toEqual(['list_tabs', 'open_url', 'read_page', 'screenshot', 'console_logs']);
  const tabs = JSON.parse((await call(3, 'tools/call', { name: 'list_tabs', arguments: {} })).content[0].text);
  expect(tabs).toHaveLength(1); // the private window isn't listed
  expect(tabs[0].tabs.map((t: { title: string }) => t.title)).toEqual(['Kigali Coffee Guide', 'Booking']);
  const article = tabs[0].tabs[0].id;
  expect((await call(4, 'tools/call', { name: 'read_page', arguments: { tabId: article } })).content[0].text).toContain('Rwanda grows Arabica');
  const shot = await call(5, 'tools/call', { name: 'screenshot', arguments: {} });
  expect(shot.content[0]).toMatchObject({ type: 'image', mimeType: 'image/png' });
  const logs = JSON.parse((await call(6, 'tools/call', { name: 'console_logs', arguments: { level: 'error' } })).content[0].text);
  expect(logs.map((l: { message: string }) => l.message)).toContain('boom from page');
  expect(await inMain(h, (vz) => vz.profile.prefs.get('dev.mcpClients'))).toEqual(['Claude Code']);

  // Turning it off closes the port.
  await inMain(h, (vz) => vz.profile.prefs.set('dev.mcp', false));
  await expect.poll(() => fetch(url!, { method: 'POST' }).then(() => 'open', () => 'closed')).toBe('closed');
});
