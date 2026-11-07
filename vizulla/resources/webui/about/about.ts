import { css, html } from 'lit';
import { base, pageStyles } from '../shared/styles';
import { icon } from '../shared/icons';
import { VzPage } from '../shared/page_base';
import { t } from '@vz/common/i18n';

interface Data { name: string; version: string; channel: string; chromium: string; electron: string; v8: string; node: string; platform: string; commands: { id: string; title: string; shortcut?: string; category: string }[] }

class VzAbout extends VzPage<Data> {
  static override styles = [base, pageStyles, css`.hero { display: flex; gap: 18px; align-items: center; padding: 24px; } .logo { width: 64px; height: 64px; border-radius: 18px; background: linear-gradient(135deg, var(--vz-accent), color-mix(in srgb, var(--vz-accent) 40%, #22d3ee)); display: grid; place-items: center; color: #fff; }
    .hero h1 { margin: 0; font-size: 26px; } dl { display: grid; grid-template-columns: 160px 1fr; gap: 6px 12px; padding: 0 24px 20px; margin: 0; font-size: var(--vz-text-s); } dt { color: var(--vz-text-2); } dd { margin: 0; font-family: var(--vz-font-mono); }
    .keys { columns: 2; padding: 12px 20px 20px; font-size: var(--vz-text-s); } .keys div { display: flex; justify-content: space-between; gap: 12px; padding: 4px 0; break-inside: avoid; }`];
  override render() {
    const d = this.data;
    if (!d) return this.loading();
    return html`<div class="page">
      <div class="card"><div class="hero"><div class="logo">${icon('sparkle', 30)}</div><div><h1>${d.name}</h1><div class="muted">${t('about_version', { version: d.version, channel: d.channel })}</div></div></div>
        <dl><dt>${t('about_engine')}</dt><dd>Chromium ${d.chromium} (Blink + V8 ${d.v8})</dd><dt>${t('about_runtime')}</dt><dd>Electron ${d.electron} · Node ${d.node}</dd><dt>${t('about_platform')}</dt><dd>${d.platform}</dd></dl>
        <p class="muted" style="padding:0 24px 20px;margin:0;font-size:12px">${t('about_attribution')}</p></div>
      <div class="card"><h2 style="padding:16px 20px 0">${t('about_shortcuts')}</h2><div class="keys">${d.commands.filter((c) => c.shortcut).map((c) => html`<div><span>${c.title}</span><span class="kbd">${c.shortcut}</span></div>`)}</div></div>
    </div>`;
  }
}
customElements.define('vz-about', VzAbout);
