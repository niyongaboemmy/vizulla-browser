// Site permissions, Chrome's model: every capability (catalog.ts) has a default (ask,
// allow or block, changeable in Settings); a site can be allowed or blocked per kind,
// or allowed just this once (until it navigates away). Dismissing a prompt three times
// blocks the site from asking for a week. Devices (USB, serial, HID, Bluetooth) and
// screen sharing are chosen in browser-owned pickers. Prompts live in the overlay,
// which page content can't draw over (C9).
import { app, webContents as allWebContents, type Session, type WebContents } from 'electron';
import { readJson, writeJsonAtomic } from '../storage/json_store';
import { originOf } from '@vz/common/url';
import { EMBARGO_AFTER, EMBARGO_MS, isSecureOrigin, kind, kindsFor, KINDS, type Decision, type DefaultSetting } from './catalog';

export type PermissionDecision = Decision;
export type PromptAnswer = 'allow-always' | 'allow-once' | 'block' | 'dismiss';

export interface PermissionsUi {
  prompt(req: { wc: WebContents; origin: string; embeddedIn?: string; kinds: string[]; detail?: string }): Promise<PromptAnswer>;
  chooseDevice(req: { wc: WebContents; origin: string; kind: 'usb' | 'serial' | 'hid' | 'bluetooth'; devices: { id: string; name: string }[] }): Promise<string | null>;
  chooseDisplay(req: { wc: WebContents; origin: string; audio: boolean }): Promise<Electron.Streams | null>;
  /** Capabilities a page is now using (camera, microphone, location, screen): for indicators. */
  inUseChanged(wc: WebContents): void;
}

interface Stored {
  version: 2;
  decisions: Record<string, Decision>;
  /** Device grants: origin → device keys (vendor:product:serial). */
  devices: Record<string, string[]>;
  /** Dismissed prompts: origin|kind → count and embargo end. */
  embargo: Record<string, { count: number; until?: number }>;
}

const IN_USE = new Set(['camera', 'microphone', 'geolocation', 'display-capture']);

export class SitePermissions {
  private data: Stored;
  /** "Allow this time": web contents id → origin|kind, cleared when the page navigates. */
  private readonly once = new Map<number, Set<string>>();
  private readonly inUse = new Map<number, Set<string>>();

  constructor(private readonly path: string | null, private readonly defaults: () => Record<string, DefaultSetting> = () => ({}), private readonly now: () => number = Date.now) {
    this.data = migrate(path ? readJson<unknown>(path, {}) : {});
  }

  private save(): void {
    if (this.path) writeJsonAtomic(this.path, this.data);
  }

  /** The default for a kind: the user's choice in Settings, else Chrome's. */
  defaultFor(id: string): DefaultSetting {
    const k = kind(id);
    if (!k) return 'block';
    return (k.configurable && this.defaults()[id]) || k.default;
  }

  /** What happens if this origin asks for this kind now. */
  effective(origin: string, id: string, wcId?: number): DefaultSetting {
    const key = `${origin}|${id}`;
    const d = this.data.decisions[key];
    if (d) return d;
    if (wcId !== undefined && this.once.get(wcId)?.has(key)) return 'allow';
    const def = this.defaultFor(id);
    if (def === 'ask' && (this.data.embargo[key]?.until ?? 0) > this.now()) return 'block';
    return def;
  }

  embargoed(origin: string, id: string): boolean {
    return !this.data.decisions[`${origin}|${id}`] && (this.data.embargo[`${origin}|${id}`]?.until ?? 0) > this.now();
  }

  usedBy(wcId: number): string[] {
    return [...(this.inUse.get(wcId) ?? [])];
  }

  private markUsed(wc: WebContents, ids: string[], ui: PermissionsUi): void {
    const used = ids.filter((id) => IN_USE.has(id));
    if (!used.length) return;
    if (!this.inUse.has(wc.id)) this.inUse.set(wc.id, new Set());
    for (const id of used) this.inUse.get(wc.id)!.add(id);
    ui.inUseChanged(wc);
  }

  private answer(origin: string, ids: string[], a: PromptAnswer, wcId: number): boolean {
    for (const id of ids) {
      const key = `${origin}|${id}`;
      if (a === 'allow-always') this.data.decisions[key] = 'allow';
      else if (a === 'block') this.data.decisions[key] = 'block';
      else if (a === 'allow-once') {
        if (!this.once.has(wcId)) this.once.set(wcId, new Set());
        this.once.get(wcId)!.add(key);
      } else {
        const e = this.data.embargo[key] ?? { count: 0 };
        e.count++;
        if (e.count >= EMBARGO_AFTER) {
          e.until = this.now() + EMBARGO_MS;
          e.count = 0;
        }
        this.data.embargo[key] = e;
      }
      if (a !== 'dismiss') delete this.data.embargo[key];
    }
    if (a !== 'allow-once') this.save();
    return a === 'allow-always' || a === 'allow-once';
  }

  install(session: Session, ui: PermissionsUi): void {
    session.setPermissionRequestHandler((wc, permission, callback, details) => {
      const origin = originOf(details.requestingUrl ?? wc.getURL());
      const top = originOf(wc.getURL());
      // Vizulla's own pages ask for nothing; extensions declare what they need.
      if (origin.startsWith('vizulla:')) return callback(permission === 'fullscreen' || permission === 'clipboard-sanitized-write');
      const kinds = kindsFor(permission, (details as Electron.MediaAccessPermissionRequest).mediaTypes ?? []);
      if (!kinds.length) return callback(false);
      if (origin.startsWith('chrome-extension:') && kinds.every((k) => ['notifications', 'clipboard-read', 'clipboard-write', 'fullscreen', 'persistent-storage', 'background-sync'].includes(k.id))) return callback(true);
      if (kinds.some((k) => k.secure) && !isSecureOrigin(origin) && !origin.startsWith('chrome-extension:')) return callback(false);
      const states = kinds.map((k) => this.effective(origin, k.id, wc.id));
      if (states.some((s) => s === 'block')) return callback(false);
      // Screen sharing: the picker is the consent (handled by the display-media handler).
      if (kinds.every((k) => k.picker)) return callback(true);
      if (states.every((s) => s === 'allow')) {
        this.markUsed(wc, kinds.map((k) => k.id), ui);
        return callback(true);
      }
      const ask = kinds.filter((_k, i) => states[i] === 'ask').map((k) => k.id);
      const fs = details as Electron.FilesystemPermissionRequest;
      const detail = permission === 'fileSystem' && fs.filePath ? `${fs.fileAccessType === 'writable' ? 'write' : 'read'}:${fs.filePath}` : undefined;
      ui.prompt({ wc, origin, embeddedIn: top !== origin && !top.startsWith('vizulla:') ? top : undefined, kinds: ask, detail })
        .then((a) => {
          // File access is never remembered beyond the visit (as in Chrome).
          const ok = this.answer(origin, ask, permission === 'fileSystem' && a === 'allow-always' ? 'allow-once' : a, wc.id);
          if (ok) this.markUsed(wc, kinds.map((k) => k.id), ui);
          callback(ok);
        })
        .catch(() => callback(false));
    });

    session.setPermissionCheckHandler((wc, permission, requestingOrigin, details) => {
      const origin = originOf(requestingOrigin);
      if (origin.startsWith('vizulla:')) return permission === 'fullscreen' || permission === 'clipboard-sanitized-write';
      const media = (details as { mediaType?: string }).mediaType;
      const kinds = kindsFor(permission, media === 'video' ? ['video'] : media === 'audio' ? ['audio'] : []);
      if (!kinds.length) return false;
      // Device APIs: the check only gates the chooser; each device is granted on its own.
      if (kinds.every((k) => k.picker)) return kinds.every((k) => this.effective(origin, k.id) !== 'block');
      return kinds.every((k) => this.effective(origin, k.id, wc?.id) === 'allow');
    });

    session.setDevicePermissionHandler((d) => {
      const origin = originOf(d.origin);
      return this.effective(origin, d.deviceType) !== 'block' && (this.data.devices[origin] ?? []).includes(deviceKey(d.device as DeviceLike));
    });

    const choose = async (kindId: 'usb' | 'serial' | 'hid', wc: WebContents | null, origin: string, list: DeviceLike[]): Promise<string> => {
      if (!wc || this.effective(origin, kindId) === 'block') return '';
      const devices = list.map((x) => ({ id: deviceId(x), name: deviceName(x) }));
      const id = await ui.chooseDevice({ wc, origin, kind: kindId, devices }).catch(() => null);
      const picked = list.find((x) => deviceId(x) === id);
      if (!picked) return '';
      this.grantDevice(origin, picked);
      return deviceId(picked);
    };
    session.on('select-hid-device', (e, details, callback) => {
      e.preventDefault();
      const wc = details.frame ? allWebContents.fromFrame(details.frame) ?? null : null;
      void choose('hid', wc, originOf(details.frame?.url ?? ''), details.deviceList as DeviceLike[]).then((id) => callback(id || null));
    });
    session.on('select-usb-device', (e, details, callback) => {
      e.preventDefault();
      const wc = details.frame ? allWebContents.fromFrame(details.frame) ?? null : null;
      void choose('usb', wc, originOf(details.frame?.url ?? ''), details.deviceList as DeviceLike[]).then((id) => callback(id || undefined));
    });
    session.on('select-serial-port', (e, portList, wc, callback) => {
      e.preventDefault();
      void choose('serial', wc, originOf(wc.getURL()), portList as DeviceLike[]).then((id) => callback(id));
    });
    // Bluetooth: Chromium keeps sending the growing device list; ask once with what's found.
    app.on('web-contents-created', (_e, wc) => {
      if (wc.session !== session) return;
      let pending: { timer: NodeJS.Timeout; list: Electron.BluetoothDevice[]; cb: (id: string) => void } | null = null;
      wc.on('select-bluetooth-device', (e, list, cb) => {
        e.preventDefault();
        if (pending) {
          pending.list = list;
          pending.cb = cb;
          return;
        }
        const origin = originOf(wc.getURL());
        pending = {
          list,
          cb,
          timer: setTimeout(() => {
            const p = pending!;
            pending = null;
            if (this.effective(origin, 'bluetooth') === 'block') return p.cb('');
            void ui
              .chooseDevice({ wc, origin, kind: 'bluetooth', devices: p.list.map((d) => ({ id: d.deviceId, name: d.deviceName || d.deviceId })) })
              .then((id) => p.cb(id ?? ''))
              .catch(() => p.cb(''));
          }, 1500),
        };
      });
      wc.on('did-start-navigation', (d) => {
        if (!d.isMainFrame || d.isSameDocument) return;
        this.once.delete(wc.id);
        if (this.inUse.delete(wc.id)) ui.inUseChanged(wc);
      });
      wc.once('destroyed', () => {
        this.once.delete(wc.id);
        this.inUse.delete(wc.id);
      });
    });

    session.setDisplayMediaRequestHandler((req, callback) => {
      const origin = originOf(req.securityOrigin);
      const wc = req.frame ? allWebContents.fromFrame(req.frame) : null;
      if (!wc || this.effective(origin, 'display-capture') === 'block' || !isSecureOrigin(origin)) return callback(null);
      void ui
        .chooseDisplay({ wc, origin, audio: req.audioRequested })
        .then((streams) => {
          if (streams) this.markUsed(wc, ['display-capture'], ui);
          callback(streams);
        })
        .catch(() => callback(null));
    });
  }

  private grantDevice(origin: string, d: DeviceLike): void {
    const list = new Set(this.data.devices[origin] ?? []);
    list.add(deviceKey(d));
    this.data.devices[origin] = [...list];
    this.save();
  }

  /** null clears the site's choice (back to the default). */
  set(origin: string, id: string, d: Decision | null): void {
    const key = `${origin}|${id}`;
    if (d) this.data.decisions[key] = d;
    else delete this.data.decisions[key];
    delete this.data.embargo[key];
    if (!d && ['usb', 'serial', 'hid', 'bluetooth'].includes(id)) delete this.data.devices[origin];
    this.save();
  }

  resetSite(origin: string): void {
    for (const key of Object.keys(this.data.decisions)) if (key.startsWith(`${origin}|`)) delete this.data.decisions[key];
    for (const key of Object.keys(this.data.embargo)) if (key.startsWith(`${origin}|`)) delete this.data.embargo[key];
    delete this.data.devices[origin];
    this.save();
  }

  list(): { origin: string; permission: string; decision: Decision }[] {
    return Object.entries(this.data.decisions).map(([k, decision]) => {
      const i = k.lastIndexOf('|');
      return { origin: k.slice(0, i), permission: k.slice(i + 1), decision };
    });
  }

  /** The site-info panel: common kinds plus anything decided, in use or blocked automatically. */
  forSite(origin: string, wcId?: number): { kind: string; setting: DefaultSetting; isDefault: boolean; inUse: boolean; embargoed: boolean }[] {
    const used = new Set(wcId !== undefined ? this.usedBy(wcId) : []);
    return KINDS.filter((k) => k.configurable)
      .filter((k) => k.common || this.data.decisions[`${origin}|${k.id}`] || used.has(k.id) || this.embargoed(origin, k.id) || (this.data.devices[origin] && k.picker))
      .map((k) => {
        const saved = this.data.decisions[`${origin}|${k.id}`];
        return { kind: k.id, setting: saved ?? this.defaultFor(k.id), isDefault: !saved, inUse: used.has(k.id), embargoed: this.embargoed(origin, k.id) };
      });
  }

  clear(): void {
    this.data = { version: 2, decisions: {}, devices: {}, embargo: {} };
    this.once.clear();
    this.save();
  }
}

type DeviceLike = { deviceId?: string; portId?: string; name?: string; productName?: string; displayName?: string; portName?: string; vendorId?: number | string; productId?: number | string; serialNumber?: string };

function deviceId(d: DeviceLike): string {
  return String(d.deviceId ?? d.portId ?? '');
}

function deviceName(d: DeviceLike): string {
  return d.productName || d.name || d.displayName || d.portName || `${d.vendorId ?? '?'}:${d.productId ?? '?'}`;
}

/** Stable across reconnects (the runtime id isn't): vendor, product, serial. */
export function deviceKey(d: DeviceLike): string {
  return `${d.vendorId ?? ''}:${d.productId ?? ''}:${d.serialNumber ?? deviceName(d)}`;
}

/** Version 1 stored "origin|electronName"; "media" meant camera and microphone together. */
export function migrate(raw: unknown): Stored {
  const r = raw as Partial<Stored> & Record<string, unknown>;
  if (r && r.version === 2) return { version: 2, decisions: r.decisions ?? {}, devices: r.devices ?? {}, embargo: r.embargo ?? {} };
  const out: Stored = { version: 2, decisions: {}, devices: {}, embargo: {} };
  for (const [key, value] of Object.entries(r ?? {})) {
    if (value !== 'allow' && value !== 'block') continue;
    const i = key.lastIndexOf('|');
    const origin = key.slice(0, i);
    const perm = key.slice(i + 1);
    const kinds = perm === 'media' ? kindsFor('media', ['video', 'audio']) : kindsFor(perm);
    for (const k of kinds) out.decisions[`${origin}|${k.id}`] = value;
  }
  return out;
}
