// <vz-toolbar>: a slim, Chrome-like toolbar: navigation, the pill omnibox (domain
// emphasized, path dimmed, security + Shields inside), and icon-only actions.
// "compact" mode is used in the vertical layout when the sidebar is hidden.
import { LitElement, css, html, nothing } from 'lit';
import { base } from '../shared/styles';
import { icon } from '../shared/icons';
import { PROFILE_HEX } from '@vz/common/tokens';
import { t } from '@vz/common/i18n';
import type { UpdateInfo, WindowState } from '@vz/common/types';
import { shell } from './shell';
import { securityIcon } from './common';

interface ExtAction { id: string; title?: string; text?: string; color?: string; iconModified?: number; tabs?: Record<string, { title?: string; text?: string; color?: string; iconModified?: number }> }
interface ExtBridge {
  getState(): Promise<{ activeTabId?: number; actions: ExtAction[] }>;
  activate(details: unknown): Promise<void>;
  observe(fn: () => void): () => void;
}
const vzExt = (globalThis as unknown as { vzExt?: ExtBridge }).vzExt;

export class VzToolbar extends LitElement {
  static override properties = { state: { attribute: false }, mode: { type: String }, rail: { type: Boolean }, actions: { state: true } };
  /** Extension toolbar buttons (electron-chrome-extensions browserAction state). */
  actions = new Map<string, ExtAction>();
  private stopExt: (() => void) | null = null;
  private lastExtCount = -1;
  state!: WindowState;
  mode: 'full' | 'compact' = 'full';
  /** The collapsed tab rail sits to the left (it holds the sidebar button and clears the traffic lights). */
  rail = false;

  static override styles = [
    base,
    css`
      :host { display: flex; align-items: center; gap: 2px; height: 46px; color: var(--vz-text-2); padding: 0 10px; position: relative; z-index: 1; }
      :host([mode='compact']) { -webkit-app-region: drag; }
      :host > * { -webkit-app-region: no-drag; }
      .icon-btn { width: 34px; height: 34px; border-radius: 50%; }
      .omni { flex: 1; display: flex; align-items: center; gap: 6px; height: 36px; margin: 0 8px; padding: 0 6px 0 4px; min-width: 0;
        border-radius: 999px; background: var(--vz-omnibox-bg, var(--vz-omnibox)); transition: background var(--vz-dur), box-shadow 240ms var(--vz-ease); }
      .omni:hover { background: var(--vz-omnibox-hover); }
      /* Focus: the field turns solid and a soft accent glow spreads around it. */
      .omni:focus-within { background: var(--vz-toolbar); box-shadow: 0 0 0 2px var(--vz-accent), 0 0 0 6px color-mix(in srgb, var(--vz-accent) 16%, transparent); }
      .sec { width: 28px; height: 28px; border-radius: 50%; display: grid; place-items: center; color: var(--vz-text-2); flex: none; }
      button.sec { border: 0; background: transparent; cursor: pointer; transition: background var(--vz-dur); }
      button.sec:hover { background: var(--vz-surface-hover); }
      button.sec.live { color: #fff; background: #dc2626; animation: pop 220ms var(--vz-ease); }
      .sec.insecure, .sec.dangerous { color: var(--vz-danger); background: color-mix(in srgb, var(--vz-danger) 12%, transparent); width: auto; padding: 0 8px; border-radius: 999px; gap: 4px; display: inline-flex; align-items: center; font-size: 11px; font-weight: 700; }
      .addr { all: unset; flex: 1; min-width: 0; height: 100%; display: flex; align-items: center; cursor: text; white-space: nowrap; overflow: hidden; font-size: 14px; letter-spacing: .005em; }
      .addr:focus-visible { outline: none; }
      .host { color: var(--vz-text); }
      .path { color: var(--vz-text-3); overflow: hidden; text-overflow: ellipsis; }
      .ph { color: var(--vz-text-3); }
      .chip-btn { display: inline-flex; align-items: center; gap: 3px; height: 26px; padding: 0 8px; border: 0; border-radius: 999px; background: transparent; color: var(--vz-text-2);
        cursor: pointer; font-size: 11px; font-weight: 700; font-variant-numeric: tabular-nums; flex: none; transition: background var(--vz-dur); }
      .chip-btn:hover { background: var(--vz-surface-hover); }
      .chip-btn.has { color: var(--vz-accent); }
      /* "Install": a soft accent pill that arrives with a little spring, hard to miss but quiet. */
      .chip-btn.install { gap: 5px; padding: 0 10px 0 8px; font-size: 12px; font-weight: 650; color: var(--vz-accent); background: var(--vz-accent-soft); animation: install-in 420ms cubic-bezier(.34,1.56,.64,1); }
      .chip-btn.install:hover { background: color-mix(in srgb, var(--vz-accent) 20%, transparent); }
      @keyframes install-in { from { opacity: 0; transform: scale(.7); } }
      .lead { width: var(--traffic, 0); flex: none; }
      .end { width: var(--controls, 0); flex: none; }
      .sep { width: 1px; height: 18px; background: var(--vz-border); margin: 0 6px; }
      .toast { display: inline-flex; align-items: center; gap: 6px; max-width: 280px; height: 30px; padding: 0 4px 0 12px; border-radius: 999px; font-size: 12px;
        background: var(--vz-bg-elev); box-shadow: var(--vz-shadow-pop); animation: pop 220ms var(--vz-ease); }
      .toast span { white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
      .toast button { border: 0; background: transparent; color: var(--vz-accent); font-weight: 700; cursor: pointer; padding: 4px 8px; border-radius: 999px; font-size: 12px; }
      .toast button:hover { background: var(--vz-surface-hover); }
      @keyframes pop { from { opacity: 0; transform: translateY(-4px) scale(.97); } }
      .on { color: var(--vz-accent); background: var(--vz-accent-soft); }
      /* Update button: tinted when available, a progress ring while downloading, solid when ready. */
      .upd { display: inline-flex; align-items: center; gap: 6px; height: 32px; padding: 0 12px 0 9px; margin: 0 2px; border: 0; border-radius: 999px; cursor: pointer; flex: none;
        background: var(--vz-accent-soft); color: var(--vz-accent); font-size: 12px; font-weight: 700; font-variant-numeric: tabular-nums;
        animation: pop 260ms var(--vz-ease); transition: background var(--vz-dur), color var(--vz-dur), transform var(--vz-dur) var(--vz-ease); }
      .upd:hover { transform: translateY(-1px); }
      .upd:active { transform: scale(.96); }
      .upd[disabled] { cursor: default; transform: none; }
      .upd.ready { background: var(--vz-accent); color: var(--vz-on-accent); animation: pop 260ms var(--vz-ease), breathe 2.6s ease-in-out 600ms infinite; }
      .upd.error { background: color-mix(in srgb, var(--vz-danger) 12%, transparent); color: var(--vz-danger); }
      .upd .ring { width: 16px; height: 16px; border-radius: 50%;
        background: conic-gradient(var(--vz-accent) calc(var(--p) * 1%), color-mix(in srgb, var(--vz-accent) 18%, transparent) 0);
        -webkit-mask: radial-gradient(circle, transparent 4.5px, #000 5px); transition: --p 200ms; }
      @keyframes breathe { 50% { transform: scale(1.05); } }
      /* Responsive: secondary controls fold into the ⋮ menu as the window narrows. */
      .ext { position: relative; }
      .ext img { width: 18px; height: 18px; border-radius: 4px; }
      .ext .badge { position: absolute; right: 1px; bottom: 3px; min-width: 15px; height: 14px; padding: 0 3px; border-radius: 7px; font-size: 9.5px; font-weight: 700; line-height: 14px; color: #fff; text-align: center; pointer-events: none; box-shadow: 0 0 0 1.5px var(--vz-toolbar); }
      .me-av { width: 24px; height: 24px; border-radius: 50%; display: grid; place-items: center; background: var(--c); color: #fff; font-size: 11.5px; font-weight: 700; transition: transform var(--vz-dur) var(--vz-ease); }
      .me:hover .me-av { transform: scale(1.08); }
      .tabs-btn { display: none; }
      @media (max-width: 760px) {
        .wide { display: none; }
        .omni { margin: 0 2px; }
        .toast { max-width: 180px; }
      }
      @media (max-width: 599px) {
        .mid { display: none; }
        .tabs-btn { display: grid; }
        .sidebar-btn { display: none; }
        .toast span { display: none; }
        .icon-btn { width: 32px; height: 32px; }
      }
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
      ${compact && mac && !s.fullscreen && !this.rail ? html`<span class="lead" style="--traffic:70px"></span>` : nothing}
      ${compact && !this.rail ? html`<button class="icon-btn sidebar-btn" aria-label=${t('cmd_toggle_sidebar')} title=${t('cmd_toggle_sidebar')} @click=${() => shell.runCommand('view.toggleSidebar')}>${icon('sidebar', 17)}</button>
        <button class="icon-btn tabs-btn" aria-label=${t('cmd_tab_search')} title=${t('cmd_tab_search')} @click=${() => shell.runCommand('tab.search')}>${icon('layers', 17)}</button>` : nothing}
      <button class="icon-btn" aria-label=${t('cmd_nav_back')} title=${t('cmd_nav_back')} data-kbd=${mac ? '⌘[' : 'Alt+←'} ?disabled=${!tab?.canGoBack} @click=${() => tab && shell.goBack(tab.id)}>${icon('arrow-left', 17)}</button>
      <button class="icon-btn mid" aria-label=${t('cmd_nav_forward')} title=${t('cmd_nav_forward')} data-kbd=${mac ? '⌘]' : 'Alt+→'} ?disabled=${!tab?.canGoForward} @click=${() => tab && shell.goForward(tab.id)}>${icon('arrow-right', 17)}</button>
      <button class="icon-btn" aria-label=${tab?.loading ? t('action_stop') : t('cmd_nav_reload')} title=${tab?.loading ? t('action_stop') : t('cmd_nav_reload')} data-kbd=${tab?.loading ? 'Esc' : mac ? '⌘R' : 'Ctrl+R'}
        @click=${() => tab && (tab.loading ? shell.stop(tab.id) : shell.reload(tab.id))}>${icon(tab?.loading ? 'x' : 'refresh', 16)}</button>
      ${compact && !this.rail ? html`<button class="icon-btn" aria-label=${t('cmd_tab_new')} title=${t('cmd_tab_new')} data-kbd=${mac ? '⌘T' : 'Ctrl+T'} @click=${() => shell.newTab()}>${icon('plus', 18)}</button>` : nothing}
      <div class="omni">
        ${host && tab && /^https?:/.test(tab.url)
          ? html`<button class="sec ${sec} ${tab.inUse.length ? 'live' : ''}" aria-label=${t('si_open')} title=${t(`security_${sec}` as never)} @click=${(e: MouseEvent) => {
              const r = (e.currentTarget as HTMLElement).getBoundingClientRect();
              void shell.openSiteInfo({ x: Math.round(r.x), y: Math.round(r.y), width: Math.round(r.width), height: Math.round(r.height) });
            }}>${tab.inUse.length ? icon(tab.inUse.includes('camera') ? 'eye' : tab.inUse.includes('microphone') ? 'volume' : tab.inUse.includes('display-capture') ? 'columns' : 'globe', 14) : icon(securityIcon(sec), 15)}${sec === 'insecure' || sec === 'dangerous' ? html`<span>${t(`security_${sec}_short` as never)}</span>` : nothing}</button>`
          : html`<span class="sec ${sec}" title=${t(`security_${sec}` as never)}>${icon(host ? securityIcon(sec) : 'search', 15, t(`security_${sec}` as never))}</span>`}
        <button class="addr" title=${t('cb_address_label')} data-kbd=${mac ? '⌘L' : 'Ctrl+L'} @click=${(e: MouseEvent) => this.open(e)}>
          ${host ? html`<span class="host">${host}</span><span class="path">${path}</span>` : html`<span class="ph">${t('cb_placeholder')}</span>`}
        </button>
        ${tab && s.install?.state === 'installable'
          ? html`<button class="chip-btn install" aria-label=${t('app_install_named', { name: s.install.name })} title=${t('app_install_named', { name: s.install.name })} @click=${() => shell.installApp(tab.id)}>${icon('app-install', 14)}<span>${t('app_install')}</span></button>`
          : tab && s.install?.state === 'installed'
            ? html`<button class="chip-btn wide" aria-label=${t('app_open_in', { name: s.install.name })} title=${t('app_open_in', { name: s.install.name })} @click=${() => shell.openInApp(tab.id)}>${icon('external', 14)}</button>`
            : nothing}
        ${tab && /^https?:/.test(tab.url)
          ? html`<button class="chip-btn ${tab.blocked ? 'has' : ''}" aria-label=${t('shields_button', { count: tab.blocked })} title=${t('shields_button', { count: tab.blocked })}
              @click=${(e: MouseEvent) => {
                const r = (e.currentTarget as HTMLElement).getBoundingClientRect();
                void shell.openShieldsPanel({ x: r.x, y: r.y, width: r.width, height: r.height });
              }}>${icon(tab.blocked ? 'shield-check' : 'shield', 14)}${tab.blocked || nothing}</button>
            ${tab.passwords.form || tab.passwords.logins
              ? html`<button class="chip-btn ${tab.passwords.logins ? 'has' : ''}" aria-label=${t('pw_key_button')} title=${t('pw_key_button')}
                  @click=${(e: MouseEvent) => {
                    const r = (e.currentTarget as HTMLElement).getBoundingClientRect();
                    void shell.showPasswordMenu(tab.id, { x: Math.round(r.left), y: Math.round(r.bottom + 4) });
                  }}>${icon('key', 14)}</button>`
              : nothing}
            <button class="chip-btn wide" aria-label=${t('cmd_reader')} title=${t('cmd_reader')} @click=${() => shell.runCommand('view.reader')}>${icon('reader', 14)}</button>
            <button class="chip-btn wide" aria-label=${t('cmd_bookmark')} title=${t('cmd_bookmark')} @click=${() => shell.runCommand('nav.bookmark')}>${icon('star', 14)}</button>`
          : nothing}
      </div>
      <button class="icon-btn wide" aria-label=${t('cmd_tools')} title=${t('cmd_tools')} aria-haspopup="menu" @click=${(e: MouseEvent) => {
        const r = (e.currentTarget as HTMLElement).getBoundingClientRect();
        void shell.openToolsMenu({ x: Math.round(r.x), y: Math.round(r.y), width: Math.round(r.width), height: Math.round(r.height) });
      }}>${icon('wand', 17)}</button>
      ${this.renderExtensions()}
      ${toast ? html`<div class="toast" role="status" aria-live="polite"><span>${toast.text}</span>
          ${toast.action ? html`<button @click=${() => shell.toastAction(toast.id)}>${toast.action.label}</button>` : nothing}
          <button aria-label=${t('action_close')} style="color:var(--vz-text-2)" @click=${() => shell.dismissToast(toast.id)}>${icon('x', 12)}</button></div>` : nothing}
      ${s.aiMode !== 'off' ? html`<button class="icon-btn ${s.panel === 'assistant' ? 'on' : ''}" aria-label=${t('cmd_ai_panel')} title=${t('cmd_ai_panel')} aria-pressed=${s.panel === 'assistant'} @click=${() => shell.runCommand('ai.panel')}>${icon('sparkle', 17)}</button>` : nothing}
      ${s.features.VizullaNotes ? html`<button class="icon-btn wide ${s.panel === 'notes' ? 'on' : ''}" aria-label=${t('cmd_notes_panel')} title=${t('cmd_notes_panel')} aria-pressed=${s.panel === 'notes'} @click=${() => shell.runCommand('notes.panel')}>${icon('note', 17)}</button>` : nothing}
      ${s.features.VizullaAgent ? html`<button class="icon-btn wide ${s.panel === 'agent' ? 'on' : ''}" aria-label=${t('agent_panel')} title=${t('agent_panel')} aria-pressed=${s.panel === 'agent'} @click=${() => shell.setPanel('agent')}>${icon('bot', 17)}</button>` : nothing}
      ${s.update ? this.renderUpdate(s.update) : nothing}
      <span class="sep wide"></span>
      <button class="icon-btn wide" aria-label=${t('cmd_downloads')} title=${t('cmd_downloads')} @click=${() => shell.runCommand('page.downloads')}>${icon('download', 17)}</button>
      ${s.platform.endsWith(':private')
        ? nothing
        : html`<button class="icon-btn me" aria-label=${t('profile_avatar', { name: s.profile.name })} title=${t('profile_avatar', { name: s.profile.name })}
            @click=${(e: MouseEvent) => {
              const r = (e.currentTarget as HTMLElement).getBoundingClientRect();
              void shell.showProfileMenu({ x: Math.round(r.left), y: Math.round(r.bottom + 4) });
            }}><span class="me-av" style="--c:${PROFILE_HEX[s.profile.color] ?? PROFILE_HEX.blue}">${(s.profile.name[0] ?? '?').toUpperCase()}</span></button>`}
      <button class="icon-btn" aria-label=${t('menu_more')} title=${t('menu_more')} aria-haspopup="menu" @click=${(e: MouseEvent) => {
        const r = (e.currentTarget as HTMLElement).getBoundingClientRect();
        void shell.openAppMenu({ x: Math.round(r.x), y: Math.round(r.y), width: Math.round(r.width), height: Math.round(r.height) });
      }}>${icon('more-v', 18)}</button>
      ${compact && !mac ? html`<span class="end" style="--controls:138px"></span>` : nothing}
    `;
  }

  override disconnectedCallback(): void {
    super.disconnectedCallback();
    this.stopExt?.();
    this.stopExt = null;
  }

  protected override willUpdate(): void {
    // Start listening once extensions exist; refresh when the set changes.
    const count = this.state?.extensions?.count ?? 0;
    if (!vzExt || count === this.lastExtCount) return;
    this.lastExtCount = count;
    if (count && !this.stopExt) this.stopExt = vzExt.observe(() => void this.refreshExtensions());
    void this.refreshExtensions();
  }

  private async refreshExtensions(): Promise<void> {
    if (!vzExt) return;
    try {
      const st = await vzExt.getState();
      this.actions = new Map(st.actions.map((a) => [a.id, a]));
    } catch {
      /* extensions still starting */
    }
  }

  /** Pinned extension buttons (badge, title and icon per tab), then the extensions menu. */
  private renderExtensions() {
    const ext = this.state.extensions;
    if (!ext?.count) return nothing;
    const tab = ext.activeWcId ?? -1;
    return html`${ext.pinned.map((id) => {
        const a = this.actions.get(id);
        if (!a) return nothing;
        const info = { ...a, ...(a.tabs?.[String(tab)] ?? {}) };
        const q = new URLSearchParams({ tabId: String(tab), partition: 'vizulla-extensions', ...(info.iconModified ? { t: String(info.iconModified) } : {}) });
        const title = info.title || id;
        const fire = (e: MouseEvent, eventType: 'click' | 'contextmenu') => {
          const r = (e.currentTarget as HTMLElement).getBoundingClientRect();
          void vzExt?.activate({ eventType, extensionId: id, tabId: tab, alignment: 'bottom left', anchorRect: { x: r.left, y: r.top, width: r.width, height: r.height } });
        };
        return html`<button class="icon-btn ext wide" title=${title} aria-label=${title} data-ext=${id}
          @click=${(e: MouseEvent) => fire(e, 'click')} @contextmenu=${(e: MouseEvent) => (e.preventDefault(), fire(e, 'contextmenu'))}>
          <img src=${`crx://extension-icon/${id}/32/2?${q.toString()}`} alt="" />
          ${info.text ? html`<span class="badge" style="background:${info.color || 'var(--vz-accent)'}">${info.text}</span>` : nothing}</button>`;
      })}
      <button class="icon-btn" aria-label=${t('ext_puzzle')} title=${t('ext_puzzle')} @click=${(e: MouseEvent) => {
        const r = (e.currentTarget as HTMLElement).getBoundingClientRect();
        void shell.openExtensionsMenu({ x: Math.round(r.x), y: Math.round(r.y), width: Math.round(r.width), height: Math.round(r.height) });
      }}>${icon('puzzle', 17)}</button>`;
  }

  private renderUpdate(u: UpdateInfo) {
    const tip = {
      available: t('upd_available', { version: u.version }),
      downloading: t('upd_downloading', { version: u.version, percent: u.percent }),
      ready: t('upd_ready', { version: u.version }),
      installing: t('upd_installing'),
      error: t('upd_failed', { error: u.error ?? '' }),
    }[u.status];
    const busy = u.status === 'downloading' || u.status === 'installing';
    return html`<button class="upd ${u.status}" title=${tip} aria-label=${tip} ?disabled=${busy} style="--p:${u.percent}"
      @click=${() => shell.runCommand('app.update')}>
      ${u.status === 'downloading' ? html`<span class="ring" aria-hidden="true"></span><span>${u.percent}%</span>`
        : u.status === 'ready' || u.status === 'installing' ? html`${icon('refresh', 15)}<span class="mid">${u.version}</span>`
        : html`${icon(u.status === 'error' ? 'alert' : 'update', 16)}<span class="mid">${u.version}</span>`}
    </button>`;
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
