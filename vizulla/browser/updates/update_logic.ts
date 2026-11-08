// Pure parts of the updater: version order, which release and asset apply to this
// install, the SHA256SUMS format, and where downloads may come from.

export interface ReleaseAsset {
  name: string;
  browser_download_url: string;
  size: number;
}

export interface Release {
  tag_name: string;
  name?: string | null;
  html_url: string;
  draft: boolean;
  prerelease: boolean;
  assets: ReleaseAsset[];
}

type Parsed = { nums: [number, number, number]; pre: string[] };

function parse(v: string): Parsed | null {
  const m = /^v?(\d+)\.(\d+)\.(\d+)(?:-([0-9A-Za-z.-]+))?(?:\+.*)?$/.exec(v.trim());
  if (!m) return null;
  return { nums: [Number(m[1]), Number(m[2]), Number(m[3])], pre: m[4] ? m[4].split('.') : [] };
}

/** SemVer 2 precedence: -1 if a < b, 0 if equal, 1 if a > b. Unparseable versions sort lowest. */
export function compareVersions(a: string, b: string): number {
  const x = parse(a);
  const y = parse(b);
  if (!x || !y) return x ? 1 : y ? -1 : 0;
  for (let i = 0; i < 3; i++) if (x.nums[i] !== y.nums[i]) return x.nums[i]! < y.nums[i]! ? -1 : 1;
  // A release outranks its prereleases.
  if (!x.pre.length || !y.pre.length) return x.pre.length === y.pre.length ? 0 : x.pre.length ? -1 : 1;
  for (let i = 0; i < Math.max(x.pre.length, y.pre.length); i++) {
    const p = x.pre[i];
    const q = y.pre[i];
    if (p === undefined) return -1;
    if (q === undefined) return 1;
    const pn = /^\d+$/.test(p);
    const qn = /^\d+$/.test(q);
    if (pn && qn && Number(p) !== Number(q)) return Number(p) < Number(q) ? -1 : 1;
    if (pn !== qn) return pn ? -1 : 1;
    if (p !== q) return p < q ? -1 : 1;
  }
  return 0;
}

/**
 * The newest release above `current`. GitHub marks every 0.x release as a
 * prerelease, so prereleases count while the installed version is itself 0.x
 * or a prerelease, or when `includePrerelease` is set.
 */
export function pickRelease(releases: Release[], current: string, includePrerelease = false): Release | null {
  const cur = parse(current);
  const allowPre = includePrerelease || !cur || cur.nums[0] === 0 || cur.pre.length > 0;
  let best: Release | null = null;
  for (const r of releases) {
    if (r.draft || (r.prerelease && !allowPre) || !parse(r.tag_name)) continue;
    if (compareVersions(r.tag_name, current) <= 0) continue;
    if (!best || compareVersions(r.tag_name, best.tag_name) > 0) best = r;
  }
  return best;
}

export type InstallKind = 'mac-zip' | 'win-nsis' | 'linux-appimage' | 'linux-deb';

/** File names follow the electron-builder artifactName in package.json. */
export function assetFor(release: Release, platform: NodeJS.Platform, arch: string, linuxAppImage: boolean): { asset: ReleaseAsset; kind: InstallKind } | null {
  const v = release.tag_name.replace(/^v/, '');
  const want: [string, InstallKind] | null =
    platform === 'darwin' ? [`Vizulla-${v}-mac-${arch === 'arm64' ? 'arm64' : 'x64'}.zip`, 'mac-zip']
    : platform === 'win32' ? [`Vizulla-${v}-win-x64.exe`, 'win-nsis']
    : platform === 'linux' ? (linuxAppImage ? [`Vizulla-${v}-linux-x86_64.AppImage`, 'linux-appimage'] : [`Vizulla-${v}-linux-amd64.deb`, 'linux-deb'])
    : null;
  if (!want) return null;
  const asset = release.assets.find((a) => a.name === want[0]);
  return asset ? { asset, kind: want[1] } : null;
}

/** Parses `sha256sum` output: "<64 hex>  <name>" (binary-mode "*name" too). */
export function parseSums(text: string): Map<string, string> {
  const out = new Map<string, string>();
  for (const line of text.split(/\r?\n/)) {
    const m = /^([0-9a-fA-F]{64})\s+\*?(.+?)\s*$/.exec(line);
    if (m) out.set(m[2]!, m[1]!.toLowerCase());
  }
  return out;
}

/** Downloads come only from GitHub over HTTPS (asset URLs redirect to githubusercontent.com). */
export function isAllowedDownloadUrl(url: string): boolean {
  try {
    const u = new URL(url);
    if (u.protocol !== 'https:' || u.username || u.password) return false;
    return u.hostname === 'github.com' || u.hostname === 'api.github.com' || u.hostname.endsWith('.githubusercontent.com');
  } catch {
    return false;
  }
}
