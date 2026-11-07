// <vz-overlay>: browser-owned surfaces above page content: the Command Bar
// (CMD-01), dialogs, and the Shields panel. Pages can't draw over this layer (C9).
import { LitElement, css, html, nothing, type TemplateResult } from 'lit';
import { base } from '../shared/styles';
import { icon } from '../shared/icons';
import { client, on } from '../shared/bridge';
import { applyLocale, applyTheme } from '../shared/theme';
import { OverlayInterface } from '@vz/common/mojom/shell';
import { t } from '@vz/common/i18n';
import type { CommandBarResult, Suggestion, WindowState } from '@vz/common/types';
import { DIALOGS, type DialogHost } from './dialogs';
import './dialogs_extra';

const overlay = client(OverlayInterface);

type Surface =
  | { kind: 'command-bar'; mode: 'palette' | 'address' | 'tab-search' | 'ask'; anchor?: { x: number; y: number; width: number; height: number }; initial: string; newTab: boolean }
  | { kind: 'shields'; anchor: { x: number; y: number; width: number; height: number }; status: ShieldsStatus }
  | { kind: 'dialog'; id: string; dialog: Record<string, unknown> & { type: string } };

interface ShieldsStatus { enabled: boolean; siteEnabled: boolean; site: string; blocked: { ads: number; trackers: number; other: number; total: number }; ruleSource: string }

const SECTION_ORDER: Suggestion['section'][] = ['top', 'tabs', 'commands', 'memory', 'history', 'search', 'ai'];

export class VzOverlay extends LitElement {
  static override properties = { surface: { state: true }, result: { state: true }, selected: { state: true }, input: { state: true }, closing: { state: true } };
  surface: Surface | null = null;
  result: CommandBarResult | null = null;
  selected = 0;
  input = '';
  closing = false;
  private draft: Record<string, unknown> = {};
  private seq = 0;

  static override styles = [
    base,
    css`
      :host { position: fixed; inset: 0; display: block; }
      .backdrop { position: absolute; inset: 0; background: var(--vz-backdrop); animation: fade 140ms var(--vz-ease); }
      .backdrop.clear { background: transparent; }
      @keyframes fade { from { opacity: 0; } }
      @keyframes rise { from { opacity: 0; transform: translateY(-6px) scale(0.985); } }

      .cb { position: absolute; width: min(680px, calc(100vw - 32px)); left: 50%; top: 14vh; transform: translateX(-50%);
        background: var(--vz-bg-elev); border-radius: var(--vz-radius-xl); box-shadow: var(--vz-shadow-pop); border: 1px solid var(--vz-border);
        overflow: hidden; animation: rise 160ms var(--vz-ease); display: flex; flex-direction: column; max-height: 72vh; }
      .cb.anchored { transform: none; }
      .cb .cb-field { display: flex; align-items: center; gap: 12px; padding: 0 16px; height: 58px; border-bottom: 1px solid var(--vz-border); }
      .cb .cb-field .lead { color: var(--vz-text-3); }
      .cb input { flex: 1; border: 0; outline: none; box-shadow: none; background: transparent; font-size: 17px; padding: 0; height: 100%; color: var(--vz-text); }
      .cb input:focus { box-shadow: none; }
      .mode { font-size: var(--vz-text-xs); font-weight: 700; color: var(--vz-accent); background: var(--vz-accent-soft); padding: 3px 8px; border-radius: 999px; }
      .chips { display: flex; gap: 6px; padding: 8px 14px 0; flex-wrap: wrap; }
      .chips .lbl { font-size: var(--vz-text-xs); color: var(--vz-text-3); align-self: center; }
      .chip-btn { border: 1px solid var(--vz-border); background: var(--vz-surface-2); border-radius: 999px; padding: 3px 10px; font-size: var(--vz-text-s); cursor: pointer; }
      .chip-btn:hover { border-color: var(--vz-accent); color: var(--vz-accent); }
      .rows { overflow-y: auto; padding: 6px; }
      .sec { font-size: var(--vz-text-xs); font-weight: 700; text-transform: uppercase; letter-spacing: 0.06em; color: var(--vz-text-3); padding: 10px 10px 4px; }
      .row { display: flex; align-items: center; gap: 12px; height: 44px; padding: 0 10px; border-radius: var(--vz-radius); cursor: pointer; }
      .row.sel { background: var(--vz-accent-soft); }
      .row .ic { width: 28px; height: 28px; border-radius: 8px; display: grid; place-items: center; background: var(--vz-surface-2); color: var(--vz-text-2); flex: none; }
      .row.sel .ic { background: var(--vz-accent); color: var(--vz-on-accent); }
      .row .ic img { width: 16px; height: 16px; border-radius: 3px; }
      .row .txt { flex: 1; min-width: 0; display: flex; flex-direction: column; }
      .row .t1 { white-space: nowrap; overflow: hidden; text-overflow: ellipsis; font-size: 14px; }
      .row .t2 { white-space: nowrap; overflow: hidden; text-overflow: ellipsis; font-size: var(--vz-text-s); color: var(--vz-text-2); }
      .row .enter { opacity: 0; font-size: var(--vz-text-xs); color: var(--vz-text-3); }
      .row.sel .enter { opacity: 1; }
      .row.destructive .t1 { color: var(--vz-danger); }
      .foot { display: flex; gap: 14px; align-items: center; padding: 8px 14px; border-top: 1px solid var(--vz-border); font-size: var(--vz-text-xs); color: var(--vz-text-3); }
      .foot .grow { flex: 1; }

      .dlg { position: absolute; left: 50%; top: 18vh; transform: translateX(-50%); width: min(460px, calc(100vw - 32px)); padding: 22px 22px 18px;
        background: var(--vz-bg-elev); border-radius: var(--vz-radius-xl); box-shadow: var(--vz-shadow-pop); border: 1px solid var(--vz-border); animation: rise 160ms var(--vz-ease); max-height: 76vh; overflow: auto; }
      .dlg.wide { width: min(620px, calc(100vw - 32px)); }
      .dlg h2 { margin: 0 0 6px; font-size: 17px; font-weight: 700; letter-spacing: -0.01em; display: flex; align-items: center; gap: 8px; }
      .dlg p { margin: 0 0 14px; line-height: 1.5; }
      .dlg .browser-owned { display: flex; align-items: center; gap: 6px; font-size: var(--vz-text-xs); color: var(--vz-text-3); margin-bottom: 12px; font-weight: 600; }
      .actions { display: flex; justify-content: flex-end; gap: 8px; margin-top: 18px; }
      .field { display: flex; flex-direction: column; gap: 6px; margin: 12px 0; }
      .field > span { font-size: var(--vz-text-s); font-weight: 600; color: var(--vz-text-2); }
      .field input { height: 36px; font-size: 14px; }
      .swatches, .icons { display: flex; flex-wrap: wrap; gap: 8px; }
      .swatch { width: 26px; height: 26px; border-radius: 50%; border: 2px solid transparent; background: var(--c); cursor: pointer; box-shadow: inset 0 0 0 2px var(--vz-bg-elev); }
      .swatch.on { border-color: var(--c); }
      .icon-choice { width: 36px; height: 36px; border-radius: 10px; border: 1px solid var(--vz-border); background: var(--vz-surface-2); display: grid; place-items: center; cursor: pointer; color: var(--vz-text-2); }
      .icon-choice.on { background: color-mix(in srgb, var(--c) 18%, transparent); color: var(--c); border-color: var(--c); }
      .check { display: flex; align-items: center; gap: 8px; font-size: var(--vz-text-s); color: var(--vz-text-2); }
      .perm-head { display: flex; gap: 14px; align-items: flex-start; }
      .perm-head > .vz-icon { margin-top: 2px; color: var(--vz-accent); }

      .pop { position: absolute; width: 320px; padding: 16px; background: var(--vz-bg-elev); border-radius: var(--vz-radius-l); box-shadow: var(--vz-shadow-pop); border: 1px solid var(--vz-border); animation: rise 140ms var(--vz-ease); }
      .pop h3 { margin: 0; font-size: 15px; display: flex; align-items: center; gap: 8px; }
      .pop .site { color: var(--vz-text-2); font-size: var(--vz-text-s); margin: 2px 0 14px; }
      .stats { display: grid; grid-template-columns: repeat(3, 1fr); gap: 8px; margin-bottom: 14px; }
      .stat { background: var(--vz-surface-2); border-radius: var(--vz-radius); padding: 10px; text-align: center; }
      .stat b { display: block; font-size: 20px; font-variant-numeric: tabular-nums; }
      .stat span { font-size: var(--vz-text-xs); color: var(--vz-text-2); }
      .toggle { display: flex; align-items: center; justify-content: space-between; gap: 12px; }
      .switch { position: relative; width: 38px; height: 22px; border-radius: 999px; background: var(--vz-surface-active); border: 0; cursor: pointer; transition: background var(--vz-dur); flex: none; }
      .switch::after { content: ''; position: absolute; top: 3px; left: 3px; width: 16px; height: 16px; border-radius: 50%; background: #fff; transition: transform var(--vz-dur) var(--vz-ease); box-shadow: 0 1px 2px rgba(0,0,0,.25); }
      .switch[aria-checked='true'] { background: var(--vz-accent); }
      .switch[aria-checked='true']::after { transform: translateX(16px); }
      .pop .link { margin-top: 12px; display: block; font-size: var(--vz-text-s); background: none; border: 0; color: var(--vz-accent); cursor: pointer; padding: 0; }
    `,
  ];

  override connectedCallback(): void {
    super.connectedCallback();
    on<Surface>('Overlay', 'show', (s) => this.show(s));
    on('Overlay', 'hide', () => (this.surface = null));
    void overlay.getState().then((s: WindowState) => {
      applyLocale(s.locale);
      applyTheme(s.theme, s.accent, s.density);
    });
    on<WindowState>('Shell', 'state', (s) => applyTheme(s.theme, s.accent, s.density));
    window.addEventListener('keydown', (e) => this.onKey(e), true);
    void overlay.ready();
  }

  private show(s: Surface): void {
    this.surface = s;
    this.draft = {};
    void overlay.getState().then((st: WindowState) => {
      applyLocale(st.locale);
      applyTheme(st.theme, st.accent, st.density);
      this.requestUpdate();
    });
    if (s.kind === 'command-bar') {
      this.input = s.initial;
      this.selected = 0;
      void this.query();
      void this.updateComplete.then(() => {
        const el = this.renderRoot.querySelector('.cb input') as HTMLInputElement | null;
        el?.focus();
        el?.select();
      });
    } else {
      void this.updateComplete.then(() => (this.renderRoot.querySelector('[autofocus]') as HTMLElement | null)?.focus());
    }
  }

  private async query(): Promise<void> {
    const s = this.surface;
    if (s?.kind !== 'command-bar') return;
    const seq = ++this.seq;
    const r = (await overlay.query(this.input, s.mode)) as CommandBarResult;
    if (seq !== this.seq) return;
    this.result = r;
    this.selected = 0;
  }

  private get rows(): Suggestion[] {
    const list = this.result?.suggestions ?? [];
    return SECTION_ORDER.flatMap((sec) => list.filter((x) => x.section === sec));
  }

  private accept(sug?: Suggestion, newTab = false): void {
    const s = this.surface;
    if (s?.kind !== 'command-bar') return;
    void overlay.accept(this.input, sug?.id, { newTab: newTab || s.newTab });
    this.surface = null;
  }

  private close(): void {
    if (this.surface?.kind === 'dialog') void overlay.dialogResult(this.surface.id, null);
    void overlay.close();
    this.surface = null;
  }

  private onKey(e: KeyboardEvent): void {
    if (!this.surface) return;
    if (e.key === 'Escape') {
      e.preventDefault();
      this.close();
      return;
    }
    if (this.surface.kind !== 'command-bar') return;
    const rows = this.rows;
    if (e.key === 'ArrowDown' || (e.key === 'n' && e.ctrlKey)) {
      e.preventDefault();
      this.selected = Math.min(rows.length - 1, this.selected + 1);
      this.scrollSel();
    } else if (e.key === 'ArrowUp' || (e.key === 'p' && e.ctrlKey)) {
      e.preventDefault();
      this.selected = Math.max(0, this.selected - 1);
      this.scrollSel();
    } else if (e.key === 'Enter') {
      e.preventDefault();
      this.accept(rows[this.selected], e.altKey || e.metaKey || e.ctrlKey);
    } else if (e.key === 'Tab' && rows[this.selected]?.kind === 'url') {
      e.preventDefault();
      this.input = rows[this.selected]!.title;
      void this.query();
    }
  }

  private scrollSel(): void {
    void this.updateComplete.then(() => this.renderRoot.querySelector('.row.sel')?.scrollIntoView({ block: 'nearest' }));
  }

  override render() {
    const s = this.surface;
    if (!s) return nothing;
    if (s.kind === 'command-bar') return this.renderCommandBar(s);
    if (s.kind === 'shields') return this.renderShields(s);
    return this.renderDialog(s);
  }

  private renderCommandBar(s: Extract<Surface, { kind: 'command-bar' }>): TemplateResult {
    const rows = this.rows;
    let lastSection = '';
    const anchored = s.mode === 'address' && s.anchor && !s.newTab;
    const style = anchored ? `left:${Math.max(8, s.anchor!.x - 4)}px; top:${Math.max(8, s.anchor!.y - 4)}px; width:min(680px, calc(100vw - ${Math.max(8, s.anchor!.x - 4) + 16}px))` : '';
    const placeholder = s.mode === 'tab-search' ? t('cb_tab_search_placeholder') : s.mode === 'ask' ? t('cb_ask_placeholder') : t('cb_placeholder_long');
    const route = this.result?.route;
    const modeLabel = s.mode === 'tab-search' ? t('cb_mode_tabs') : route === 'command' ? t('cb_mode_command') : route === 'ask' || s.mode === 'ask' ? t('cb_mode_ask') : s.newTab ? t('cb_mode_new_tab') : '';
    const mac = navigator.platform.startsWith('Mac');
    return html`
      <div class="backdrop ${anchored ? 'clear' : ''}" @mousedown=${() => this.close()}></div>
      <div class="cb ${anchored ? 'anchored' : ''}" style=${style} role="dialog" aria-modal="true" aria-label=${t('cmd_command_bar')}>
        <div class="cb-field">
          <span class="lead">${icon(route === 'command' ? 'command' : route === 'ask' || s.mode === 'ask' ? 'sparkle' : 'search', 18)}</span>
          <input type="text" spellcheck="false" autocomplete="off" .value=${this.input} placeholder=${placeholder}
            role="combobox" aria-expanded="true" aria-controls="cb-rows" aria-activedescendant=${rows[this.selected] ? `cb-${this.selected}` : ''}
            @input=${(e: InputEvent) => ((this.input = (e.target as HTMLInputElement).value), void this.query())} />
          ${modeLabel ? html`<span class="mode">${modeLabel}</span>` : nothing}
        </div>
        ${this.result?.chips.length
          ? html`<div class="chips"><span class="lbl">${t('cb_interpreted_as')}</span>${this.result.chips.map((c) => html`<button class="chip-btn" @click=${() => void overlay.accept(this.input, undefined, { route: c.route })}>${c.label}</button>`)}</div>`
          : nothing}
        <div class="rows" id="cb-rows" role="listbox">
          ${rows.map((r, i) => {
            const header = r.section !== lastSection && r.section !== 'top' ? html`<div class="sec">${t(`cb_section_${r.section}` as never)}</div>` : nothing;
            lastSection = r.section;
            return html`${header}<div class="row ${i === this.selected ? 'sel' : ''} ${r.destructive ? 'destructive' : ''}" id="cb-${i}" role="option" aria-selected=${i === this.selected}
              @mousemove=${() => this.selected !== i && (this.selected = i)} @click=${(e: MouseEvent) => this.accept(r, e.metaKey || e.ctrlKey)}>
              <span class="ic">${r.favicon ? html`<img src=${r.favicon} alt="" referrerpolicy="no-referrer" />` : icon(r.icon ?? kindIcon(r.kind), 15)}</span>
              <span class="txt"><span class="t1">${r.title}</span>${r.detail ? html`<span class="t2">${r.detail}</span>` : nothing}</span>
              ${r.shortcut ? html`<span class="kbd">${r.shortcut}</span>` : nothing}
              <span class="enter">↵</span>
            </div>`;
          })}
        </div>
        <div class="foot"><span>↑↓ ${t('cb_hint_move')}</span><span>↵ ${t('cb_hint_open')}</span><span>${mac ? '⌘' : 'Ctrl'}↵ ${t('cb_hint_new_tab')}</span><span class="grow"></span>
          <span><b>&gt;</b> ${t('cb_hint_commands')}</span><span><b>?</b> ${t('cb_hint_ask')}</span></div>
      </div>`;
  }

  private renderShields(s: Extract<Surface, { kind: 'shields' }>): TemplateResult {
    const st = s.status;
    const left = Math.max(8, Math.min(window.innerWidth - 328, s.anchor.x - 10));
    return html`<div class="backdrop clear" @mousedown=${() => this.close()}></div>
      <div class="pop" style="left:${left}px; top:${s.anchor.y + s.anchor.height + 8}px" role="dialog" aria-label=${t('shields_title')}>
        <h3>${icon(st.siteEnabled ? 'shield-check' : 'shield-off', 18)} ${t('shields_title')}</h3>
        <div class="site">${st.site}</div>
        <div class="stats">
          <div class="stat"><b>${st.blocked.ads}</b><span>${t('shields_ads')}</span></div>
          <div class="stat"><b>${st.blocked.trackers}</b><span>${t('shields_trackers')}</span></div>
          <div class="stat"><b>${st.blocked.total}</b><span>${t('shields_total')}</span></div>
        </div>
        <div class="toggle"><span>${st.siteEnabled ? t('shields_on_for_site') : t('shields_off_for_site')}</span>
          <button class="switch" role="switch" aria-checked=${st.siteEnabled} aria-label=${t('shields_toggle_site')} ?disabled=${!st.enabled}
            @click=${async () => {
              const next = (await overlay.setShieldsForSite(!st.siteEnabled)) as ShieldsStatus | null;
              if (next) this.surface = { ...s, status: next };
            }}></button></div>
        <p class="faint" style="font-size:11px;margin:10px 0 0">${t('shields_breakage_hint')}</p>
        <button class="link" @click=${() => (this.close(), void overlay.runCommand('page.privacy'))}>${t('shields_open_dashboard')} →</button>
      </div>`;
  }

  private renderDialog(s: Extract<Surface, { kind: 'dialog' }>): TemplateResult {
    const render = DIALOGS.get(s.dialog.type);
    const host: DialogHost = {
      resolve: (r) => {
        void overlay.dialogResult(s.id, r ?? null);
        this.surface = null;
      },
      cancel: () => this.close(),
      requestUpdate: () => this.requestUpdate(),
      draft: this.draft,
    };
    const wide = ['agent-plan', 'agent-confirm', 'disclosure'].includes(s.dialog.type);
    return html`<div class="backdrop"></div>
      <div class="dlg ${wide ? 'wide' : ''}" role="dialog" aria-modal="true" aria-labelledby="dlg-title">
        <div class="browser-owned">${icon('shield', 12)} ${t('browser_owned_label')}</div>
        ${render ? render(s.dialog, host) : html`<p>${s.dialog.type}</p>`}
      </div>`;
  }
}

function kindIcon(k: Suggestion['kind']): string {
  return ({ url: 'globe', search: 'search', tab: 'layers', history: 'history', bookmark: 'star', command: 'command', ask: 'sparkle', memory: 'brain', archive: 'archive', 'nl-command': 'wand' } as Record<string, string>)[k] ?? 'globe';
}

customElements.define('vz-overlay', VzOverlay);
