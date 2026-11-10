// <vz-gemini-panel>: Gemini beside the page, as the Google account chosen in the avatar menu.
// The page itself is a browser-owned view (google/google_service.ts) laid over the .view box,
// whose place this element reports; the bar above it switches account, asks about the page,
// starts over, or moves the conversation to a tab.
import { LitElement, css, html, nothing } from 'lit';
import { base } from '../shared/styles';
import { geminiMark, icon } from '../shared/icons';
import { t } from '@vz/common/i18n';
import type { WindowState } from '@vz/common/types';
import { registerPanel } from './panels';
import { shell } from './shell';

class VzGeminiPanel extends LitElement {
  static override properties = { state: { attribute: false } };
  state!: WindowState;
  private readonly ro = new ResizeObserver(() => this.report());
  private last = '';
  private settle = 0;
  private readonly onResize = () => this.report();

  static override styles = [
    base,
    css`
      :host { display: flex; flex-direction: column; min-height: 0; }
      .bar { display: flex; align-items: center; gap: 2px; padding: 2px 8px 8px; }
      .who { all: unset; display: inline-flex; align-items: center; gap: 8px; min-width: 0; height: 32px; padding: 0 8px 0 4px; border-radius: 999px; cursor: pointer; font-size: var(--vz-text-s); color: var(--vz-text-2); transition: background var(--vz-dur); }
      .who:hover { background: var(--vz-surface-hover); color: var(--vz-text); }
      .who:focus-visible { outline: 2px solid var(--vz-focus); }
      .who span { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
      .av { width: 22px; height: 22px; border-radius: 50%; flex: none; object-fit: cover; display: grid; place-items: center; background: var(--vz-accent); color: var(--vz-on-accent); font-size: 11px; font-weight: 700; }
      .grow { flex: 1; }
      .icon-btn { width: 30px; height: 30px; border-radius: 50%; }
      /* The page goes here; until it paints, a soft breathing mark. */
      .view { flex: 1; min-height: 0; margin: 0 8px 8px; border-radius: 14px; background: var(--vz-surface-2); display: grid; place-items: center; }
      .view .vz-gem { animation: breathe 1.8s ease-in-out infinite; }
      @keyframes breathe { 50% { transform: scale(1.12) rotate(45deg); opacity: .7; } }
    `,
  ];

  override connectedCallback(): void {
    super.connectedCallback();
    window.addEventListener('resize', this.onResize);
  }

  override disconnectedCallback(): void {
    super.disconnectedCallback();
    window.removeEventListener('resize', this.onResize);
    this.ro.disconnect();
    cancelAnimationFrame(this.settle);
    this.last = '';
    void shell.setPanelView(undefined);
  }

  protected override firstUpdated(): void {
    this.ro.observe(this.renderRoot.querySelector('.view')!);
  }

  protected override updated(): void {
    // The panel slides in (and the window may be resizing): follow the box for a moment.
    cancelAnimationFrame(this.settle);
    const until = performance.now() + 420;
    const step = () => {
      this.report();
      if (performance.now() < until) this.settle = requestAnimationFrame(step);
    };
    step();
  }

  private report(): void {
    const r = this.renderRoot.querySelector('.view')?.getBoundingClientRect();
    if (!r || !this.isConnected) return;
    const rect = { x: Math.round(r.x), y: Math.round(r.y), width: Math.round(r.width), height: Math.round(r.height) };
    const key = JSON.stringify(rect);
    if (key === this.last) return;
    this.last = key;
    void shell.setPanelView(rect);
  }

  override render() {
    const g = this.state.google;
    const me = g?.accounts.find((a) => a.email === g.active && !a.signedOut);
    const tab = this.state.tabs.find((x) => x.id === this.state.activeTabId);
    const web = !!tab && /^https?:/.test(tab.url);
    return html`<div class="bar">
        ${me
          ? html`<button class="who" title=${t('gemini_as', { email: me.email })} aria-label=${t('gemini_as', { email: me.email })} aria-haspopup="menu" @click=${(e: MouseEvent) => {
              const b = (e.currentTarget as HTMLElement).getBoundingClientRect();
              void shell.openAccountMenu({ x: Math.round(b.x), y: Math.round(b.y), width: Math.round(b.width), height: Math.round(b.height) });
            }}>${me.photo ? html`<img class="av" src=${me.photo} alt="" />` : html`<span class="av">${(me.name[0] ?? '?').toUpperCase()}</span>`}<span>${me.email}</span>${icon('chevron-down', 13)}</button>`
          : nothing}
        <span class="grow"></span>
        <button class="icon-btn" ?disabled=${!web} title=${t('gemini_ask_page')} aria-label=${t('gemini_ask_page')} @click=${() => shell.geminiAction('page')}>${icon('reader', 16)}</button>
        <button class="icon-btn" title=${t('gemini_reload')} aria-label=${t('gemini_reload')} @click=${() => shell.geminiAction('reload')}>${icon('refresh', 15)}</button>
        <button class="icon-btn" title=${t('gemini_open_tab')} aria-label=${t('gemini_open_tab')} @click=${() => shell.geminiAction('tab')}>${icon('external', 15)}</button>
      </div>
      <div class="view">${geminiMark(30)}</div>`;
  }
}

customElements.define('vz-gemini-panel', VzGeminiPanel);
registerPanel('gemini', 'vz-gemini-panel', () => t('gemini_title'), 'gemini');
