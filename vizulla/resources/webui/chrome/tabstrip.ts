// <vz-tabstrip>: tabs on top (the default layout), on the same glass as the toolbar.
// The current tab is a soft pill (no separators or joins), groups as
// colored chips, pinned icon tabs, Spaces as colored dots, "+" and tab search.
// Cmd/Ctrl/Shift-click selects several tabs; tabs drag between windows or out
// into a new one.
import { LitElement, css, html, nothing } from 'lit';
import { repeat } from 'lit/directives/repeat.js';
import { base } from '../shared/styles';
import { icon } from '../shared/icons';
import { t } from '@vz/common/i18n';
import type { TabInfo, WindowState } from '@vz/common/types';
import { ACCENTS } from '@vz/common/tokens';
import { shell } from './shell';
import { favicon } from './common';
import { TabSelection, draggedTabIds, endTabDrag, isTabDrag, startTabDrag } from './tab_selection';

export class VzTabstrip extends LitElement {
  static override properties = { state: { attribute: false }, dragOver: { state: true }, edges: { state: true }, frozen: { state: true } };
  state!: WindowState;
  dragOver: number | null = null;
  /** Hidden tabs to the left / right of an overflowing strip (edge fades, tab count). */
  edges = { left: false, right: false };
  /** Tab width held while closing tabs with the pointer in the strip (as in Chrome). */
  frozen: number | null = null;
  private readonly ro = new ResizeObserver(() => this.measure());
  private dragId: number | null = null;
  private dragIds: number[] = [];
  private readonly sel = new TabSelection(this);

  static override styles = [
    base,
    css`
      :host { display: flex; align-items: flex-end; height: 40px; padding: 0 6px; -webkit-app-region: drag; }
      /* Every control shares the tabs' centre line: 23px down a 40px strip (34px tabs on the bottom edge). */
      .lead, .trail { display: flex; align-items: flex-end; gap: 2px; height: 100%; padding-bottom: 3px; -webkit-app-region: no-drag; flex: none; }
      .lead { padding-left: var(--traffic, 0); padding-right: 6px; }
      .dot { width: 24px; height: 24px; padding: 0; margin-bottom: 2px; border-radius: 50%; border: 0; display: grid; place-items: center; cursor: pointer; color: var(--vz-text-2); background: transparent; transition: background var(--vz-dur), color var(--vz-dur), box-shadow var(--vz-dur), transform var(--vz-dur) var(--vz-ease); }
      .dot:hover { background: var(--vz-tab-hover); color: var(--c); }
      /* The current Space: its colour, a soft fill and a ring, readable on glass in both themes. */
      .dot.on { background: color-mix(in srgb, var(--c) 22%, transparent); color: var(--c); box-shadow: inset 0 0 0 1px color-mix(in srgb, var(--c) 45%, transparent); animation: vz-pop 320ms cubic-bezier(.34,1.56,.64,1); }
      @keyframes vz-pop { 0% { transform: scale(.82); } 60% { transform: scale(1.08); } 100% { transform: scale(1); } }
      .dot:active { transform: scale(0.92); }
      /* Tabs shrink to icons, then the strip scrolls (padding leaves room for the active tab's feet). */
      .tabs { display: flex; flex: 0 1 auto; min-width: 0; height: 34px; align-items: flex-end; overflow-x: auto; overflow-y: hidden; scrollbar-width: none;
        padding: 0 10px; margin: 0 -10px; -webkit-app-region: no-drag; scroll-behavior: smooth; scroll-padding-inline: 10px;
        /* Soft edges when tabs are hidden on either side. */
        mask-image: linear-gradient(90deg, transparent, #000 var(--fl, 0px), #000 calc(100% - var(--fr, 0px)), transparent); }
      /* While closing tabs one after another, widths hold still so the next × lands under the pointer. */
      .tabs.frozen .tab:not(.pinned):not(.active) { flex: 0 0 var(--frozen); width: var(--frozen); }
      .tabs::-webkit-scrollbar { display: none; }
      .tab {
        -webkit-app-region: no-drag; position: relative; flex: 0 1 240px; width: 240px; min-width: 44px; max-width: 240px; height: 34px;
        /* Explicit width: size containment (for the container query) would otherwise report 0 to the strip. */
        container-type: inline-size;
        display: flex; align-items: center; border-radius: 10px 10px 0 0; animation: grow 180ms var(--vz-ease);
      }
      @keyframes grow { from { max-width: 0; opacity: 0; } }
      .tab.pinned { flex: 0 0 44px; width: 44px; }
      /* The current tab never shrinks below icon + a few letters + ×. */
      .tab.active:not(.pinned) { min-width: 104px; }
      .tab.drop { box-shadow: inset 2px 0 0 var(--vz-accent); }
      .tabs.drop-end { box-shadow: inset -2px 0 0 var(--vz-accent); }
      .tab.selected:not(.active) .body { background: var(--vz-accent-soft); color: var(--vz-text); }
      .tab.selected.active .body { box-shadow: inset 0 0 0 1.5px color-mix(in srgb, var(--vz-accent) 45%, transparent); }
      .tab .body { all: unset; box-sizing: border-box; flex: 1; min-width: 0; height: 28px; margin: 3px 4px 3px 6px; padding: 0 6px; display: flex; align-items: center; gap: 8px;
        border-radius: 8px; cursor: default; color: var(--vz-text-2); font-size: var(--vz-text-s); transition: background var(--vz-dur); }
      .tab:not(.active):hover .body { background: var(--vz-tab-hover); color: var(--vz-text); }
      .tab .body:focus-visible { outline: 2px solid var(--vz-focus); }
      .tab.active { z-index: 1; }
      /* The current tab: a soft pill on the shared surface, the same shape as the address field.
         Switching tabs, it eases in behind the text (text and layout never move). */
      .tab.active::after { content: ''; position: absolute; inset: 3px 2px 3px 4px; z-index: -1; border-radius: 10px; background: color-mix(in srgb, var(--vz-text) 9%, transparent); box-shadow: var(--vz-glass-edge, 0 0 transparent); pointer-events: none; animation: pill-in 220ms var(--vz-ease); }
      @keyframes pill-in { from { opacity: 0; transform: scale(.96); } }
      .tab.active .body { color: var(--vz-text); }
      .tab.pinned .body { justify-content: center; padding: 0; margin: 3px; }
      .title { flex: 1; min-width: 0; white-space: nowrap; overflow: hidden; mask-image: linear-gradient(90deg, #000 85%, transparent); }
      .fav { width: 16px; height: 16px; display: grid; place-items: center; flex: none; position: relative; }
      .fav img, .fav .vz-icon { width: 16px; height: 16px; border-radius: 3px; }
      .fav.loading::after { content: ''; position: absolute; inset: -3px; border-radius: 50%; border: 2px solid var(--vz-accent); border-right-color: transparent; animation: vz-spin .8s linear infinite; }
      .fav.asleep { opacity: .5; }
      /* padding: 0 matters: the default button padding (6px a side) would leave 8px for the 12px glyph and push it off-centre.
         8px right margin puts the glyph 12px from the tab edge, mirroring the favicon on the left. */
      .x { width: 20px; height: 20px; padding: 0; flex: none; border-radius: 50%; border: 0; background: transparent; color: var(--vz-text-2); display: grid; place-items: center; cursor: pointer; opacity: 0; margin-right: 8px; transition: opacity var(--vz-dur), background var(--vz-dur); -webkit-app-region: no-drag; }
      .tab:hover .x, .tab.active .x { opacity: 1; }
      .x:hover { background: var(--vz-surface-active); color: var(--vz-text); }
      .live { width: 18px; height: 18px; border-radius: 50%; display: grid; place-items: center; background: #dc2626; color: #fff; flex: none; animation: vz-rise 200ms var(--vz-ease); }
      .audio { color: var(--vz-accent); display: grid; place-items: center; width: 20px; height: 20px; border-radius: 50%; cursor: pointer; flex: none; transition: background var(--vz-dur); }
      .audio:hover { background: var(--vz-surface-active); }
      .group { -webkit-app-region: no-drag; align-self: center; flex: none; height: 22px; max-width: 120px; padding: 0 9px; margin: 0 4px 3px; border-radius: 999px; border: 0; cursor: pointer;
        background: var(--g); color: #fff; font-size: 11px; font-weight: 700; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
      .group.collapsed { opacity: .75; }
      .tab.in-group .body { box-shadow: inset 0 -2px 0 var(--g); border-radius: 8px 8px 2px 2px; }
      .add, .search { -webkit-app-region: no-drag; width: 28px; height: 28px; border-radius: 50%; }
      .add .vz-icon { transition: transform 260ms cubic-bezier(.34,1.56,.64,1); }
      .add:hover .vz-icon { transform: rotate(90deg); }
      .search { margin-left: 4px; position: relative; }
      /* With hidden tabs, tab search becomes a "31 ⌄" pill: how many tabs, one click to find any. */
      .search.counted { width: auto; padding: 0 6px 0 10px; gap: 2px; display: inline-flex; align-items: center; border-radius: 999px; background: var(--vz-tab-hover); animation: vz-rise 200ms var(--vz-ease); }
      .count { font-size: 12px; font-weight: 650; font-variant-numeric: tabular-nums; color: var(--vz-text); }
      .end { width: var(--controls, 0); flex: none; }
      @container (max-width: 96px) {
        .body { justify-content: center; padding: 0; gap: 0; }
        .title { display: none; }
        .x { display: none; }
      }
      @media (max-width: 640px) {
        .dot:not(.on) { display: none; }
        .search { display: none; }
      }
    `,
  ];

  private color(c: string): string {
    const a = ACCENTS[c as keyof typeof ACCENTS] ?? ACCENTS.indigo;
    return document.documentElement.dataset.theme === 'light' ? a.light : a.dark;
  }

  override render() {
    const s = this.state;
    const mac = s.platform.startsWith('darwin');
    const tabs = s.tabs.filter((x) => x.spaceId === s.activeSpaceId);
    this.sel.prune(tabs.map((x) => x.id));
    const items: unknown[] = [];
    let lastGroup: string | null = null;
    tabs.forEach((x, i) => {
      if (x.groupId && x.groupId !== lastGroup) {
        const g = s.groups.find((gg) => gg.id === x.groupId);
        if (g) {
          items.push(html`<button class="group ${g.collapsed ? 'collapsed' : ''}" style="--g:${this.color(g.color)}" tabindex="-1" aria-hidden="true" title=${g.title}
            @click=${() => shell.updateGroup(g.id, { collapsed: !g.collapsed })}>${g.aiGenerated ? '✦ ' : ''}${g.title}</button>`);
        }
      }
      lastGroup = x.groupId;
      const g = x.groupId ? s.groups.find((gg) => gg.id === x.groupId) : undefined;
      if (g?.collapsed && x.id !== s.activeTabId) return;
      items.push(this.renderTab(x, i, g ? this.color(g.color) : null));
    });
    return html`
      <div class="lead" style=${mac && !s.fullscreen ? '--traffic:72px' : ''}>
        ${s.spaces.length > 1 || !s.classic
          ? s.spaces.map((sp) => html`<button class="dot ${sp.id === s.activeSpaceId ? 'on' : ''}" style="--c:${this.color(sp.color)}" title=${sp.name} aria-label=${sp.name}
              aria-pressed=${sp.id === s.activeSpaceId} @click=${() => shell.switchSpace(sp.id)} @dblclick=${() => shell.editSpace(sp.id)}
              @contextmenu=${(e: MouseEvent) => (e.preventDefault(), shell.showSpaceMenu(sp.id, { x: e.clientX, y: e.clientY }))}
              @dragover=${(e: DragEvent) => this.dragId !== null && e.preventDefault()} @drop=${() => this.dragIds.forEach((id) => shell.moveTabToSpace(id, sp.id))}>${icon(sp.icon, 13)}</button>`)
          : nothing}
      </div>
      <div class="tabs ${this.dragOver === tabs.length ? 'drop-end' : ''} ${this.frozen ? 'frozen' : ''}" role="tablist" aria-label=${t('tabs_list')} aria-multiselectable="true"
        style="--fl:${this.edges.left ? 40 : 0}px;--fr:${this.edges.right ? 40 : 0}px;${this.frozen ? `--frozen:${this.frozen}px` : ''}"
        @wheel=${(e: WheelEvent) => this.onWheel(e)} @scroll=${() => this.measure()} @pointerleave=${() => (this.frozen = null)}
        @animationend=${(e: AnimationEvent) => this.onGrown(e)}
        @dragover=${(e: DragEvent) => this.onDragOver(e, tabs.length)} @dragleave=${() => (this.dragOver = null)}
        @drop=${(e: DragEvent) => this.onDrop(e, tabs.length)}>${repeat(items, (_x, i) => i, (x) => x)}</div>
      <div class="trail">
        <button class="icon-btn add" aria-label=${t('cmd_tab_new')} title=${t('cmd_tab_new')} data-kbd=${mac ? '⌘T' : 'Ctrl+T'} @click=${() => shell.newTab()}>${icon('plus', 16)}</button>
      </div>
      <span style="flex:1;min-width:8px"></span>
      <div class="trail">
        <button class="icon-btn search ${this.edges.left || this.edges.right ? 'counted' : ''}" aria-label=${t('cmd_tab_search')} title=${t('cmd_tab_search')} data-kbd=${mac ? '⌘⇧A' : 'Ctrl+Shift+A'} @click=${() => shell.runCommand('tab.search')}>${this.edges.left || this.edges.right ? html`<span class="count" aria-hidden="true">${tabs.length}</span>` : nothing}${icon('chevron-down', 16)}</button>
      </div>
      <div class="end" style=${mac ? '' : '--controls:140px'}></div>
    `;
  }

  private renderTab(x: TabInfo, i: number, groupColor: string | null) {
    const s = this.state;
    const active = x.id === s.activeTabId;
    const order = s.tabs.filter((y) => y.spaceId === s.activeSpaceId).map((y) => y.id);
    const selected = this.sel.has(x.id);
    return html`<div class="tab ${active ? 'active' : ''} ${x.pinned ? 'pinned' : ''} ${groupColor ? 'in-group' : ''} ${selected ? 'selected' : ''} ${this.dragOver === i ? 'drop' : ''}"
        style=${groupColor ? `--g:${groupColor}` : ''} draggable="true"
        @dragstart=${(e: DragEvent) => {
          this.dragId = x.id;
          this.dragIds = this.sel.targets(x.id, order);
          startTabDrag(e, this.dragIds, x.url);
        }}
        @dragend=${(e: DragEvent) => {
          endTabDrag(e, this.dragIds);
          this.dragId = null;
          this.dragIds = [];
          this.dragOver = null;
        }}
        @dragover=${(e: DragEvent) => (e.stopPropagation(), this.onDragOver(e, i))}
        @drop=${(e: DragEvent) => (e.stopPropagation(), this.onDrop(e, i, x.id))}
        @auxclick=${(e: MouseEvent) => e.button === 1 && this.close(e, x.id)}
        @contextmenu=${(e: MouseEvent) => (e.preventDefault(), shell.showTabMenu(x.id, { x: e.clientX, y: e.clientY }, this.sel.has(x.id) ? this.sel.targets(x.id, order) : undefined))}>
        <button class="body" role="tab" aria-selected=${active || selected} title=${x.displayUrl ? `${x.title}\n${x.displayUrl}` : x.title} aria-label=${x.title + (x.audible ? `, ${t('tab_playing_audio')}` : '')}
          @click=${(e: MouseEvent) => this.sel.click(e, x.id, order, s.activeTabId) || shell.activateTab(x.id)}>
          <span class="fav ${x.loading ? 'loading' : ''} ${x.discarded ? 'asleep' : ''}">${favicon(x, 16)}</span>
          ${x.pinned ? nothing : html`<span class="title">${x.title}</span>`}
          ${x.inUse?.length ? html`<span class="live" title=${t('si_in_use')} aria-label=${t('si_in_use')}>${icon(x.inUse.includes('camera') ? 'eye' : x.inUse.includes('display-capture') ? 'columns' : x.inUse.includes('microphone') ? 'volume' : 'globe', 11)}</span>` : nothing}
          ${x.audible || x.muted
            ? html`<span class="audio" role="button" tabindex="-1" title=${x.muted ? t('ctx_unmute') : t('ctx_mute')} aria-label=${x.muted ? t('ctx_unmute') : t('ctx_mute')}
                @click=${(e: MouseEvent) => (e.stopPropagation(), shell.setMuted(x.id, !x.muted))}>${icon(x.muted ? 'volume-x' : 'volume', 13)}</span>`
            : nothing}
        </button>
        ${x.pinned ? nothing : html`<button class="x" tabindex="-1" aria-hidden="true" title=${t('cmd_tab_close')} @click=${(e: MouseEvent) => this.close(e, x.id)}>${icon('x', 12)}</button>`}
      </div>`;
  }

  /** A vertical wheel scrolls an overflowing strip sideways. */
  private onWheel(e: WheelEvent): void {
    const el = e.currentTarget as HTMLElement;
    if (el.scrollWidth <= el.clientWidth || Math.abs(e.deltaX) > Math.abs(e.deltaY)) return;
    el.scrollLeft += e.deltaY;
    e.preventDefault();
  }

  private shownActive: number | null = null;

  /** Keeps a newly activated tab in view when the strip overflows. */
  /** Closes a tab; the others keep their width until the pointer leaves the strip. */
  private close(e: MouseEvent, id: number): void {
    const tab = (e.currentTarget as HTMLElement).closest('.tab');
    if (tab && !tab.classList.contains('active')) this.frozen = Math.round(tab.getBoundingClientRect().width);
    else if (tab) this.frozen = Math.round(this.renderRoot.querySelector('.tab:not(.active):not(.pinned)')?.getBoundingClientRect().width ?? 0) || null;
    void shell.closeTab(id);
  }

  /** Which ends of the strip hide tabs. */
  private measure(): void {
    const el = this.renderRoot.querySelector('.tabs');
    if (!el) return;
    // Hidden means a tab pokes past the visible area (inside the 10px side padding kept for
    // the active tab's feet), measured on the tabs themselves.
    const tabs = el.querySelectorAll('.tab');
    const box = el.getBoundingClientRect();
    const left = (tabs[0]?.getBoundingClientRect().left ?? box.left) < box.left + 9;
    const right = (tabs[tabs.length - 1]?.getBoundingClientRect().right ?? box.right) > box.right - 9;
    if (left !== this.edges.left || right !== this.edges.right) this.edges = { left, right };
  }

  override disconnectedCallback(): void {
    super.disconnectedCallback();
    this.ro.disconnect();
  }

  protected override firstUpdated(): void {
    const el = this.renderRoot.querySelector('.tabs');
    if (el) this.ro.observe(el);
  }

  /** A new tab grows in: once it has its full width, bring it fully into view. */
  private onGrown(e: AnimationEvent): void {
    const tab = e.target as HTMLElement;
    if (tab.classList?.contains('active')) tab.scrollIntoView({ block: 'nearest', inline: 'nearest' });
    this.measure();
  }

  protected override updated(): void {
    requestAnimationFrame(() => this.measure());
    if (this.state.activeTabId === this.shownActive) return;
    this.shownActive = this.state.activeTabId;
    this.renderRoot.querySelector('.tab.active')?.scrollIntoView({ block: 'nearest', inline: 'nearest' });
  }

  private onDragOver(e: DragEvent, index: number): void {
    if (this.dragId === null && !isTabDrag(e)) return;
    e.preventDefault();
    e.dataTransfer!.dropEffect = 'move';
    this.dragOver = index;
  }

  /** A drop from this strip reorders; a drop from another window's strip adopts the tabs. */
  private onDrop(e: DragEvent, index: number, onto?: number): void {
    e.preventDefault();
    this.dragOver = null;
    if (this.dragId !== null) {
      if (this.dragId !== onto) this.dragIds.forEach((id, k) => void shell.moveTab(id, index + k));
      return;
    }
    const ids = draggedTabIds(e);
    if (ids.length) void shell.adoptTabs(ids, index);
  }
}
customElements.define('vz-tabstrip', VzTabstrip);
