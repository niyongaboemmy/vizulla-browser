// vizulla://apps: installed web apps. Open, put the shortcut back, remove. With none
// installed, a short guide shows where the Install button appears.
import { css, html, nothing } from 'lit';
import { base, pageStyles } from '../shared/styles';
import { icon } from '../shared/icons';
import { VzPage, timeAgo } from '../shared/page_base';
import { getLocale, t } from '@vz/common/i18n';

interface AppRow {
  id: string;
  name: string;
  origin: string;
  icon: string | null;
  installedAt: number;
  shortcutOk: boolean;
}
interface Data {
  apps: AppRow[];
  platform: string;
}

class VzApps extends VzPage<Data> {
  static override properties = { ...VzPage.properties, note: { state: true } };
  note = '';

  static override styles = [
    base,
    pageStyles,
    css`
      .lead { color: var(--vz-text-2); margin: -16px 0 22px; }
      .grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(220px, 1fr)); gap: 14px; }
      .app { position: relative; display: flex; flex-direction: column; align-items: center; gap: 10px; padding: 22px 16px 14px; border-radius: 20px; text-align: center;
        background: var(--vz-bg-elev); border: 1px solid var(--vz-border); transition: transform 220ms cubic-bezier(.34,1.56,.64,1), box-shadow 220ms var(--vz-ease); animation: in 320ms var(--vz-ease) backwards; }
      .app:hover { transform: translateY(-3px); box-shadow: 0 16px 40px -18px rgba(15, 23, 42, .35); }
      @keyframes in { from { opacity: 0; transform: translateY(6px); } }
      .tile { width: 72px; height: 72px; border-radius: 18px; display: grid; place-items: center; overflow: hidden; background: var(--vz-surface-2); cursor: pointer; border: 0; padding: 0; }
      .tile img { width: 100%; height: 100%; object-fit: contain; }
      .tile .letter { width: 100%; height: 100%; display: grid; place-items: center; background: var(--vz-accent); color: var(--vz-on-accent); font-size: 28px; font-weight: 750; }
      .name { font-weight: 650; font-size: 15px; max-width: 100%; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
      .origin { font-size: var(--vz-text-s); color: var(--vz-text-3); margin-top: -6px; max-width: 100%; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
      .row { display: flex; gap: 6px; margin-top: 4px; }
      .warn { font-size: var(--vz-text-xs); color: var(--vz-warn); display: flex; gap: 4px; align-items: center; }
      .empty { display: grid; justify-items: center; text-align: center; gap: 10px; padding: 48px 20px; border-radius: 24px; background: var(--vz-bg-elev); border: 1px solid var(--vz-border); }
      .empty .orb { width: 72px; height: 72px; border-radius: 22px; display: grid; place-items: center; color: var(--vz-accent); background: var(--vz-accent-soft); animation: float 3.2s ease-in-out infinite; }
      @keyframes float { 50% { transform: translateY(-5px); } }
      .empty h2 { margin: 6px 0 0; font-size: 18px; }
      .empty p { margin: 0; color: var(--vz-text-2); max-width: 460px; line-height: 1.5; }
      .demo { display: inline-flex; align-items: center; gap: 8px; margin-top: 8px; padding: 6px 8px 6px 14px; border-radius: 999px; background: var(--vz-omnibox); font-size: var(--vz-text-s); color: var(--vz-text-2); }
      .demo .pill { display: inline-flex; align-items: center; gap: 5px; padding: 4px 10px 4px 8px; border-radius: 999px; background: var(--vz-accent-soft); color: var(--vz-accent); font-weight: 650; animation: pulse 2.4s ease-in-out infinite; }
      @keyframes pulse { 50% { box-shadow: 0 0 0 6px color-mix(in srgb, var(--vz-accent) 14%, transparent); } }
      .steps { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 12px; margin-top: 18px; width: 100%; max-width: 640px; text-align: start; }
      .step { padding: 12px 14px; border-radius: 16px; background: var(--vz-surface-2); font-size: var(--vz-text-s); color: var(--vz-text-2); line-height: 1.45; }
      .step b { display: flex; align-items: center; gap: 6px; color: var(--vz-text); margin-bottom: 4px; }
      .note { margin-top: 14px; color: var(--vz-text-2); font-size: var(--vz-text-s); }
      @media (max-width: 640px) { .steps { grid-template-columns: 1fr; } }
    `,
  ];

  protected override loaded(): void {
    window.addEventListener('focus', () => void this.invoke<Data>('init').then((d) => (this.data = d)));
  }

  private async act(method: 'open' | 'uninstall' | 'repair', a: AppRow): Promise<void> {
    const d = await this.invoke<Data | null>(method, a.id);
    if (d) this.data = d;
    if (method === 'repair') this.note = t('apps_repaired', { name: a.name });
  }

  override render() {
    if (!this.data) return this.loading();
    const d = this.data;
    return html`<div class="page">
      <header class="page-head"><h1>${t('apps_title')}</h1></header>
      <p class="lead">${t('apps_lead')}</p>
      ${d.apps.length
        ? html`<div class="grid">${d.apps.map((a, i) => html`<div class="app" style="animation-delay:${i * 40}ms">
            <button class="tile" aria-label=${t('apps_open', { name: a.name })} @click=${() => void this.act('open', a)}>
              ${a.icon ? html`<img src=${a.icon} alt="" />` : html`<span class="letter">${(a.name[0] ?? 'A').toUpperCase()}</span>`}</button>
            <div class="name" title=${a.name}>${a.name}</div>
            <div class="origin">${a.origin.replace(/^https?:\/\//, '')} · ${timeAgo(a.installedAt, getLocale())}</div>
            ${a.shortcutOk ? nothing : html`<div class="warn">${icon('alert', 12)} ${t('apps_shortcut_missing')}</div>`}
            <div class="row">
              <button class="btn primary" @click=${() => void this.act('open', a)}>${t('action_open')}</button>
              ${a.shortcutOk ? nothing : html`<button class="btn" @click=${() => void this.act('repair', a)}>${t('apps_repair')}</button>`}
              <button class="icon-btn" title=${t('apps_remove')} aria-label=${t('apps_remove_named', { name: a.name })} @click=${() => void this.act('uninstall', a)}>${icon('trash', 15)}</button>
            </div>
          </div>`)}</div>`
        : html`<div class="empty">
            <span class="orb">${icon('app-install', 32)}</span>
            <h2>${t('apps_empty_title')}</h2>
            <p>${t('apps_empty_body')}</p>
            <span class="demo" aria-hidden="true">${icon('lock', 12)} example.com <span class="pill">${icon('app-install', 13)} ${t('app_install')}</span></span>
            <div class="steps">
              <div class="step"><b>${icon('globe', 14)} 1</b>${t('apps_step_1')}</div>
              <div class="step"><b>${icon('app-install', 14)} 2</b>${t('apps_step_2')}</div>
              <div class="step"><b>${icon('grid', 14)} 3</b>${t('apps_step_3', { where: d.platform === 'darwin' ? t('app_where_launchpad') : d.platform === 'win32' ? t('app_where_start') : t('app_where_menu') })}</div>
            </div>
          </div>`}
      ${this.note ? html`<p class="note" role="status">${this.note}</p>` : nothing}
    </div>`;
  }
}

customElements.define('vz-apps', VzApps);
