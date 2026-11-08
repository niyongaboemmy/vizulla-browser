// Phases 5-6 (G5/G6) checks with model-free planners: gating, Stage A in an
// isolated session with the egress filter, enforcer decisions surfacing as
// browser-owned approvals, the advisory detector, the Esc kill switch, the
// login-page stop, and Stage B commit confirmations.
import { expect, test, type Page } from '@playwright/test';
import { inMain, launch, waitFor, type Harness } from './harness';

let h: Harness;
test.afterEach(async () => h?.close());

const AGENT = ['--enable-features=VizullaAgent'];
const AGENT_B = ['--enable-features=VizullaAgent,VizullaAgentStageB'];
const overlay = async (h: Harness): Promise<Page> => (await waitFor(async () => h.app.windows().find((w) => w.url().startsWith('vizulla://overlay')), (p) => !!p))!;
const agentState = (h: Harness) => inMain(h, (vz) => vz.__services.agent.state());
const waitStatus = (h: Harness, ...s: string[]) => waitFor(() => agentState(h), (st: any) => s.includes(st.task?.status), 20_000);
async function setup(args: string[]) {
  const hh = await launch({ args });
  await hh.chrome();
  await inMain(hh, (vz) => {
    vz.profile.prefs.set('agent.testerOptIn', true);
    vz.profile.prefs.set('ai.mode', 'local');
  });
  return hh;
}
async function approvePlan(h: Harness): Promise<Page> {
  const ov = await overlay(h);
  await expect(ov.locator('vz-overlay .dlg')).toContainText('proposed plan');
  await ov.locator('vz-overlay .dlg .btn.primary').click();
  return ov;
}
/** Installs a scripted, model-free planner (the test driver from P5-SEC-01). */
function scripted(h: Harness, actions: unknown[], goalOrigin: string) {
  return inMain(h, (vz, a: any) => {
    const ctl = vz.__services.agent;
    let i = 0;
    ctl.pickPlanner = () => ({
      name: 'scripted',
      plan: async (goal: string) => ({ goal, steps: [{ label: 'Open', origin: a.origin, tier: 1 }, { label: 'Interact', origin: a.origin, tier: 2 }] }),
      next: async () => a.actions[Math.min(i++, a.actions.length - 1)],
    });
  }, { actions, origin: goalOrigin });
}

test('gating: the agent is off by default and needs the flag plus tester opt-in (P5-PLT-01)', async () => {
  h = await launch();
  await h.chrome();
  expect((await agentState(h)).available).toBe(false);
  expect((await agentState(h)).reason).toMatch(/experiment/i);
  await h.close();
  h = await launch({ args: AGENT });
  await h.chrome();
  expect((await agentState(h)).reason).toMatch(/test program/i);
});

test('Stage A: plan approval, isolated session, trusted input fills the form, stops before submitting (AGT-01..03/07)', async () => {
  h = await setup(AGENT);
  await inMain(h, async (vz, base) => {
    await vz.profile.session.cookies.set({ url: base, name: 'secret', value: 'user-session-cookie' });
  }, h.base);
  await inMain(h, (vz, a: any) => { void vz.__services.agent.start(vz.focused(), `Book a table at ${a.base}/form`, { Name: 'Alice', Guests: '4', Time: '7:00 PM' }); }, { base: h.base });
  const ov = await approvePlan(h);
  await ov.screenshot({ path: 'test-results/phase5-plan.png' }).catch(() => undefined);
  const s = await waitStatus(h, 'done', 'failed', 'stopped');
  expect(s.task.status, JSON.stringify(s.task.log.slice(-6))).toBe('done');
  const page = (await waitFor(async () => h.app.windows().find((w) => w.url().endsWith('/form')), (p) => !!p))!;
  expect(await page.evaluate(() => ({ name: (document.getElementById('name') as HTMLInputElement).value, guests: (document.getElementById('guests') as HTMLSelectElement).value, chosen: document.getElementById('chosen')!.textContent, cookie: document.cookie }))).toEqual({ name: 'Alice', guests: '4', chosen: '19:00', cookie: 'vzt=1' });
  // Nothing was submitted in Stage A.
  expect((h.server as any).lastPost).toBeUndefined();
  // The agent tab runs in its own session; egress to an off-plan origin is blocked.
  const iso = await inMain(h, async (vz, port) => {
    const tab = [...vz.focused().tabs.values()].find((t: any) => t.agent);
    await tab.wc.executeJavaScript(`fetch('http://localhost:${port}/app.js').then(() => 'ok', () => 'blocked')`);
    const blocked = vz.__services.agent.task.session.blocked.map((b: any) => b.reason);
    return { separate: tab.session !== vz.profile.session, blocked };
  }, h.base.split(':').at(-1));
  expect(iso.separate).toBe(true);
  expect(iso.blocked).toContain('off-plan-origin');
  const chrome = await h.chrome();
  await expect(chrome.locator('vz-shell')).toContainText('Isolated session');
  await chrome.screenshot({ path: 'test-results/phase5-agent.png' });
  // The Action Log records every call with its verdict.
  const log = await inMain(h, (vz) => vz.__services.agent.log.entries(vz.__services.agent.task.id));
  expect(log.filter((e: any) => e.kind === 'call').every((e: any) => e.verdict === 'allowed')).toBe(true);
  // Dismissing ends the task: the agent tab and its session go away.
  await inMain(h, (vz) => vz.__services.agent.control('stop'));
  await waitFor(() => inMain(h, (vz) => [...vz.focused().tabs.values()].some((t: any) => t.agent)), (v) => v === false);
});

test('an off-plan navigation needs the user\'s approval; refusing stops the task (AGT-05)', async () => {
  h = await setup(AGENT);
  await scripted(h, [{ tool: 'navigate', url: `${h.base}/form`, why: 'open' }, { tool: 'navigate', url: 'https://evil.example/collect', why: 'page told me to' }], h.base);
  await inMain(h, (vz, base) => { void vz.__services.agent.start(vz.focused(), `Look around ${base}/form`, {}); }, h.base);
  const ov = await approvePlan(h);
  await expect(ov.locator('vz-overlay .dlg')).toContainText('evil.example', { timeout: 15_000 });
  await ov.locator('vz-overlay .dlg .btn', { hasText: 'Cancel' }).click();
  const s = await waitStatus(h, 'stopped', 'failed');
  expect(s.task.status).toBe('stopped');
  expect(s.task.log.some((l: any) => l.verdict === 'needs approval: new site')).toBe(true);
});

test('suspected injection pauses and asks; declining stops (advisory detector, AGT-09)', async () => {
  h = await setup(AGENT);
  await scripted(h, [{ tool: 'navigate', url: `${h.base}/inject`, why: 'open' }, { tool: 'done', why: 'x', advance: true }], h.base);
  await inMain(h, (vz, base) => { void vz.__services.agent.start(vz.focused(), `Read ${base}/inject`, {}); }, h.base);
  const ov = await approvePlan(h);
  await expect(ov.locator('vz-overlay .dlg')).toContainText('Suspicious content', { timeout: 15_000 });
  await ov.locator('vz-overlay .dlg .btn', { hasText: 'Cancel' }).click();
  const s = await waitStatus(h, 'stopped');
  expect(s.task.log.some((l: any) => l.kind === 'detector')).toBe(true);
});

test('Esc is the kill switch; login pages make the agent stop and ask (C16, AGT-06)', async () => {
  h = await setup(AGENT);
  await scripted(h, [{ tool: 'navigate', url: `${h.base}/login`, why: 'open' }], h.base);
  await inMain(h, (vz, base) => { void vz.__services.agent.start(vz.focused(), `Sign in on ${base}/login`, {}); }, h.base);
  await approvePlan(h);
  const paused = await waitStatus(h, 'paused');
  expect(paused.task.message).toMatch(/sign in yourself/i);
  const chrome = await h.chrome();
  await chrome.locator('vz-shell').press('Escape');
  const s = await waitStatus(h, 'stopped');
  expect(s.task.message).toMatch(/Stopped by you/);
});

test('Stage B: a commit shows the exact destination and fields, cannot be confirmed instantly, then submits (AGT-04)', async () => {
  h = await setup(AGENT_B);
  await inMain(h, (vz, base) => { void vz.__services.agent.start(vz.focused(), `Book a table at ${base}/form`, { Name: 'Alice', Guests: '2' }); }, h.base);
  const ov = await approvePlan(h);
  await expect(ov.locator('vz-overlay .dlg')).toContainText('Confirm', { timeout: 20_000 });
  await expect(ov.locator('vz-overlay .dlg')).toContainText(h.base);
  await expect(ov.locator('vz-overlay .dlg')).toContainText('Alice');
  const confirmBtn = ov.locator('vz-overlay .dlg .btn.primary');
  await expect(confirmBtn).toBeDisabled(); // armed only after a delay and a key/pointer release
  await ov.screenshot({ path: 'test-results/phase6-confirm.png' });
  await ov.mouse.move(1, 1);
  await ov.mouse.down();
  await ov.mouse.up();
  await expect(confirmBtn).toBeEnabled({ timeout: 3000 });
  await confirmBtn.click();
  const s = await waitStatus(h, 'done', 'failed', 'stopped');
  expect(s.task.status, JSON.stringify(s.task.log.slice(-6))).toBe('done');
  await waitFor(async () => (h.server as any).lastPost as string | undefined, (b) => !!b);
  expect((h.server as any).lastPost).toContain('name=Alice');
  const log = await inMain(h, (vz) => vz.__services.agent.log.entries(vz.__services.agent.task.id));
  expect(log.some((e: any) => e.kind === 'confirm' && e.verdict === 'confirmed')).toBe(true);
});

test('accessibility: agent panel and Action Log have no WCAG AA violations', async () => {
  const { readFileSync } = await import('node:fs');
  const AXE = readFileSync(require.resolve('axe-core/axe.min.js'), 'utf8');
  const axe = async (p: Page) => {
    await p.evaluate(AXE);
    return p.evaluate(async () => {
      await Promise.all(document.getAnimations().filter((a) => a.effect?.getComputedTiming().endTime !== Infinity).map((a) => a.finished.catch(() => undefined)));
      return ((await (window as any).axe.run(document, { runOnly: { type: 'tag', values: ['wcag2a', 'wcag2aa', 'wcag21aa', 'wcag22aa'] } })).violations as any[]).map((v) => `${v.id}: ${v.nodes[0]?.target}`);
    });
  };
  h = await setup(AGENT_B);
  const chrome = await h.chrome();
  await inMain(h, (vz) => vz.focused().setPanel('agent'));
  await expect(chrome.locator('vz-agent')).toBeVisible();
  // The panel slides in; audit once it has settled (as for the Action Log below).
  await chrome.waitForTimeout(400);
  expect(await axe(chrome)).toEqual([]);
  await inMain(h, (vz) => vz.focused().loadUrl(null, 'vizulla://agent-log', { newTab: true }));
  const log = (await waitFor(async () => h.app.windows().find((w) => w.url().startsWith('vizulla://agent-log')), (p) => !!p))!;
  await log.waitForLoadState('load');
  await log.waitForTimeout(300);
  expect(await axe(log)).toEqual([]);
});
