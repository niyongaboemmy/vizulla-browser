// vizulla://extensions: Chrome-style extension management. Get extensions from the
// Chrome Web Store (or paste a store link), turn them on and off, pin, see details
// (permissions, site access, source), remove; developer mode loads unpacked folders,
// reloads them and updates store extensions.
import { css, html, nothing, unsafeCSS, type TemplateResult } from 'lit';
import { base, pageStyles } from '../shared/styles';
import { icon } from '../shared/icons';
import { VzPage, switchStyles } from '../shared/page_base';
import { page } from '../shared/bridge';
import { t } from '@vz/common/i18n';

interface Ext {
  id: string;
  name: string;
  version: string;
  description: string;
  icon: string | null;
  enabled: boolean;
  pinned: boolean;
  source: 'store' | 'unpacked';
  path: string;
  permissions: string[];
  hostPermissions: string[];
  hasAction: boolean;
  optionsUrl: string | null;
  homepage: string | null;
  error: string | null;
}
interface Data {
  list: Ext[];
  devMode: boolean;
}

const SENSITIVE = ['tabs', 'history', 'bookmarks', 'cookies', 'downloads', 'clipboardRead', 'clipboardWrite', 'notifications', 'webRequest', 'declarativeNetRequest'];

class VzExtensions extends VzPage<Data> {
  static override properties = { ...VzPage.properties, q: { state: true }, open: { state: true }, paste: { state: true }, pasteError: { state: true }, busy: { state: true }, confirm: { state: true }, flash: { state: true } };
  q = '';
  open: string | null = null;
  paste = '';
  pasteError = '';
  busy = '';
  confirm: string | null = null;
  flash = '';

  static override styles = [
    base,
    pageStyles,
    css`
      ${unsafeCSS(switchStyles)}
      .lead { color: var(--vz-text-2); margin: -16px 0 20px; }
      .bar { display: flex; gap: 10px; align-items: center; flex-wrap: wrap; margin-bottom: 18px; }
      .bar .search { flex: 1; min-width: 200px; }
      .get { display: flex; gap: 16px; align-items: center; padding: 18px 20px; border-radius: 22px; margin-bottom: 18px; border: 1px solid var(--vz-glass-border);
        background: linear-gradient(120deg, color-mix(in srgb, var(--vz-accent) 12%, var(--vz-glass-strong)), var(--vz-glass-strong)); backdrop-filter: blur(20px) saturate(160%); }
      .get .grow { flex: 1; min-width: 0; }
      .get h2 { margin: 0 0 2px; font-size: var(--vz-text-l); }
      .get .paste { display: flex; gap: 8px; margin-top: 10px; flex-wrap: wrap; }
      .get .paste input { flex: 1; min-width: 220px; }
      .err { color: var(--vz-danger); font-size: var(--vz-text-s); margin-top: 6px; }
      .grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(280px, 1fr)); gap: 14px; }
      .ext { display: flex; flex-direction: column; gap: 12px; padding: 16px; border-radius: 20px; border: 1px solid var(--vz-border); background: var(--vz-glass-strong);
        backdrop-filter: blur(20px) saturate(160%); animation: vz-rise 320ms var(--vz-ease) both; transition: border-color var(--vz-dur), transform var(--vz-dur) var(--vz-ease); }
      .ext:hover { border-color: color-mix(in srgb, var(--vz-accent) 35%, var(--vz-border)); transform: translateY(-2px); }
      .ext.off { opacity: .72; }
      .ext.broken { border-color: color-mix(in srgb, var(--vz-danger) 45%, var(--vz-border)); }
      .ext-head { display: flex; gap: 12px; align-items: flex-start; }
      .ext-head img, .mono { width: 40px; height: 40px; border-radius: 10px; flex: none; }
      .mono { display: grid; place-items: center; background: var(--vz-accent-soft); color: var(--vz-accent); font-weight: 700; font-size: 18px; }
      .ext-head .grow { flex: 1; min-width: 0; }
      .ext-head h3 { margin: 0; font-size: var(--vz-text-m); font-weight: 650; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
      .ver { font-size: var(--vz-text-xs); color: var(--vz-text-3); }
      .desc { font-size: var(--vz-text-s); color: var(--vz-text-2); display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical; overflow: hidden; min-height: 2.6em; }
      .ext-foot { display: flex; gap: 6px; align-items: center; }
      .ext-foot .grow { flex: 1; }
      .chip { font-size: 11px; font-weight: 700; padding: 2px 8px; border-radius: 999px; background: var(--vz-surface-2); color: var(--vz-text-2); }
      .detail { padding: 22px; border-radius: 22px; border: 1px solid var(--vz-border); background: var(--vz-glass-strong); backdrop-filter: blur(20px) saturate(160%); animation: vz-rise 260ms var(--vz-ease); }
      .detail .ext-head img, .detail .mono { width: 56px; height: 56px; border-radius: 14px; }
      .detail h2 { margin: 0; font-size: var(--vz-text-xl); }
      dl { display: grid; grid-template-columns: 160px 1fr; gap: 10px 16px; margin: 20px 0; font-size: var(--vz-text-m); }
      dt { color: var(--vz-text-2); }
      dd { margin: 0; min-width: 0; overflow-wrap: anywhere; }
      dd ul { margin: 0; padding-left: 18px; line-height: 1.6; }
      .actions { display: flex; gap: 8px; flex-wrap: wrap; }
      .note { color: var(--vz-text-3); font-size: var(--vz-text-s); margin-top: 22px; display: flex; gap: 8px; align-items: flex-start; }
      .flash { position: fixed; left: 50%; bottom: 28px; transform: translateX(-50%); padding: 10px 18px; border-radius: 999px; background: var(--vz-text); color: var(--vz-bg); font-size: var(--vz-text-s); animation: vz-rise 200ms var(--vz-ease); }
      @media (max-width: 600px) { dl { grid-template-columns: 1fr; } .get { flex-direction: column; align-items: stretch; } }
    `,
  ];

  protected override loaded(): void {
    const id = new URLSearchParams(location.search).get('id');
    if (id) this.open = id;
    page.on('changed', () => void this.refresh());
  }

  private async refresh(): Promise<void> {
    this.data = await this.invoke<Data>('init');
  }

  private async run(method: string, payload?: unknown, flash?: string): Promise<void> {
    this.busy = method;
    try {
      this.data = await this.invoke<Data>(method, payload);
      if (flash) this.toast(flash);
    } finally {
      this.busy = '';
    }
  }

  private toast(msg: string): void {
    this.flash = msg;
    setTimeout(() => (this.flash = ''), 2600);
  }

  override render() {
    const d = this.data;
    if (!d) return this.loading();
    const ext = this.open ? d.list.find((x) => x.id === this.open) : null;
    return html`<div class="page">
      <header class="page-head"><h1>${t('ext_title')}</h1>
        <label class="row" style="gap:10px;min-height:0">${t('ext_devmode')}${this.toggle(d.devMode, (on) => void this.run('setDevMode', on), t('ext_devmode'))}</label></header>
      <p class="lead">${t('ext_subtitle')}</p>
      ${ext ? this.renderDetail(ext, d) : this.renderList(d)}
      <p class="note">${icon('info', 14)}<span>${t('ext_compat_note')} ${t('ext_private_note')}</span></p>
      ${this.flash ? html`<div class="flash" role="status">${this.flash}</div>` : nothing}
    </div>`;
  }

  private renderList(d: Data): TemplateResult {
    const q = this.q.trim().toLowerCase();
    const list = d.list.filter((x) => !q || `${x.name} ${x.description}`.toLowerCase().includes(q));
    return html`
      <section class="get">
        <span class="mono" style="width:48px;height:48px">${icon('puzzle', 24)}</span>
        <div class="grow">
          <h2>${t('ext_get')}</h2>
          <div class="muted">${t('ext_get_body')}</div>
          <form class="paste" @submit=${(e: Event) => (e.preventDefault(), void this.openStore())}>
            <input type="text" .value=${this.paste} placeholder=${t('ext_paste_label')} aria-label=${t('ext_paste_label')}
              @input=${(e: InputEvent) => ((this.paste = (e.target as HTMLInputElement).value), (this.pasteError = ''))} />
            <button class="btn" type="submit" ?disabled=${!this.paste.trim()}>${t('ext_paste_go')}</button>
          </form>
          ${this.pasteError ? html`<div class="err" role="alert">${this.pasteError}</div>` : nothing}
        </div>
        <button class="btn primary" @click=${() => void this.invoke('openStore', '')}>${icon('external', 14)} ${t('ext_get')}</button>
      </section>
      <div class="bar">
        ${d.list.length > 3 ? html`<input class="search" type="search" placeholder=${t('ext_search')} aria-label=${t('ext_search')} .value=${this.q} @input=${(e: InputEvent) => (this.q = (e.target as HTMLInputElement).value)} />` : html`<span style="flex:1"></span>`}
        ${d.devMode
          ? html`<button class="btn" ?disabled=${!!this.busy} @click=${() => void this.run('loadUnpacked')}>${icon('folder', 14)} ${t('ext_load_unpacked')}</button>
              <button class="btn" ?disabled=${!!this.busy} @click=${() => void this.run('update', undefined, t('ext_updated'))}>${icon('refresh', 14)} ${t('ext_update')}</button>`
          : nothing}
      </div>
      ${list.length
        ? html`<div class="grid">${list.map((x, i) => this.renderCard(x, d, i))}</div>`
        : html`<div class="empty">${icon('puzzle', 28)}<h3>${t('ext_empty')}</h3><p>${t('ext_empty_body')}</p></div>`}`;
  }

  private mono(x: Ext): TemplateResult {
    return x.icon ? html`<img src=${x.icon} alt="" />` : html`<span class="mono" aria-hidden="true">${(x.name[0] ?? '?').toUpperCase()}</span>`;
  }

  private renderCard(x: Ext, d: Data, i: number): TemplateResult {
    return html`<article class="ext ${x.enabled ? '' : 'off'} ${x.error ? 'broken' : ''}" style="animation-delay:${i * 40}ms" aria-label=${x.name}>
      <div class="ext-head">${this.mono(x)}
        <div class="grow"><h3 title=${x.name}>${x.name}</h3><div class="ver">${x.version ? t('ext_version', { version: x.version }) : ''}${x.source === 'unpacked' ? html` · <span class="chip">${t('ext_source_unpacked')}</span>` : nothing}</div></div>
        ${x.error && !x.version ? nothing : this.toggle(x.enabled, (on) => void this.run('setEnabled', { id: x.id, on }), t('ext_toggle', { name: x.name }))}</div>
      <div class="desc">${x.error ? html`<span style="color:var(--vz-danger)">${t('ext_error')}: ${x.error}</span>` : x.description}</div>
      <div class="ext-foot">
        <button class="btn ghost" @click=${() => (this.open = x.id)}>${t('ext_details')}</button>
        ${d.devMode && x.source === 'unpacked' && x.version ? html`<button class="icon-btn" title=${t('ext_reload')} aria-label=${`${t('ext_reload')}: ${x.name}`} @click=${() => void this.run('reload', x.id)}>${icon('refresh', 15)}</button>` : nothing}
        <span class="grow"></span>
        ${this.confirm === x.id
          ? html`<button class="btn danger primary" @click=${() => ((this.confirm = null), void this.run('remove', x.id))}>${t('ext_remove_confirm', { name: x.name })}</button>`
          : html`<button class="btn ghost" @click=${() => (this.confirm = x.id)}>${t('ext_remove')}</button>`}
      </div>
    </article>`;
  }

  private renderDetail(x: Ext, d: Data): TemplateResult {
    const hosts = x.hostPermissions;
    const all = hosts.some((h) => h === '<all_urls>' || /^\*:\/\/\*\//.test(h) || /^https?:\/\/\*\/\*/.test(h));
    const sites = [...new Set(hosts.map((h) => h.replace(/^\*:\/\/|^https?:\/\//, '').replace(/\/.*$/, '')))].join(', ');
    const perms = x.permissions.filter((p) => SENSITIVE.includes(p));
    return html`<button class="btn ghost" style="margin-bottom:14px" @click=${() => ((this.open = null), history.replaceState(null, '', location.pathname))}>${icon('arrow-left', 14)} ${t('ext_back')}</button>
      <section class="detail" aria-labelledby="ext-name">
        <div class="ext-head">${this.mono(x)}
          <div class="grow"><h2 id="ext-name">${x.name}</h2><div class="ver">${x.version ? t('ext_version', { version: x.version }) : ''}</div></div>
          ${this.toggle(x.enabled, (on) => void this.run('setEnabled', { id: x.id, on }), t('ext_toggle', { name: x.name }))}</div>
        ${x.error ? html`<p class="err" role="alert">${t('ext_error')}: ${x.error}</p>` : html`<p>${x.description}</p>`}
        <dl>
          <dt>${t('ext_site_access')}</dt><dd>${all ? t('ext_site_all') : hosts.length ? t('ext_site_some', { sites }) : t('ext_site_none')}</dd>
          <dt>${t('ext_permissions')}</dt><dd>${perms.length ? html`<ul>${perms.map((p) => html`<li>${t(`extperm_${p}` as never)}</li>`)}</ul>` : t('ext_no_permissions')}</dd>
          <dt>${t('ext_source')}</dt><dd>${x.source === 'store' ? t('ext_source_store') : t('ext_source_unpacked')}</dd>
          <dt>${t('ext_id')}</dt><dd><code>${x.id}</code></dd>
          ${d.devMode ? html`<dt>${t('ext_path')}</dt><dd><code>${x.path}</code></dd>` : nothing}
        </dl>
        <div class="actions">
          ${x.hasAction && x.enabled ? html`<button class="btn" @click=${() => void this.run('setPinned', { id: x.id, on: !x.pinned })}>${icon('pin', 14)} ${x.pinned ? t('ext_unpin') : t('ext_pin')}</button>` : nothing}
          ${x.optionsUrl && x.enabled ? html`<button class="btn" @click=${() => void this.invoke('openUrl', x.optionsUrl)}>${icon('settings', 14)} ${t('ext_options')}</button>` : nothing}
          ${x.source === 'store' ? html`<button class="btn" @click=${() => void this.invoke('openStore', x.id)}>${icon('external', 14)} ${t('ext_store')}</button>` : nothing}
          <span style="flex:1"></span>
          ${this.confirm === x.id
            ? html`<button class="btn danger primary" @click=${() => ((this.confirm = null), (this.open = null), void this.run('remove', x.id))}>${t('ext_remove_confirm', { name: x.name })}</button>`
            : html`<button class="btn danger" @click=${() => (this.confirm = x.id)}>${icon('trash', 14)} ${t('ext_remove')}</button>`}
        </div>
      </section>`;
  }

  private async openStore(): Promise<void> {
    const ok = await this.invoke<boolean>('openStore', this.paste.trim());
    if (ok) this.paste = '';
    else this.pasteError = t('ext_paste_invalid');
  }
}

customElements.define('vz-extensions', VzExtensions);
