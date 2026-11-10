// <vz-shell>: the window chrome. Owns WindowState (pushed by the browser) and
// lays out the sidebar, content frame, panels, and the strips around the page.
// The page itself is a native view the browser places over #content.
import { LitElement, css, html, nothing } from 'lit';
import { base } from '../shared/styles';
import { icon } from '../shared/icons';
import { client, on } from '../shared/bridge';
import { installTooltips, setTooltipAvoid } from '../shared/tooltip';
import { applyLocale, applyTheme } from '../shared/theme';
import { ShellInterface } from '@vz/common/mojom/shell';
import { t } from '@vz/common/i18n';
import type { TabInfo, WindowState } from '@vz/common/types';
import './sidebar';
import './tabstrip';
import './tab_rail';
import './toolbar';
import './panels';
import './assistant_panel';
import './notes_panel';
import './agent_panel';

export const shell = client(ShellInterface);

/** Breakpoints (window width, CSS px). */
const NARROW = 860;
const TINY = 600;

export class VzShell extends LitElement {
  static override properties = { state: { state: true }, findOpen: { state: true }, findResult: { state: true }, resizing: { state: true }, vw: { state: true } };
  state: WindowState | null = null;
  findOpen = false;
  findResult: { active: number; total: number } | null = null;
  resizing: 'sidebar' | 'panel' | null = null;
  /** Window width: the layout adapts below NARROW and TINY. */
  vw = window.innerWidth;
  private ro = new ResizeObserver(() => this.reportBounds());
  private lastBounds = '';
  private lastLocale = '';

  static override styles = [
    base,
    css`
      /* One surface: tabs, toolbar, sidebar and panels sit on the same glass, with no lines between them. */
      :host { display: grid; height: 100vh; overflow: hidden; user-select: none; background-color: var(--vz-chrome-bg, var(--vz-toolbar)); background-image: var(--vz-glass-sheen, none); }
      :host([layout='vertical']) { grid-template-columns: auto 1fr auto; }
      :host([layout='horizontal']) { grid-template-rows: auto auto auto 1fr; grid-template-columns: 1fr auto; }
      :host([layout='horizontal']) vz-tabstrip, :host([layout='horizontal']) vz-toolbar, :host([layout='horizontal']) .bookmarks { grid-column: 1 / -1; }
      /* Explicit rows: the bookmarks row exists only in Classic mode; the page always gets the 1fr row. */
      :host([layout='horizontal']) vz-tabstrip { grid-row: 1; }
      :host([layout='horizontal']) vz-toolbar { grid-row: 2; }
      :host([layout='horizontal']) .bookmarks { grid-row: 3; }
      :host([layout='horizontal']) .main, :host([layout='horizontal']) .panel-host { grid-row: 4; }
      .main { display: flex; flex-direction: column; min-width: 0; min-height: 0; position: relative; }
      /* The page gets every pixel: no inset, no rounded frame. */
      .frame-wrap { flex: 1; display: flex; gap: 2px; min-height: 0; background: var(--vz-border); }
      .frame { flex: 1; min-width: 0; background: transparent; position: relative; }
      .frame.split-active { box-shadow: inset 0 2px 0 var(--vz-accent); }
      .strip {
        display: flex; align-items: center; gap: 8px; height: 42px; padding: 0 8px 0 14px; flex: none;
        background: var(--vz-glass-strong); backdrop-filter: blur(20px) saturate(160%); box-shadow: 0 1px 0 var(--vz-border); animation: slide 180ms var(--vz-ease);
      }
      @keyframes slide { from { opacity: 0; transform: translateY(-6px); } }
      .strip input { flex: 1; min-width: 0; min-height: 0; max-width: 420px; height: 28px; border-radius: 999px; padding: 0 12px; background: var(--vz-omnibox); border-color: transparent; }
      .strip .count { font-size: var(--vz-text-s); color: var(--vz-text-2); min-width: 56px; text-align: right; font-variant-numeric: tabular-nums; }
      .strip .grow { flex: 1; }
      .agent-bar { background: linear-gradient(90deg, color-mix(in srgb, var(--vz-accent) 16%, var(--vz-toolbar)), var(--vz-glass-strong)); }
      .agent-bar .label { flex: 1; font-weight: 600; min-width: 0; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
      .agent-bar .step { font-variant-numeric: tabular-nums; color: var(--vz-text-2); font-weight: 600; font-size: 12px; }
      .agent-bar .pulse { width: 8px; height: 8px; border-radius: 50%; background: var(--vz-accent); animation: pulse 1.4s ease-in-out infinite; flex: none; }
      @keyframes pulse { 50% { opacity: .3; transform: scale(.7); } }
      .panel-host { display: flex; }
      .resize { width: 6px; cursor: col-resize; position: relative; z-index: 2; margin: 0 -3px; }
      .resize::after { content: ''; position: absolute; inset: 30% 3px; border-radius: 2px; background: transparent; transition: background var(--vz-dur); }
      .resize:hover::after, .resize.active::after { background: var(--vz-border-strong); }
      .bookmarks { display: flex; gap: 2px; padding: 0 8px 6px; overflow: hidden; }
      .bookmarks button { display: inline-flex; align-items: center; gap: 6px; max-width: 180px; height: 28px; padding: 0 12px 0 9px; border: 0; background: transparent; border-radius: 999px; cursor: pointer; color: var(--vz-text-2); font-size: var(--vz-text-s); }
      .bookmarks button:hover { background: var(--vz-surface-hover); color: var(--vz-text); }
      .bookmarks img { width: 14px; height: 14px; }
      .bookmarks span { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
      .private-badge { position: fixed; right: 12px; bottom: 10px; z-index: 5; pointer-events: none; }
    `,
  ];

  override connectedCallback(): void {
    super.connectedCallback();
    on<WindowState>('Shell', 'state', (s) => this.apply(s));
    on('Shell', 'find-open', () => this.openFind());
    on<{ tabId: number; active: number; total: number }>('Shell', 'found', (r) => (this.findResult = { active: r.active, total: r.total }));
    void shell.getState().then((s: WindowState) => this.apply(s));
    installTooltips();
    // Web pages are drawn above the page area, so tooltips must stay off it.
    setTooltipAvoid(() => [...this.renderRoot.querySelectorAll('#content, #split')].map((el) => el.getBoundingClientRect()), {
      show: (r, doc) => void shell.showTip(r, doc),
      hide: () => void shell.hideTip(),
    });
    window.addEventListener('resize', () => {
      this.vw = window.innerWidth;
      this.reportBounds();
    });
    window.addEventListener('keydown', (e) => {
      if (e.key !== 'Escape') return;
      if (this.findOpen) this.closeFind();
      // Esc is the agent kill switch (C16) from anywhere in the window chrome.
      else if (this.state?.agent && ['planning', 'running', 'paused', 'awaiting-confirmation'].includes(this.state.agent.status)) void shell.agentControl('stop');
    });
  }

  private apply(s: WindowState): void {
    if (s.locale !== this.lastLocale) {
      applyLocale(s.locale);
      this.lastLocale = s.locale;
    }
    applyTheme(s.theme, s.accent, s.density);
    // Glass (macOS vibrancy, Windows Mica): the whole chrome is one light tint over the blurred
    // desktop, like iOS materials; a hairline highlight marks the glass edge.
    if (s.glass) {
      const root = document.documentElement.style;
      root.setProperty('--vz-chrome-bg', 'color-mix(in srgb, var(--vz-toolbar) 46%, transparent)');
      root.setProperty('--vz-glass-edge', 'inset 0 1px 0 color-mix(in srgb, #fff 22%, transparent)');
      // Light catching the top of the glass, and a field you can see the glass through.
      root.setProperty('--vz-glass-sheen', 'linear-gradient(180deg, color-mix(in srgb, #fff 12%, transparent), transparent 70%)');
      root.setProperty('--vz-omnibox-bg', 'color-mix(in srgb, var(--vz-omnibox) 72%, transparent)');
    } else {
      const root = document.documentElement.style;
      for (const k of ['--vz-chrome-bg', '--vz-glass-edge', '--vz-glass-sheen', '--vz-omnibox-bg']) root.removeProperty(k);
    }
    this.state = s;
    this.setAttribute('layout', s.layout);
    this.setAttribute('sidebar', s.sidebarCollapsed ? 'collapsed' : 'open');
    this.toggleAttribute('classic', s.classic);
    this.toggleAttribute('fullscreen', s.fullscreen);
  }

  get activeTab(): TabInfo | undefined {
    return this.state?.tabs.find((x) => x.id === this.state!.activeTabId);
  }

  protected override updated(): void {
    const content = this.renderRoot.querySelector('#content');
    const split = this.renderRoot.querySelector('#split');
    if (content && !(content as HTMLElement).dataset.observed) {
      (content as HTMLElement).dataset.observed = '1';
      this.ro.disconnect();
      this.ro.observe(content);
      if (split) this.ro.observe(split);
    }
    if (split && !(split as HTMLElement).dataset.observed) {
      (split as HTMLElement).dataset.observed = '1';
      this.ro.observe(split);
    }
    this.reportBounds();
  }

  private reportBounds(): void {
    const c = this.renderRoot.querySelector('#content')?.getBoundingClientRect();
    const s = this.renderRoot.querySelector('#split')?.getBoundingClientRect();
    if (!c) return;
    const r = (x: DOMRect) => ({ x: x.x, y: x.y, width: x.width, height: x.height });
    const key = JSON.stringify([r(c), s ? r(s) : null]);
    if (key === this.lastBounds) return;
    this.lastBounds = key;
    void shell.setContentBounds(r(c), s ? r(s) : undefined);
  }

  private openFind(): void {
    this.findOpen = true;
    this.findResult = null;
    void this.updateComplete.then(() => (this.renderRoot.querySelector('.find input') as HTMLInputElement | null)?.select());
  }

  private closeFind(): void {
    const tab = this.activeTab;
    if (tab) void shell.stopFind(tab.id);
    this.findOpen = false;
    this.findResult = null;
  }

  private onFind(e: KeyboardEvent | InputEvent, forward = true, next = false): void {
    const tab = this.activeTab;
    const input = this.renderRoot.querySelector('.find input') as HTMLInputElement;
    if (!tab) return;
    if (!input.value) {
      void shell.stopFind(tab.id);
      this.findResult = null;
      return;
    }
    if (e instanceof KeyboardEvent && e.key === 'Enter') {
      next = true;
      forward = !e.shiftKey;
    }
    void shell.find(tab.id, input.value, { forward, findNext: next });
  }

  private startResize(which: 'sidebar' | 'panel', e: PointerEvent): void {
    const s = this.state!;
    this.resizing = which;
    const startX = e.clientX;
    const startW = which === 'sidebar' ? s.sidebarWidth : s.panelWidth;
    const el = e.currentTarget as HTMLElement;
    el.setPointerCapture(e.pointerId);
    const move = (ev: PointerEvent) => {
      const dx = ev.clientX - startX;
      const w = which === 'sidebar' ? Math.max(180, Math.min(480, startW + dx)) : Math.max(300, Math.min(760, startW - dx));
      this.state = which === 'sidebar' ? { ...this.state!, sidebarWidth: w } : { ...this.state!, panelWidth: w };
    };
    const up = () => {
      el.removeEventListener('pointermove', move);
      el.removeEventListener('pointerup', up);
      this.resizing = null;
      if (which === 'sidebar') void shell.setSidebar({ width: Math.round(this.state!.sidebarWidth) });
      else void shell.setPanel(this.state!.panel ?? undefined, Math.round(this.state!.panelWidth));
    };
    el.addEventListener('pointermove', move);
    el.addEventListener('pointerup', up);
  }

  override render() {
    const s = this.state;
    if (!s) return nothing;
    const vertical = s.layout === 'vertical';
    const narrow = this.vw < NARROW;
    const tiny = this.vw < TINY;
    // Small windows: the sidebar narrows, then hides (tabs stay one click away in tab search).
    // Full screen keeps the tabs, as in Chrome (a page in full screen covers the window anyway).
    const showSidebar = vertical && !s.sidebarCollapsed && !tiny;
    // Collapsed, the sidebar becomes a slim rail of tab icons (as in Chrome), never nothing.
    const showRail = vertical && s.sidebarCollapsed && !tiny;
    const sidebarWidth = narrow ? Math.min(s.sidebarWidth, 200) : s.sidebarWidth;
    const panel = s.panel && !s.classic;
    // A side panel never takes more than half the window from the page.
    const panelWidth = Math.max(260, Math.min(s.panelWidth, Math.round(this.vw * (narrow ? 0.5 : 0.45))));
    return html`
      ${vertical ? nothing : html`<vz-tabstrip .state=${s}></vz-tabstrip><vz-toolbar .state=${s} mode="full"></vz-toolbar>${s.classic ? this.renderBookmarks() : nothing}`}
      ${showSidebar
        ? html`<div style="display:flex"><vz-sidebar .state=${s} style="width:${sidebarWidth}px"></vz-sidebar>
            <div class="resize ${this.resizing === 'sidebar' ? 'active' : ''}" role="separator" aria-orientation="vertical" aria-label=${t('a11y_resize_sidebar')}
              @pointerdown=${(e: PointerEvent) => this.startResize('sidebar', e)}></div></div>`
        : showRail
          ? html`<vz-tab-rail .state=${s}></vz-tab-rail>`
          : vertical
            ? html`<div></div>`
          : nothing}
      <div class="main">
        ${vertical && !showSidebar ? html`<vz-toolbar .state=${s} mode="compact" ?rail=${showRail}></vz-toolbar>` : nothing}
        ${s.agent ? this.renderAgentBar() : nothing}
        ${this.findOpen ? this.renderFind() : nothing}
        <div class="frame-wrap">
          <div class="frame ${s.splitTabId !== null ? 'split-active' : ''}" id="content"></div>
          ${s.splitTabId !== null ? html`<div class="frame" id="split"></div>` : nothing}
        </div>
      </div>
      ${panel
        ? html`<div class="panel-host">
            <div class="resize ${this.resizing === 'panel' ? 'active' : ''}" role="separator" aria-orientation="vertical" aria-label=${t('a11y_resize_panel')}
              @pointerdown=${(e: PointerEvent) => this.startResize('panel', e)}></div>
            <vz-panels .state=${s} style="width:${panelWidth}px"></vz-panels></div>`
        : nothing}
      ${s.platform.endsWith(':private') ? html`<span class="chip private-badge">${icon('eye-off', 12)} ${t('private_window')}</span>` : nothing}
    `;
  }

  private renderFind() {
    const r = this.findResult;
    return html`<div class="strip find" role="search">
      ${icon('search', 15)}
      <input type="search" placeholder=${t('find_placeholder')} aria-label=${t('find_placeholder')}
        @input=${(e: InputEvent) => this.onFind(e)} @keydown=${(e: KeyboardEvent) => (e.key === 'Enter' ? this.onFind(e) : e.key === 'Escape' && this.closeFind())} />
      <span class="grow"></span>
      <span class="count" aria-live="polite">${r ? (r.total ? t('find_count', { active: r.active, total: r.total }) : t('find_none')) : ''}</span>
      <button class="icon-btn" aria-label=${t('find_prev')} @click=${(e: Event) => this.onFind(e as unknown as InputEvent, false, true)}>${icon('chevron-left', 15)}</button>
      <button class="icon-btn" aria-label=${t('find_next')} @click=${(e: Event) => this.onFind(e as unknown as InputEvent, true, true)}>${icon('chevron-right', 15)}</button>
      <button class="icon-btn" aria-label=${t('action_close')} @click=${() => this.closeFind()}>${icon('x', 15)}</button>
    </div>`;
  }

  /** Browser-owned agent control bar: outside the page area, so pages can't cover it (C9, C16). */
  private renderAgentBar() {
    const a = this.state!.agent!;
    const running = a.status === 'running';
    const paused = a.status === 'paused';
    const active = running || paused || a.status === 'awaiting-confirmation' || a.status === 'planning' || a.status === 'awaiting-approval';
    return html`<div class="strip agent-bar" role="region" aria-label=${t('agent_bar_label')}>
      ${running ? html`<span class="pulse" aria-hidden="true"></span>` : icon('bot', 16)}
      ${a.stepCount && active ? html`<span class="step">${a.stepIndex + 1}/${a.stepCount}</span>` : nothing}
      <div class="label" title=${a.goal}>${a.stepLabel || a.goal}</div>
      <span class="chip" title=${a.session === 'grant' ? a.grantOrigin ?? '' : t('agent_isolated')}>${icon(a.session === 'grant' ? 'key' : 'shield', 11)} ${a.session === 'grant' ? a.grantOrigin : t('agent_isolated')}</span>
      ${active
        ? html`
            ${running ? html`<button class="icon-btn" aria-label=${t('agent_pause')} title=${t('agent_pause')} @click=${() => shell.agentControl('pause')}>${icon('pause', 15)}</button>` : nothing}
            ${paused ? html`<button class="icon-btn" aria-label=${t('agent_resume')} title=${t('agent_resume')} @click=${() => shell.agentControl('resume')}>${icon('play', 15)}</button>` : nothing}
            <button class="icon-btn" aria-label=${t('agent_takeover')} title=${t('agent_takeover')} @click=${() => shell.agentControl('takeover')}>${icon('hand', 15)}</button>
            <button class="btn danger" aria-label=${t('agent_stop')} title=${t('agent_stop')} @click=${() => shell.agentControl('stop')}>${icon('stop', 13)} <span class="kbd">Esc</span></button>`
        : html`<span class="chip">${t(`agent_status_${a.status.replace(/-/g, '_')}` as never)}</span>
            <button class="icon-btn" aria-label=${t('action_close')} title=${t('action_close')} @click=${() => shell.agentControl('stop')}>${icon('x', 14)}</button>`}
    </div>`;
  }

  private renderBookmarks() {
    const marks = this.state!.bookmarks;
    return html`<div class="bookmarks" role="toolbar" aria-label=${t('bookmarks_bar')}>
      ${marks.length
        ? marks.slice(0, 20).map((b) => html`<button title=${b.url} @click=${() => shell.newTab(b.url)}>${icon('star', 12)}<span>${b.title}</span></button>`)
        : html`<button @click=${() => shell.runCommand('page.bookmarks')}>${icon('star', 12)}<span>${t('cmd_bookmarks')}</span></button>`}
    </div>`;
  }
}
customElements.define('vz-shell', VzShell);
