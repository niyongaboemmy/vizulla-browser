import { html, type TemplateResult } from 'lit';
import { icon } from '../shared/icons';
import type { SecurityState, TabInfo } from '@vz/common/types';

export function favicon(tab: Pick<TabInfo, 'favicon' | 'url' | 'isPdf'> & { agent?: boolean }, size = 16): TemplateResult {
  if (tab.agent) return icon('bot', size, 'Agent');
  if (tab.url.startsWith('vizulla://')) return icon(internalIcon(tab.url), size);
  if (tab.isPdf) return icon('reader', size);
  if (tab.favicon) return html`<img src=${tab.favicon} width=${size} height=${size} alt="" referrerpolicy="no-referrer" @error=${(e: Event) => ((e.target as HTMLImageElement).style.visibility = 'hidden')} />`;
  return icon('globe', size);
}

function internalIcon(url: string): string {
  const host = url.slice('vizulla://'.length).split(/[/?#]/)[0];
  return ({ settings: 'settings', history: 'history', downloads: 'download', privacy: 'shield', archive: 'archive', memory: 'brain', newtab: 'sparkle', bookmarks: 'star', flags: 'flask', about: 'info', 'agent-log': 'bot', error: 'alert', reader: 'reader' } as Record<string, string>)[host ?? ''] ?? 'globe';
}

export function securityIcon(s: SecurityState): string {
  switch (s) {
    case 'secure':
      return 'lock';
    case 'insecure':
    case 'dangerous':
      return 'alert';
    case 'internal':
      return 'sparkle';
    case 'file':
      return 'note';
    default:
      return 'search';
  }
}
