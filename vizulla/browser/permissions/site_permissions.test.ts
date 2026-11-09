import { describe, expect, it, vi } from 'vitest';
vi.mock('electron', () => ({ app: { on: () => undefined }, webContents: { fromFrame: () => null } }));
import { deviceKey, migrate, SitePermissions } from './site_permissions';
import { isSecureOrigin, kindsFor } from './catalog';

describe('permission catalog', () => {
  it('splits media into camera and microphone and maps Electron names', () => {
    expect(kindsFor('media', ['video', 'audio']).map((k) => k.id)).toEqual(['camera', 'microphone']);
    expect(kindsFor('media', ['audio']).map((k) => k.id)).toEqual(['microphone']);
    expect(kindsFor('local-network-access').map((k) => k.id)).toEqual(['local-network']);
    expect(kindsFor('fileSystem').map((k) => k.id)).toEqual(['file-system']);
    expect(kindsFor('nope')).toEqual([]);
  });
  it('treats https and local addresses as secure', () => {
    expect(isSecureOrigin('https://a.example')).toBe(true);
    expect(isSecureOrigin('http://localhost:3000')).toBe(true);
    expect(isSecureOrigin('http://127.0.0.1:8080')).toBe(true);
    expect(isSecureOrigin('http://a.example')).toBe(false);
  });
});

describe('SitePermissions', () => {
  it('migrates version 1 ("media" meant camera and microphone)', () => {
    const m = migrate({ 'https://a.example|media': 'allow', 'https://b.example|geolocation': 'block', junk: 1 });
    expect(m.decisions).toEqual({ 'https://a.example|camera': 'allow', 'https://a.example|microphone': 'allow', 'https://b.example|geolocation': 'block' });
  });

  it('uses the site choice, then the user default, then Chrome’s default', () => {
    let defaults: Record<string, 'ask' | 'allow' | 'block'> = {};
    const p = new SitePermissions(null, () => defaults);
    expect(p.effective('https://a.example', 'camera')).toBe('ask');
    expect(p.effective('https://a.example', 'protected-content')).toBe('allow');
    defaults = { camera: 'block' };
    expect(p.effective('https://a.example', 'camera')).toBe('block');
    p.set('https://a.example', 'camera', 'allow');
    expect(p.effective('https://a.example', 'camera')).toBe('allow');
    p.resetSite('https://a.example');
    expect(p.effective('https://a.example', 'camera')).toBe('block');
  });

  it('blocks a site from asking for a week after three dismissed prompts', () => {
    let now = 1_000_000;
    const p = new SitePermissions(null, () => ({}), () => now);
    const answer = (a: string) => (p as unknown as { answer(o: string, ids: string[], a: string, wc: number): boolean }).answer('https://n.example', ['notifications'], a, 1);
    answer('dismiss');
    answer('dismiss');
    expect(p.effective('https://n.example', 'notifications')).toBe('ask');
    answer('dismiss');
    expect(p.effective('https://n.example', 'notifications')).toBe('block');
    expect(p.embargoed('https://n.example', 'notifications')).toBe(true);
    now += 8 * 24 * 3600_000;
    expect(p.effective('https://n.example', 'notifications')).toBe('ask');
  });

  it('"allow this time" lasts for that page only', () => {
    const p = new SitePermissions(null);
    const answer = (p as unknown as { answer(o: string, ids: string[], a: string, wc: number): boolean }).answer.bind(p);
    expect(answer('https://m.example', ['microphone'], 'allow-once', 7)).toBe(true);
    expect(p.effective('https://m.example', 'microphone', 7)).toBe('allow');
    expect(p.effective('https://m.example', 'microphone', 8)).toBe('ask');
    expect(p.list()).toEqual([]);
  });

  it('identifies devices by vendor, product and serial', () => {
    expect(deviceKey({ deviceId: 'x1', vendorId: 0x2341, productId: 0x43, serialNumber: 'A1' })).toBe('9025:67:A1');
    expect(deviceKey({ portId: 'p', vendorId: 1, productId: 2, displayName: 'Arduino' })).toBe('1:2:Arduino');
  });
});
