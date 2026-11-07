// <vz-toolbar>: navigation + address field + page actions. "full" in the
// horizontal/Classic layout; "compact" in vertical layout when the sidebar is hidden.
import { LitElement, css, html, nothing } from 'lit';
import { base } from '../shared/styles';
import { icon } from '../shared/icons';
import { t } from '@vz/common/i18n';
import type { WindowState } from '@vz/common/types';
import { shell } from './shell';
import { securityIcon } from './common';

export class VzToolbar extends LitElement {
  static override properties = { state: { attribute: false }, mode: { type: String } };
  state!: WindowState;
  mode: 'full' | 'compact' = 'full';

  static override styles = [
    base,
    css`
      :host { display: flex; align-items: center; gap: 4px; height: 44px; padding: 0 8px; -webkit-app-region: drag; }
      :host([mode='full']) { background: var(--vz-bg-elev); border-bottom: 1px solid var(--vz-border); height: 42px; }
      :host > * { -webkit-app-region: no-drag; }
      .address { flex: 1; display: flex; align-items: center; gap: 8px; height: 30px; padding: 0 6px 0 12px; max-width: 900px; margin: 0 auto;
        border-radius: 999px; background: var(--vz-surface-2); cursor: text; color: var(--vz-text-2); min-width: 0; }
      .address:hover { background: var(--vz-surface-hover); }
      .addr-btn { flex: 1; min-width: 0; display: flex; align-items: center; gap: 8px; height: 100%; border: 0; background: transparent; padding: 0; cursor: text; color: inherit; text-align: start; }
      .url { flex: 1; min-width: 0; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; color: var(--vz-text); }
      .url.placeholder { color: var(--vz-text-3); }
      .insecure, .dangerous { color: var(--vz-danger); }
      .sec-label { font-size: var(--vz-text-xs); font-weight: 650; color: var(--vz-danger); }
      .shield { display: inline-flex; align-items: center; gap: 3px; border: 0; background: transparent; color: var(--vz-text-2); height: 24px; padding: 0 6px; border-radius: 999px; cursor: pointer; font-size: var(--vz-text-xs); font-weight: 650; }
      .shield.has { color: var(--vz-accent); }
      .shield:hover { background: var(--vz-surface-hover); }
      .end { width: var(--controls, 0); flex: none; }
      .lead { width: var(--traffic, 0); flex: none; }
    `,
  ];

  override render() {
    const s = this.state;
    const mac = s.platform.startsWith('darwin');
    const tab = s.tabs.find((x) => x.id === s.activeTabId);
    const sec = tab?.security ?? 'none';
    const compact = this.mode === 'compact';
    return html`
      ${compact && mac && !s.fullscreen ? html`<span class="lead" style="--traffic:70px"></span>` : nothing}
      ${compact ? html`<button class="icon-btn" aria-label=${t('cmd_toggle_sidebar')} @click=${() => shell.runCommand('view.toggleSidebar')}>${icon('sidebar', 16)}</button>` : nothing}
      <button class="icon-btn" aria-label=${t('cmd_nav_back')} ?disabled=${!tab?.canGoBack} @click=${() => tab && shell.goBack(tab.id)}>${icon('arrow-left', 16)}</button>
      <button class="icon-btn" aria-label=${t('cmd_nav_forward')} ?disabled=${!tab?.canGoForward} @click=${() => tab && shell.goForward(tab.id)}>${icon('arrow-right', 16)}</button>
      <button class="icon-btn" aria-label=${tab?.loading ? t('action_stop') : t('cmd_nav_reload')} @click=${() => tab && (tab.loading ? shell.stop(tab.id) : shell.reload(tab.id))}>${icon(tab?.loading ? 'x' : 'refresh', 16)}</button>
      <div class="address"><button class="addr-btn" title=${t('cb_address_label')} @click=${(e: MouseEvent) => this.open(e)}>
        <span class=${sec}>${icon(securityIcon(sec), 14, t(`security_${sec}` as never))}</span>
        ${sec === 'insecure' || sec === 'dangerous' ? html`<span class="sec-label">${t(`security_${sec}_short` as never)}</span>` : nothing}
        <span class="url ${tab?.displayUrl ? '' : 'placeholder'}">${tab?.displayUrl || t('cb_placeholder')}</span></button>
        ${tab && /^https?:/.test(tab.url)
          ? html`<button class="shield ${tab.blocked ? 'has' : ''}" aria-label=${t('shields_button', { count: tab.blocked })} @click=${(e: MouseEvent) => {
              e.stopPropagation();
              const r = (e.currentTarget as HTMLElement).getBoundingClientRect();
              void shell.openShieldsPanel({ x: r.x, y: r.y, width: r.width, height: r.height });
            }}>${icon('shield', 13)}${tab.blocked || ''}</button>`
          : nothing}
        <button class="icon-btn" aria-label=${t('cmd_bookmark')} @click=${(e: Event) => (e.stopPropagation(), shell.runCommand('nav.bookmark'))}>${icon('star', 14)}</button>
      </div>
      ${s.aiMode !== 'off' ? html`<button class="icon-btn ${s.panel === 'assistant' ? 'on' : ''}" aria-label=${t('cmd_ai_panel')} @click=${() => shell.runCommand('ai.panel')}>${icon('sparkle', 16)}</button>` : nothing}
      <button class="icon-btn" aria-label=${t('menu_more')} @click=${(e: MouseEvent) => shell.showAppMenu({ x: e.clientX, y: e.clientY })}>${icon('more', 16)}</button>
      ${!mac && (this.mode === 'compact' || !s.classic) && s.layout === 'vertical' ? html`<span class="end" style="--controls:138px"></span>` : nothing}
    `;
  }

  private open(e: Event): void {
    const r = ((e.currentTarget as HTMLElement).closest('.address') as HTMLElement).getBoundingClientRect();
    void shell.openCommandBar('address', { x: r.x, y: r.y, width: r.width, height: r.height });
  }
}
customElements.define('vz-toolbar', VzToolbar);
