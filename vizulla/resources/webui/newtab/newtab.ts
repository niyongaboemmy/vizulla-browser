// Calm start page (P2-BRW-17): a search pill and shortcut tiles. No feeds, no remote
// content, zero network requests. Text is minimal: icons and tiles carry meaning.
import { css, html, nothing } from 'lit';
import { base, pageStyles } from '../shared/styles';
import { icon } from '../shared/icons';
import { VzPage } from '../shared/page_base';
import { t } from '@vz/common/i18n';
import type { SpaceInfo, TabInfo } from '@vz/common/types';

interface Data {
  space: SpaceInfo;
  pins: TabInfo[];
  recent: { url: string; title: string; favicon: string | null }[];
  archived: { id: number; url: string; title: string; favicon: string | null }[];
  engine: string;
  onboarded: boolean;
  aiMode: string;
}

const HUES = [228, 172, 32, 346, 262, 152, 199, 215];
const hueOf = (s: string) => HUES[[...s].reduce((n, c) => n + c.charCodeAt(0), 0) % HUES.length]!;
const hostOf = (u: string) => {
  try {
    return new URL(u).hostname.replace(/^www\./, '');
  } catch {
    return u;
  }
};

class VzNewTab extends VzPage<Data> {
  static override styles = [
    base,
    pageStyles,
    css`
      :host { display: grid; place-items: start center; min-height: 100vh; background:
        radial-gradient(900px 500px at 15% -10%, color-mix(in srgb, var(--vz-accent) 14%, transparent), transparent 70%),
        radial-gradient(800px 500px at 100% 0%, color-mix(in srgb, #22d3ee 10%, transparent), transparent 70%), var(--vz-toolbar); }
      .wrap { width: min(640px, calc(100vw - 48px)); padding-top: 16vh; display: flex; flex-direction: column; align-items: center; }
      .glyph { width: 72px; height: 72px; border-radius: 24px; display: grid; place-items: center; color: #fff; margin-bottom: 28px;
        background: linear-gradient(135deg, var(--vz-accent), color-mix(in srgb, var(--vz-accent) 40%, #22d3ee));
        box-shadow: 0 16px 40px -12px color-mix(in srgb, var(--vz-accent) 60%, transparent); animation: float 5s ease-in-out infinite; }
      @keyframes float { 50% { transform: translateY(-6px) rotate(3deg); } }
      .bar { width: 100%; display: flex; align-items: center; gap: 12px; height: 54px; padding: 0 10px 0 20px; border-radius: 999px; cursor: text;
        background: var(--vz-glass-strong); backdrop-filter: blur(20px) saturate(160%); box-shadow: var(--vz-glass-shadow); border: 1px solid var(--vz-glass-border);
        color: var(--vz-text-3); font-size: 16px; transition: transform var(--vz-dur) var(--vz-ease), box-shadow var(--vz-dur); }
      .bar:hover { transform: translateY(-1px); }
      .bar:focus-visible { outline: 2px solid var(--vz-focus); }
      .bar .grow { flex: 1; }
      .bar .mic { width: 36px; height: 36px; border-radius: 50%; display: grid; place-items: center; color: var(--vz-accent); background: var(--vz-accent-soft); }
      .tiles { display: flex; flex-wrap: wrap; justify-content: center; gap: 8px; margin-top: 36px; width: 100%; }
      .tile { all: unset; box-sizing: border-box; width: 96px; height: 104px; display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 10px;
        border-radius: 18px; cursor: pointer; transition: background var(--vz-dur), transform var(--vz-dur) var(--vz-ease); position: relative; }
      .tile:hover { background: var(--vz-surface-hover); transform: translateY(-2px); }
      .tile:focus-visible { outline: 2px solid var(--vz-focus); }
      .bubble { position: relative; width: 52px; height: 52px; border-radius: 50%; display: grid; place-items: center; font-weight: 700; font-size: 20px; color: #fff;
        background: hsl(var(--h) 70% 52%); box-shadow: 0 6px 16px -8px hsl(var(--h) 70% 40%); }
      .bubble.fav { background: var(--vz-glass-strong); box-shadow: 0 0 0 1px var(--vz-border), 0 6px 16px -10px rgba(0,0,0,.4); }
      .bubble img { width: 26px; height: 26px; }
      .label { max-width: 88px; font-size: 12px; color: var(--vz-text-2); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
      .badge { position: absolute; top: 12px; right: 18px; width: 20px; height: 20px; border-radius: 50%; display: grid; place-items: center;
        background: var(--vz-toolbar); color: var(--vz-text-2); box-shadow: 0 0 0 1px var(--vz-border); }
      .actions { display: flex; gap: 10px; margin-top: 28px; }
      .act { width: 44px; height: 44px; border-radius: 14px; border: 0; display: grid; place-items: center; cursor: pointer; color: var(--vz-text-2);
        background: var(--vz-glass-strong); box-shadow: 0 0 0 1px var(--vz-border); transition: all var(--vz-dur) var(--vz-ease); }
      .act:hover { color: var(--vz-accent); transform: translateY(-2px); box-shadow: 0 0 0 1px var(--vz-accent), 0 8px 20px -10px var(--vz-accent); }
      .space { display: inline-flex; align-items: center; gap: 6px; margin-bottom: 14px; padding: 4px 12px; border-radius: 999px; font-size: 12px; font-weight: 600; color: var(--vz-accent); background: var(--vz-accent-soft); }
    `,
  ];

  private tile(url: string, title: string, fav: string | null, onClick: () => void, badge?: string) {
    const host = hostOf(url);
    return html`<button class="tile" title=${`${title}\n${host}`} aria-label=${title || host} @click=${onClick}>
      <span class="bubble" style="--h:${hueOf(host)}">${/^\d/.test(host) ? '#' : host.slice(0, 1).toUpperCase()}${fav
        ? html`<img src=${fav} alt="" style="position:absolute;inset:0;margin:auto;width:52px;height:52px;padding:13px;box-sizing:border-box;border-radius:50%;background:var(--vz-glass-strong)"
            @error=${(e: Event) => (e.target as HTMLImageElement).remove()} />`
        : nothing}</span>
      <span class="label">${title || host}</span>${badge ? html`<span class="badge">${icon(badge, 11)}</span>` : nothing}</button>`;
  }

  override render() {
    const d = this.data;
    if (!d) return nothing;
    const mac = navigator.platform.startsWith('Mac');
    const seen = new Set<string>();
    const recent = d.recent.filter((r) => !seen.has(hostOf(r.url)) && seen.add(hostOf(r.url)));
    return html`<div class="wrap">
      <div class="glyph">${icon('sparkle', 34)}</div>
      ${d.space ? html`<span class="space">${icon(d.space.icon, 12)} ${d.space.name}</span>` : nothing}
      <div class="bar" role="button" tabindex="0"
        @click=${() => this.invoke('openCommandBar')} @keydown=${(e: KeyboardEvent) => e.key !== 'Tab' && this.invoke('openCommandBar')}>
        ${icon('search', 20)}<span class="grow"><span class="sr-only">${t('cb_placeholder')} · </span>${d.engine}</span><span class="kbd" aria-hidden="true">${mac ? '⌘K' : 'Ctrl K'}</span>
        ${d.aiMode !== 'off' ? html`<span class="mic" aria-hidden="true">${icon('sparkle', 16)}</span>` : nothing}
      </div>
      <div class="tiles" role="list" aria-label=${t('ntp_continue')}>
        ${d.pins.map((p) => html`<div role="listitem">${this.tile(p.url, p.title, p.favicon, () => this.invoke('open', { url: p.url }), 'pin')}</div>`)}
        ${d.archived.map((a) => html`<div role="listitem">${this.tile(a.url, a.title, a.favicon, () => this.invoke('restoreArchived', a.id), 'archive')}</div>`)}
        ${recent.slice(0, Math.max(0, 8 - d.pins.length - d.archived.length)).map((r) => html`<div role="listitem">${this.tile(r.url, r.title, r.favicon, () => this.invoke('open', { url: r.url }))}</div>`)}
      </div>
      <div class="actions">
        <button class="act" aria-label=${t('ntp_tip_space')} title=${t('ntp_tip_space')} @click=${() => this.invoke('command', { id: 'space.new' })}>${icon('layers', 18)}</button>
        ${d.aiMode !== 'off' ? html`<button class="act" aria-label=${t('ntp_tip_ai')} title=${t('ntp_tip_ai')} @click=${() => this.invoke('command', { id: 'ai.panel' })}>${icon('sparkle', 18)}</button>` : nothing}
        <button class="act" aria-label=${t('ntp_tip_import')} title=${t('ntp_tip_import')} @click=${() => this.invoke('command', { id: 'page.import' })}>${icon('download', 18)}</button>
        <button class="act" aria-label=${t('cmd_privacy_dashboard')} title=${t('cmd_privacy_dashboard')} @click=${() => this.invoke('command', { id: 'page.privacy' })}>${icon('shield', 18)}</button>
        <button class="act" aria-label=${t('cmd_settings')} title=${t('cmd_settings')} @click=${() => this.invoke('command', { id: 'page.settings' })}>${icon('settings', 18)}</button>
        ${!d.onboarded ? html`<button class="act" aria-label=${t('ntp_tip_setup')} title=${t('ntp_tip_setup')} @click=${() => this.invoke('open', { url: 'vizulla://onboarding' })}>${icon('zap', 18)}</button>` : nothing}
      </div>
    </div>`;
  }
}
customElements.define('vz-newtab', VzNewTab);
