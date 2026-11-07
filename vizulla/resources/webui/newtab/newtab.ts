// Calm start page (P2-BRW-17): Command Bar focus, the current Space's pins,
// "continue where you left off". No feeds, no remote content, zero network requests.
import { css, html, nothing } from 'lit';
import { base, pageStyles } from '../shared/styles';
import { icon } from '../shared/icons';
import { VzPage } from '../shared/page_base';
import { t } from '@vz/common/i18n';
import type { SpaceInfo, TabInfo } from '@vz/common/types';

interface Data {
  space: SpaceInfo;
  pins: TabInfo[];
  recent: { url: string; title: string; favicon: string | null }[];
  archived: { id: number; url: string; title: string; favicon: string | null }[];
  engine: string;
  onboarded: boolean;
  aiMode: string;
}

class VzNewTab extends VzPage<Data> {
  static override styles = [
    base,
    pageStyles,
    css`
      :host { display: grid; place-items: start center; min-height: 100vh; background:
        radial-gradient(1200px 600px at 50% -10%, var(--vz-accent-soft), transparent 70%), var(--vz-bg-elev); }
      .wrap { width: min(680px, calc(100vw - 48px)); padding-top: 18vh; }
      .greet { font-size: 30px; font-weight: 700; letter-spacing: -0.03em; margin: 0 0 6px; }
      .sub { color: var(--vz-text-2); margin: 0 0 26px; display: flex; align-items: center; gap: 8px; }
      .bar { display: flex; align-items: center; gap: 12px; height: 56px; padding: 0 18px; border-radius: 18px; background: var(--vz-bg-elev);
        border: 1px solid var(--vz-border); box-shadow: var(--vz-shadow-pop); cursor: text; color: var(--vz-text-3); font-size: 16px; transition: transform var(--vz-dur) var(--vz-ease); }
      .bar:hover { transform: translateY(-1px); }
      .bar .grow { flex: 1; }
      h4 { font-size: var(--vz-text-xs); font-weight: 700; text-transform: uppercase; letter-spacing: 0.08em; color: var(--vz-text-3); margin: 34px 0 10px; }
      .pins { display: flex; flex-wrap: wrap; gap: 10px; }
      .pin { width: 84px; display: flex; flex-direction: column; align-items: center; gap: 8px; border: 0; background: transparent; cursor: pointer; padding: 8px 4px; border-radius: 14px; color: var(--vz-text-2); font-size: var(--vz-text-xs); }
      .pin:hover { background: var(--vz-surface-hover); }
      .pin .tile { width: 48px; height: 48px; border-radius: 14px; display: grid; place-items: center; background: var(--vz-surface-2); border: 1px solid var(--vz-border); }
      .pin img { width: 22px; height: 22px; }
      .pin span { max-width: 80px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
      .recent { display: grid; grid-template-columns: 1fr 1fr; gap: 4px 12px; }
      .recent button { all: unset; display: flex; align-items: center; gap: 10px; padding: 8px 10px; border-radius: 10px; cursor: pointer; min-width: 0; }
      .recent button:hover { background: var(--vz-surface-hover); }
      .recent button:focus-visible { outline: 2px solid var(--vz-focus); }
      .recent img, .recent .vz-icon { width: 16px; height: 16px; flex: none; color: var(--vz-text-3); }
      .recent span { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font-size: var(--vz-text-m); }
      .tips { display: flex; gap: 10px; flex-wrap: wrap; margin-top: 34px; }
      .tip { display: inline-flex; align-items: center; gap: 8px; font-size: var(--vz-text-s); color: var(--vz-text-2); background: var(--vz-surface-2); padding: 6px 12px; border-radius: 999px; border: 0; cursor: pointer; }
      .tip:hover { background: var(--vz-surface-hover); color: var(--vz-text); }
    `,
  ];

  override render() {
    const d = this.data;
    if (!d) return nothing;
    const hour = new Date().getHours();
    const greet = hour < 12 ? t('ntp_morning') : hour < 18 ? t('ntp_afternoon') : t('ntp_evening');
    const mac = navigator.platform.startsWith('Mac');
    return html`<div class="wrap">
      <h1 class="greet">${greet}</h1>
      <p class="sub">${icon(d.space.icon, 14)} ${t('ntp_in_space', { space: d.space.name })}</p>
      <div class="bar" role="button" tabindex="0"
        @click=${() => this.invoke('openCommandBar')} @keydown=${(e: KeyboardEvent) => e.key !== 'Tab' && this.invoke('openCommandBar')}>
        ${icon('search', 18)}<span class="grow">${t('ntp_search', { engine: d.engine })}</span><span class="kbd" aria-hidden="true">${mac ? '⌘K' : 'Ctrl+K'}</span>
      </div>
      ${d.pins.length
        ? html`<h4>${t('pinned_tabs')}</h4><div class="pins">${d.pins.map((p) => html`<button class="pin" @click=${() => this.invoke('open', { url: p.url })}>
            <span class="tile">${p.favicon ? html`<img src=${p.favicon} alt="" />` : icon('globe', 20)}</span><span>${p.title}</span></button>`)}</div>`
        : nothing}
      ${d.archived.length || d.recent.length
        ? html`<h4>${t('ntp_continue')}</h4><div class="recent">
            ${d.archived.map((a) => html`<button title=${a.url} @click=${() => this.invoke('restoreArchived', a.id)}>${icon('archive', 16)}<span>${a.title || a.url}</span></button>`)}
            ${d.recent.slice(0, 8 - d.archived.length).map((r) => html`<button title=${r.url} @click=${() => this.invoke('open', { url: r.url })}>
              ${r.favicon ? html`<img src=${r.favicon} alt="" />` : icon('globe', 16)}<span>${r.title || r.url}</span></button>`)}
          </div>`
        : nothing}
      <div class="tips">
        <button class="tip" @click=${() => this.invoke('command', { id: 'space.new' })}>${icon('layers', 13)} ${t('ntp_tip_space')}</button>
        ${d.aiMode !== 'off' ? html`<button class="tip" @click=${() => this.invoke('command', { id: 'ai.panel' })}>${icon('sparkle', 13)} ${t('ntp_tip_ai')}</button>` : nothing}
        <button class="tip" @click=${() => this.invoke('command', { id: 'page.import' })}>${icon('download', 13)} ${t('ntp_tip_import')}</button>
        ${!d.onboarded ? html`<button class="tip" @click=${() => this.invoke('open', { url: 'vizulla://onboarding' })}>${icon('zap', 13)} ${t('ntp_tip_setup')}</button>` : nothing}
      </div>
    </div>`;
  }
}
customElements.define('vz-newtab', VzNewTab);
