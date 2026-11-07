// <vz-agent>: the Task Agent panel (R3). Start a task with a goal and your values;
// follow the approved plan step by step, with the live Action Log.
import { LitElement, css, html, nothing } from 'lit';
import { base } from '../shared/styles';
import { icon } from '../shared/icons';
import { client, on } from '../shared/bridge';
import { AgentInterface, type AgentPanelState } from '@vz/common/mojom/agent';
import { t } from '@vz/common/i18n';
import { registerPanel } from './panels';
import { shell } from './shell';

const api = client(AgentInterface);

class VzAgent extends LitElement {
  static override properties = { s: { state: true }, goal: { state: true }, values: { state: true } };
  s: AgentPanelState | null = null;
  goal = '';
  values: [string, string][] = [['', '']];

  static override styles = [base, css`
    :host { display: flex; flex-direction: column; height: 100%; min-height: 0; overflow: auto; padding: 12px 14px; gap: 12px; }
    textarea { width: 100%; min-height: 72px; resize: vertical; font: 13.5px/1.5 var(--vz-font); }
    .vals { display: grid; grid-template-columns: 1fr 1fr auto; gap: 6px; align-items: center; }
    .vals input { height: 30px; min-width: 0; }
    .hint { font-size: var(--vz-text-xs); color: var(--vz-text-2); line-height: 1.5; }
    .card { border: 1px solid var(--vz-border); border-radius: 12px; padding: 12px; background: var(--vz-bg-elev); }
    .steps { list-style: none; margin: 8px 0 0; padding: 0; display: flex; flex-direction: column; gap: 6px; }
    .steps li { display: flex; gap: 8px; align-items: flex-start; font-size: var(--vz-text-s); }
    .dot { width: 18px; height: 18px; border-radius: 50%; display: grid; place-items: center; flex: none; background: var(--vz-surface-2); color: var(--vz-text-2); font-size: 10px; font-weight: 700; }
    .active .dot { background: var(--vz-accent); color: var(--vz-on-accent); }
    .done .dot { background: color-mix(in srgb, var(--vz-ok) 20%, transparent); color: var(--vz-ok); }
    .tier { font-size: 10px; font-weight: 700; padding: 1px 6px; border-radius: 999px; background: var(--vz-surface-2); color: var(--vz-text-2); }
    .tier.t3, .tier.t4 { background: color-mix(in srgb, var(--vz-warn) 18%, transparent); color: var(--vz-warn); }
    .log { font-family: var(--vz-font-mono); font-size: 11px; line-height: 1.6; max-height: 260px; overflow: auto; }
    .log div { display: flex; gap: 6px; } .log .k { color: var(--vz-text-3); min-width: 54px; } .log .v { color: var(--vz-accent); }
    .status { display: flex; gap: 8px; align-items: center; font-weight: 650; }
    .off { text-align: center; color: var(--vz-text-2); padding: 24px 8px; font-size: var(--vz-text-s); }
    .row { display: flex; gap: 8px; }`];

  override connectedCallback(): void {
    super.connectedCallback();
    on<AgentPanelState>('Agent', 'state', (s) => (this.s = s));
    void api.getState().then((s: AgentPanelState) => (this.s = s));
  }

  private start(): void {
    const values = Object.fromEntries(this.values.filter(([k, v]) => k.trim() && v.trim()).map(([k, v]) => [k.trim(), v.trim()]));
    void api.start(this.goal.trim(), values);
  }

  override render() {
    const s = this.s;
    if (!s) return nothing;
    if (!s.available) return html`<div class="off">${icon('bot', 28)}<p>${s.reason}</p><button class="btn" @click=${() => shell.runCommand('page.settings')}>${t('cmd_settings')}</button></div>`;
    const task = s.task;
    return html`
      ${!task || ['done', 'stopped', 'failed'].includes(task.status) ? html`
        <div><label class="hint" for="goal">${t('agent_goal_label')}</label>
          <textarea id="goal" .value=${this.goal} placeholder=${t('agent_goal_placeholder')} @input=${(e: InputEvent) => (this.goal = (e.target as HTMLTextAreaElement).value)}></textarea></div>
        <div><div class="hint" style="margin-bottom:6px">${t('agent_values_label')}</div>
          <div class="vals">${this.values.map(([k, v], i) => html`
            <input type="text" placeholder=${t('agent_value_name')} aria-label=${t('agent_value_name')} .value=${k} @input=${(e: InputEvent) => (this.values = this.values.map((p, j) => (j === i ? [(e.target as HTMLInputElement).value, p[1]] : p)))} />
            <input type="text" placeholder=${t('agent_value_value')} aria-label=${t('agent_value_value')} .value=${v} @input=${(e: InputEvent) => (this.values = this.values.map((p, j) => (j === i ? [p[0], (e.target as HTMLInputElement).value] : p)))} />
            <button class="icon-btn" aria-label=${t('action_remove')} @click=${() => (this.values = this.values.filter((_, j) => j !== i))}>${icon('x', 13)}</button>`)}
          </div>
          <button class="btn ghost" style="margin-top:6px" @click=${() => (this.values = [...this.values, ['', '']])}>${icon('plus', 13)} ${t('agent_add_value')}</button></div>
        <p class="hint">${icon('shield', 11)} ${s.stageB ? t('agent_hint_stage_b') : t('agent_hint_stage_a')}</p>
        <div class="row"><button class="btn primary" ?disabled=${this.goal.trim().length < 3} @click=${() => this.start()}>${icon('play', 13)} ${t('agent_plan_task')}</button>
          <button class="btn ghost" @click=${() => shell.runCommand('page.agentLog')}>${t('cmd_agent_log')}</button></div>` : nothing}
      ${task ? html`<div class="card">
          <div class="status">${icon('bot', 16)} <span style="flex:1">${task.goal}</span><span class="tier">${t(`agent_status_${task.status.replace(/-/g, '_')}` as never)}</span></div>
          ${task.message ? html`<p class="hint">${task.message}</p>` : nothing}
          <ol class="steps">${task.steps.map((st, i) => html`<li class=${st.state}><span class="dot">${st.state === 'done' ? icon('check', 11) : i + 1}</span>
            <span style="flex:1">${st.label}<br /><span class="hint">${st.origin}</span></span><span class="tier t${st.tier}">T${st.tier}</span></li>`)}</ol>
          <div class="hint" style="margin-top:8px">${t('agent_planner')}: ${task.planner} · ${task.session === 'grant' ? t('agent_grant') : t('agent_isolated')}</div>
        </div>
        <div class="card log" aria-label=${t('cmd_agent_log')}>${task.log.map((l) => html`<div><span class="k">${l.kind}</span><span style="flex:1">${l.summary}</span>${l.verdict ? html`<span class="v">${l.verdict}</span>` : nothing}</div>`)}</div>` : nothing}`;
  }
}
customElements.define('vz-agent', VzAgent);
registerPanel('agent', 'vz-agent', () => t('agent_panel'), 'bot');
