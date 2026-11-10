import { html, type TemplateResult } from 'lit';
import { icon } from '../shared/icons';
import type { SecurityState, TabInfo } from '@vz/common/types';

export function favicon(tab: Pick<TabInfo, 'favicon' | 'url' | 'isPdf'> & { agent?: boolean }, size = 16): TemplateResult {
  if (tab.agent) return icon('bot', size, 'Agent');
  if (tab.url.startsWith('vizulla://')) return icon(internalIcon(tab.url), size);
  if (tab.isPdf) return icon('reader', size);
  if (tab.favicon) return faviconImg(tab.favicon, tab.url, size);
  return monogram(tab.url, size);
}

function internalIcon(url: string): string {
  const host = url.slice('vizulla://'.length).split(/[/?#]/)[0];
  return ({ settings: 'settings', history: 'history', downloads: 'download', privacy: 'shield', archive: 'archive', memory: 'brain', newtab: 'sparkle', bookmarks: 'star', flags: 'flask', about: 'info', 'agent-log': 'bot', error: 'alert', reader: 'reader', onboarding: 'sparkle', passwords: 'key', profiles: 'user' } as Record<string, string>)[host ?? ''] ?? 'globe';
}

export function securityIcon(s: SecurityState): string {
  switch (s) {
    case 'secure':
      return 'lock';
    case 'insecure':
    case 'dangerous':
      return 'alert';
    case 'internal':
      return 'info';
    case 'file':
      return 'note';
    default:
      return 'search';
  }
}

/** A favicon that falls back to a colored monogram when the image fails to load. */
export function faviconImg(src: string, url: string, size = 16): TemplateResult {
  return html`<span style="position:relative;display:inline-grid;place-items:center;width:${size}px;height:${size}px">${monogram(url, size)}<img
    src=${src} width=${size} height=${size} alt="" referrerpolicy="no-referrer" style="position:absolute;inset:0;border-radius:3px"
    @error=${(e: Event) => (e.target as HTMLImageElement).remove()} /></span>`;
}

const HUES = [228, 172, 32, 346, 262, 152, 199, 215];

export function monogram(url: string, size = 16): TemplateResult {
  let host = '';
  try {
    host = new URL(url).hostname.replace(/^www\./, '');
  } catch {
    /* not a URL */
  }
  if (!host) return icon('globe', size);
  const h = HUES[[...host].reduce((n, c) => n + c.charCodeAt(0), 0) % HUES.length];
  const letter = /^\d/.test(host) ? '#' : host[0]!.toUpperCase();
  return html`<span aria-hidden="true" style="display:grid;place-items:center;width:${size}px;height:${size}px;border-radius:${Math.round(size / 4)}px;background:hsl(${h} 65% 52%);color:#fff;font:700 ${Math.round(size * 0.62)}px/1 var(--vz-font)">${letter}</span>`;
}
