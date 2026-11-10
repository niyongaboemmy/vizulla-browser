// vizulla://task-manager (Shift+Esc): memory and CPU per process, refreshed every two
// seconds; "End process" on a tab process puts its tabs to sleep.
import { css, html, nothing, type TemplateResult } from 'lit';
import { base, pageStyles } from '../shared/styles';
import { icon } from '../shared/icons';
import { VzPage } from '../shared/page_base';
import { getLocale, t, tn } from '@vz/common/i18n';

interface Row {
  pid: number;
  kind: 'browser' | 'gpu' | 'network' | 'audio' | 'utility' | 'tabs' | 'ui' | 'other';
  name: string;
  tabs: { id: number; title: string; favicon: string | null }[];
  memoryKb: number;
  cpu: number;
}
interface Data {
  rows: Row[];
  asleep: number;
}

class VzTaskManager extends VzPage<Data> {
  static override properties = { ...VzPage.properties, sort: { state: true } };
  sort: 'memory' | 'cpu' | 'task' = 'memory';
  private timer = 0;

  static override styles = [
    base,
    pageStyles,
    css`
      .lead { color: var(--vz-text-2); margin: -16px 0 18px; }
      .table { border-radius: 20px; border: 1px solid var(--vz-border); background: var(--vz-bg-elev); overflow: hidden; }
      .tr { display: grid; grid-template-columns: minmax(0, 1fr) 110px 70px 90px 132px; align-items: center; gap: 12px; padding: 10px 16px; border-top: 1px solid var(--vz-border); }
      .tr.head { border-top: 0; font-size: var(--vz-text-s); color: var(--vz-text-2); font-weight: 600; background: var(--vz-surface-2); }
      .tr.head button { all: unset; cursor: pointer; display: inline-flex; gap: 4px; align-items: center; }
      .tr.head button[aria-sort] { color: var(--vz-text); }
      .num { text-align: right; font-variant-numeric: tabular-nums; }
      .task { display: flex; gap: 10px; align-items: center; min-width: 0; }
      .task .ic { width: 22px; height: 22px; border-radius: 6px; display: grid; place-items: center; background: var(--vz-surface-2); color: var(--vz-text-2); flex: none; }
      .task img { width: 16px; height: 16px; border-radius: 3px; }
      .task .names { min-width: 0; }
      .task .names div { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
      .sub { font-size: var(--vz-text-xs); color: var(--vz-text-3); }
      .bar { height: 4px; border-radius: 2px; background: var(--vz-accent); opacity: .55; margin-top: 4px; }
      .total { font-weight: 650; background: var(--vz-surface-2); }
      .note { color: var(--vz-text-3); font-size: var(--vz-text-s); margin-top: 14px; display: flex; gap: 8px; }
      @media (max-width: 700px) { .tr { grid-template-columns: minmax(0, 1fr) 90px 60px; } .tr > :nth-child(4), .tr > :nth-child(5) { display: none; } }
    `,
  ];

  protected override loaded(): void {
    this.timer = window.setInterval(() => void this.invoke<Data>('list').then((d) => (this.data = d)), 2000);
  }

  override disconnectedCallback(): void {
    super.disconnectedCallback();
    clearInterval(this.timer);
  }

  private label(r: Row): string {
    switch (r.kind) {
      case 'browser': return t('tm_browser');
      case 'gpu': return t('tm_gpu');
      case 'network': return t('tm_network');
      case 'audio': return t('tm_audio');
      case 'utility': return t('tm_utility', { name: r.name || '—' });
      case 'ui': return t('tm_ui');
      case 'tabs': return r.tabs.map((x) => x.title).join(', ');
      default: return t('tm_other');
    }
  }

  private mem(kb: number): string {
    return new Intl.NumberFormat(getLocale(), { maximumFractionDigits: kb > 1024 * 1024 ? 1 : 0 }).format(kb > 1024 * 1024 ? kb / 1024 / 1024 : kb / 1024) + (kb > 1024 * 1024 ? ' GB' : ' MB');
  }

  override render() {
    const d = this.data;
    if (!d) return this.loading();
    const rows = [...d.rows].sort((a, b) => (this.sort === 'memory' ? b.memoryKb - a.memoryKb : this.sort === 'cpu' ? b.cpu - a.cpu : this.label(a).localeCompare(this.label(b))));
    const max = Math.max(...rows.map((r) => r.memoryKb), 1);
    const totalMem = rows.reduce((n, r) => n + r.memoryKb, 0);
    const totalCpu = rows.reduce((n, r) => n + r.cpu, 0);
    const head = (key: 'task' | 'memory' | 'cpu', label: string, num = false): TemplateResult =>
      html`<div class=${num ? 'num' : ''}><button aria-sort=${this.sort === key ? (key === 'task' ? 'ascending' : 'descending') : nothing} @click=${() => (this.sort = key)}>${label}${this.sort === key ? icon('chevron-down', 12) : nothing}</button></div>`;
    return html`<div class="page">
      <header class="page-head"><h1>${t('tm_title')}</h1><button class="btn" @click=${() => void this.invoke<Data>('sleepAll').then((x) => (this.data = x))}>${icon('moon', 14)} ${t('tm_sleep_all')}</button></header>
      <p class="lead">${t('tm_lead')}</p>
      <div class="table" role="table" aria-label=${t('tm_title')}>
        <div class="tr head" role="row">${head('task', t('tm_task'))}${head('memory', t('tm_memory'), true)}${head('cpu', t('tm_cpu'), true)}<div class="num">${t('tm_pid')}</div><div></div></div>
        ${rows.map((r) => html`<div class="tr" role="row">
          <div class="task" role="cell">
            ${r.kind === 'tabs' && r.tabs[0]?.favicon ? html`<img src=${r.tabs[0].favicon} alt="" />` : html`<span class="ic">${icon(r.kind === 'tabs' ? 'globe' : r.kind === 'gpu' ? 'cpu' : r.kind === 'network' ? 'cloud' : r.kind === 'browser' ? 'layers' : 'settings', 13)}</span>`}
            <div class="names"><div title=${this.label(r)}>${this.label(r)}</div>${r.kind === 'tabs' && r.tabs.length > 1 ? html`<div class="sub">${tn('tm_tabs', r.tabs.length)}</div>` : nothing}
              <div class="bar" style="width:${Math.max(2, (r.memoryKb / max) * 100)}%"></div></div>
          </div>
          <div class="num" role="cell">${this.mem(r.memoryKb)}</div>
          <div class="num" role="cell">${r.cpu.toFixed(1)}</div>
          <div class="num" role="cell">${r.pid}</div>
          <div role="cell" style="text-align:right">${r.kind === 'tabs' ? html`<button class="btn" @click=${() => void this.invoke<Data>('end', r.pid).then((x) => (this.data = x))}>${t('tm_end')}</button>` : nothing}</div>
        </div>`)}
        <div class="tr total" role="row"><div role="cell">${t('tm_total')}</div><div class="num" role="cell">${this.mem(totalMem)}</div><div class="num" role="cell">${totalCpu.toFixed(1)}</div><div></div><div></div></div>
      </div>
      <p class="note">${icon('info', 14)}<span>${d.asleep ? `${tn('tm_asleep', d.asleep)} · ` : ''}${t('tm_hint')}</span></p>
    </div>`;
  }
}
customElements.define('vz-task-manager', VzTaskManager);
