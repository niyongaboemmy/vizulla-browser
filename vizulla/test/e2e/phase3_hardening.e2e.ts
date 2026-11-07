// Phase 3 (G3) checks runnable on a dev machine: accessibility (WCAG 2.2 AA via
// axe-core), performance budgets, Electron security invariants, privacy of a
// fresh profile, and localization coverage.
import { expect, test, type Page } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { inMain, launch, waitFor, type Harness } from './harness';

let h: Harness;
test.afterEach(async () => h?.close());
const AXE = readFileSync(require.resolve('axe-core/axe.min.js'), 'utf8');

async function axe(page: Page): Promise<{ id: string; impact: string; nodes: string[] }[]> {
  await page.evaluate(AXE);
  const r = await page.evaluate(async () => {
    const res = await (window as any).axe.run(document, { runOnly: { type: 'tag', values: ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa'] } });
    return res.violations.map((v: any) => ({ id: v.id, impact: v.impact, nodes: v.nodes.slice(0, 3).map((n: any) => `${n.target.join(' ')} :: ${n.failureSummary}`) }));
  });
  return r;
}

const page = async (h: Harness, prefix: string) => (await waitFor(async () => h.app.windows().find((w) => w.url().startsWith(prefix)), (p) => !!p))!;

test('accessibility: shell, overlay, and internal pages have no WCAG AA violations (P3-UX-01)', async () => {
  h = await launch();
  const chrome = await h.chrome();
  await inMain(h, (vz, base) => {
    const w = vz.focused();
    w.loadUrl(w.activeTab().id, `${base}/article`);
    w.setPanel('assistant');
  }, h.base);
  await chrome.waitForTimeout(800);
  const results: Record<string, unknown> = { chrome: await axe(chrome) };
  await inMain(h, (vz) => vz.focused().setPanel('notes'));
  await chrome.waitForTimeout(300);
  results.notesPanel = await axe(chrome);
  for (const url of ['vizulla://settings', 'vizulla://privacy', 'vizulla://history', 'vizulla://newtab', 'vizulla://archive', 'vizulla://downloads', 'vizulla://about', 'vizulla://flags', 'vizulla://onboarding', 'vizulla://memory']) {
    await inMain(h, (vz, u) => vz.focused().loadUrl(null, u, { newTab: true }), url);
    const p = await page(h, url);
    await p.waitForLoadState('load');
    await p.waitForTimeout(400);
    results[url] = await axe(p);
  }
  await inMain(h, (vz) => vz.runCommand(vz.focused(), 'nav.commandBar'));
  const ov = await page(h, 'vizulla://overlay');
  await ov.waitForTimeout(300);
  results.overlay = await axe(ov);
  const bad = Object.entries(results).filter(([, v]) => (v as unknown[]).length);
  expect(bad, JSON.stringify(bad, null, 1)).toEqual([]);
});

test('keyboard: Command Bar opens, navigates, and closes without a mouse', async () => {
  h = await launch();
  await h.chrome();
  await inMain(h, (vz) => vz.runCommand(vz.focused(), 'nav.commandBar'));
  const ov = await page(h, 'vizulla://overlay');
  await ov.keyboard.type('> settings');
  await expect(ov.locator('vz-overlay .row.sel')).toContainText('Settings');
  await ov.keyboard.press('Enter');
  await page(h, 'vizulla://settings');
  expect(await inMain(h, (vz) => vz.focused().overlay.isOpen)).toBe(false);
});

test('performance budgets on this machine (PERF-01/02 smoke; PERF-05 is a unit test)', async () => {
  const t0 = Date.now();
  h = await launch();
  const chrome = await h.chrome();
  await chrome.locator('vz-sidebar').waitFor();
  const startup = Date.now() - t0;
  await chrome.waitForTimeout(1500);
  const metrics = await inMain(h, (_vz, _a, electron) => electron.app.getAppMetrics().map((m: any) => ({ type: m.type, kb: m.memory.workingSetSize })));
  const totalMb = metrics.reduce((n: number, m: { kb: number }) => n + m.kb, 0) / 1024;
  console.log(`startup ${startup} ms, idle memory ${totalMb.toFixed(0)} MB across ${metrics.length} processes`);
  expect(startup).toBeLessThan(5000); // launch + first paint incl. Playwright overhead (PERF-01 target 1.2 s is for RD-1 official builds)
  expect(totalMb).toBeLessThan(900);
});

test('security invariants: sandboxed renderers, no node, CSP on internal pages, no native popups', async () => {
  h = await launch();
  await h.chrome();
  await inMain(h, (vz, base) => vz.focused().loadUrl(vz.focused().activeTab().id, `${base}/`), h.base);
  await waitFor(() => inMain(h, (vz) => vz.focused().activeTab().title), (t) => t === 'Vizulla test home');
  const prefs = await inMain(h, (_vz, _a, electron) =>
    electron.webContents.getAllWebContents().map((wc: any) => {
      const p = wc.getLastWebPreferences?.() ?? {};
      return { url: wc.getURL(), sandbox: p.sandbox, contextIsolation: p.contextIsolation, nodeIntegration: p.nodeIntegration };
    }),
  );
  for (const p of prefs) {
    expect(p.sandbox, p.url).toBe(true);
    expect(p.contextIsolation, p.url).toBe(true);
    expect(p.nodeIntegration, p.url).toBeFalsy();
  }
  const settings = await (async () => {
    await inMain(h, (vz) => vz.focused().loadUrl(null, 'vizulla://settings', { newTab: true }));
    return page(h, 'vizulla://settings');
  })();
  const csp = await settings.evaluate(async () => (await fetch(location.href)).headers.get('content-security-policy'));
  expect(csp).toContain("script-src 'self'");
  expect(csp).toContain("frame-ancestors 'none'");
  // Inline script injection is blocked by CSP on internal pages.
  const inline = await settings.evaluate(() => {
    const s = document.createElement('script');
    s.textContent = 'window.__pwned = 1';
    document.head.appendChild(s);
    return (window as any).__pwned ?? 0;
  });
  expect(inline).toBe(0);
  // window.open from a web page becomes a tab, never a native window.
  const web = await page(h, `${h.base}/`);
  await web.evaluate(() => window.open('/article', '_blank'));
  await waitFor(() => inMain(h, (vz) => vz.focused().tabs.size), (n) => n === 3);
  const natives = await inMain(h, (_vz, _a, electron) => electron.BrowserWindow.getAllWindows().length);
  expect(natives).toBe(0);
});

test('privacy: a fresh profile makes no network requests on its own (P3-SEC-05)', async () => {
  h = await launch();
  await h.chrome();
  await new Promise((r) => setTimeout(r, 2500));
  const stats = await inMain(h, (vz) => ({ ...vz.profile.pipeline.stats }));
  expect(stats.requests).toBe(0);
  const ai = await inMain(h, (vz) => vz.profile.privacy.summary(1).ai.length);
  expect(ai).toBe(0);
});

test('localization: French UI is complete and the pseudo-locale leaves no unwrapped text in the shell', async () => {
  h = await launch();
  const chrome = await h.chrome();
  await inMain(h, (vz) => vz.profile.prefs.set('appearance.locale', 'fr'));
  await expect(chrome.locator('vz-sidebar')).toContainText('Nouvel onglet');
  await inMain(h, (vz) => vz.profile.prefs.set('appearance.locale', 'pseudo'));
  await chrome.waitForTimeout(300);
  const texts: string[] = await chrome.evaluate(() => {
    const out: string[] = [];
    const walk = (root: Node) => {
      const tw = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
      let n: Node | null;
      while ((n = tw.nextNode())) {
        const s = n.textContent!.trim();
        if (s && /[a-z]{3,}/i.test(s)) out.push(s);
      }
      for (const el of (root as Element).querySelectorAll?.('*') ?? []) if ((el as Element).shadowRoot) walk((el as Element).shadowRoot!);
    };
    walk(document.querySelector('vz-shell')!.shadowRoot!);
    return out;
  });
  // User content (tab titles, Space names, URLs) is exempt; UI strings must be pseudo-wrapped.
  const unwrapped = texts.filter((s) => !s.startsWith('[') && !/Personal|Vizulla test|127\.0|newtab/i.test(s));
  expect(unwrapped).toEqual([]);
});

test('signed filter lists: a signed update is accepted and swapped in; a tampered one is rejected (P1-CLD-03)', async () => {
  const { execFileSync } = await import('node:child_process');
  const { createServer } = await import('node:http');
  const { readFileSync: read } = await import('node:fs');
  const { ROOT } = await import('./harness');
  execFileSync(process.execPath, ['tools/vz.mjs', 'build'], { cwd: ROOT }); // ships the dev public key (build wipes out/)
  execFileSync(process.execPath, ['tools/lists.mjs'], { cwd: ROOT });
  let tamper = false;
  const cdn = createServer((req, res) => {
    const blob = read(`${ROOT}/out/lists/engine.bin`);
    if (req.url === '/engine.json') return res.end(read(`${ROOT}/out/lists/engine.json`));
    if (tamper) blob[200] = blob[200]! ^ 0xff;
    res.end(blob);
  });
  await new Promise<void>((r) => cdn.listen(0, '127.0.0.1', r));
  const url = `http://127.0.0.1:${(cdn.address() as { port: number }).port}`;
  try {
    tamper = true;
    h = await launch({ env: { VZ_SHIELDS_LIST_URL: url } });
    await h.chrome();
    expect(await inMain(h, (vz) => vz.profile.shields.updateLists())).toBe('rejected-hash-mismatch');
    expect(await inMain(h, (vz) => vz.profile.shields.status(-1, '').ruleSource)).toBe('baseline');
    tamper = false;
    expect(await inMain(h, (vz) => vz.profile.shields.updateLists())).toBe('updated');
    expect(await inMain(h, (vz) => vz.profile.shields.status(-1, '').ruleSource)).toBe('signed');
    expect(await inMain(h, (vz) => vz.profile.shields.updateLists())).toBe('up-to-date');
  } finally {
    cdn.close();
  }
});
