// vizulla://agent-log (P5-BRW-05, AGT-08): every task, observation, call,
// enforcer verdict, and confirmation. Kept 30 days.
import { css, html, nothing } from 'lit';
import { base, pageStyles } from '../shared/styles';
import { icon } from '../shared/icons';
import { VzPage, timeAgo } from '../shared/page_base';
import { t, getLocale } from '@vz/common/i18n';

interface TaskRow { id: string; goal: string; startedAt: number; endedAt: number | null; status: string; session: string }
interface Entry { at: number; kind: string; summary: string; verdict: string | null; origin: string | null; step: number | null }

class VzAgentLog extends VzPage<{ tasks: TaskRow[] }> {
  static override properties = { ...VzPage.properties, open: { state: true }, entries: { state: true } };
  open: string | null = null;
  entries: Entry[] = [];
  static override styles = [base, pageStyles, css`.task { cursor: pointer; } .e { display: grid; grid-template-columns: 70px 80px 1fr auto; gap: 8px; padding: 6px 14px; font-size: 12px; border-top: 1px solid var(--vz-border); }
    .e .k { color: var(--vz-text-3); font-family: var(--vz-font-mono); } .v { font-weight: 600; } .v.rejected, .v.blocked, .v.declined { color: var(--vz-danger); } .v.allowed, .v.confirmed { color: var(--vz-ok); }`];

  private async toggleTask(id: string): Promise<void> {
    this.open = this.open === id ? null : id;
    if (this.open) this.entries = await this.invoke<Entry[]>('entries', id);
  }

  override render() {
    const d = this.data;
    if (!d) return this.loading();
    const fmt = new Intl.DateTimeFormat(getLocale(), { hour: '2-digit', minute: '2-digit', second: '2-digit' });
    return html`<div class="page"><header class="page-head"><h1>${icon('bot', 24)} ${t('cmd_agent_log')}</h1>
      <button class="btn ghost" @click=${async () => confirm(t('agent_log_clear_confirm')) && ((await this.invoke('clear')), (this.data = { tasks: [] }))}>${t('action_clear')}</button></header>
      <p class="muted">${t('agent_log_desc')}</p>
      <div class="card">${d.tasks.length ? d.tasks.map((task) => html`<div class="row section task" role="button" tabindex="0" @click=${() => this.toggleTask(task.id)} @keydown=${(e: KeyboardEvent) => e.key === "Enter" && this.toggleTask(task.id)}>
          ${icon(this.open === task.id ? 'chevron-down' : 'chevron-right', 14)}<div class="grow"><div class="title">${task.goal}</div><div class="desc">${timeAgo(task.startedAt, getLocale())} · ${task.session}</div></div>
          <span class="chip">${task.status}</span></div>
          ${this.open === task.id ? this.entries.map((e) => html`<div class="e"><span class="k">${fmt.format(e.at)}</span><span class="k">${e.kind}</span><span>${e.summary}</span>
            ${e.verdict ? html`<span class="v ${e.verdict.split(':')[0]!.split(' ')[0]}">${e.verdict}</span>` : nothing}</div>`) : nothing}`)
        : html`<div class="empty">${t('agent_log_empty')}</div>`}</div></div>`;
  }
}
customElements.define('vz-agent-log', VzAgentLog);
