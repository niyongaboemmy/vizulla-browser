import { css, html } from 'lit';
import { base, pageStyles } from '../shared/styles';
import { icon } from '../shared/icons';
import { VzPage, timeAgo } from '../shared/page_base';
import { t, getLocale } from '@vz/common/i18n';

interface Item { id: number; spaceId: string; url: string; title: string; favicon: string | null; archivedAt: number }
interface Data { items: Item[]; spaces: { id: string; name: string }[]; retentionDays: number }

class VzArchive extends VzPage<Data> {
  static override properties = { ...VzPage.properties, q: { state: true } };
  q = '';
  static override styles = [base, pageStyles, css`.list-item { cursor: pointer; } .list-item .x { opacity: 0; } .list-item:hover .x { opacity: 1; } .when { color: var(--vz-text-3); font-size: var(--vz-text-s); } .space { font-size: var(--vz-text-xs); } input[type=search] { width: 240px; height: 34px; }`];
  override render() {
    const d = this.data;
    if (!d) return this.loading();
    const names = new Map(d.spaces.map((s) => [s.id, s.name]));
    const q = this.q.toLowerCase();
    const items = d.items.filter((i) => !q || `${i.title} ${i.url}`.toLowerCase().includes(q));
    return html`<div class="page"><header class="page-head"><h1>${t('cmd_archive')}</h1>
      <input type="search" placeholder=${t('history_search')} @input=${(e: InputEvent) => (this.q = (e.target as HTMLInputElement).value)} />
      <button class="btn ghost" @click=${async () => confirm(t('archive_clear_confirm')) && ((await this.invoke('clear')), (this.data = { ...d, items: [] }))}>${t('action_clear')}</button></header>
      <p class="muted">${t('archive_desc', { days: d.retentionDays })}</p>
      <div class="card" style="padding:6px">${items.length ? items.map((i) => html`<div class="list-item" role="button" tabindex="0" title=${i.url}
          @click=${async () => (this.data = { ...d, items: await this.invoke('restore', i.id) })}>
          ${i.favicon ? html`<img src=${i.favicon} alt="" />` : icon('globe', 16)}<span class="ellipsis" style="flex:1">${i.title || i.url}</span>
          <span class="chip space">${names.get(i.spaceId) ?? ''}</span><span class="when">${timeAgo(i.archivedAt, getLocale())}</span>
          <button class="icon-btn x" aria-label=${t('action_delete')} @click=${async (e: Event) => (e.stopPropagation(), (this.data = { ...d, items: await this.invoke('remove', i.id) }))}>${icon('x', 14)}</button></div>`)
        : html`<div class="empty">${icon('archive', 28)}<p>${t('archive_empty')}</p></div>`}</div></div>`;
  }
}
customElements.define('vz-archive', VzArchive);
