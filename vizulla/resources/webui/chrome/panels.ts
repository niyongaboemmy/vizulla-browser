// <vz-panels>: the right-hand side panel host (assistant, notes, agent).
// Panel elements are registered by feature modules; each is created lazily on first open.
import { LitElement, css, html } from 'lit';
import { base } from '../shared/styles';
import { icon } from '../shared/icons';
import { t } from '@vz/common/i18n';
import type { PanelKind, WindowState } from '@vz/common/types';
import { shell } from './shell';

export const PANEL_TAGS: Partial<Record<PanelKind, { tag: string; title: () => string; icon: string }>> = {};

export function registerPanel(kind: PanelKind, tag: string, title: () => string, iconName: string): void {
  PANEL_TAGS[kind] = { tag, title, icon: iconName };
}

export class VzPanels extends LitElement {
  static override properties = { state: { attribute: false } };
  state!: WindowState;
  private readonly created = new Map<PanelKind, HTMLElement>();

  static override styles = [
    base,
    css`
      :host { display: flex; flex-direction: column; height: 100%; min-width: 0; animation: panel-in 260ms var(--vz-ease); }
      @keyframes panel-in { from { opacity: 0; transform: translateX(16px); } }
      .card { flex: 1; display: flex; flex-direction: column; min-height: 0; background: var(--vz-toolbar); overflow: hidden; }
      .tabs { display: flex; align-items: center; gap: 2px; padding: 8px 8px 4px; }
      .tabs > * { -webkit-app-region: no-drag; }
      .tabs .tab { display: inline-grid; place-items: center; width: 34px; height: 32px; border: 0; border-radius: 10px; background: transparent; cursor: pointer; color: var(--vz-text-2); transition: background var(--vz-dur), color var(--vz-dur); }
      .tabs .tab:hover { background: var(--vz-surface-hover); }
      .tabs .tab[aria-selected='true'] { color: var(--vz-accent); background: var(--vz-accent-soft); }
      .tabs .spacer { flex: 1; }
      .body { flex: 1; min-height: 0; display: flex; flex-direction: column; }
      .body > * { flex: 1; min-height: 0; }
    `,
  ];

  override render() {
    const kinds = (Object.keys(PANEL_TAGS) as PanelKind[]).filter((k) => (k !== 'agent' || this.state.features.VizullaAgent) && (k !== 'notes' || this.state.features.VizullaNotes) && (k !== 'assistant' || this.state.aiMode !== 'off' || this.state.panel === 'assistant'));
    const current = this.state.panel!;
    const def = PANEL_TAGS[current];
    let el = this.created.get(current);
    if (def && !el) {
      el = document.createElement(def.tag);
      this.created.set(current, el);
    }
    if (el) (el as unknown as { state: WindowState }).state = this.state;
    return html`<div class="card">
      <div class="tabs"><div role="tablist" style="display:flex;gap:2px">
        ${kinds.map((k) => html`<button class="tab" role="tab" aria-selected=${k === current} aria-label=${PANEL_TAGS[k]!.title()} title=${PANEL_TAGS[k]!.title()} @click=${() => shell.setPanel(k)}>${icon(PANEL_TAGS[k]!.icon, 16)}</button>`)}</div>
        <span class="spacer"></span>
        <button class="icon-btn" aria-label=${t('action_close')} @click=${() => shell.setPanel(undefined)}>${icon('x', 15)}</button>
      </div>
      <div class="body">${el ?? html`<div class="muted" style="padding:20px">${t('panel_unavailable')}</div>`}</div>
    </div>`;
  }
}
customElements.define('vz-panels', VzPanels);
