import { css, html } from 'lit';
import { base, pageStyles } from '../shared/styles';
import { icon } from '../shared/icons';
import { VzPage } from '../shared/page_base';
import { t } from '@vz/common/i18n';

const MESSAGES: Record<string, string> = { '-105': 'err_name_not_resolved', '-106': 'err_internet_disconnected', '-102': 'err_connection_refused', '-118': 'err_timed_out', '-200': 'err_cert', '-201': 'err_cert', '-202': 'err_cert', '-207': 'err_cert', '-20': 'err_blocked', '-21': 'err_network_changed', '-109': 'err_unreachable', '-7': 'err_timed_out' };

class VzError extends VzPage<unknown> {
  static override styles = [base, pageStyles, css`:host { display: grid; place-items: center; } .box { max-width: 520px; padding: 24px; } .box .vz-icon { color: var(--vz-text-3); } h1 { font-size: 22px; margin: 16px 0 8px; } code { font-size: 11px; color: var(--vz-text-3); }`];
  override render() {
    const q = new URLSearchParams(location.search);
    const code = q.get('code') ?? '';
    const url = q.get('url') ?? '';
    let host = url;
    try {
      host = new URL(url).hostname;
    } catch {
      /* keep */
    }
    const key = MESSAGES[code] ?? 'err_generic';
    const cert = key === 'err_cert';
    return html`<div class="box">${icon(cert ? 'alert' : 'globe', 40)}
      <h1>${cert ? t('err_cert_title') : t('err_title', { host })}</h1>
      <p class="muted">${t(key as never, { host })}</p>
      <p><code>${q.get('desc') ?? ''} (${code})</code></p>
      ${cert ? '' : html`<button class="btn primary" @click=${() => this.invoke('open', { url })}>${icon('refresh', 14)} ${t('err_retry')}</button>`}
    </div>`;
  }
}
customElements.define('vz-error', VzError);
