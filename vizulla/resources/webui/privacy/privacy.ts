// Privacy Dashboard (P2-BRW-18, PRV-05/06): what Shields blocked, and every AI
// request: origin, size, provider, and where it was processed.
import { css, html, nothing } from 'lit';
import { base, pageStyles } from '../shared/styles';
import { icon } from '../shared/icons';
import { VzPage, timeAgo } from '../shared/page_base';
import { t, getLocale } from '@vz/common/i18n';

interface Data {
  blocked: { total: number; byCategory: Record<string, number>; bySite: { site: string; n: number }[]; byDay: { day: string; n: number }[] };
  ai: { at: number; feature: string; origins: string[]; bytesSent: number; location: string; provider: string; model: string; routeReason: string; ok: boolean }[];
  aiCloudCount: number;
  aiLocalCount: number;
  shieldsEnabled: boolean;
  aiMode: string;
  retentionDays: number;
}

class VzPrivacy extends VzPage<Data> {
  static override styles = [base, pageStyles, css`
    .kpis { display: grid; grid-template-columns: repeat(4, 1fr); gap: 12px; margin-bottom: 16px; }
    .kpi { padding: 16px 18px; } .kpi b { display: block; font-size: 28px; letter-spacing: -0.02em; font-variant-numeric: tabular-nums; } .kpi span { color: var(--vz-text-2); font-size: var(--vz-text-s); }
    .chart { display: flex; align-items: flex-end; gap: 3px; height: 90px; padding: 16px 18px 6px; }
    .chart i { flex: 1; background: var(--vz-accent); border-radius: 3px 3px 0 0; min-height: 2px; opacity: .85; }
    .chart i:hover { opacity: 1; }
    .axis { display: flex; justify-content: space-between; padding: 0 18px 14px; font-size: var(--vz-text-xs); color: var(--vz-text-3); }
    .site { display: flex; align-items: center; gap: 10px; padding: 6px 18px; } .site .b { height: 6px; border-radius: 3px; background: var(--vz-accent); opacity: .7; }
    .site .n { width: 50px; text-align: right; font-variant-numeric: tabular-nums; color: var(--vz-text-2); font-size: var(--vz-text-s); }
    table { width: 100%; border-collapse: collapse; font-size: var(--vz-text-s); } th { text-align: start; font-weight: 600; color: var(--vz-text-3); padding: 8px 18px; font-size: var(--vz-text-xs); text-transform: uppercase; letter-spacing: .05em; }
    td { padding: 8px 18px; border-top: 1px solid var(--vz-border); vertical-align: top; }
    .loc { display: inline-flex; gap: 4px; align-items: center; font-weight: 600; } .loc.cloud { color: var(--vz-warn); } .loc.dev { color: var(--vz-ok); }
    h2 { padding: 16px 18px 4px; } .sub { padding: 0 18px 12px; color: var(--vz-text-2); font-size: var(--vz-text-s); margin: 0; }
    @media (max-width: 760px) { .kpis { grid-template-columns: 1fr 1fr; } }`];

  override render() {
    const d = this.data;
    if (!d) return this.loading();
    const max = Math.max(1, ...d.blocked.byDay.map((x) => x.n));
    const siteMax = Math.max(1, ...d.blocked.bySite.map((x) => x.n));
    const fmt = new Intl.NumberFormat(getLocale());
    const kb = (n: number) => `${fmt.format(Math.max(1, Math.round(n / 1024)))} KB`;
    return html`<div class="page">
      <header class="page-head"><h1>${t('cmd_privacy_dashboard')}</h1>
        <button class="btn" @click=${() => this.invoke('command', { id: 'page.settings' })}>${icon('settings', 14)} ${t('cmd_settings')}</button>
        <button class="btn danger" @click=${async () => confirm(t('privacy_clear_confirm')) && (this.data = { ...d, ...(await this.invoke<Data>('clear')) })}>${t('action_clear')}</button></header>
      <div class="kpis">
        <div class="card kpi"><b>${fmt.format(d.blocked.total)}</b><span>${t('privacy_blocked_30d')}</span></div>
        <div class="card kpi"><b>${fmt.format(d.blocked.byCategory.trackers ?? 0)}</b><span>${t('shields_trackers')}</span></div>
        <div class="card kpi"><b>${d.aiLocalCount}</b><span>${t('privacy_ai_local')}</span></div>
        <div class="card kpi"><b>${d.aiCloudCount}</b><span>${t('privacy_ai_cloud')}</span></div>
      </div>
      <div class="card"><h2>${t('privacy_blocked_per_day')}</h2>
        ${d.blocked.byDay.length ? html`<div class="chart" role="img" aria-label=${t('privacy_blocked_per_day')}>${d.blocked.byDay.map((x) => html`<i style="height:${(100 * x.n) / max}%" title="${x.day}: ${x.n}"></i>`)}</div>
          <div class="axis"><span>${d.blocked.byDay[0]?.day}</span><span>${d.blocked.byDay.at(-1)?.day}</span></div>` : html`<p class="sub">${d.shieldsEnabled ? t('privacy_nothing_yet') : t('privacy_shields_off')}</p>`}
      </div>
      ${d.blocked.bySite.length ? html`<div class="card"><h2>${t('privacy_top_sites')}</h2><div style="padding-bottom:12px">${d.blocked.bySite.slice(0, 10).map((s) => html`<div class="site">
          <span style="width:200px" class="ellipsis">${s.site}</span><span style="flex:1"><span class="b" style="display:block;width:${(100 * s.n) / siteMax}%"></span></span><span class="n">${fmt.format(s.n)}</span></div>`)}</div></div>` : nothing}
      <div class="card"><h2>${t('privacy_ai_title')}</h2><p class="sub">${t('privacy_ai_sub', { days: d.retentionDays })}</p>
        ${d.ai.length ? html`<table><thead><tr><th>${t('privacy_when')}</th><th>${t('privacy_what')}</th><th>${t('privacy_sent')}</th><th>${t('privacy_where')}</th></tr></thead><tbody>
          ${d.ai.map((r) => html`<tr><td>${timeAgo(r.at, getLocale())}</td><td>${r.feature}<div class="faint">${r.origins.join(', ')}</div></td><td>${kb(r.bytesSent)}</td>
            <td><span class="loc ${r.location === 'cloud' ? 'cloud' : 'dev'}">${icon(r.location === 'cloud' ? 'cloud' : 'cpu', 12)} ${r.location === 'cloud' ? t('ai_badge_cloud', { provider: r.provider }) : t('ai_badge_device')}</span>
              <div class="faint">${r.model} · ${r.routeReason}${r.ok ? '' : ` · ${t('privacy_failed')}`}</div></td></tr>`)}</tbody></table>`
          : html`<p class="sub">${d.aiMode === 'off' ? t('privacy_ai_off') : t('privacy_ai_none')}</p>`}
      </div></div>`;
  }
}
customElements.define('vz-privacy', VzPrivacy);
