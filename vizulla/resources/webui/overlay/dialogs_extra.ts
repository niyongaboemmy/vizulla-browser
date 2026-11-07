// Dialog types added by later phases.
import { html } from 'lit';
import { icon } from '../shared/icons';
import { t } from '@vz/common/i18n';
import { registerDialog } from './dialogs';
import './dialogs_agent';

// AI-05: first cloud use per site and provider. Says what leaves the device, and where.
registerDialog('disclosure', (d, host) => {
  const draft = host.draft as { remember?: boolean };
  draft.remember ??= true;
  const sites = d.sites as string[];
  return html`
    <div class="perm-head">${icon('cloud', 22)}<div>
      <h2 id="dlg-title">${t('disclosure_title', { provider: String(d.provider) })}</h2>
      <p class="muted">${t('disclosure_body', { sites: sites.join(', '), kb: String(d.kb), provider: String(d.provider) })}</p>
    </div></div>
    <ul class="muted" style="margin:0 0 12px;padding-inline-start:20px;font-size:12px;line-height:1.7">
      <li>${t('disclosure_point_what')}</li><li>${t('disclosure_point_retention')}</li><li>${t('disclosure_point_local')}</li>
    </ul>
    <label class="check"><input type="checkbox" .checked=${draft.remember} @change=${(e: Event) => (draft.remember = (e.target as HTMLInputElement).checked)} /> ${t('disclosure_remember')}</label>
    <div class="actions">
      <button class="btn" @click=${() => host.resolve({ allow: false })}>${t('action_cancel')}</button>
      <button class="btn primary" autofocus @click=${() => host.resolve({ allow: true, remember: draft.remember })}>${t('disclosure_send')}</button>
    </div>`;
});
