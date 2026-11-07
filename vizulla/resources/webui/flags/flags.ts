import { css, html, unsafeCSS } from 'lit';
import { base, pageStyles } from '../shared/styles';
import { VzPage, switchStyles } from '../shared/page_base';
import { t } from '@vz/common/i18n';

interface Flag { name: string; release: string; description: string; owner: string; removeBy: string; enabled: boolean; defaultEnabled: boolean; override: boolean | null }

class VzFlags extends VzPage<Flag[]> {
  static override properties = { ...VzPage.properties, dirty: { state: true } };
  dirty = false;
  static override styles = [base, pageStyles, css`${unsafeCSS(switchStyles)} .rel { font-family: var(--vz-font-mono); font-size: 11px; } .warn { background: var(--vz-accent-soft); padding: 12px 16px; border-radius: 12px; margin-bottom: 16px; }`];
  override render() {
    if (!this.data) return this.loading();
    return html`<div class="page"><header class="page-head"><h1>${t('cmd_flags')}</h1>${this.dirty ? html`<button class="btn primary" @click=${() => this.invoke('restart')}>${t('flags_restart')}</button>` : ''}</header>
      <div class="warn">${t('flags_warning')}</div>
      <div class="card">${this.data.map((f) => html`<div class="row section"><div class="grow"><div class="title">${f.name} <span class="chip rel">${f.release}</span>${f.override !== null ? html` <span class="chip">${t('flags_overridden')}</span>` : ''}</div>
        <div class="desc">${f.description} · ${f.owner} · ${t('flags_remove_by', { date: f.removeBy })}</div></div>
        ${f.override !== null ? html`<button class="btn ghost" @click=${async () => ((this.data = await this.invoke('set', { name: f.name })), (this.dirty = true))}>${t('action_reset')}</button>` : ''}
        ${this.toggle(f.enabled, async (v) => ((this.data = await this.invoke('set', { name: f.name, value: v })), (this.dirty = true)), f.name)}</div>`)}</div></div>`;
  }
}
customElements.define('vz-flags', VzFlags);
