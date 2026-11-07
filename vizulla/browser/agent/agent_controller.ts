// AgentController (Phases 5-6). The model proposes, the browser decides:
// every action passes the deterministic Policy Enforcer, sensitive ones need a
// browser-owned confirmation, and the user can pause, take over, or stop (Esc)
// at any time. Stage A runs in an isolated session; Stage B adds personal-data
// handles, commit confirmations, egress matching, and per-origin session grants.
import { randomUUID } from 'node:crypto';
import { join } from 'node:path';
import type { BrowserApp } from '../browser_app';
import type { BrowserWindowController } from '../ui/browser_window';
import type { WebTab } from '../tabs/web_tab';
import type { AssistantService } from '../ai/assistant_service';
import { emitTo, type CallContext } from '../ui/ipc_router';
import { AgentInterface, type AgentPanelState, type AgentTaskView } from '@vz/common/mojom/agent';
import { Actuator, type Snapshot } from './actuator';
import { AgentSession } from './agent_session';
import { ActionLog } from './action_log';
import { HeuristicPlanner, LlmPlanner, type Planner, type ProposedAction } from './planner';
import { PROFILE_FIELDS, Tier, validatePlan, type ApprovedPlan, type ProfileField } from './plan';
import { check, tierOf, type ExecutionState, type ToolCall, type Verdict } from './policy_enforcer';
import { detectInjection } from './injection_detector';
import { scanEgress, type PrivateValue } from './egress';
import { CryptoBox } from '../storage/crypto_box';
import { readJson, writeJsonAtomic } from '../storage/json_store';
import { searchUrl } from '@vz/common/url';
import { t } from '@vz/common/i18n';
import { kVizullaAgent, kVizullaAgentStageB } from '../vizulla_features';
import type { AgentBarState } from '@vz/common/types';

const MAX_ACTIONS = 40;
const PLAN_TTL_MS = 30 * 60_000;
/** SEC-09: the agent turns itself off on builds this far behind (no fresher security signal). */
const STALE_BUILD_DAYS = 28;

interface Task {
  id: string;
  goal: string;
  window: BrowserWindowController;
  status: AgentTaskView['status'];
  plan: ApprovedPlan | null;
  stepIndex: number;
  session: AgentSession | null;
  tab: WebTab | null;
  actuator: Actuator | null;
  planner: Planner;
  abort: AbortController;
  paused: boolean;
  resume: (() => void) | null;
  message: string | null;
  acknowledgedInjection: Set<string>;
  seen: Set<string>;
  history: { tool: ProposedAction['tool']; nodeId?: number; ok: boolean; why: string }[];
}

export class AgentController {
  readonly log: ActionLog;
  private task: Task | null = null;
  private readonly profileBox: CryptoBox;

  constructor(private readonly app: BrowserApp, private readonly assistant: AssistantService) {
    const p = app.profile;
    this.log = p.register('agentLog', new ActionLog(join(p.dir, 'AgentLog.db')), () => this.log.close());
    this.log.purge(30);
    this.profileBox = new CryptoBox(p.keys.getOrCreateKey('agent-profile'));
    this.bind();
    app.hooks.agentBarState = (w) => this.barState(w);
    app.hooks.tabInput.push((w, tab, e, input) => {
      // Esc is the kill switch (C16) while the agent drives this tab.
      if (this.task && this.task.tab === tab && input.type === 'keyDown' && input.key === 'Escape' && this.active()) {
        e.preventDefault();
        void this.stop('stopped', t('agent_stopped_by_user'));
        return true;
      }
      void w;
      return false;
    });
    app.commandHandlers.set('agent.start', (w, args) => {
      w.setPanel('agent');
      if (args?.goal) void this.start(w, String(args.goal), {});
    });
    app.commandHandlers.set('agent.stop', () => void this.stop('stopped', t('agent_stopped_by_user')));
    for (const what of ['pause', 'resume', 'takeover', 'stop'] as const) app.commandHandlers.set(`agent.control.${what}`, () => this.control(what));
    app.commandHandlers.set('page.agentLog', (w) => w.loadUrl(null, 'vizulla://agent-log', { newTab: true }));
    this.definePages();
  }

  // ---------------------------------------------------------------- gating

  availability(): { ok: boolean; reason: string | null } {
    const p = this.app.profile;
    if (!p.features.isEnabled(kVizullaAgent)) return { ok: false, reason: t('agent_off_flag') };
    if (!p.prefs.get('agent.testerOptIn')) return { ok: false, reason: t('agent_off_optin') };
    if (p.prefs.get('ai.mode') === 'off') return { ok: false, reason: t('agent_off_ai') };
    const built = Number(process.env.VZ_BUILD_TIME ?? BUILD_TIME);
    if (built && Date.now() - built > STALE_BUILD_DAYS * 86_400_000) return { ok: false, reason: t('agent_off_stale') };
    return { ok: true, reason: null };
  }

  get stageB(): boolean {
    return this.app.profile.features.isEnabled(kVizullaAgentStageB);
  }

  private active(): boolean {
    return !!this.task && ['planning', 'awaiting-approval', 'running', 'paused', 'awaiting-confirmation'].includes(this.task.status);
  }

  // ---------------------------------------------------------------- agent profile (Stage B personal data)

  private get profilePath(): string {
    return join(this.app.profile.dir, 'AgentProfile.json');
  }

  personalData(): Partial<Record<ProfileField, string>> {
    const sealed = readJson<{ v?: string }>(this.profilePath, {});
    if (!sealed.v) return {};
    try {
      return JSON.parse(this.profileBox.openString(sealed.v, 'agent-profile'));
    } catch {
      return {};
    }
  }

  setPersonalData(d: Partial<Record<ProfileField, string>>): void {
    const clean = Object.fromEntries(Object.entries(d).filter(([k, v]) => (PROFILE_FIELDS as readonly string[]).includes(k) && typeof v === 'string' && v.length <= 200));
    writeJsonAtomic(this.profilePath, { v: this.profileBox.sealString(JSON.stringify(clean), 'agent-profile') });
  }

  private privateValues(plan: ApprovedPlan | null): PrivateValue[] {
    const data = this.personalData();
    const out: PrivateValue[] = [];
    for (const [field, value] of Object.entries(data) as [ProfileField, string][]) {
      if (!value || value.length < 4) continue;
      // A profile value may go only to origins of steps that declared that field.
      const allowed = plan?.steps.filter((s) => s.dataFields.includes(field)).map((s) => s.origin) ?? [];
      out.push({ value, allowedOrigins: allowed, label: field });
    }
    const vault = this.app.pages.vault;
    for (const l of vault?.list().slice(0, 200) ?? []) if (l.username.length >= 4) out.push({ value: l.username, allowedOrigins: [l.origin], label: 'saved login' });
    return out;
  }

  // ---------------------------------------------------------------- lifecycle

  async start(w: BrowserWindowController, goal: string, userValues: Record<string, string>): Promise<void> {
    const avail = this.availability();
    if (!avail.ok) {
      w.toast(avail.reason!, undefined, 4000);
      return;
    }
    if (this.active()) await this.stop('stopped', t('agent_replaced'));
    const abort = new AbortController();
    const values = Object.fromEntries(Object.entries(userValues).filter(([, v]) => v.trim()).map(([k, v], i) => [`v${i + 1}:${k}`, v]));
    const task: Task = {
      id: randomUUID(), goal, window: w, status: 'planning', plan: null, stepIndex: 0, session: null, tab: null, actuator: null,
      planner: this.pickPlanner(abort.signal), abort, paused: false, resume: null, message: null, acknowledgedInjection: new Set(), seen: new Set(), history: [],
    };
    this.task = task;
    this.log.startTask(task.id, goal, 'isolated');
    this.log.add(task.id, 'plan', `Planner: ${task.planner.name}`);
    this.push();
    try {
      const raw = await task.planner.plan(goal, { startUrl: w.activeTab()?.url && /^https?:/.test(w.activeTab()!.url) ? w.activeTab()!.url : null, stageB: this.stageB, userValues: values });
      const searchOrigin = new URL(searchUrl(this.app.profile.prefs.get('search.engine'), 'x')).origin;
      const candidate = validatePlan(raw, { searchOrigin, stageB: this.stageB, userValues: values });
      if (task.abort.signal.aborted) return;
      task.status = 'awaiting-approval';
      this.push();
      // Browser-owned plan approval (doc 05 §8.3). Edits change data, not a prompt.
      const r = await w.overlay.dialog<{ run: boolean; removed: number[]; values: Record<string, string>; session: 'isolated' | 'grant'; grantOrigin?: string } | null>({
        type: 'agent-plan', goal: candidate.goal, stageB: this.stageB, values: candidate.userValues,
        steps: candidate.steps.map((s) => ({ label: s.label, origin: s.origin, tier: s.maxTier, dataFields: s.dataFields })),
        origins: [...candidate.allowedOrigins], grantMinutes: this.app.profile.prefs.get('agent.grantMinutes'),
      });
      if (!r?.run || task.abort.signal.aborted) return void this.stop('stopped', t('agent_cancelled'));
      const steps = candidate.steps.filter((s) => !r.removed.includes(s.index)).map((s, i) => ({ ...s, index: i }));
      if (!steps.length) return void this.stop('stopped', t('agent_cancelled'));
      const session = this.stageB && r.session === 'grant' ? 'grant' : 'isolated';
      const now = Date.now();
      task.plan = {
        ...candidate, id: task.id, steps,
        userValues: Object.fromEntries(Object.entries(r.values ?? {}).filter(([k]) => Object.hasOwn(candidate.userValues, k)).map(([k, v]) => [k, String(v).slice(0, 300)])),
        allowedOrigins: new Set([...steps.map((s) => s.origin), searchOrigin]),
        session, grantOrigin: session === 'grant' ? (r.grantOrigin && steps.some((s) => s.origin === r.grantOrigin) ? r.grantOrigin : steps[0]!.origin) : undefined,
        approvedAt: now, expiresAt: now + (session === 'grant' ? this.app.profile.prefs.get('agent.grantMinutes') * 60_000 : PLAN_TTL_MS),
      };
      this.log.add(task.id, 'approval', `Approved ${steps.length} steps; origins ${[...task.plan.allowedOrigins].join(', ')}; session ${session}${task.plan.grantOrigin ? ` (${task.plan.grantOrigin})` : ''}`);
      await this.execute(task);
    } catch (e) {
      if (!task.abort.signal.aborted) await this.stop('failed', (e as Error).message);
    }
  }

  private pickPlanner(signal: AbortSignal): Planner {
    const mode = this.app.profile.prefs.get('ai.mode');
    if (mode === 'cloud' || mode === 'byo') {
      return new LlmPlanner((system, user, s) => this.assistant.complete(system, user, s, 'agent_plan'), this.app.profile.prefs.get('ai.models')[mode === 'cloud' ? 'gateway' : this.app.profile.prefs.get('ai.provider')] ?? 'model', signal);
    }
    return new HeuristicPlanner();
  }

  private async execute(task: Task): Promise<void> {
    const plan = task.plan!;
    const w = task.window;
    const agentWcIds = new Set<number>();
    task.session =
      plan.session === 'grant'
        ? new AgentSession(() => plan.allowedOrigins, () => this.privateValues(plan), { session: w.profile.session, pipeline: w.profile.pipeline }, () => agentWcIds)
        : new AgentSession(() => plan.allowedOrigins, () => this.privateValues(plan));
    if (plan.session === 'isolated') w.profile.shields.install(task.session.pipeline);
    task.session.onBlocked = (e) => this.log.add(task.id, 'egress', `Blocked ${e.reason}: ${e.url.slice(0, 160)}${e.labels ? ` (${e.labels.join(', ')})` : ''}`, { verdict: 'blocked' });
    this.log.startTask(task.id, task.goal, plan.session);
    task.tab = w.createTab({ url: 'about:blank', agent: true, session: task.session.session, activate: true });
    if (task.tab.wc) agentWcIds.add(task.tab.wc.id);
    task.tab.on('closed-by-page', () => void this.stop('stopped', t('agent_tab_closed')));
    task.actuator = new Actuator(task.tab.ensureLive());
    task.status = 'running';
    this.push();

    let actions = 0;
    while (this.task === task && !task.abort.signal.aborted) {
      if (task.paused) {
        await new Promise<void>((r) => (task.resume = r));
        task.resume = null;
        if (task.abort.signal.aborted) break;
      }
      if (++actions > MAX_ACTIONS) return void this.stop('failed', t('agent_too_many_steps'));
      const step = plan.steps[task.stepIndex];
      if (!step) return void this.stop('done', t('agent_done'));
      await this.settle(task.tab);
      const snap = await task.actuator.observe();
      this.log.add(task.id, 'observe', `${snap.title || snap.url} · ${snap.nodes.length} controls`, { origin: snap.origin, step: task.stepIndex });

      // Credential fill is out of scope (AGT-06): the user signs in themselves.
      if (snap.nodes.some((n) => n.isPassword)) {
        this.pause(task, t('agent_sign_in_yourself'));
        continue;
      }
      // Advisory detector: pauses and asks; it can never allow anything (C2).
      const det = detectInjection(snap.text);
      if (det.suspected && !task.acknowledgedInjection.has(snap.url)) {
        this.log.add(task.id, 'detector', `Suspected injection (${det.signals.join(', ')}): “${det.excerpt.slice(0, 160)}”`);
        const go = await w.overlay.dialog<boolean | null>({ type: 'confirm', title: t('agent_injection_title'), body: t('agent_injection_body', { excerpt: det.excerpt.slice(0, 200) }), confirm: t('agent_continue') });
        if (!go) return void this.stop('stopped', t('agent_injection_stopped'));
        task.acknowledgedInjection.add(snap.url);
      }

      let action: ProposedAction;
      try {
        action = await task.planner.next({ plan, step, stepIndex: task.stepIndex, snapshot: snap, history: task.history });
      } catch (e) {
        return void this.stop('failed', t('agent_planner_failed', { reason: (e as Error).message.slice(0, 120) }));
      }
      if (action.tool === 'done') {
        this.log.add(task.id, 'result', `Step ${task.stepIndex + 1} done: ${action.why}`, { step: task.stepIndex });
        task.stepIndex++;
        this.push();
        continue;
      }
      const node = action.nodeId !== undefined ? snap.nodes.find((n) => n.nodeId === action.nodeId) : undefined;
      const call: ToolCall = {
        id: randomUUID(), tool: action.tool, targetOrigin: snap.origin, url: action.url, nodeId: action.nodeId,
        snapshotId: snap.id, value: action.value, targetIsCommit: node?.isCommit,
      };
      const state: ExecutionState = { currentStep: task.stepIndex, stageB: this.stageB, lastSnapshotId: snap.id, seenCallIds: task.seen, now: Date.now(), privateValues: this.privateValues(null).map((v) => v.value) };
      let verdict: Verdict = check(plan, call, state);
      this.log.add(task.id, 'call', `${call.tool}${node ? ` “${node.name}”` : ''}${call.url ? ` ${call.url}` : ''} · ${action.why}`, { verdict: verdictText(verdict), origin: call.url ? safeOrigin(call.url) : snap.origin, step: task.stepIndex });
      task.seen.add(call.id);

      if (verdict.kind === 'needs-approval') {
        const ok = await w.overlay.dialog<boolean | null>({ type: 'confirm', title: t('agent_new_origin_title', { origin: verdict.origin }), body: t('agent_new_origin_body'), confirm: t('agent_allow_site') });
        this.log.add(task.id, 'user', `${ok ? 'Allowed' : 'Refused'} new site ${verdict.origin}`);
        if (!ok) return void this.stop('stopped', t('agent_refused_origin'));
        plan.allowedOrigins.add(verdict.origin);
        verdict = check(plan, { ...call, id: randomUUID() }, { ...state, seenCallIds: new Set() });
      }
      if (verdict.kind === 'reject') {
        if (verdict.reason === 'stale-snapshot') continue;
        task.history.push({ tool: call.tool, nodeId: call.nodeId, ok: false, why: verdict.reason });
        return void this.stop('failed', t('agent_rejected', { reason: verdict.reason }));
      }
      if (verdict.kind === 'needs-confirmation') {
        if (!(await this.confirm(task, call, snap))) return void this.stop('stopped', t('agent_not_confirmed'));
      }

      // Act.
      try {
        if (node) await task.actuator.highlight(snap.id, node.nodeId);
        await this.act(task, call);
        task.history.push({ tool: call.tool, nodeId: call.nodeId, ok: true, why: action.why });
        this.log.add(task.id, 'result', `Done: ${call.tool}${node ? ` “${node.name}”` : ''}`, { step: task.stepIndex });
      } catch (e) {
        task.history.push({ tool: call.tool, nodeId: call.nodeId, ok: false, why: (e as Error).message });
        this.log.add(task.id, 'error', (e as Error).message.slice(0, 200));
      } finally {
        await task.actuator.clearHighlight();
      }
      if (action.advance) task.stepIndex++;
      this.push();
    }
  }

  private async act(task: Task, call: ToolCall): Promise<void> {
    const a = task.actuator!;
    const plan = task.plan!;
    const value = (): string => {
      const v = call.value!;
      switch (v.kind) {
        case 'user':
          return plan.userValues[v.handle]!;
        case 'profile':
          // The real value is filled by the browser only after the T3 confirmation (P6-AI-01).
          return this.personalData()[v.field] ?? '';
        case 'page':
        case 'free':
          return v.text;
      }
    };
    switch (call.tool) {
      case 'navigate':
        await task.tab!.wc!.loadURL(call.url!).catch(() => undefined);
        return;
      case 'click':
      case 'submit':
        return a.click(call.snapshotId!, call.nodeId!);
      case 'type':
      case 'fill_personal':
        return a.type(call.snapshotId!, call.nodeId!, value());
      case 'select':
        return a.select(call.snapshotId!, call.nodeId!, value());
      case 'scroll':
        return a.scroll(400);
      case 'wait':
      case 'observe':
        await new Promise((r) => setTimeout(r, 500));
    }
  }

  /** PermissionBroker (P6-BRW-01, AGT-04): exact destination, fields, and values; no accidental confirms. */
  private async confirm(task: Task, call: ToolCall, snap: Snapshot): Promise<boolean> {
    const w = task.window;
    const prev = task.status;
    task.status = 'awaiting-confirmation';
    this.push();
    let form = { action: snap.url, method: 'GET', fields: [] as { name: string; value: string }[] };
    if (tierOf(call) === Tier.T4Commit && call.nodeId !== undefined) form = await task.actuator!.pendingFormValues(snap.id, call.nodeId).catch(() => form);
    const dest = safeOrigin(form.action) || snap.origin;
    const personal = call.value?.kind === 'profile' ? { field: call.value.field, value: this.personalData()[call.value.field] ?? '' } : null;
    // C7b: block private values heading to an origin that wasn't approved for them.
    const hits = scanEgress(dest, form.action, form.fields.map((f) => `${f.name}=${f.value}`).join('&'), this.privateValues(task.plan));
    if (hits.length) {
      this.log.add(task.id, 'egress', `Commit to ${dest} would send ${hits.map((h) => h.label).join(', ')}: blocked`, { verdict: 'blocked' });
      task.status = prev;
      return false;
    }
    const node = snap.nodes.find((n) => n.nodeId === call.nodeId);
    const r = await w.overlay.dialog<{ confirm: boolean } | null>({
      type: 'agent-confirm', kind: personal ? 'personal-data' : 'commit', action: node?.name ?? call.tool, destination: dest,
      method: form.method, fields: form.fields, personal, step: task.plan!.steps[task.stepIndex]?.label ?? '',
    });
    this.log.add(task.id, 'confirm', `${r?.confirm ? 'Confirmed' : 'Declined'}: ${node?.name ?? call.tool} → ${dest}${form.fields.length ? ` (${form.fields.map((f) => f.name).join(', ')})` : ''}`, { verdict: r?.confirm ? 'confirmed' : 'declined', origin: dest });
    task.status = prev === 'awaiting-confirmation' ? 'running' : prev;
    this.push();
    return !!r?.confirm;
  }

  private async settle(tab: WebTab | null): Promise<void> {
    const wc = tab?.wc;
    if (!wc) return;
    if (wc.isLoading()) await new Promise<void>((r) => {
      const done = () => r();
      wc.once('did-stop-loading', done);
      setTimeout(done, 8000);
    });
    await new Promise((r) => setTimeout(r, 150));
  }

  private pause(task: Task, message: string): void {
    task.paused = true;
    task.status = 'paused';
    task.message = message;
    this.log.add(task.id, 'user', `Paused: ${message}`);
    this.push();
  }

  control(what: 'pause' | 'resume' | 'takeover' | 'stop'): void {
    const task = this.task;
    if (!task) return;
    if (what === 'stop') {
      if (this.active()) void this.stop('stopped', t('agent_stopped_by_user'));
      else void this.dismiss();
      return;
    }
    if (what === 'pause' || what === 'takeover') {
      this.pause(task, what === 'takeover' ? t('agent_you_have_control') : t('agent_paused'));
      if (what === 'takeover' && task.tab) {
        task.window.activateTab(task.tab.id);
        task.tab.wc?.focus();
      }
      return;
    }
    if (what === 'resume' && task.paused) {
      task.paused = false;
      task.status = 'running';
      task.message = null;
      this.log.add(task.id, 'user', 'Resumed');
      task.resume?.();
      this.push();
    }
  }

  async stop(status: 'done' | 'stopped' | 'failed', message: string): Promise<void> {
    const task = this.task;
    if (!task) return;
    task.abort.abort();
    task.status = status;
    task.message = message;
    task.paused = false;
    task.resume?.();
    task.actuator?.detach();
    this.log.add(task.id, 'result', `${status}: ${message}`);
    this.log.endTask(task.id, status);
    // A logged-in grant ends now; the isolated session lives until the bar is dismissed so results stay visible.
    if (task.plan?.session === 'grant') await task.session?.destroy();
    this.push();
  }

  /** Dismissing the bar ends the task: the isolated session and its tab are destroyed (doc 06 §7). */
  async dismiss(): Promise<void> {
    const task = this.task;
    if (!task) return;
    this.task = null;
    if (task.tab && task.window.tabs.has(task.tab.id)) task.window.closeTab(task.tab.id, { noUndo: true });
    await task.session?.destroy();
    this.push(task.window);
  }

  // ---------------------------------------------------------------- views

  private view(): AgentTaskView | null {
    const task = this.task;
    if (!task) return null;
    return {
      id: task.id, goal: task.goal, status: task.status, session: task.plan?.session ?? 'isolated', planner: task.planner.name, message: task.message,
      steps: task.plan?.steps.map((s, i) => ({ label: s.label, origin: s.origin, tier: s.maxTier, state: i < task.stepIndex ? 'done' : i === task.stepIndex ? 'active' : 'pending' })) ?? [],
      log: this.log.entries(task.id).slice(-30).map((e) => ({ at: e.at, kind: e.kind, summary: e.summary, verdict: e.verdict })),
    };
  }

  state(): AgentPanelState {
    const a = this.availability();
    return { available: a.ok, reason: a.reason, stageB: this.stageB, task: this.view() };
  }

  private barState(w: BrowserWindowController): AgentBarState | null {
    const task = this.task;
    if (!task || task.window !== w) return null;
    const step = task.plan?.steps[task.stepIndex];
    return {
      taskId: task.id, goal: task.goal, status: task.status, stepIndex: task.stepIndex, stepCount: task.plan?.steps.length ?? 0,
      stepLabel: task.message ?? step?.label ?? task.goal, session: task.plan?.session ?? 'isolated', grantOrigin: task.plan?.grantOrigin,
      grantExpiresAt: task.plan?.session === 'grant' ? task.plan.expiresAt : undefined,
    };
  }

  private push(w = this.task?.window): void {
    if (!w) return;
    w.pushState();
    emitTo(w.chrome.webContents, 'Agent', 'state', this.state());
  }

  private bind(): void {
    const win = (ctx: CallContext) => {
      const w = this.app.windowForSender(ctx.sender);
      if (!w) throw new Error('no window');
      return w;
    };
    this.app.router.bind(
      AgentInterface,
      {
        getState: () => this.state(),
        start: (ctx, goal, values) => void this.start(win(ctx), goal, values),
        control: (_ctx, what) => this.control(what),
      },
      { hosts: ['chrome'] },
    );
  }

  private definePages(): void {
    this.app.pages.define('agent-log', {
      init: () => ({ tasks: this.log.tasks() }),
      entries: (payload) => this.log.entries(String(payload).slice(0, 64)),
      clear: () => {
        this.log.clear();
        return [];
      },
    });
    this.app.pages.define('settings', {
      getAgentProfile: () => this.personalData(),
      setAgentProfile: (payload) => {
        this.setPersonalData(payload as Partial<Record<ProfileField, string>>);
        return this.personalData();
      },
    });
  }
}

function safeOrigin(u: string): string {
  try {
    return new URL(u).origin;
  } catch {
    return '';
  }
}

function verdictText(v: Verdict): string {
  return v.kind === 'reject' ? `rejected: ${v.reason}` : v.kind === 'needs-approval' ? 'needs approval: new site' : v.kind === 'needs-confirmation' ? `needs confirmation: ${v.reason}` : 'allowed';
}

declare const BUILD_TIME: number;
