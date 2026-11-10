// <vz-sidebar>: vertical tabs (TAB-01), Spaces (TAB-02), pins, groups, and the
// address pill that opens the Command Bar. Tabs drag to reorder, into/out of
// groups and the pinned zone, and onto Space icons. Horizontal two-finger swipe
// switches Spaces. Fully keyboard operable (arrow keys move through tabs).
// Cmd/Ctrl/Shift-click selects several tabs; tabs drag between windows or out
// into a new one.
import { LitElement, css, html, nothing, type TemplateResult } from 'lit';
import { base } from '../shared/styles';
import { icon } from '../shared/icons';
import { t } from '@vz/common/i18n';
import type { GroupInfo, SpaceInfo, TabInfo, WindowState } from '@vz/common/types';
import { ACCENTS } from '@vz/common/tokens';
import { shell } from './shell';
import { favicon, securityIcon } from './common';
import { TabSelection, draggedTabIds, endTabDrag, isTabDrag, startTabDrag } from './tab_selection';

type DropTarget = { index: number; groupId: string | null | undefined; zone: 'pinned' | 'list' } | null;

export class VzSidebar extends LitElement {
  static override properties = { state: { attribute: false }, drop: { state: true }, dragging: { state: true }, swipe: { state: true }, renaming: { state: true } };
  state!: WindowState;
  drop: DropTarget = null;
  dragging: number | null = null;
  swipe = 0;
  renaming: string | null = null;
  private dragIds: number[] = [];
  private readonly sel = new TabSelection(this);
  private wheelAcc = 0;
  private wheelTimer = 0;

  static override styles = [
    base,
    css`
      :host { display: flex; flex-direction: column; height: 100vh; min-width: 0; padding: 0 8px 8px 8px; position: relative; }
      .top { display: flex; align-items: center; gap: 2px; height: 44px; padding-left: var(--traffic, 0px); -webkit-app-region: drag; }
      .top > * { -webkit-app-region: no-drag; }
      .top .spacer { flex: 1; }
      .address {
        display: flex; align-items: center; gap: 8px; height: 36px; padding: 0 6px 0 10px; margin-bottom: 8px; border-radius: var(--vz-radius);
        background: var(--vz-surface-2); border: 1px solid transparent; cursor: text; color: var(--vz-text-2); transition: background var(--vz-dur), border-color var(--vz-dur);
      }
      .address:hover { background: var(--vz-surface-hover); }
      .addr-btn { flex: 1; min-width: 0; display: flex; align-items: center; gap: 8px; height: 100%; border: 0; background: transparent; padding: 0; cursor: text; color: inherit; text-align: start; }
      .address .url { flex: 1; min-width: 0; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; font-size: var(--vz-text-m); color: var(--vz-text); }
      .address .url.placeholder { color: var(--vz-text-3); }
      .sec.insecure, .sec.dangerous { color: var(--vz-danger); }
      .sec-label { font-size: var(--vz-text-xs); font-weight: 650; color: var(--vz-danger); }
      .shield-btn { display: inline-flex; align-items: center; gap: 3px; height: 24px; padding: 0 6px; border-radius: 6px; border: 0; background: transparent; cursor: pointer; color: var(--vz-text-2); font-size: var(--vz-text-xs); font-weight: 650; font-variant-numeric: tabular-nums; }
      .shield-btn:hover { background: var(--vz-surface-hover); }
      .shield-btn.has { color: var(--vz-accent); }

      .space-head { display: flex; align-items: center; gap: 6px; padding: 4px 4px 6px 6px; }
      .space-head .name { flex: 1; font-weight: 650; font-size: var(--vz-text-m); letter-spacing: -0.01em; color: var(--vz-text); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
      .space-dot { width: 18px; height: 18px; border-radius: 6px; display: grid; place-items: center; color: #fff; flex: none; }

      .pinned { display: grid; grid-template-columns: repeat(auto-fill, minmax(52px, 1fr)); gap: 6px; padding: 0 2px 8px; }
      .pin {
        height: 44px; border-radius: var(--vz-radius); display: grid; place-items: center; background: var(--vz-surface-2); border: 1px solid transparent;
        cursor: pointer; position: relative; transition: background var(--vz-dur), transform var(--vz-dur) var(--vz-ease);
      }
      .pin:hover { background: var(--vz-surface-hover); }
      .pin.active { background: color-mix(in srgb, var(--vz-text) 9%, transparent); border-color: transparent; }
      .pin img, .pin .vz-icon { width: 20px; height: 20px; }
      .pin .dot { position: absolute; bottom: 4px; width: 4px; height: 4px; border-radius: 50%; background: var(--vz-accent); }
      .pinned.drop { outline: 2px dashed var(--vz-accent); outline-offset: 2px; border-radius: var(--vz-radius); }
      .pinned:empty { display: none; }

      .list { flex: 1; overflow-y: auto; overflow-x: hidden; padding: 2px 2px 8px; scrollbar-width: thin; }
      .list.anim { animation: slide var(--vz-dur) var(--vz-ease); }
      @keyframes slide { from { opacity: 0; transform: translateX(calc(var(--dir, 1) * 18px)); } }
      .newtab { display: flex; align-items: center; justify-content: center; height: 30px; border-radius: 999px; color: var(--vz-text-2); cursor: pointer; border: 1px dashed var(--vz-border-strong); background: transparent; width: 100%; margin-bottom: 4px; transition: all var(--vz-dur); }
      .newtab:hover { border-style: solid; color: var(--vz-accent); border-color: var(--vz-accent); }
      .newtab:hover { background: var(--vz-surface-hover); color: var(--vz-text); }
      .sep { height: 1px; background: var(--vz-border); margin: 6px 8px; }

      .tab {
        display: flex; align-items: center; gap: 10px; height: var(--row-h, 34px); padding: 0 6px 0 10px; border-radius: var(--vz-radius-s); cursor: default;
        position: relative; color: var(--vz-text); transition: background 80ms; outline: none;
      }
      :host-context([data-density=compact]) .tab { --row-h: 28px; }
      .tab:hover { background: var(--vz-surface-hover); }
      /* Same pill as the top tab strip: no card, no border. */
      .tab.active { background: color-mix(in srgb, var(--vz-text) 9%, transparent); }
      .tab:focus-visible { outline: 2px solid var(--vz-focus); outline-offset: -2px; }
      .tab.discarded .title, .tab.discarded img { opacity: 0.55; }
      .tab.dragging { opacity: 0.4; }
      .tab.selected:not(.active), .pin.selected:not(.active) { background: var(--vz-accent-soft); color: var(--vz-text); }
      .tab.selected.active, .pin.selected.active { box-shadow: 0 0 0 1.5px color-mix(in srgb, var(--vz-accent) 45%, transparent); }
      .tab .title { flex: 1; min-width: 0; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; font-size: var(--vz-text-m); }
      .tab .x { opacity: 0; width: 22px; height: 22px; }
      .tab:hover .x, .tab.active .x, .tab:focus-within .x { opacity: 1; }
      .tab .audio { width: 22px; height: 22px; color: var(--vz-accent); }
      .tab.split::after { content: ''; position: absolute; inset-inline-start: 2px; top: 8px; bottom: 8px; width: 3px; border-radius: 2px; background: var(--vz-accent); }
      .drop-line { height: 2px; margin: -1px 8px; background: var(--vz-accent); border-radius: 1px; }
      .fav { width: 16px; height: 16px; border-radius: 4px; flex: none; display: grid; place-items: center; color: var(--vz-text-3); }
      .fav img { width: 16px; height: 16px; border-radius: 3px; }

      .group { margin: 2px 0; border-radius: var(--vz-radius); }
      .group-head { display: flex; align-items: center; gap: 6px; height: 28px; padding: 0 6px 0 4px; border-radius: var(--vz-radius-s); cursor: pointer; color: var(--vz-text-2); font-size: var(--vz-text-s); font-weight: 650; }
      .group-head:hover { background: var(--vz-surface-hover); }
      .group-head .gdot { width: 8px; height: 8px; border-radius: 50%; flex: none; }
      .group-head .gname { flex: 1; min-width: 0; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
      .group-head input { flex: 1; height: 22px; padding: 0 6px; font-size: var(--vz-text-s); }
      .group-body { padding-inline-start: 10px; border-inline-start: 2px solid var(--gcolor); margin-inline-start: 7px; }
      .group.drop .group-body { background: color-mix(in srgb, var(--gcolor) 8%, transparent); border-radius: 0 var(--vz-radius-s) var(--vz-radius-s) 0; }

      .footer { display: flex; align-items: center; gap: 2px; padding-top: 8px; }
      .spaces { flex: 1; display: flex; align-items: center; gap: 2px; overflow-x: auto; scrollbar-width: none; }
      .space-btn { width: 30px; height: 30px; border-radius: 50%; border: 0; background: transparent; display: grid; place-items: center; cursor: pointer; color: var(--vz-text-3); position: relative; flex: none; transition: background var(--vz-dur), color var(--vz-dur), transform var(--vz-dur) var(--vz-ease); }
      .space-btn:hover { color: var(--vz-text); }
      .space-btn.active { color: var(--vz-text); animation: vz-pop 320ms cubic-bezier(.34,1.56,.64,1); }
      @keyframes vz-pop { 0% { transform: scale(.82); } 60% { transform: scale(1.08); } 100% { transform: scale(1); } }
      .space-btn.drop { transform: scale(1.18); background: color-mix(in srgb, var(--c) 26%, transparent); color: var(--c); }
      .meta { display: flex; gap: 6px; padding: 4px 6px 0; font-size: var(--vz-text-xs); color: var(--vz-text-3); }
      .meta button { border: 0; background: transparent; color: inherit; cursor: pointer; display: inline-flex; gap: 4px; align-items: center; padding: 2px 4px; border-radius: 999px; font-size: inherit; }
      .meta button:hover { background: var(--vz-surface-hover); color: var(--vz-text-2); }

      .toasts { position: absolute; left: 8px; right: 0; bottom: 74px; display: flex; flex-direction: column; gap: 6px; z-index: 3; }
      .toast { display: flex; align-items: center; gap: 8px; padding: 9px 10px 9px 12px; border-radius: var(--vz-radius); background: var(--vz-text); color: var(--vz-bg-elev); box-shadow: var(--vz-shadow-pop); font-size: var(--vz-text-s); animation: pop 220ms var(--vz-ease); }
      .toast span { flex: 1; }
      .toast button { border: 0; background: transparent; color: inherit; cursor: pointer; font-weight: 700; font-size: inherit; padding: 2px 4px; border-radius: 999px; }
      .toast button:hover { background: color-mix(in srgb, currentColor 14%, transparent); }
      @keyframes pop { from { opacity: 0; transform: translateY(8px) scale(0.98); } }
    `,
  ];

  private get space(): SpaceInfo | undefined {
    return this.state.spaces.find((s) => s.id === this.state.activeSpaceId);
  }

  private get spaceTabs(): TabInfo[] {
    return this.state.tabs.filter((x) => x.spaceId === this.state.activeSpaceId);
  }

  private get order(): number[] {
    return this.spaceTabs.map((x) => x.id);
  }

  private clickTab(e: MouseEvent, id: number): void {
    if (!this.sel.click(e, id, this.order, this.state.activeTabId)) void shell.activateTab(id);
  }

  private tabMenu(e: MouseEvent, id: number): void {
    e.preventDefault();
    void shell.showTabMenu(id, { x: e.clientX, y: e.clientY }, this.sel.has(id) ? this.sel.targets(id, this.order) : undefined);
  }

  override render() {
    const s = this.state;
    const mac = s.platform.startsWith('darwin');
    this.sel.prune(this.order);
    const active = s.tabs.find((x) => x.id === s.activeTabId);
    const tabs = this.spaceTabs;
    const pinned = tabs.filter((x) => x.pinned);
    const rest = tabs.filter((x) => !x.pinned);
    return html`
      <div class="top" style=${mac && !s.fullscreen ? '--traffic: 74px' : ''}>
        <button class="icon-btn" aria-label=${t('cmd_toggle_sidebar')} title=${t('cmd_toggle_sidebar')} @click=${() => shell.runCommand('view.toggleSidebar')}>${icon('sidebar', 16)}</button>
        <span class="spacer"></span>
        <button class="icon-btn" aria-label=${t('cmd_nav_back')} ?disabled=${!active?.canGoBack} @click=${() => active && shell.goBack(active.id)}>${icon('arrow-left', 16)}</button>
        <button class="icon-btn" aria-label=${t('cmd_nav_forward')} ?disabled=${!active?.canGoForward} @click=${() => active && shell.goForward(active.id)}>${icon('arrow-right', 16)}</button>
        <button class="icon-btn" aria-label=${active?.loading ? t('action_stop') : t('cmd_nav_reload')} @click=${() => active && (active.loading ? shell.stop(active.id) : shell.reload(active.id))}>
          ${icon(active?.loading ? 'x' : 'refresh', 16)}</button>
      </div>
      ${this.renderAddress(active)}
      <div class="space-head">
        <span class="space-dot" style="background:${this.accent(this.space?.color)}">${icon(this.space?.icon ?? 'star', 12)}</span>
        <span class="name">${this.space?.name}</span>
        <button class="icon-btn" aria-label=${t('space_menu')} @click=${(e: MouseEvent) => shell.showSpaceMenu(s.activeSpaceId, { x: e.clientX, y: e.clientY })}>${icon('more', 16)}</button>
      </div>
      <div class="pinned ${this.drop?.zone === 'pinned' ? 'drop' : ''}" role="list" aria-label=${t('pinned_tabs')}
        @dragover=${(e: DragEvent) => this.onDragOver(e, { index: Math.max(0, pinned.length - 1) + (pinned.length ? 1 : 0), groupId: undefined, zone: 'pinned' })}
        @drop=${(e: DragEvent) => this.onDrop(e)}>${pinned.map((x) => this.renderPin(x))}</div>
      <div class="list ${this.swipe ? 'anim' : ''}" style="--dir:${this.swipe}"
        @wheel=${(e: WheelEvent) => this.onWheel(e)} @keydown=${(e: KeyboardEvent) => this.onListKey(e)} @dragleave=${() => (this.drop = null)}>
        <button class="newtab" aria-label=${t('cmd_tab_new')} title=${`${t('cmd_tab_new')} (${mac ? '⌘T' : 'Ctrl+T'})`} @click=${() => shell.newTab()}>${icon('plus', 16)}</button>
        <div role="tree" aria-label=${t('tabs_list')}>${this.renderTabTree(rest, pinned.length)}</div>
        <div style="height:40px" @dragover=${(e: DragEvent) => this.onDragOver(e, { index: tabs.length, groupId: null, zone: 'list' })} @drop=${(e: DragEvent) => this.onDrop(e)}></div>
      </div>
      ${s.toasts.length ? html`<div class="toasts" role="status" aria-live="polite">${s.toasts.map((x) => html`<div class="toast"><span>${x.text}</span>
          ${x.action ? html`<button @click=${() => shell.toastAction(x.id)}>${x.action.label}</button>` : nothing}
          <button aria-label=${t('action_close')} @click=${() => shell.dismissToast(x.id)}>${icon('x', 12)}</button></div>`)}</div>` : nothing}
      <div class="footer">
        <div class="spaces" role="tablist" aria-label=${t('spaces')}>
          ${s.spaces.map((sp, i) => html`<button class="space-btn ${sp.id === s.activeSpaceId ? 'active' : ''} ${this.drop && (this.drop as unknown as { space?: string }).space === sp.id ? 'drop' : ''}"
            role="tab" aria-selected=${sp.id === s.activeSpaceId} style="--c:${this.accent(sp.color)}" title="${sp.name} (${mac ? '⌘⌥' : 'Ctrl+Alt+'}${i + 1})"
            aria-label=${sp.name}
            @click=${() => shell.switchSpace(sp.id)} @dblclick=${() => shell.editSpace(sp.id)}
            @contextmenu=${(e: MouseEvent) => (e.preventDefault(), shell.showSpaceMenu(sp.id, { x: e.clientX, y: e.clientY }))}
            @dragover=${(e: DragEvent) => {
              if (this.dragging === null) return;
              e.preventDefault();
              this.drop = { index: -1, groupId: undefined, zone: 'list', space: sp.id } as never;
            }}
            @drop=${(e: DragEvent) => {
              e.preventDefault();
              if (this.dragging !== null) this.dragIds.forEach((id) => void shell.moveTabToSpace(id, sp.id));
              this.endDrag();
            }}>${icon(sp.icon, 16)}</button>`)}
        </div>
        <button class="space-btn" aria-label=${t('cmd_space_new')} title=${t('cmd_space_new')} @click=${() => shell.createSpace()}>${icon('plus', 15)}</button>
        <button class="icon-btn" aria-label=${t('cmd_downloads')} title=${t('cmd_downloads')} @click=${() => shell.runCommand('page.downloads')}>${icon('download', 16)}</button>
        <button class="icon-btn" aria-label=${t('cmd_settings')} title=${t('cmd_settings')} @click=${() => shell.runCommand('page.settings')}>${icon('settings', 16)}</button>
      </div>
      <div class="meta">
        ${s.archiveCount ? html`<button @click=${() => shell.runCommand('page.archive')} title=${t('archived_count', { count: s.archiveCount })} aria-label=${t('archived_count', { count: s.archiveCount })}>${icon('archive', 12)} ${s.archiveCount}</button>` : nothing}
        ${s.asleepCount ? html`<button @click=${() => shell.runCommand('focus.toggle')} title=${t('asleep_count', { count: s.asleepCount })} aria-label=${t('asleep_count', { count: s.asleepCount })}>${icon('moon', 12)} ${s.asleepCount}</button>` : nothing}
      </div>
    `;
  }

  private renderAddress(active: TabInfo | undefined): TemplateResult {
    const sec = active?.security ?? 'none';
    const empty = !active?.displayUrl;
    return html`<div class="address">
      <button class="addr-btn" title=${t('cb_address_label')} @click=${(e: MouseEvent) => this.openAddress(e)}>
      <span class="sec ${sec}" title=${t(`security_${sec}` as never)}>${icon(securityIcon(sec), 14, t(`security_${sec}` as never))}</span>
      ${sec === 'insecure' || sec === 'dangerous' ? html`<span class="sec-label">${t(`security_${sec}_short` as never)}</span>` : nothing}
      <span class="url ${empty ? 'placeholder' : ''}">${empty ? t('cb_placeholder') : active!.displayUrl}</span></button>
      ${active && /^https?:/.test(active.url)
        ? html`<button class="shield-btn ${active.blocked ? 'has' : ''}" aria-label=${t('shields_button', { count: active.blocked })} title=${t('shields_button', { count: active.blocked })}
            @click=${(e: MouseEvent) => {
              e.stopPropagation();
              const r = (e.currentTarget as HTMLElement).getBoundingClientRect();
              void shell.openShieldsPanel({ x: r.x, y: r.y, width: r.width, height: r.height });
            }}>${icon('shield', 13)}${active.blocked || ''}</button>`
        : nothing}
      ${this.state.aiMode !== 'off'
        ? html`<button class="icon-btn ${this.state.panel === 'assistant' ? 'on' : ''}" aria-label=${t('cmd_ai_panel')} title=${t('cmd_ai_panel')}
            @click=${(e: MouseEvent) => {
              e.stopPropagation();
              void shell.runCommand('ai.panel');
            }}>${icon('sparkle', 15)}</button>`
        : nothing}
    </div>`;
  }

  private openAddress(e: Event): void {
    const r = ((e.currentTarget as HTMLElement).closest('.address') as HTMLElement).getBoundingClientRect();
    void shell.openCommandBar('address', { x: r.x, y: r.y, width: r.width, height: r.height });
  }

  private renderPin(x: TabInfo): TemplateResult {
    const active = x.id === this.state.activeTabId;
    return html`<div class="pin ${active ? 'active' : ''} ${this.sel.has(x.id) ? 'selected' : ''}" role="listitem" tabindex="0" title=${x.title} aria-label=${x.title} aria-current=${active ? 'page' : 'false'}
      draggable="true" @dragstart=${(e: DragEvent) => this.startDrag(e, x)} @dragend=${(e: DragEvent) => this.endDrag(e)}
      @click=${(e: MouseEvent) => this.clickTab(e, x.id)} @keydown=${(e: KeyboardEvent) => e.key === 'Enter' && shell.activateTab(x.id)}
      @auxclick=${(e: MouseEvent) => e.button === 1 && shell.closeTab(x.id)}
      @contextmenu=${(e: MouseEvent) => this.tabMenu(e, x.id)}>
      ${favicon(x, 20)}${x.audible ? html`<span class="dot"></span>` : nothing}
    </div>`;
  }

  /** Renders ungrouped tabs and groups in model order; `offset` = number of pinned tabs before them. */
  private renderTabTree(rest: TabInfo[], offset: number): TemplateResult[] {
    const out: TemplateResult[] = [];
    let i = 0;
    while (i < rest.length) {
      const tab = rest[i]!;
      if (tab.groupId) {
        const g = this.state.groups.find((x) => x.id === tab.groupId);
        const members: TabInfo[] = [];
        const start = i;
        while (i < rest.length && rest[i]!.groupId === tab.groupId) members.push(rest[i++]!);
        if (g) out.push(this.renderGroup(g, members, offset + start));
        else members.forEach((m, k) => out.push(this.renderTab(m, offset + start + k, null)));
      } else {
        out.push(this.renderTab(tab, offset + i, null));
        i++;
      }
    }
    return out;
  }

  private renderGroup(g: GroupInfo, members: TabInfo[], start: number): TemplateResult {
    const color = this.accent(g.color);
    const isDrop = this.drop?.groupId === g.id;
    return html`<div class="group ${isDrop ? 'drop' : ''}" style="--gcolor:${color}" role="treeitem" aria-expanded=${!g.collapsed} aria-label=${g.title}>
      <div class="group-head" @click=${() => shell.updateGroup(g.id, { collapsed: !g.collapsed })} @dblclick=${(e: Event) => (e.stopPropagation(), (this.renaming = g.id))}
        @dragover=${(e: DragEvent) => this.onDragOver(e, { index: start + members.length, groupId: g.id, zone: 'list' })} @drop=${(e: DragEvent) => this.onDrop(e)}>
        ${icon(g.collapsed ? 'chevron-right' : 'chevron-down', 14)}
        <span class="gdot" style="background:${color}"></span>
        ${this.renaming === g.id
          ? html`<input type="text" .value=${g.title} aria-label=${t('group_rename')} @click=${(e: Event) => e.stopPropagation()}
              @keydown=${(e: KeyboardEvent) => {
                if (e.key === 'Enter') this.finishRename(g, (e.target as HTMLInputElement).value);
                if (e.key === 'Escape') this.renaming = null;
              }} @blur=${(e: FocusEvent) => this.finishRename(g, (e.target as HTMLInputElement).value)} />`
          : html`<span class="gname">${g.aiGenerated ? html`${icon('sparkle', 11)} ` : nothing}${g.title}</span>`}
        <span class="faint">${members.length}</span>
        <button class="icon-btn" style="width:22px;height:22px" aria-label=${t('group_ungroup')} title=${t('group_ungroup')} @click=${(e: Event) => (e.stopPropagation(), shell.ungroup(g.id))}>${icon('x', 12)}</button>
      </div>
      ${g.collapsed ? nothing : html`<div class="group-body" role="group">${members.map((m, k) => this.renderTab(m, start + k, g.id))}</div>`}
    </div>`;
  }

  protected override updated(): void {
    const input = this.renderRoot.querySelector('.group-head input') as HTMLInputElement | null;
    if (input && document.activeElement !== input && this.shadowRoot?.activeElement !== input) {
      input.focus();
      input.select();
    }
  }

  private finishRename(g: GroupInfo, value: string): void {
    if (this.renaming !== g.id) return;
    this.renaming = null;
    const title = value.trim();
    if (title && title !== g.title) void shell.updateGroup(g.id, { title });
  }

  private renderTab(x: TabInfo, index: number, groupId: string | null): TemplateResult {
    const active = x.id === this.state.activeTabId;
    const showLine = this.drop && this.drop.zone === 'list' && this.drop.index === index && this.dragging !== x.id;
    return html`${showLine ? html`<div class="drop-line"></div>` : nothing}
      <div class="tab ${active ? 'active' : ''} ${this.sel.has(x.id) ? 'selected' : ''} ${x.discarded ? 'discarded' : ''} ${this.dragIds.includes(x.id) ? 'dragging' : ''} ${this.state.splitTabId === x.id ? 'split' : ''}"
        role="treeitem" tabindex=${active ? 0 : -1} aria-selected=${active || this.sel.has(x.id)} aria-label=${x.title + (x.audible ? `, ${t('tab_playing_audio')}` : '') + (x.discarded ? `, ${t('tab_asleep')}` : '')}
        data-id=${x.id} draggable="true" title=${`${x.title}\n${x.displayUrl}`}
        @click=${(e: MouseEvent) => this.clickTab(e, x.id)} @auxclick=${(e: MouseEvent) => e.button === 1 && shell.closeTab(x.id)}
        @contextmenu=${(e: MouseEvent) => this.tabMenu(e, x.id)}
        @dragstart=${(e: DragEvent) => this.startDrag(e, x)} @dragend=${(e: DragEvent) => this.endDrag(e)}
        @dragover=${(e: DragEvent) => {
          const r = (e.currentTarget as HTMLElement).getBoundingClientRect();
          const after = e.clientY > r.top + r.height / 2;
          this.onDragOver(e, { index: index + (after ? 1 : 0), groupId, zone: 'list' });
        }}
        @drop=${(e: DragEvent) => this.onDrop(e)}>
        <span class="fav">${x.loading ? icon('loader', 14) : favicon(x, 16)}</span>
        <span class="title">${x.title}</span>
        ${x.audible || x.muted
          ? html`<button class="icon-btn audio" aria-label=${x.muted ? t('ctx_unmute') : t('ctx_mute')} @click=${(e: Event) => (e.stopPropagation(), shell.setMuted(x.id, !x.muted))}>${icon(x.muted ? 'volume-x' : 'volume', 14)}</button>`
          : nothing}
        <button class="icon-btn x" aria-label=${t('cmd_tab_close')} tabindex="-1" @click=${(e: Event) => (e.stopPropagation(), shell.closeTab(x.id))}>${icon('x', 13)}</button>
      </div>`;
  }

  // ---- interaction

  private accent(color: string | undefined): string {
    const a = ACCENTS[(color ?? 'indigo') as keyof typeof ACCENTS] ?? ACCENTS.indigo;
    return document.documentElement.dataset.theme === 'light' ? a.light : a.dark;
  }

  private startDrag(e: DragEvent, x: TabInfo): void {
    this.dragging = x.id;
    this.dragIds = this.sel.targets(x.id, this.order);
    startTabDrag(e, this.dragIds, x.url);
  }

  private endDrag(e?: DragEvent): void {
    if (e) endTabDrag(e, this.dragIds);
    this.dragging = null;
    this.dragIds = [];
    this.drop = null;
  }

  private onDragOver(e: DragEvent, target: NonNullable<DropTarget>): void {
    if (this.dragging === null && !isTabDrag(e)) return;
    e.preventDefault();
    e.stopPropagation();
    e.dataTransfer!.dropEffect = 'move';
    if (JSON.stringify(this.drop) !== JSON.stringify(target)) this.drop = target;
  }

  private onDrop(e: DragEvent): void {
    e.preventDefault();
    e.stopPropagation();
    const id = this.dragging;
    const ids = this.dragIds;
    const d = this.drop;
    this.endDrag();
    if (!d || d.index < 0) return;
    if (id === null) {
      // Tabs dragged in from another window.
      const foreign = draggedTabIds(e);
      if (foreign.length) void shell.adoptTabs(foreign, Math.max(d.index, 0));
      return;
    }
    if (ids.length > 1) {
      ids.forEach((x, k) => void shell.moveTab(x, Math.max(d.index, 0) + k, d.groupId === undefined ? undefined : (d.groupId ?? '')));
      return;
    }
    const tabs = this.spaceTabs;
    const from = tabs.findIndex((x) => x.id === id);
    let index = d.index;
    if (from >= 0 && from < index) index--; // removing the tab shifts later positions
    if (d.zone === 'pinned') {
      const pinnedCount = tabs.filter((x) => x.pinned).length;
      void shell.moveTab(id, Math.min(index, pinnedCount), '');
      void shell.setPinned(id, true);
      return;
    }
    void shell.moveTab(id, Math.max(index, 0), d.groupId === undefined ? undefined : (d.groupId ?? ''));
  }

  /** Two-finger horizontal swipe on the tab list switches Space. */
  private onWheel(e: WheelEvent): void {
    if (Math.abs(e.deltaX) < Math.abs(e.deltaY) * 1.5) return;
    this.wheelAcc += e.deltaX;
    clearTimeout(this.wheelTimer);
    this.wheelTimer = window.setTimeout(() => (this.wheelAcc = 0), 220);
    if (Math.abs(this.wheelAcc) > 120) {
      const dir = this.wheelAcc > 0 ? 1 : -1;
      this.wheelAcc = 0;
      this.swipe = dir;
      void shell.runCommand(dir > 0 ? 'space.next' : 'space.previous');
      window.setTimeout(() => (this.swipe = 0), 200);
    }
  }

  /** Arrow keys move between tabs; Enter activates; Delete closes (tree keyboard pattern). */
  private onListKey(e: KeyboardEvent): void {
    const rows = [...this.renderRoot.querySelectorAll<HTMLElement>('.tab')];
    const i = rows.findIndex((r) => r === this.shadowRoot!.activeElement);
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault();
      const next = rows[Math.max(0, Math.min(rows.length - 1, i + (e.key === 'ArrowDown' ? 1 : -1)))];
      next?.focus();
    } else if (e.key === 'Enter' && i >= 0) {
      void shell.activateTab(Number(rows[i]!.dataset.id));
    } else if ((e.key === 'Delete' || e.key === 'Backspace') && i >= 0) {
      void shell.closeTab(Number(rows[i]!.dataset.id));
    }
  }
}
customElements.define('vz-sidebar', VzSidebar);
