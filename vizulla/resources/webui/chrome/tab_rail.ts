// <vz-tab-rail>: the collapsed vertical tab strip, like Chrome's and Edge's collapsed
// vertical tabs. Tabs stay visible as favicons with "+" right under them, so a
// collapsed sidebar never hides the tabs or the way to open a new one.
import { LitElement, css, html, nothing } from 'lit';
import { repeat } from 'lit/directives/repeat.js';
import { base } from '../shared/styles';
import { icon } from '../shared/icons';
import { t } from '@vz/common/i18n';
import type { WindowState } from '@vz/common/types';
import { shell } from './shell';
import { favicon } from './common';

export class VzTabRail extends LitElement {
  static override properties = { state: { attribute: false } };
  state!: WindowState;

  static override styles = [
    base,
    css`
      :host { display: flex; flex-direction: column; align-items: center; gap: 4px; width: 52px; height: 100vh; padding: 8px 0; -webkit-app-region: drag; }
      :host([mac]) { padding-top: 44px; }
      button { -webkit-app-region: no-drag; }
      .expand { width: 36px; height: 36px; border-radius: 50%; flex: none; }
      .tabs { display: flex; flex-direction: column; align-items: center; gap: 4px; overflow-y: auto; scrollbar-width: none; min-height: 0; padding: 2px 0; }
      .tabs::-webkit-scrollbar { display: none; }
      .tab { position: relative; width: 36px; height: 36px; flex: none; border: 0; border-radius: 10px; display: grid; place-items: center; cursor: pointer; background: transparent; color: var(--vz-text-2);
        transition: background var(--vz-dur), transform var(--vz-dur) var(--vz-ease); animation: vz-rise 200ms var(--vz-ease); }
      .tab:hover { background: var(--vz-tab-hover); }
      .tab:active { transform: scale(.94); }
      .tab.active { background: color-mix(in srgb, var(--vz-text) 9%, transparent); color: var(--vz-text); }
      .tab.active::before { content: ''; position: absolute; left: -8px; top: 10px; bottom: 10px; width: 3px; border-radius: 0 3px 3px 0; background: var(--vz-accent); }
      .tab img, .tab .vz-icon { width: 16px; height: 16px; border-radius: 3px; }
      .tab.loading::after { content: ''; position: absolute; inset: 7px; border-radius: 50%; border: 2px solid var(--vz-accent); border-right-color: transparent; animation: vz-spin .8s linear infinite; }
      .tab.asleep { opacity: .5; }
      .add { width: 36px; height: 36px; border-radius: 50%; flex: none; }
      .sep { width: 20px; height: 1px; flex: none; background: var(--vz-border-strong); margin: 2px 0; }
    `,
  ];

  override render() {
    const s = this.state;
    const mac = s.platform.startsWith('darwin');
    this.toggleAttribute('mac', mac && !s.fullscreen);
    const tabs = s.tabs.filter((x) => x.spaceId === s.activeSpaceId);
    return html`
      <button class="icon-btn expand" aria-label=${t('cmd_toggle_sidebar')} title=${t('cmd_toggle_sidebar')} @click=${() => shell.setSidebar({ collapsed: false })}>${icon('sidebar', 17)}</button>
      <span class="sep"></span>
      <div class="tabs" role="tablist" aria-orientation="vertical" aria-label=${t('tabs_list')}>
        ${repeat(tabs, (x) => x.id, (x) => html`<button class="tab ${x.id === s.activeTabId ? 'active' : ''} ${x.loading ? 'loading' : ''} ${x.discarded ? 'asleep' : ''}" role="tab"
          aria-selected=${x.id === s.activeTabId} aria-label=${x.title} title=${x.displayUrl ? `${x.title}\n${x.displayUrl}` : x.title} data-tip-side="right"
          @click=${() => shell.activateTab(x.id)} @auxclick=${(e: MouseEvent) => e.button === 1 && shell.closeTab(x.id)}
          @contextmenu=${(e: MouseEvent) => (e.preventDefault(), shell.showTabMenu(x.id, { x: e.clientX, y: e.clientY }))}>${x.loading ? nothing : favicon(x, 16)}</button>`)}
      </div>
      <button class="icon-btn add" aria-label=${t('cmd_tab_new')} title=${t('cmd_tab_new')} data-tip-side="right" data-kbd=${mac ? '⌘T' : 'Ctrl+T'} @click=${() => shell.newTab()}>${icon('plus', 18)}</button>
    `;
  }
}
customElements.define('vz-tab-rail', VzTabRail);
