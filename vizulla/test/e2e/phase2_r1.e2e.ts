// Phase 2 (G2) checks: vertical tabs + Spaces, Command Bar, assistant with
// citations on pages and PDFs, the Gateway + disclosure, AI off, archive, reader.
import { expect, test, type Page } from '@playwright/test';
import { execFileSync, spawn, type ChildProcess } from 'node:child_process';
import { createServer } from 'node:net';
import { inMain, launch, ROOT, waitFor, type Harness } from './harness';

let h: Harness;

const freePort = () => new Promise<number>((resolve) => {
  const s = createServer().listen(0, '127.0.0.1', () => {
    const p = (s.address() as { port: number }).port;
    s.close(() => resolve(p));
  });
});
test.afterEach(async () => h?.close());

const load = (h: Harness, path: string) => inMain(h, (vz, url) => vz.focused().loadUrl(vz.focused().activeTab().id, url), `${h.base}${path}`);
const waitTitle = (h: Harness, title: string) => waitFor(() => inMain(h, (vz) => vz.focused().activeTab()?.title), (t) => t === title);
const overlay = async (h: Harness): Promise<Page> => (await waitFor(async () => h.app.windows().find((w) => w.url().startsWith('vizulla://overlay')), (p) => !!p))!;
const assistantState = (chrome: Page) => chrome.evaluate(() => (window as any).vz.call('Assistant', 'getState'));
const lastAnswer = async (chrome: Page) => {
  const s = await waitFor(() => assistantState(chrome), (s: any) => !s.busy && s.messages.at(-1)?.role === 'assistant' && s.messages.at(-1).status !== 'streaming', 20_000);
  return s.messages.at(-1);
};

test('Spaces: switching hides tabs, keeps each Space\'s active tab, cycling stays inside the Space', async () => {
  h = await launch();
  const chrome = await h.chrome();
  await load(h, '/');
  await waitTitle(h, 'Vizulla test home');
  const r = await inMain(h, (vz, base) => {
    const w = vz.focused();
    const home = w.model.activeSpaceId;
    w.createTab({ url: `${base}/article`, activate: true });
    const work = vz.profile.spaces.create({ name: 'Work', color: 'teal', icon: 'briefcase' });
    w.switchSpace(work.id);
    w.loadUrl(w.activeTab().id, `${base}/form`);
    const workTab = w.activeTab().id;
    w.switchSpace(home);
    const homeActive = w.activeTab().url;
    const visibleHome = w.model.visible().length;
    w.model.cycle(1);
    w.model.cycle(1);
    const stayed = w.model.activeSpaceId === home;
    w.switchSpace(work.id);
    return { homeActive, visibleHome, stayed, workActive: w.activeTab().id === workTab, spaces: vz.profile.spaces.list().length };
  }, h.base);
  expect(r).toMatchObject({ visibleHome: 2, stayed: true, workActive: true, spaces: 2 });
  expect(r.homeActive).toContain('/article');
  await expect(chrome.locator('vz-sidebar')).toContainText('Work');
  await chrome.screenshot({ path: 'test-results/phase2-spaces.png' });
});

test('Command Bar: typed URL navigates, ">" lists commands, nothing reaches AI', async () => {
  h = await launch();
  await h.chrome();
  await inMain(h, (vz) => vz.runCommand(vz.focused(), 'nav.focusAddress'));
  const ov = await overlay(h);
  const input = ov.locator('vz-overlay input');
  await expect(input).toBeVisible();
  await input.fill('> new sp');
  await expect(ov.locator('vz-overlay .row').first()).toContainText('New Space');
  await input.fill(`${h.base.replace('http://', '')}/article`);
  await expect(ov.locator('vz-overlay .row').first()).toContainText('/article');
  await ov.screenshot({ path: 'test-results/phase2-commandbar.png' });
  await input.press('Enter');
  await waitTitle(h, 'Kigali Coffee Guide');
  const ai = await inMain(h, (vz) => vz.profile.privacy.summary(1).ai.length);
  expect(ai).toBe(0);
});

test('Assistant on device: answers with valid citations, ignores hidden injected text, reveals the passage', async () => {
  h = await launch();
  const chrome = await h.chrome();
  await load(h, '/article');
  await waitTitle(h, 'Kigali Coffee Guide');
  await inMain(h, (vz) => vz.focused().setPanel('assistant'));
  await expect(chrome.locator('vz-assistant')).toBeVisible();
  await chrome.evaluate(() => (window as any).vz.call('Assistant', 'ask', 'How much does a cappuccino cost?'));
  const msg = await lastAnswer(chrome);
  expect(msg.status).toBe('done');
  expect(msg.text).toContain('2,000 Rwandan francs');
  expect(msg.citations.length).toBeGreaterThan(0);
  expect(msg.location).toBe('on-device');
  expect(msg.sourcing).toBe('sourced');
  // The hidden "ignore all previous instructions" paragraph is never extracted.
  const ctx = await inMain(h, async (vz) => {
    const svc = vz.__services.assistant;
    const r = await svc.extract(vz.focused().activeTab());
    return r.chunks.map((c: { text: string }) => c.text).join('\n');
  });
  expect(ctx).not.toContain('Ignore all previous instructions');
  const found = await chrome.evaluate((m) => (window as any).vz.call('Assistant', 'revealCitation', m.id, m.citations[0].id), msg);
  expect(found).toBe(true);
  await expect(chrome.locator('vz-assistant')).toContainText('2,000');
  await chrome.screenshot({ path: 'test-results/phase2-assistant.png' });
  // The privacy log records where it ran, not what was said.
  const log = await inMain(h, (vz) => vz.profile.privacy.summary(1).ai[0]);
  expect(log).toMatchObject({ location: 'on-device', feature: 'assistant.ask', ok: true });
  expect(JSON.stringify(log)).not.toContain('cappuccino');
});

test('Cloud through the Gateway: AI-05 disclosure in browser UI, cloud badge, dashboard entry', async () => {
  // Build once and run the binary itself: `go run` leaves the real server orphaned on kill.
  execFileSync('go', ['build', '-o', `${ROOT}/.cache/bin/vz-gateway`, './cmd/gateway'], { cwd: `${ROOT}/cloud` });
  const port = await freePort();
  const gwUrl = `http://127.0.0.1:${port}`;
  const gw: ChildProcess = spawn(`${ROOT}/.cache/bin/vz-gateway`, [], { env: { ...process.env, ADDR: `127.0.0.1:${port}`, VZ_REGION: 'test' } });
  try {
    await waitFor(() => fetch(`${gwUrl}/healthz`).then((r) => r.ok, () => false), (ok) => ok, 30_000);
    h = await launch();
    const chrome = await h.chrome();
    await inMain(h, (vz, url) => {
      vz.profile.prefs.set('ai.gatewayUrl', url);
      vz.profile.prefs.set('ai.mode', 'cloud');
    }, gwUrl);
    await load(h, '/article');
    await waitTitle(h, 'Kigali Coffee Guide');
    await inMain(h, (vz) => vz.focused().setPanel('assistant'));
    void chrome.evaluate(() => (window as any).vz.call('Assistant', 'summarize', 'tldr'));
    const ov = await overlay(h);
    await expect(ov.locator('vz-overlay .dlg')).toContainText('Vizulla Cloud');
    await ov.screenshot({ path: 'test-results/phase2-disclosure.png' });
    await ov.locator('vz-overlay .btn.primary').click();
    const msg = await lastAnswer(chrome);
    expect(msg.location).toBe('cloud');
    expect(msg.text).toMatch(/\[c\d+\]/);
    expect(msg.citations.length).toBe(1);
    const log = await inMain(h, (vz) => vz.profile.privacy.summary(1).ai[0]);
    expect(log).toMatchObject({ location: 'cloud', provider: 'Vizulla Cloud' });
    // Remembered: the second request on the same site doesn't ask again.
    await chrome.evaluate(() => (window as any).vz.call('Assistant', 'ask', 'Where can I drink coffee?'));
    const second = await lastAnswer(chrome);
    expect(`${second.status} ${second.error ?? ''}`, h.logs.join('')).toBe('done ');
  } finally {
    gw.kill();
  }
});

test('AI off: nothing runs, no request is made (AI-09)', async () => {
  h = await launch();
  const chrome = await h.chrome();
  await inMain(h, (vz) => vz.profile.prefs.set('ai.mode', 'off'));
  await load(h, '/article');
  await waitTitle(h, 'Kigali Coffee Guide');
  await chrome.evaluate(() => (window as any).vz.call('Assistant', 'ask', 'price?'));
  const s = await assistantState(chrome);
  expect(s.location).toBe('off');
  expect(s.messages.at(-1).status).toBe('error');
  expect(await inMain(h, (vz) => vz.profile.privacy.summary(1).ai.length)).toBe(0);
});

test('PDF: summary cites passages with page numbers (PA-04)', async () => {
  h = await launch();
  const chrome = await h.chrome();
  await load(h, '/sample.pdf');
  await waitFor(() => inMain(h, (vz) => vz.focused().activeTab().isPdf), (v) => v === true, 15_000);
  await chrome.evaluate(() => (window as any).vz.call('Assistant', 'ask', 'How much does a moto ride cost?'));
  const msg = await lastAnswer(chrome);
  expect(msg.text).toContain('500 Rwandan francs');
  expect(msg.citations[0].page).toBe(2);
});

test('auto-archive moves idle tabs to the archive with undo; restore brings history back (TAB-04)', async () => {
  h = await launch();
  await h.chrome();
  await load(h, '/');
  await waitTitle(h, 'Vizulla test home');
  const r = await inMain(h, async (vz, base) => {
    const w = vz.focused();
    const old = w.activeTab();
    w.createTab({ url: `${base}/article`, activate: true });
    w.model.get(old.id).lastActive = Date.now() - 48 * 3600_000;
    const n = w.autoArchive();
    const archived = vz.profile.spaces.listArchive();
    w.restoreArchived(archived[0].id);
    return { n, archivedUrl: archived[0].url, tabsAfter: w.model.visible().length, toast: w.state().toasts[0]?.text };
  }, h.base);
  expect(r.n).toBe(1);
  expect(r.archivedUrl).toBe(`${h.base}/`);
  expect(r.tabsAfter).toBe(2);
  expect(r.toast).toMatch(/Archived 1/);
});

test('Reader view renders the article and returns with Back', async () => {
  h = await launch();
  await h.chrome();
  await load(h, '/article');
  await waitTitle(h, 'Kigali Coffee Guide');
  await inMain(h, (vz) => vz.runCommand(vz.focused(), 'view.reader'));
  const reader = await waitFor(async () => h.app.windows().find((w) => w.url().startsWith('vizulla://reader')), (p) => !!p);
  await expect(reader!.locator('vz-reader article')).toContainText('Question Coffee in Gishushu');
  await expect(reader!.locator('vz-reader article')).not.toContainText('Ignore all previous');
});
