// vizulla://memory (P4-BRW-03, MEM-07): search, browse by site, delete by item,
// site, or time range, exclusions, opt-in switch, and wipe all.
import { css, html, nothing, unsafeCSS } from 'lit';
import { base, pageStyles } from '../shared/styles';
import { icon } from '../shared/icons';
import { VzPage, switchStyles, timeAgo } from '../shared/page_base';
import { t, getLocale } from '@vz/common/i18n';

interface Item { id: number; kind: string; url: string; title: string; site: string; visitedAt: number; saved: boolean; summary: string; tags: string[] }
interface Data { enabled: boolean; excluded: string[]; retentionDays: number; items: Item[] }
interface Hit { id: number; url: string; title: string; visitedAt: number; snippet: string; saved: boolean }

class VzMemory extends VzPage<{ enabled: boolean }> {
  static override properties = { ...VzPage.properties, d: { state: true }, hits: { state: true }, q: { state: true } };
  d: Data | null = null;
  hits: Hit[] | null = null;
  q = '';
  static override styles = [base, pageStyles, css`${unsafeCSS(switchStyles)}
    .hero { display: flex; gap: 14px; align-items: center; padding: 18px 20px; } .hero .grow { flex: 1; }
    input[type=search] { width: 100%; height: 40px; border-radius: 12px; padding-left: 14px; font-size: 14px; }
    .snip { color: var(--vz-text-2); font-size: var(--vz-text-s); margin-top: 2px; } .site { color: var(--vz-text-3); font-size: var(--vz-text-xs); }
    .list-item { align-items: flex-start; cursor: pointer; } .list-item .x { opacity: 0; } .list-item:hover .x { opacity: 1; }
    .tags { display: inline-flex; gap: 4px; margin-left: 6px; } .row-actions { display: flex; gap: 8px; flex-wrap: wrap; padding: 14px 20px; }`];

  protected override loaded(): void {
    void this.reload();
  }
  private async reload(): Promise<void> {
    this.d = await this.invoke<Data>('load');
  }
  private async search(q: string): Promise<void> {
    this.q = q;
    this.hits = q.trim() ? await this.invoke<Hit[]>('search', q) : null;
  }

  override render() {
    const d = this.d;
    if (!d) return this.loading();
    const fmt = new Intl.DateTimeFormat(getLocale(), { dateStyle: 'medium' });
    const sites = [...new Set(d.items.map((i) => i.site))].slice(0, 12);
    return html`<div class="page">
      <header class="page-head"><h1>${icon('brain', 26)} ${t('cmd_memory_page')}</h1></header>
      <div class="card"><div class="hero">${icon('lock', 18)}<div class="grow"><div class="title">${d.enabled ? t('memory_on') : t('memory_off')}</div>
        <div class="desc muted" style="font-size:12px">${t('set_memory_desc')}</div></div>
        ${this.toggle(d.enabled, async (v) => (this.d = await this.invoke<Data>('setEnabled', v)), t('set_memory'))}</div></div>
      <div style="margin:18px 0"><input type="search" placeholder=${t('memory_search')} aria-label=${t('memory_search')} @input=${(e: InputEvent) => this.search((e.target as HTMLInputElement).value)} /></div>
      <div class="card" style="padding:6px">
        ${(this.hits ?? d.items).length ? (this.hits ?? d.items).map((i) => html`<div class="list-item" role="link" tabindex="0" @click=${() => this.invoke('open', i.url)}>
            ${icon((i as Item).saved ? 'star' : 'globe', 16)}<div style="flex:1;min-width:0"><div class="ellipsis">${i.title}
              ${(i as Item).tags?.length ? html`<span class="tags">${(i as Item).tags.map((g) => html`<span class="chip">${g}</span>`)}</span>` : nothing}</div>
            ${(i as Hit).snippet ? html`<div class="snip">${(i as Hit).snippet}</div>` : (i as Item).summary ? html`<div class="snip">${(i as Item).summary}</div>` : nothing}
            <div class="site">${new URL(i.url).hostname} · ${timeAgo(i.visitedAt, getLocale())} · ${fmt.format(i.visitedAt)}</div></div>
            <button class="icon-btn x" aria-label=${t('action_delete')} @click=${async (e: Event) => { e.stopPropagation(); this.d = await this.invoke<Data>('remove', [i.id]); if (this.q) void this.search(this.q); }}>${icon('trash', 14)}</button></div>`)
          : html`<div class="empty">${this.q ? t('memory_no_results') : d.enabled ? t('memory_empty_on') : t('memory_empty_off')}</div>`}
      </div>
      ${sites.length ? html`<h2 style="margin:24px 0 8px;font-size:15px">${t('memory_by_site')}</h2><div class="card">${sites.map((s) => html`<div class="row section">${icon('globe', 15)}<div class="grow">${s}</div>
          <button class="btn ghost" @click=${async () => (this.d = await this.invoke<Data>('removeSite', s))}>${t('memory_forget_site')}</button>
          <button class="btn ghost" @click=${async () => (this.d = await this.invoke<Data>('exclude', s))}>${t('memory_exclude_site')}</button></div>`)}</div>` : nothing}
      ${d.excluded.length ? html`<h2 style="margin:24px 0 8px;font-size:15px">${t('memory_excluded')}</h2><div class="card">${d.excluded.map((s) => html`<div class="row section"><div class="grow">${s}</div>
          <button class="btn ghost" @click=${async () => (this.d = await this.invoke<Data>('unexclude', s))}>${t('action_remove')}</button></div>`)}</div>` : nothing}
      <div class="card" style="margin-top:24px"><div class="row-actions">
        <button class="btn" @click=${async () => (this.d = await this.invoke<Data>('removeRange', { from: Date.now() - 3600_000, to: Date.now() }))}>${t('memory_forget_hour')}</button>
        <button class="btn" @click=${async () => (this.d = await this.invoke<Data>('removeRange', { from: Date.now() - 86_400_000, to: Date.now() }))}>${t('memory_forget_day')}</button>
        <span style="flex:1"></span>
        <button class="btn danger" @click=${async () => confirm(t('memory_wipe_confirm')) && (this.d = await this.invoke<Data>('wipe'))}>${t('memory_wipe')}</button></div></div>
    </div>`;
  }
}
customElements.define('vz-memory', VzMemory);
