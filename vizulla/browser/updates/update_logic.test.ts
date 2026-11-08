import { describe, expect, it } from 'vitest';
import { assetFor, compareVersions, isAllowedDownloadUrl, parseSums, pickRelease, type Release } from './update_logic';

const rel = (tag: string, o: Partial<Release> = {}): Release => ({
  tag_name: tag,
  html_url: `https://github.com/o/r/releases/tag/${tag}`,
  draft: false,
  prerelease: tag.startsWith('v0.') || tag.includes('-'),
  assets: [],
  ...o,
});

describe('compareVersions', () => {
  it('orders by SemVer precedence', () => {
    const sorted = ['1.0.0', '0.2.1', '1.0.0-beta.2', '0.10.0', '1.0.0-alpha', '1.0.0-beta.11', 'v0.2.0', '1.0.0-alpha.1'].sort(compareVersions);
    expect(sorted).toEqual(['v0.2.0', '0.2.1', '0.10.0', '1.0.0-alpha', '1.0.0-alpha.1', '1.0.0-beta.2', '1.0.0-beta.11', '1.0.0']);
    expect(compareVersions('v1.2.3', '1.2.3')).toBe(0);
    expect(compareVersions('garbage', '0.0.1')).toBe(-1);
  });
});

describe('pickRelease', () => {
  const releases = [rel('v0.2.0'), rel('v0.2.1'), rel('v0.3.0', { draft: true }), rel('v0.1.0'), rel('nightly')];

  it('picks the newest published release above the current one', () => {
    expect(pickRelease(releases, '0.2.0')?.tag_name).toBe('v0.2.1');
    expect(pickRelease(releases, '0.2.1')).toBeNull();
    expect(pickRelease(releases, '0.9.0')).toBeNull();
  });

  it('ignores prereleases for a stable 1.x install unless asked', () => {
    const list = [rel('v1.1.0', { prerelease: false }), rel('v1.2.0-beta.1')];
    expect(pickRelease(list, '1.0.0')?.tag_name).toBe('v1.1.0');
    expect(pickRelease(list, '1.0.0', true)?.tag_name).toBe('v1.2.0-beta.1');
  });
});

describe('assetFor', () => {
  const names = ['Vizulla-0.3.0-mac-arm64.zip', 'Vizulla-0.3.0-mac-x64.zip', 'Vizulla-0.3.0-mac-arm64.dmg', 'Vizulla-0.3.0-win-x64.exe', 'Vizulla-0.3.0-linux-x86_64.AppImage', 'Vizulla-0.3.0-linux-amd64.deb'];
  const r = rel('v0.3.0', { assets: names.map((name) => ({ name, browser_download_url: `https://github.com/o/r/releases/download/v0.3.0/${name}`, size: 1 })) });

  it('matches the installer for this platform and architecture', () => {
    expect(assetFor(r, 'darwin', 'arm64', false)).toMatchObject({ kind: 'mac-zip', asset: { name: 'Vizulla-0.3.0-mac-arm64.zip' } });
    expect(assetFor(r, 'darwin', 'x64', false)?.asset.name).toBe('Vizulla-0.3.0-mac-x64.zip');
    expect(assetFor(r, 'win32', 'x64', false)?.kind).toBe('win-nsis');
    expect(assetFor(r, 'linux', 'x64', true)?.kind).toBe('linux-appimage');
    expect(assetFor(r, 'linux', 'x64', false)?.asset.name).toBe('Vizulla-0.3.0-linux-amd64.deb');
    expect(assetFor(rel('v0.3.0'), 'darwin', 'arm64', false)).toBeNull();
    expect(assetFor(r, 'freebsd', 'x64', false)).toBeNull();
  });
});

describe('parseSums', () => {
  it('reads sha256sum output', () => {
    const a = 'a'.repeat(64);
    const b = 'B'.repeat(64);
    const m = parseSums(`${a}  Vizulla-0.3.0-mac-arm64.zip\n${b} *Vizulla Setup.exe\r\nnot a line\n`);
    expect(m.get('Vizulla-0.3.0-mac-arm64.zip')).toBe(a);
    expect(m.get('Vizulla Setup.exe')).toBe('b'.repeat(64));
    expect(m.size).toBe(2);
  });
});

describe('isAllowedDownloadUrl', () => {
  it('allows GitHub over HTTPS only', () => {
    expect(isAllowedDownloadUrl('https://github.com/o/r/releases/download/v1/x.zip')).toBe(true);
    expect(isAllowedDownloadUrl('https://objects.githubusercontent.com/x')).toBe(true);
    expect(isAllowedDownloadUrl('https://release-assets.githubusercontent.com/x')).toBe(true);
    expect(isAllowedDownloadUrl('http://github.com/x')).toBe(false);
    expect(isAllowedDownloadUrl('https://github.com.evil.example/x')).toBe(false);
    expect(isAllowedDownloadUrl('https://user:pw@github.com/x')).toBe(false);
    expect(isAllowedDownloadUrl('not a url')).toBe(false);
  });
});
