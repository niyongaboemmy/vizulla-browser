// Phase 4 (G4) checks: sandboxed on-device runtime lifecycle, Memory end to end,
// Notes clipping, natural-language commands, E2EE sync between two profiles,
// fingerprinting protection, and cookie banner rejection.
import { expect, test, type Page } from '@playwright/test';
import { execFileSync, spawn } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { createServer } from 'node:net';
import { join } from 'node:path';
import { inMain, launch, ROOT, waitFor, type Harness } from './harness';

let h: Harness;
let h2: Harness | undefined;
test.afterEach(async () => {
  await h?.close();
  await h2?.close();
  h2 = undefined;
});

const load = (h: Harness, path: string, base = h.base) => inMain(h, (vz, url) => vz.focused().loadUrl(vz.focused().activeTab().id, url), `${base}${path}`);
const waitTitle = (h: Harness, title: string) => waitFor(() => inMain(h, (vz) => vz.focused().activeTab()?.title), (t) => t === title);
const pageOf = async (h: Harness, pred: (u: string) => boolean): Promise<Page> => (await waitFor(async () => h.app.windows().find((w) => pred(w.url())), (p) => !!p))!;
const freePort = () => new Promise<number>((r) => {
  const s = createServer().listen(0, '127.0.0.1', () => {
    const p = (s.address() as { port: number }).port;
    s.close(() => r(p));
  });
});

test('ai_runtime: answers run in a separate utility process; crash restarts and retries; idle unloads (AI-08, REL-02)', async () => {
  h = await launch({ env: { VZ_RUNTIME_IDLE_MS: '2500' } });
  const chrome = await h.chrome();
  await load(h, '/article');
  await waitTitle(h, 'Kigali Coffee Guide');
  await chrome.evaluate(() => (window as any).vz.call('Assistant', 'ask', 'Where is Question Coffee?'));
  const msg = await waitFor(() => chrome.evaluate(() => (window as any).vz.call('Assistant', 'getState')), (s: any) => s.messages.at(-1)?.status === 'done', 15_000);
  expect(msg.messages.at(-1).text).toContain('Gishushu');
  const st = await inMain(h, async (vz) => vz.__services.runtime.status());
  expect(st.running).toBe(true);
  expect(st.pid).not.toBe(process.pid);
  // Crash mid-request: the host restarts the process and retries once.
  const r = await inMain(h, async (vz) => {
    const host = vz.__services.runtime.host;
    void host.call('crash').catch(() => 0);
    const out = await vz.__services.runtime.classify('mute this tab');
    return { label: out[0].label, crashes: host.stats.crashes, starts: host.stats.starts };
  });
  expect(r.label).toBe('command');
  expect(r.starts).toBeGreaterThanOrEqual(2);
  // Idle unload.
  await waitFor(() => inMain(h, (vz) => vz.__services.runtime.host.running), (v) => v === false, 10_000);
});

test('Memory: opt-in indexing, encrypted at rest, recall in the Command Bar, deleting history deletes it (MEM-01/03/07)', async () => {
  h = await launch();
  await h.chrome();
  // Off by default: nothing is indexed.
  await load(h, '/article');
  await waitTitle(h, 'Kigali Coffee Guide');
  await new Promise((r) => setTimeout(r, 1200));
  expect(await inMain(h, (vz) => vz.__services.memory.stats.indexed)).toBe(0);
  // Indexing runs only on AC power by default; allow battery so the test doesn't depend on the charger.
  await inMain(h, (vz) => {
    vz.profile.prefs.set('memory.indexOnBattery', true);
    vz.profile.prefs.set('memory.enabled', true);
  });
  await inMain(h, (vz) => vz.focused().activeTab().wc.reload());
  await waitFor(() => inMain(h, (vz) => vz.__services.memory.stats.indexed), (n) => n >= 1, 15_000);
  // Recall through the Command Bar.
  await inMain(h, (vz) => vz.runCommand(vz.focused(), 'nav.commandBar'));
  const ov = await pageOf(h, (u) => u.startsWith('vizulla://overlay'));
  await ov.locator('vz-overlay input').fill('women-led cooperatives roasting');
  await expect(ov.locator('vz-overlay .row', { hasText: 'Kigali Coffee Guide' }).first()).toBeVisible();
  await expect(ov.locator('vz-overlay')).toContainText('From Memory');
  await ov.keyboard.press('Escape');
  // At rest: the Memory file has no page text.
  const raw = readFileSync(join(h.profile, 'Memory.db')).toString('latin1') + (() => {
    try {
      return readFileSync(join(h.profile, 'Memory.db-wal')).toString('latin1');
    } catch {
      return '';
    }
  })();
  expect(raw).not.toContain('Gishushu');
  expect(raw).not.toContain('Kigali Coffee');
  // History deletion removes the Memory item.
  await inMain(h, (vz) => vz.profile.history.clearAll());
  await waitFor(() => inMain(h, (vz) => vz.__services.memory.call('stats')), (s: any) => s.items === 0, 10_000);
});

test('Notes: clipping keeps a text-fragment link back to the passage; assistant answers go to Notes', async () => {
  h = await launch();
  const chrome = await h.chrome();
  await load(h, '/article');
  await waitTitle(h, 'Kigali Coffee Guide');
  const id = await inMain(h, (vz) => {
    const w = vz.focused();
    const tab = w.activeTab();
    return vz.__services.notes.clip(w, tab.url, tab.title, 'Inzora Rooftop Cafe sits above a bookshop in Kacyiru');
  });
  const note = await inMain(h, (vz, i) => vz.__services.notes.store.get(i), id);
  expect(note.sourceUrl).toContain('/article#:~:text=Inzora%20Rooftop%20Cafe');
  await expect(chrome.locator('vz-notes')).toContainText('Inzora Rooftop Cafe');
  await inMain(h, (vz) => vz.runCommand(vz.focused(), 'notes.fromAssistant', { text: 'Coffee costs 2,000 francs [c3]' }));
  expect(await inMain(h, (vz) => vz.__services.notes.store.list().length)).toBe(2);
});

test('NL commands: "switch to work" runs from the Command Bar; destructive ones ask first (CMD-05)', async () => {
  h = await launch();
  await h.chrome();
  await inMain(h, (vz) => vz.profile.spaces.create({ name: 'Work', color: 'teal', icon: 'briefcase' }));
  await inMain(h, (vz) => vz.runCommand(vz.focused(), 'nav.commandBar'));
  const ov = await pageOf(h, (u) => u.startsWith('vizulla://overlay'));
  const input = ov.locator('vz-overlay input');
  await input.fill('switch to work');
  await expect(ov.locator('vz-overlay .row', { hasText: 'Work' }).first()).toBeVisible();
  await ov.locator('vz-overlay .row', { hasText: 'Switch Space' }).first().click();
  await waitFor(() => inMain(h, (vz) => vz.profile.spaces.get(vz.focused().model.activeSpaceId).name), (n) => n === 'Work');
  // Destructive: "clear my history" opens a confirmation instead of running.
  await inMain(h, (vz) => vz.profile.history.addVisit('https://keep.example/', 'Keep'));
  await inMain(h, (vz) => vz.runCommand(vz.focused(), 'nav.commandBar'));
  await input.fill('clear my history');
  await ov.locator('vz-overlay .row').filter({ hasText: 'Clear history' }).first().click();
  await expect(ov.locator('vz-overlay .dlg')).toBeVisible();
  await ov.locator('vz-overlay .dlg .btn', { hasText: 'Cancel' }).click();
  expect(await inMain(h, (vz) => vz.profile.history.count())).toBe(1);
});

test('E2EE sync: two profiles converge through the Go server, which stores only ciphertext (SYN-01/02)', async () => {
  execFileSync('go', ['build', '-o', `${ROOT}/.cache/bin/vz-sync`, './cmd/syncserver'], { cwd: `${ROOT}/cloud` });
  const port = await freePort();
  const data = join(ROOT, '.cache', `sync-${port}.json`);
  const srv = spawn(`${ROOT}/.cache/bin/vz-sync`, [], { env: { ...process.env, ADDR: `127.0.0.1:${port}`, DATA: data } });
  try {
    const url = `http://127.0.0.1:${port}`;
    await waitFor(() => fetch(`${url}/healthz`).then((r) => r.ok, () => false), (ok) => ok, 20_000);
    h = await launch();
    await h.chrome();
    const settingsCall = (hh: Harness, method: string, payload?: unknown) => inMain(hh, (vz, a: any) => vz.pageHandlers.get('settings')[a.method](a.payload, { window: vz.focused() }), { method, payload });
    await inMain(h, (vz, u) => {
      vz.profile.prefs.set('sync.serverUrl', u);
      vz.profile.history.addBookmark('https://irembo.gov.rw/', 'Irembo');
      vz.profile.spaces.create({ name: 'Research', color: 'violet', icon: 'flask' });
    }, url);
    const created = await settingsCall(h, 'syncCreate');
    expect(created.enabled).toBe(true);
    expect(created.code).toMatch(/^[A-Z2-9]{6}(-[A-Z2-9]{6}){3}$/);
    h2 = await launch();
    await h2.chrome();
    await inMain(h2, (vz, u) => vz.profile.prefs.set('sync.serverUrl', u), url);
    const joined = await settingsCall(h2, 'syncJoin', created.code);
    expect(joined.error).toBeNull();
    const b = await inMain(h2, (vz) => ({ marks: vz.profile.history.bookmarks().map((x: any) => x.title), spaces: vz.profile.spaces.list().map((s: any) => s.name) }));
    expect(b.marks).toContain('Irembo');
    expect(b.spaces).toContain('Research');
    const stored = readFileSync(data, 'utf8');
    for (const secret of ['irembo', 'Irembo', 'Research', created.code]) expect(stored).not.toContain(secret);
  } finally {
    srv.kill();
  }
});

test('fingerprinting protection: canvas readouts differ across sites, stay stable within a site, and are untouched when off (SHD-03)', async () => {
  h = await launch();
  await h.chrome();
  let n = 0;
  const fp = async (base: string) => {
    const path = `/canvas?n=${++n}`; // a fresh document each time
    await load(h, path, base);
    const p = await pageOf(h, (u) => u === `${base}${path}`);
    return waitFor(() => p.evaluate(() => (window as any).__fp as string).catch(() => ''), (v) => !!v);
  };
  const port = h.base.split(':').at(-1);
  const a1 = await fp(h.base);
  const a2 = await fp(h.base);
  const b = await fp(`http://localhost:${port}`);
  expect(a1).toBe(a2);
  expect(a1).not.toBe(b);
  await inMain(h, (vz) => vz.profile.prefs.set('shields.fingerprinting', 'off'));
  const off1 = await fp(h.base);
  const off2 = await fp(`http://localhost:${port}`);
  expect(off1).toBe(off2);
});

test('cookie banners are rejected automatically (SHD-04)', async () => {
  h = await launch();
  await h.chrome();
  await load(h, '/cookies');
  await waitTitle(h, 'Cookie banner');
  const p = await pageOf(h, (u) => u.endsWith('/cookies'));
  await expect.poll(() => p.evaluate(() => (window as any).__choice ?? null).catch(() => null), { timeout: 8000 }).toBe('reject');
});
