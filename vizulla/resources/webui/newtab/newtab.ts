// Calm start page (P2-BRW-17): a search pill and shortcut tiles. No feeds, no remote
// content, zero network requests. Text is minimal: icons and tiles carry meaning.
import { css, html, nothing, unsafeCSS } from 'lit';
import { base, pageStyles } from '../shared/styles';
import { icon, logo } from '../shared/icons';
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
      :host { display: grid; place-items: start center; min-height: 100vh; background: var(--vz-toolbar); }
      .wrap { width: min(584px, calc(100vw - 48px)); padding-top: 18vh; display: flex; flex-direction: column; align-items: center; }
      .glyph { display: grid; margin-bottom: 30px; }
      /* Chrome-style search pill: filled, no border; white with an accent ring on hover/focus. */
      .bar { width: 100%; display: flex; align-items: center; gap: 12px; height: 48px; padding: 0 8px 0 18px; border-radius: 999px; cursor: text;
        background: var(--vz-omnibox); color: var(--vz-text-3); font-size: 15px; border: 1px solid transparent;
        transition: background var(--vz-dur), border-color var(--vz-dur); }
      .bar:hover { background: var(--vz-omnibox-hover); }
      .bar:focus-visible { outline: none; background: var(--vz-toolbar); border-color: var(--vz-accent); }
      .bar .grow { flex: 1; }
      .bar .mic { width: 34px; height: 34px; border-radius: 50%; display: grid; place-items: center; color: var(--vz-accent); transition: background var(--vz-dur); }
      .bar:hover .mic { background: var(--vz-accent-soft); }
      .tiles { display: flex; flex-wrap: wrap; justify-content: center; gap: 4px; margin-top: 32px; max-width: 592px; }
      .tile { all: unset; box-sizing: border-box; width: 112px; height: 112px; display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 12px;
        border-radius: 14px; cursor: pointer; transition: background var(--vz-dur); position: relative; }
      .tile:hover { background: var(--vz-surface-hover); }
      .tile:active { background: var(--vz-surface-active); }
      .tiles > * { animation: vz-rise 320ms var(--vz-ease) both; }
      ${unsafeCSS(Array.from({ length: 16 }, (_, i) => `.tiles > :nth-child(${i + 1}) { animation-delay: ${80 + i * 30}ms; }`).join('\n'))}
      .tile:focus-visible { outline: 2px solid var(--vz-focus); }
      .bubble { position: relative; width: 48px; height: 48px; border-radius: 50%; display: grid; place-items: center; background: var(--vz-omnibox); }
      .letter { width: 28px; height: 28px; border-radius: 50%; display: grid; place-items: center; font-weight: 600; font-size: 14px; color: #fff; background: hsl(var(--h) 62% 46%); }
      .bubble img { position: absolute; inset: 0; margin: auto; width: 24px; height: 24px; border-radius: 4px; background: var(--vz-omnibox); }
      .label { max-width: 96px; font-size: 13px; color: var(--vz-text); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
      .badge { position: absolute; top: 14px; right: 26px; width: 18px; height: 18px; border-radius: 50%; display: grid; place-items: center;
        background: var(--vz-toolbar); color: var(--vz-text-2); box-shadow: 0 0 0 1px var(--vz-border); }
      /* Quiet corner actions, like Chrome's "Customize" button. */
      .actions { position: fixed; right: 16px; bottom: 16px; display: flex; gap: 2px; padding: 4px; border-radius: 999px; background: var(--vz-omnibox); }
      .act { width: 36px; height: 36px; border-radius: 50%; border: 0; display: grid; place-items: center; cursor: pointer; color: var(--vz-text-2); background: transparent;
        transition: background var(--vz-dur), color var(--vz-dur); }
      .act:hover { color: var(--vz-accent); background: var(--vz-toolbar); }
      @media (max-width: 520px) { .tile { width: 96px; } .actions { right: 50%; transform: translateX(50%); } }
    `,
  ];

  private tile(url: string, title: string, fav: string | null, onClick: () => void, badge?: string) {
    const host = hostOf(url);
    return html`<button class="tile" title=${`${title}\n${host}`} aria-label=${title || host} @click=${onClick}>
      <span class="bubble"><span class="letter" style="--h:${hueOf(host)}">${/^\d/.test(host) ? '#' : host.slice(0, 1).toUpperCase()}</span>${fav
        ? html`<img src=${fav} alt="" @error=${(e: Event) => (e.target as HTMLImageElement).remove()} />`
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
      <div class="glyph rise">${logo(72)}</div>
      <div class="bar rise" style="--i:2" role="button" tabindex="0"
        @click=${() => this.invoke('openCommandBar')} @keydown=${(e: KeyboardEvent) => e.key !== 'Tab' && this.invoke('openCommandBar')}>
        ${icon('search', 18)}<span class="grow"><span class="sr-only">${t('cb_placeholder')} · </span>${d.engine}</span><span class="kbd" aria-hidden="true">${mac ? '⌘K' : 'Ctrl K'}</span>
        ${d.aiMode !== 'off' ? html`<span class="mic" aria-hidden="true">${icon('sparkle', 16)}</span>` : nothing}
      </div>
      <div class="tiles" role="list" aria-label=${t('ntp_continue')}>
        ${d.pins.map((p) => html`<div role="listitem">${this.tile(p.url, p.title, p.favicon, () => this.invoke('open', { url: p.url }), 'pin')}</div>`)}
        ${d.archived.map((a) => html`<div role="listitem">${this.tile(a.url, a.title, a.favicon, () => this.invoke('restoreArchived', a.id), 'archive')}</div>`)}
        ${recent.slice(0, Math.max(0, 8 - d.pins.length - d.archived.length)).map((r) => html`<div role="listitem">${this.tile(r.url, r.title, r.favicon, () => this.invoke('open', { url: r.url }))}</div>`)}
      </div>
      <div class="actions">
        <button class="act" aria-label=${t('ntp_tip_space')} title=${t('ntp_tip_space')} @click=${() => this.invoke('command', { id: 'space.new' })}>${icon('layers', 17)}</button>
        ${d.aiMode !== 'off' ? html`<button class="act" aria-label=${t('ntp_tip_ai')} title=${t('ntp_tip_ai')} @click=${() => this.invoke('command', { id: 'ai.panel' })}>${icon('sparkle', 17)}</button>` : nothing}
        <button class="act" aria-label=${t('ntp_tip_import')} title=${t('ntp_tip_import')} @click=${() => this.invoke('command', { id: 'page.import' })}>${icon('download', 17)}</button>
        <button class="act" aria-label=${t('cmd_privacy_dashboard')} title=${t('cmd_privacy_dashboard')} @click=${() => this.invoke('command', { id: 'page.privacy' })}>${icon('shield', 17)}</button>
        <button class="act" aria-label=${t('cmd_settings')} title=${t('cmd_settings')} @click=${() => this.invoke('command', { id: 'page.settings' })}>${icon('settings', 17)}</button>
        ${!d.onboarded ? html`<button class="act" aria-label=${t('ntp_tip_setup')} title=${t('ntp_tip_setup')} @click=${() => this.invoke('open', { url: 'vizulla://onboarding' })}>${icon('zap', 17)}</button>` : nothing}
      </div>
    </div>`;
  }
}
customElements.define('vz-newtab', VzNewTab);
