import { css, html } from 'lit';
import { base, pageStyles } from '../shared/styles';
import { icon } from '../shared/icons';
import { VzPage } from '../shared/page_base';
import { t } from '@vz/common/i18n';

interface Bm { id: number; url: string; title: string; folder: string }

class VzBookmarks extends VzPage<Bm[]> {
  static override properties = { ...VzPage.properties, q: { state: true } };
  q = '';
  static override styles = [base, pageStyles, css`.folder { font-size: var(--vz-text-xs); font-weight: 700; color: var(--vz-text-3); margin: 18px 12px 6px; display: flex; gap: 6px; align-items: center; }
    .list-item { cursor: pointer; } .list-item .del { opacity: 0; } .list-item:hover .del { opacity: 1; } .host { color: var(--vz-text-3); font-size: var(--vz-text-s); } input[type=search] { width: 260px; height: 34px; }`];

  override render() {
    if (!this.data) return this.loading();
    const q = this.q.toLowerCase();
    const items = this.data.filter((b) => !q || `${b.title} ${b.url}`.toLowerCase().includes(q));
    const folders = [...new Set(items.map((b) => b.folder))];
    return html`<div class="page"><header class="page-head"><h1>${t('cmd_bookmarks')}</h1>
      <input type="search" placeholder=${t('history_search')} @input=${(e: InputEvent) => (this.q = (e.target as HTMLInputElement).value)} /></header>
      <div class="card" style="padding:6px">${items.length ? folders.map((f) => html`<div class="folder">${icon('folder', 13)} ${f || t('bookmarks_unsorted')}</div>
        ${items.filter((b) => b.folder === f).map((b) => html`<div class="list-item" role="link" tabindex="0" @click=${() => this.invoke('open', { url: b.url })}>${icon('star', 15)}
          <span class="ellipsis" style="flex:1">${b.title} <span class="host">${b.url.replace(/^https?:\/\//, '')}</span></span>
          <button class="icon-btn del" aria-label=${t('action_delete')} @click=${async (e: Event) => (e.stopPropagation(), (this.data = await this.invoke('remove', b.id)))}>${icon('trash', 14)}</button></div>`)}`)
        : html`<div class="empty">${t('bookmarks_empty')}</div>`}</div></div>`;
  }
}
customElements.define('vz-bookmarks', VzBookmarks);
