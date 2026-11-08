// <vz-toolbar>: a slim, Chrome-like toolbar: navigation, the pill omnibox (domain
// emphasized, path dimmed, security + Shields inside), and icon-only actions.
// "compact" mode is used in the vertical layout when the sidebar is hidden.
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
      :host { display: flex; align-items: center; gap: 2px; height: 46px; padding: 0 8px; background: var(--vz-toolbar); box-shadow: 0 1px 0 var(--vz-border); position: relative; z-index: 1; }
      :host([mode='compact']) { -webkit-app-region: drag; }
      :host > * { -webkit-app-region: no-drag; }
      .icon-btn { width: 34px; height: 34px; border-radius: 50%; }
      .omni { flex: 1; display: flex; align-items: center; gap: 6px; height: 36px; margin: 0 6px; padding: 0 6px 0 4px; min-width: 0;
        border-radius: 999px; background: var(--vz-omnibox); transition: background var(--vz-dur), box-shadow var(--vz-dur); }
      .omni:hover { background: var(--vz-omnibox-hover); }
      .omni:focus-within { background: var(--vz-toolbar); box-shadow: 0 0 0 2px var(--vz-accent); }
      .sec { width: 28px; height: 28px; border-radius: 50%; display: grid; place-items: center; color: var(--vz-text-2); flex: none; }
      .sec.insecure, .sec.dangerous { color: var(--vz-danger); background: color-mix(in srgb, var(--vz-danger) 12%, transparent); width: auto; padding: 0 8px; border-radius: 999px; gap: 4px; display: inline-flex; align-items: center; font-size: 11px; font-weight: 700; }
      .addr { all: unset; flex: 1; min-width: 0; height: 100%; display: flex; align-items: center; cursor: text; white-space: nowrap; overflow: hidden; font-size: 14px; }
      .addr:focus-visible { outline: none; }
      .host { color: var(--vz-text); }
      .path { color: var(--vz-text-3); overflow: hidden; text-overflow: ellipsis; }
      .ph { color: var(--vz-text-3); }
      .chip-btn { display: inline-flex; align-items: center; gap: 3px; height: 26px; padding: 0 8px; border: 0; border-radius: 999px; background: transparent; color: var(--vz-text-2);
        cursor: pointer; font-size: 11px; font-weight: 700; font-variant-numeric: tabular-nums; flex: none; transition: background var(--vz-dur); }
      .chip-btn:hover { background: var(--vz-surface-hover); }
      .chip-btn.has { color: var(--vz-accent); }
      .lead { width: var(--traffic, 0); flex: none; }
      .end { width: var(--controls, 0); flex: none; }
      .sep { width: 1px; height: 20px; background: var(--vz-border); margin: 0 4px; }
      .toast { display: inline-flex; align-items: center; gap: 6px; max-width: 280px; height: 30px; padding: 0 4px 0 12px; border-radius: 999px; font-size: 12px;
        background: var(--vz-glass-strong); backdrop-filter: blur(20px) saturate(160%); box-shadow: var(--vz-glass-shadow); animation: pop 220ms var(--vz-ease); }
      .toast span { white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
      .toast button { border: 0; background: transparent; color: var(--vz-accent); font-weight: 700; cursor: pointer; padding: 4px 8px; border-radius: 999px; font-size: 12px; }
      .toast button:hover { background: var(--vz-surface-hover); }
      @keyframes pop { from { opacity: 0; transform: translateY(-4px) scale(.97); } }
      .on { color: var(--vz-accent); background: var(--vz-accent-soft); }
    `,
  ];

  override render() {
    const s = this.state;
    const mac = s.platform.startsWith('darwin');
    const tab = s.tabs.find((x) => x.id === s.activeTabId);
    const sec = tab?.security ?? 'none';
    const compact = this.mode === 'compact';
    const [host, path] = splitUrl(tab?.displayUrl ?? '');
    const toast = s.toasts.at(-1);
    return html`
      ${compact && mac && !s.fullscreen ? html`<span class="lead" style="--traffic:70px"></span>` : nothing}
      ${compact ? html`<button class="icon-btn" aria-label=${t('cmd_toggle_sidebar')} title=${t('cmd_toggle_sidebar')} @click=${() => shell.runCommand('view.toggleSidebar')}>${icon('sidebar', 17)}</button>` : nothing}
      <button class="icon-btn" aria-label=${t('cmd_nav_back')} title=${t('cmd_nav_back')} ?disabled=${!tab?.canGoBack} @click=${() => tab && shell.goBack(tab.id)}>${icon('arrow-left', 17)}</button>
      <button class="icon-btn" aria-label=${t('cmd_nav_forward')} title=${t('cmd_nav_forward')} ?disabled=${!tab?.canGoForward} @click=${() => tab && shell.goForward(tab.id)}>${icon('arrow-right', 17)}</button>
      <button class="icon-btn" aria-label=${tab?.loading ? t('action_stop') : t('cmd_nav_reload')} title=${tab?.loading ? t('action_stop') : t('cmd_nav_reload')}
        @click=${() => tab && (tab.loading ? shell.stop(tab.id) : shell.reload(tab.id))}>${icon(tab?.loading ? 'x' : 'refresh', 16)}</button>
      <div class="omni">
        <span class="sec ${sec}" title=${t(`security_${sec}` as never)}>${icon(securityIcon(sec), 14, t(`security_${sec}` as never))}${sec === 'insecure' || sec === 'dangerous' ? html`<span>${t(`security_${sec}_short` as never)}</span>` : nothing}</span>
        <button class="addr" title=${t('cb_address_label')} @click=${(e: MouseEvent) => this.open(e)}>
          ${host ? html`<span class="host">${host}</span><span class="path">${path}</span>` : html`<span class="ph">${t('cb_placeholder')}</span>`}
        </button>
        ${tab && /^https?:/.test(tab.url)
          ? html`<button class="chip-btn ${tab.blocked ? 'has' : ''}" aria-label=${t('shields_button', { count: tab.blocked })} title=${t('shields_button', { count: tab.blocked })}
              @click=${(e: MouseEvent) => {
                const r = (e.currentTarget as HTMLElement).getBoundingClientRect();
                void shell.openShieldsPanel({ x: r.x, y: r.y, width: r.width, height: r.height });
              }}>${icon(tab.blocked ? 'shield-check' : 'shield', 14)}${tab.blocked || nothing}</button>
            <button class="chip-btn" aria-label=${t('cmd_reader')} title=${t('cmd_reader')} @click=${() => shell.runCommand('view.reader')}>${icon('reader', 14)}</button>
            <button class="chip-btn" aria-label=${t('cmd_bookmark')} title=${t('cmd_bookmark')} @click=${() => shell.runCommand('nav.bookmark')}>${icon('star', 14)}</button>`
          : nothing}
      </div>
      ${toast ? html`<div class="toast" role="status" aria-live="polite"><span>${toast.text}</span>
          ${toast.action ? html`<button @click=${() => shell.toastAction(toast.id)}>${toast.action.label}</button>` : nothing}
          <button aria-label=${t('action_close')} style="color:var(--vz-text-2)" @click=${() => shell.dismissToast(toast.id)}>${icon('x', 12)}</button></div>` : nothing}
      ${s.aiMode !== 'off' ? html`<button class="icon-btn ${s.panel === 'assistant' ? 'on' : ''}" aria-label=${t('cmd_ai_panel')} title=${t('cmd_ai_panel')} aria-pressed=${s.panel === 'assistant'} @click=${() => shell.runCommand('ai.panel')}>${icon('sparkle', 17)}</button>` : nothing}
      ${s.features.VizullaNotes ? html`<button class="icon-btn ${s.panel === 'notes' ? 'on' : ''}" aria-label=${t('cmd_notes_panel')} title=${t('cmd_notes_panel')} aria-pressed=${s.panel === 'notes'} @click=${() => shell.runCommand('notes.panel')}>${icon('note', 17)}</button>` : nothing}
      ${s.features.VizullaAgent ? html`<button class="icon-btn ${s.panel === 'agent' ? 'on' : ''}" aria-label=${t('agent_panel')} title=${t('agent_panel')} aria-pressed=${s.panel === 'agent'} @click=${() => shell.setPanel('agent')}>${icon('bot', 17)}</button>` : nothing}
      <span class="sep"></span>
      <button class="icon-btn" aria-label=${t('cmd_downloads')} title=${t('cmd_downloads')} @click=${() => shell.runCommand('page.downloads')}>${icon('download', 17)}</button>
      <button class="icon-btn" aria-label=${t('menu_more')} title=${t('menu_more')} @click=${(e: MouseEvent) => shell.showAppMenu({ x: e.clientX, y: e.clientY })}>${icon('more', 18)}</button>
      ${compact && !mac ? html`<span class="end" style="--controls:138px"></span>` : nothing}
    `;
  }

  private open(e: Event): void {
    const r = ((e.currentTarget as HTMLElement).closest('.omni') as HTMLElement).getBoundingClientRect();
    void shell.openCommandBar('address', { x: r.x, y: r.y, width: r.width, height: r.height });
  }
}

/** "news.example.com/a/b?c" → ["news.example.com", "/a/b?c"]; internal pages stay whole. */
function splitUrl(u: string): [string, string] {
  if (!u) return ['', ''];
  const m = /^((?:https?:\/\/)?[^/?#]+)(.*)$/.exec(u);
  return m ? [m[1]!, m[2]!] : [u, ''];
}
customElements.define('vz-toolbar', VzToolbar);
