import { css, html, nothing } from 'lit';
import { base, pageStyles } from '../shared/styles';
import { icon } from '../shared/icons';
import { VzPage } from '../shared/page_base';
import { page } from '../shared/bridge';
import { t } from '@vz/common/i18n';

interface Dl { id: number; filename: string; url: string; state: string; received: number; total: number; startedAt: number }

const size = (n: number) => (n > 1e9 ? `${(n / 1e9).toFixed(1)} GB` : n > 1e6 ? `${(n / 1e6).toFixed(1)} MB` : `${Math.max(1, Math.round(n / 1e3))} KB`);

class VzDownloads extends VzPage<Dl[]> {
  static override styles = [base, pageStyles, css`.bar { height: 4px; border-radius: 2px; background: var(--vz-surface-2); overflow: hidden; margin-top: 6px; } .bar i { display: block; height: 100%; background: var(--vz-accent); transition: width .3s; }
    .meta { color: var(--vz-text-2); font-size: var(--vz-text-s); } .dl { padding: 12px 14px; }`];
  protected override loaded(): void {
    page.on<Dl[]>('changed', (d) => (this.data = d));
  }
  private act(id: number, what: string) {
    return async () => (this.data = await this.invoke('action', { id, what }));
  }
  override render() {
    if (!this.data) return this.loading();
    return html`<div class="page"><header class="page-head"><h1>${t('cmd_downloads')}</h1>
      <button class="btn" @click=${() => this.invoke('openFolder')}>${icon('folder', 14)} ${t('dl_open_folder')}</button>
      <button class="btn ghost" @click=${async () => (this.data = await this.invoke('clear'))}>${t('action_clear')}</button></header>
      <div class="card">${this.data.length ? this.data.map((d) => html`<div class="row dl">${icon('download', 18)}<div class="grow">
          <div class="title ellipsis">${d.filename}</div>
          <div class="meta">${d.state === 'progressing' ? `${size(d.received)} / ${d.total ? size(d.total) : '?'}` : t(`dl_${d.state}` as never)} · ${new URL(d.url).hostname}</div>
          ${d.state === 'progressing' ? html`<div class="bar"><i style="width:${d.total ? (100 * d.received) / d.total : 30}%"></i></div>` : nothing}</div>
        ${d.state === 'progressing' ? html`<button class="btn ghost" @click=${this.act(d.id, 'pause')}>${t('dl_pause')}</button><button class="btn ghost" @click=${this.act(d.id, 'cancel')}>${t('action_cancel')}</button>` : nothing}
        ${d.state === 'paused' ? html`<button class="btn ghost" @click=${this.act(d.id, 'resume')}>${t('dl_resume')}</button>` : nothing}
        ${d.state === 'completed' ? html`<button class="btn" @click=${this.act(d.id, 'open')}>${t('action_open')}</button><button class="icon-btn" aria-label=${t('dl_show')} @click=${this.act(d.id, 'show')}>${icon('folder', 15)}</button>` : nothing}
        <button class="icon-btn" aria-label=${t('action_remove')} @click=${this.act(d.id, 'remove')}>${icon('x', 14)}</button></div>`)
        : html`<div class="empty">${t('dl_empty')}</div>`}</div></div>`;
  }
}
customElements.define('vz-downloads', VzDownloads);
