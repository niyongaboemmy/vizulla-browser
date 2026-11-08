// Vizulla icon set: 24×24 stroke icons, currentColor. Inline SVG only (no remote assets).
import { html, type TemplateResult } from 'lit';

const P: Record<string, string> = {
  'arrow-left': 'M19 12H5M12 19l-7-7 7-7',
  'arrow-right': 'M5 12h14M12 5l7 7-7 7',
  refresh: 'M21 12a9 9 0 1 1-2.64-6.36M21 4v5h-5',
  update: 'M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18zM12 16V8M8.5 11.5 12 8l3.5 3.5',
  x: 'M18 6 6 18M6 6l12 12',
  plus: 'M12 5v14M5 12h14',
  search: 'M11 4a7 7 0 1 0 0 14 7 7 0 0 0 0-14zM20 20l-4-4',
  sparkle: 'M12 3l1.9 5.6L19.5 10l-5.6 1.9L12 17.5l-1.9-5.6L4.5 10l5.6-1.4L12 3zM19 15l.8 2.2L22 18l-2.2.8L19 21l-.8-2.2L16 18l2.2-.8L19 15z',
  shield: 'M12 3l8 3v6c0 4.5-3.4 8.3-8 9-4.6-.7-8-4.5-8-9V6l8-3z',
  'shield-check': 'M12 3l8 3v6c0 4.5-3.4 8.3-8 9-4.6-.7-8-4.5-8-9V6l8-3zM8.5 12l2.5 2.5 4.5-5',
  'shield-off': 'M12 3l8 3v6c0 1.6-.4 3.1-1.2 4.4M5.3 5.3 4 6v6c0 4.5 3.4 8.3 8 9 1.9-.3 3.6-1.1 5-2.3M3 3l18 18',
  lock: 'M7 11V8a5 5 0 0 1 10 0v3M5 11h14v10H5z',
  alert: 'M12 3 2 20h20L12 3zM12 10v4M12 17.5v.01',
  info: 'M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18zM12 11v6M12 7.5v.01',
  globe: 'M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18zM3 12h18M12 3c2.5 2.6 3.8 5.6 3.8 9s-1.3 6.4-3.8 9c-2.5-2.6-3.8-5.6-3.8-9S9.5 5.6 12 3z',
  sidebar: 'M4 5h16v14H4zM9 5v14',
  'panel-right': 'M4 5h16v14H4zM15 5v14',
  more: 'M5 12h.01M12 12h.01M19 12h.01',
  'more-v': 'M12 5h.01M12 12h.01M12 19h.01',
  pin: 'M15 4l5 5-3 1-3 3 1 4-2 2-4-4-5 5M9 11l4 4',
  volume: 'M4 9v6h4l5 4V5L8 9H4zM16 9a4 4 0 0 1 0 6M18.5 6.5a8 8 0 0 1 0 11',
  'volume-x': 'M4 9v6h4l5 4V5L8 9H4zM17 9l5 5M22 9l-5 5',
  moon: 'M20 14.5A8 8 0 0 1 9.5 4a8 8 0 1 0 10.5 10.5z',
  sun: 'M12 8a4 4 0 1 0 0 8 4 4 0 0 0 0-8zM12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4',
  archive: 'M3 5h18v4H3zM5 9v10h14V9M10 13h4',
  settings: 'M12 9a3 3 0 1 0 0 6 3 3 0 0 0 0-6zM19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z',
  brain: 'M9 4a3 3 0 0 0-3 3 3 3 0 0 0-2 5 3 3 0 0 0 2 5 3 3 0 0 0 6 1V5a2 2 0 0 0-3-1zM15 4a3 3 0 0 1 3 3 3 3 0 0 1 2 5 3 3 0 0 1-2 5 3 3 0 0 1-6 1',
  download: 'M12 4v11M7 10l5 5 5-5M5 20h14',
  star: 'M12 3l2.8 5.7 6.2.9-4.5 4.4 1 6.2L12 17.3 6.5 20.2l1-6.2L3 9.6l6.2-.9L12 3z',
  command: 'M9 6a3 3 0 1 0-3 3h12a3 3 0 1 0-3-3v12a3 3 0 1 0 3-3H6a3 3 0 1 0 3 3V6z',
  home: 'M4 11l8-7 8 7v9h-5v-6H9v6H4z',
  briefcase: 'M4 8h16v11H4zM9 8V5h6v3M4 13h16',
  book: 'M5 4h10a4 4 0 0 1 4 4v12H9a4 4 0 0 1-4-4V4zM5 16a4 4 0 0 1 4-4h10',
  code: 'M8 7l-5 5 5 5M16 7l5 5-5 5M14 4l-4 16',
  heart: 'M12 20s-7-4.5-9-9a5 5 0 0 1 9-3 5 5 0 0 1 9 3c-2 4.5-9 9-9 9z',
  music: 'M9 18V5l11-2v13M9 18a3 3 0 1 1-3-3 3 3 0 0 1 3 3zM20 16a3 3 0 1 1-3-3 3 3 0 0 1 3 3z',
  cart: 'M3 4h2l2.5 11h11L21 7H6.2M9 20h.01M18 20h.01',
  flask: 'M9 3h6M10 3v6L4.5 19a1.5 1.5 0 0 0 1.3 2h12.4a1.5 1.5 0 0 0 1.3-2L14 9V3M7 15h10',
  'chevron-down': 'M6 9l6 6 6-6',
  'chevron-right': 'M9 6l6 6-6 6',
  'chevron-left': 'M15 6l-6 6 6 6',
  columns: 'M4 5h16v14H4zM12 5v14',
  copy: 'M9 9h11v11H9zM5 15H4V4h11v1',
  check: 'M5 12l5 5 9-10',
  trash: 'M4 7h16M10 11v6M14 11v6M6 7l1 13h10l1-13M9 7V4h6v3',
  history: 'M3 12a9 9 0 1 0 3-6.7L3 8M3 3v5h5M12 7v5l3 3',
  reader: 'M5 4h14v16H5zM8 8h8M8 12h8M8 16h5',
  note: 'M5 4h10l4 4v12H5zM14 4v5h5M8 13h8M8 17h5',
  bot: 'M12 4v3M6 8h12v11H6zM9.5 13v1M14.5 13v1M3 13v3M21 13v3',
  pause: 'M8 5v14M16 5v14',
  play: 'M7 4l13 8-13 8z',
  stop: 'M6 6h12v12H6z',
  hand: 'M8 13V5a1.5 1.5 0 0 1 3 0v6M11 10V4a1.5 1.5 0 0 1 3 0v6M14 10V5a1.5 1.5 0 0 1 3 0v7M17 9a1.5 1.5 0 0 1 3 0v4a8 8 0 0 1-8 8 7 7 0 0 1-6-3.5L3.5 13a1.5 1.5 0 0 1 2.5-1.5L8 14',
  minimize: 'M5 12h14',
  maximize: 'M5 5h14v14H5z',
  cloud: 'M7 18a4 4 0 0 1-.5-8A6 6 0 0 1 18 9a4.5 4.5 0 0 1-.5 9H7z',
  cpu: 'M7 7h10v10H7zM10 10h4v4h-4zM10 3v4M14 3v4M10 17v4M14 17v4M3 10h4M3 14h4M17 10h4M17 14h4',
  eye: 'M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7S2 12 2 12zM12 9a3 3 0 1 0 0 6 3 3 0 0 0 0-6z',
  'eye-off': 'M3 3l18 18M10.6 5.1A10.7 10.7 0 0 1 12 5c6.5 0 10 7 10 7a17 17 0 0 1-3.1 4M6.6 6.6C3.9 8.4 2 12 2 12s3.5 7 10 7a9.7 9.7 0 0 0 5.4-1.6M9.9 9.9a3 3 0 0 0 4.2 4.2',
  edit: 'M4 20h4L19 9l-4-4L4 16v4zM13.5 6.5l4 4',
  upload: 'M12 15V3M7 8l5-5 5 5M5 21h14',
  key: 'M15 4a5 5 0 1 0 0 10 5 5 0 0 0 0-10zM11.5 12.5 4 20M7 17l2 2M5 19l2 2',
  folder: 'M3 6h6l2 2h10v11H3z',
  external: 'M14 4h6v6M20 4l-9 9M18 14v6H4V6h6',
  send: 'M4 12l16-8-6 16-3-7-7-1z',
  loader: 'M12 3a9 9 0 1 0 9 9',
  grid: 'M4 4h7v7H4zM13 4h7v7h-7zM4 13h7v7H4zM13 13h7v7h-7z',
  zap: 'M13 3 4 14h7l-1 7 9-11h-7l1-7z',
  layers: 'M12 3l9 5-9 5-9-5 9-5zM3 13l9 5 9-5M3 17l9 5 9-5',
  user: 'M12 4a4 4 0 1 0 0 8 4 4 0 0 0 0-8zM4 21a8 8 0 0 1 16 0',
  sync: 'M20 8a8 8 0 0 0-14-2L4 8M4 4v4h4M4 16a8 8 0 0 0 14 2l2-2M20 20v-4h-4',
  quote: 'M7 7h4v4c0 3-1.5 5-4 6M15 7h4v4c0 3-1.5 5-4 6',
  table: 'M4 5h16v14H4zM4 10h16M4 15h16M10 5v14',
  wand: 'M15 4V2M15 10V8M12 5h-2M20 5h-2M17.8 7.8 19 9M17.8 2.2 19 1M3 21l11-11',
  translate: 'M4 5h8M8 3v2M10 5c0 4-3 7-6 8M6 9c1 2 3 3.5 6 4M13 20l4-9 4 9M14.5 17h5',
  undo: 'M9 14 4 9l5-5M4 9h11a5 5 0 0 1 0 10h-3',
  focus: 'M3 8V4h4M17 4h4v4M21 16v4h-4M7 20H3v-4M12 9a3 3 0 1 0 0 6 3 3 0 0 0 0-6z',
};

export function icon(name: string, size = 16, label?: string): TemplateResult {
  const d = P[name] ?? P.globe!;
  return html`<svg class="vz-icon" width=${size} height=${size} viewBox="0 0 24 24" fill="none" stroke="currentColor"
    stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" role=${label ? 'img' : 'presentation'}
    aria-hidden=${label ? 'false' : 'true'} aria-label=${label ?? ''}><path d=${d}></path></svg>`;
}

export const ICON_NAMES = Object.keys(P);

/** The Vizulla mark (same geometry as app/icons/icon.svg, cropped to the tile). */
export function logo(size = 28, label?: string): TemplateResult {
  return html`<svg class="vz-logo" width=${size} height=${size} viewBox="100 100 824 824" role=${label ? 'img' : 'presentation'}
    aria-hidden=${label ? 'false' : 'true'} aria-label=${label ?? ''}>
    <defs><linearGradient id="vz-logo-tile" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#3b82f6"></stop><stop offset="1" stop-color="#1d4ed8"></stop></linearGradient></defs>
    <rect x="100" y="100" width="824" height="824" rx="186" fill="url(#vz-logo-tile)"></rect>
    <g stroke-linecap="round" stroke-width="136" fill="none">
      <line x1="650" y1="312" x2="512" y2="712" stroke="#fff" stroke-opacity="0.55"></line>
      <line x1="374" y1="312" x2="512" y2="712" stroke="#fff"></line>
    </g></svg>`;
}
