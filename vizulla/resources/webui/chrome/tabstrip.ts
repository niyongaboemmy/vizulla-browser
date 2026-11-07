// <vz-tabstrip>: horizontal tabs (the layout toggle, P2-BRW-02) and Classic mode.
import { LitElement, css, html, nothing } from 'lit';
import { base } from '../shared/styles';
import { icon } from '../shared/icons';
import { t } from '@vz/common/i18n';
import type { WindowState } from '@vz/common/types';
import { shell } from './shell';
import { favicon } from './common';

export class VzTabstrip extends LitElement {
  static override properties = { state: { attribute: false } };
  state!: WindowState;
  private dragId: number | null = null;

  static override styles = [
    base,
    css`
      :host { display: flex; align-items: flex-end; gap: 4px; height: 42px; padding: 0 8px; -webkit-app-region: drag; }
      .lead { display: flex; align-items: center; gap: 4px; height: 100%; padding-left: var(--traffic, 0); -webkit-app-region: no-drag; }
      .space { display: inline-flex; align-items: center; gap: 6px; height: 28px; padding: 0 8px; margin-bottom: 7px; border: 0; border-radius: 8px; background: var(--vz-surface-2); cursor: pointer; font-weight: 600; font-size: var(--vz-text-s); }
      .space:hover { background: var(--vz-surface-hover); }
      .tabs { display: flex; flex: 1; min-width: 0; gap: 2px; height: 34px; align-items: flex-end; }
      .tab { -webkit-app-region: no-drag; flex: 1 1 200px; min-width: 40px; max-width: 220px; height: 34px; display: flex; align-items: center; gap: 8px; padding: 0 6px 0 10px;
        border-radius: 9px 9px 0 0; cursor: default; position: relative; font-size: var(--vz-text-s); color: var(--vz-text-2); }
      .tab:hover { background: var(--vz-surface-hover); color: var(--vz-text); }
      .tab.active { background: var(--vz-bg-elev); color: var(--vz-text); box-shadow: 0 -1px 0 var(--vz-border); }
      .tab.pinned { flex: 0 0 40px; justify-content: center; padding: 0; }
      .tab .title { flex: 1; min-width: 0; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
      .tab .x { width: 20px; height: 20px; opacity: 0; }
      .tab:hover .x, .tab.active .x { opacity: 1; }
      .tab img, .tab .vz-icon { width: 14px; height: 14px; }
      .add { -webkit-app-region: no-drag; margin-bottom: 4px; }
      .end { width: var(--controls, 0); flex: none; }
    `,
  ];

  override render() {
    const s = this.state;
    const mac = s.platform.startsWith('darwin');
    const space = s.spaces.find((x) => x.id === s.activeSpaceId);
    const tabs = s.tabs.filter((x) => x.spaceId === s.activeSpaceId);
    return html`
      <div class="lead" style=${mac && !s.fullscreen ? '--traffic:74px' : ''}>
        ${s.classic && s.spaces.length < 2
          ? nothing
          : html`<button class="space" aria-label=${t('spaces')} @click=${(e: MouseEvent) => shell.showSpaceMenu(s.activeSpaceId, { x: e.clientX, y: e.clientY })}>${icon(space?.icon ?? 'star', 13)} ${space?.name}</button>`}
      </div>
      <div class="tabs" role="tablist" aria-label=${t('tabs_list')}>
        ${tabs.map(
          (x, i) => html`<div class="tab ${x.id === s.activeTabId ? 'active' : ''} ${x.pinned ? 'pinned' : ''}" role="tab" tabindex=${x.id === s.activeTabId ? 0 : -1}
            aria-selected=${x.id === s.activeTabId} title=${x.title} draggable="true"
            @dragstart=${() => (this.dragId = x.id)} @dragover=${(e: DragEvent) => e.preventDefault()}
            @drop=${() => this.dragId !== null && shell.moveTab(this.dragId, i)}
            @click=${() => shell.activateTab(x.id)} @auxclick=${(e: MouseEvent) => e.button === 1 && shell.closeTab(x.id)}
            @contextmenu=${(e: MouseEvent) => (e.preventDefault(), shell.showTabMenu(x.id, { x: e.clientX, y: e.clientY }))}>
            ${x.loading ? icon('loader', 14) : favicon(x, 14)}
            ${x.pinned ? nothing : html`<span class="title">${x.title}</span>
              ${x.audible ? icon(x.muted ? 'volume-x' : 'volume', 13) : nothing}
              <button class="icon-btn x" aria-label=${t('cmd_tab_close')} @click=${(e: Event) => (e.stopPropagation(), shell.closeTab(x.id))}>${icon('x', 12)}</button>`}
          </div>`,
        )}
        <button class="icon-btn add" aria-label=${t('cmd_tab_new')} @click=${() => shell.newTab()}>${icon('plus', 16)}</button>
      </div>
      <div class="end" style=${mac ? '' : '--controls:138px'}></div>
    `;
  }
}
customElements.define('vz-tabstrip', VzTabstrip);
