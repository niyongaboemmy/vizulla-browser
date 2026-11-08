import { css, html, nothing } from 'lit';
import { base, pageStyles } from '../shared/styles';
import { icon } from '../shared/icons';
import { VzPage } from '../shared/page_base';
import { t, getLocale } from '@vz/common/i18n';

interface Entry { url: string; title: string; lastVisit: number; favicon: string | null; visitCount: number }

class VzHistory extends VzPage<{ total: number }> {
  static override properties = { ...VzPage.properties, items: { state: true }, q: { state: true } };
  items: Entry[] = [];
  q = '';
  static override styles = [base, pageStyles, css`.day { font-size: var(--vz-text-xs); font-weight: 700; text-transform: uppercase; letter-spacing: .06em; color: var(--vz-text-3); margin: 20px 12px 6px; }
    .time { color: var(--vz-text-3); font-size: var(--vz-text-s); width: 56px; font-variant-numeric: tabular-nums; } .host { color: var(--vz-text-3); font-size: var(--vz-text-s); }
    .list-item { cursor: pointer; } .list-item .del { opacity: 0; } .list-item:hover .del { opacity: 1; } input[type=search] { width: min(280px, 100%); height: 34px; }`];

  protected override loaded(): void {
    void this.load();
  }

  private async load(): Promise<void> {
    this.items = await this.invoke<Entry[]>('list', { query: this.q || undefined });
  }

  override render() {
    if (!this.data) return this.loading();
    const fmtDay = new Intl.DateTimeFormat(getLocale(), { weekday: 'long', month: 'long', day: 'numeric' });
    const fmtTime = new Intl.DateTimeFormat(getLocale(), { hour: '2-digit', minute: '2-digit' });
    let last = '';
    return html`<div class="page">
      <header class="page-head"><h1>${t('cmd_history')}</h1>
        <input type="search" placeholder=${t('history_search')} aria-label=${t('history_search')} @input=${(e: InputEvent) => ((this.q = (e.target as HTMLInputElement).value), void this.load())} />
        <button class="btn danger" @click=${() => this.invoke('command', { id: 'privacy.clearHistory' }).then(() => this.load())}>${t('cmd_clear_history')}</button></header>
      <div class="card" style="padding:6px">
        ${this.items.length ? this.items.map((e) => {
          const day = fmtDay.format(e.lastVisit);
          const head = day !== last && !this.q ? html`<div class="day">${day}</div>` : nothing;
          last = day;
          return html`${head}<div class="list-item" role="link" tabindex="0" @click=${() => this.invoke('open', { url: e.url })} @keydown=${(k: KeyboardEvent) => k.key === 'Enter' && this.invoke('open', { url: e.url })}>
            <span class="time">${fmtTime.format(e.lastVisit)}</span>
            ${e.favicon ? html`<img src=${e.favicon} alt="" />` : icon('globe', 16)}
            <span class="grow ellipsis" style="flex:1">${e.title || e.url} <span class="host">${new URL(e.url).hostname}</span></span>
            <button class="icon-btn del" aria-label=${t('action_delete')} @click=${async (ev: Event) => {
              ev.stopPropagation();
              await this.invoke('remove', e.url);
              await this.load();
            }}>${icon('x', 14)}</button></div>`;
        }) : html`<div class="empty">${t('history_empty')}</div>`}
      </div></div>`;
  }
}
customElements.define('vz-history', VzHistory);
