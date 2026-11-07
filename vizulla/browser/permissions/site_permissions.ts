// Site permissions (camera, microphone, location, notifications…). The prompt is
// browser-owned UI in the overlay layer, which page content cannot draw over (C9).
import type { Session, WebContents } from 'electron';
import { readJson, writeJsonAtomic } from '../storage/json_store';
import { originOf } from '@vz/common/url';

export type PermissionDecision = 'allow' | 'block';
export type PromptFn = (wc: WebContents, origin: string, permission: string) => Promise<{ allow: boolean; remember: boolean }>;

const AUTO_ALLOW = new Set(['fullscreen', 'clipboard-sanitized-write', 'pointerLock', 'speaker-selection']);
const PROMPTABLE = new Set(['media', 'geolocation', 'notifications', 'midi', 'midiSysex', 'display-capture', 'clipboard-read', 'window-management', 'idle-detection', 'openExternal', 'keyboardLock', 'storage-access', 'top-level-storage-access']);

export class SitePermissions {
  private decisions: Record<string, PermissionDecision>;

  constructor(private readonly path: string | null) {
    this.decisions = path ? readJson(path, {}) : {};
  }

  install(session: Session, prompt: PromptFn): void {
    session.setPermissionRequestHandler((wc, permission, callback, details) => {
      const origin = originOf(details.requestingUrl ?? wc.getURL());
      if (origin.startsWith('vizulla:')) return callback(false);
      if (AUTO_ALLOW.has(permission)) return callback(true);
      if (!PROMPTABLE.has(permission)) return callback(false);
      const key = `${origin}|${permission}`;
      const saved = this.decisions[key];
      if (saved) return callback(saved === 'allow');
      prompt(wc, origin, permission === 'media' ? mediaKind(details) : permission)
        .then(({ allow, remember }) => {
          if (remember) this.set(origin, permission, allow ? 'allow' : 'block');
          callback(allow);
        })
        .catch(() => callback(false));
    });
    session.setPermissionCheckHandler((_wc, permission, requestingOrigin) => {
      if (AUTO_ALLOW.has(permission)) return true;
      return this.decisions[`${originOf(requestingOrigin)}|${permission}`] === 'allow';
    });
  }

  set(origin: string, permission: string, d: PermissionDecision | null): void {
    const key = `${origin}|${permission}`;
    if (d) this.decisions[key] = d;
    else delete this.decisions[key];
    if (this.path) writeJsonAtomic(this.path, this.decisions);
  }

  list(): { origin: string; permission: string; decision: PermissionDecision }[] {
    return Object.entries(this.decisions).map(([k, decision]) => {
      const i = k.lastIndexOf('|');
      return { origin: k.slice(0, i), permission: k.slice(i + 1), decision };
    });
  }

  clear(): void {
    this.decisions = {};
    if (this.path) writeJsonAtomic(this.path, this.decisions);
  }
}

function mediaKind(details: Electron.PermissionRequest | Electron.MediaAccessPermissionRequest): string {
  const types = (details as Electron.MediaAccessPermissionRequest).mediaTypes ?? [];
  if (types.includes('video') && types.includes('audio')) return 'camera-microphone';
  if (types.includes('video')) return 'camera';
  return 'microphone';
}
