// Every capability a site can ask for, with Chrome's defaults (Settings → Privacy →
// Site settings): what asks, what's allowed quietly, what's blocked. Pure data: the
// browser maps Electron's permission names onto these kinds, the UI shows them.

export type Decision = 'allow' | 'block';
export type DefaultSetting = 'ask' | 'allow' | 'block';

export interface PermissionKind {
  id: string;
  /** Electron permission names that map to this kind. */
  electron: string[];
  default: DefaultSetting;
  /** May the user change the default in Settings? */
  configurable: boolean;
  icon: string;
  /** Shown in Settings and the site-info panel (unless rare). */
  common?: boolean;
  /** Choosing a device or screen (a picker is the consent; nothing is remembered as "allow"). */
  picker?: boolean;
  /** Needs a secure context (https or localhost). Chromium enforces it too. */
  secure?: boolean;
}

export const KINDS: PermissionKind[] = [
  { id: 'camera', electron: ['media:video'], default: 'ask', configurable: true, icon: 'eye', common: true, secure: true },
  { id: 'microphone', electron: ['media:audio'], default: 'ask', configurable: true, icon: 'volume', common: true, secure: true },
  { id: 'geolocation', electron: ['geolocation', 'geolocation-approximate'], default: 'ask', configurable: true, icon: 'globe', common: true, secure: true },
  { id: 'notifications', electron: ['notifications'], default: 'ask', configurable: true, icon: 'info', common: true, secure: true },
  { id: 'display-capture', electron: ['display-capture'], default: 'ask', configurable: true, icon: 'columns', common: true, picker: true, secure: true },
  { id: 'clipboard-read', electron: ['clipboard-read', 'deprecated-sync-clipboard-read'], default: 'ask', configurable: true, icon: 'copy', common: true },
  { id: 'file-system', electron: ['fileSystem'], default: 'ask', configurable: true, icon: 'folder', common: true, secure: true },
  { id: 'usb', electron: ['usb'], default: 'ask', configurable: true, icon: 'cpu', picker: true, secure: true },
  { id: 'serial', electron: ['serial'], default: 'ask', configurable: true, icon: 'cpu', picker: true, secure: true },
  { id: 'hid', electron: ['hid'], default: 'ask', configurable: true, icon: 'cpu', picker: true, secure: true },
  { id: 'bluetooth', electron: ['bluetooth'], default: 'ask', configurable: true, icon: 'cpu', picker: true, secure: true },
  { id: 'midi', electron: ['midi', 'midiSysex'], default: 'ask', configurable: true, icon: 'music', secure: true },
  { id: 'window-management', electron: ['window-management'], default: 'ask', configurable: true, icon: 'columns', secure: true },
  { id: 'idle-detection', electron: ['idle-detection'], default: 'ask', configurable: true, icon: 'eye', secure: true },
  { id: 'local-fonts', electron: ['local-fonts'], default: 'ask', configurable: true, icon: 'edit', secure: true },
  { id: 'local-network', electron: ['local-network-access', 'local-network', 'loopback-network'], default: 'ask', configurable: true, icon: 'globe', common: true },
  { id: 'open-external', electron: ['openExternal'], default: 'ask', configurable: true, icon: 'external' },
  { id: 'storage-access', electron: ['storage-access', 'top-level-storage-access'], default: 'ask', configurable: true, icon: 'eye-off' },
  { id: 'captured-surface-control', electron: ['captured-surface-control'], default: 'ask', configurable: true, icon: 'columns', secure: true },
  { id: 'xr', electron: ['ar', 'vr', 'hand-tracking'], default: 'ask', configurable: true, icon: 'eye', secure: true },
  { id: 'keyboard-lock', electron: ['keyboardLock'], default: 'ask', configurable: true, icon: 'command', secure: true },
  { id: 'automatic-fullscreen', electron: ['automatic-fullscreen'], default: 'block', configurable: true, icon: 'maximize' },
  { id: 'sensors', electron: ['sensors'], default: 'allow', configurable: true, icon: 'zap', secure: true },
  { id: 'protected-content', electron: ['mediaKeySystem'], default: 'allow', configurable: true, icon: 'play' },
  { id: 'payment-handler', electron: ['payment-handler'], default: 'allow', configurable: true, icon: 'cart', secure: true },
  { id: 'background-sync', electron: ['background-sync', 'periodic-background-sync', 'background-fetch'], default: 'allow', configurable: true, icon: 'sync', secure: true },
  { id: 'screen-wake-lock', electron: ['screen-wake-lock'], default: 'allow', configurable: false, icon: 'zap', secure: true },
  { id: 'persistent-storage', electron: ['persistent-storage'], default: 'allow', configurable: false, icon: 'archive', secure: true },
  { id: 'fullscreen', electron: ['fullscreen'], default: 'allow', configurable: false, icon: 'maximize' },
  { id: 'pointer-lock', electron: ['pointerLock'], default: 'allow', configurable: false, icon: 'focus' },
  { id: 'clipboard-write', electron: ['clipboard-sanitized-write'], default: 'allow', configurable: false, icon: 'copy' },
  { id: 'speaker-selection', electron: ['speaker-selection'], default: 'allow', configurable: false, icon: 'volume' },
  // Not available in Vizulla (no hardware path or not shipped in Chromium for desktop).
  { id: 'system-wake-lock', electron: ['system-wake-lock'], default: 'block', configurable: false, icon: 'zap' },
  { id: 'nfc', electron: ['nfc'], default: 'block', configurable: false, icon: 'cpu' },
  { id: 'smart-card', electron: ['smart-card'], default: 'block', configurable: false, icon: 'key' },
  { id: 'web-printing', electron: ['web-printing'], default: 'block', configurable: false, icon: 'copy' },
  { id: 'web-app-installation', electron: ['web-app-installation'], default: 'block', configurable: false, icon: 'download' },
];

const BY_ID = new Map(KINDS.map((k) => [k.id, k]));
const BY_ELECTRON = new Map(KINDS.flatMap((k) => k.electron.map((e) => [e, k] as const)));

export function kind(id: string): PermissionKind | undefined {
  return BY_ID.get(id);
}

/** Electron's permission (+ media types) → the kinds the user is asked about. */
export function kindsFor(permission: string, mediaTypes: string[] = []): PermissionKind[] {
  if (permission === 'media') {
    const out = [];
    if (mediaTypes.includes('video')) out.push(BY_ID.get('camera')!);
    if (mediaTypes.includes('audio') || !mediaTypes.length) out.push(BY_ID.get('microphone')!);
    return out;
  }
  const k = BY_ELECTRON.get(permission);
  return k ? [k] : [];
}

/** Powerful features need https (or a local address) — the same rule as Chromium. */
export function isSecureOrigin(origin: string): boolean {
  try {
    const u = new URL(origin);
    return u.protocol === 'https:' || u.protocol === 'wss:' || /^(localhost|127\.\d+\.\d+\.\d+|\[::1\])$/.test(u.hostname) || u.hostname.endsWith('.localhost');
  } catch {
    return false;
  }
}

/** After this many dismissed prompts a site is blocked from asking again for a while (Chrome's embargo). */
export const EMBARGO_AFTER = 3;
export const EMBARGO_MS = 7 * 24 * 3600_000;
