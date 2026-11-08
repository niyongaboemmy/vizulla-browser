// In-app updates from GitHub Releases. Checks at startup and every few hours
// (Settings → Updates can turn that off), and shows a toolbar button when a
// newer release exists. The user clicks once to download and once to restart.
//
// Builds are not code-signed yet, so the platform updaters (Squirrel.Mac and
// friends) can't be used. Instead every download is checked against the
// release's SHA256SUMS.txt over HTTPS from GitHub only, then:
//   macOS     the .zip is unpacked and a small script swaps the .app after we quit;
//   Windows   the NSIS installer runs silently and relaunches;
//   Linux     an AppImage replaces itself; a .deb is handed to the system installer.
// When the install location isn't writable the file is revealed instead.
import { createHash } from 'node:crypto';
import { createWriteStream, existsSync, promises as fs, constants as fsc } from 'node:fs';
import { spawn, execFile } from 'node:child_process';
import { dirname, join, resolve } from 'node:path';
import { promisify } from 'node:util';
import type { Session } from 'electron';
import type { UpdateInfo } from '@vz/common/types';
import { assetFor, isAllowedDownloadUrl, parseSums, pickRelease, type InstallKind, type Release, type ReleaseAsset } from './update_logic';

const run = promisify(execFile);
const CHECK_EVERY_MS = 6 * 60 * 60_000;

export interface UpdateHost {
  session: Session;
  version: string;
  packaged: boolean;
  feedUrl: string;
  dir: string;
  autoCheck: () => boolean;
  onChange: () => void;
  /** Saves state and quits so the swap script can run. */
  quit: () => void;
  /** Shows the file (or release page) when the update must be finished by hand. */
  reveal: (pathOrUrl: string) => void;
  allowUrl?: (url: string) => boolean;
}

export type CheckResult = 'latest' | 'available' | 'error';

export class UpdateService {
  private state: UpdateInfo | null = null;
  private release: Release | null = null;
  private target: { asset: ReleaseAsset; kind: InstallKind } | null = null;
  private file: string | null = null;
  private timers: NodeJS.Timeout[] = [];
  private busy: Promise<unknown> | null = null;

  constructor(private readonly host: UpdateHost) {}

  info(): UpdateInfo | null {
    return this.state;
  }

  start(firstDelayMs = 15_000): void {
    const tick = () => this.host.autoCheck() && void this.check();
    this.timers.push(setTimeout(tick, firstDelayMs), setInterval(tick, CHECK_EVERY_MS));
  }

  stop(): void {
    this.timers.forEach(clearTimeout);
    this.timers = [];
  }

  async check(): Promise<CheckResult> {
    if (this.state && this.state.status !== 'available' && this.state.status !== 'error') return 'available';
    try {
      const res = await this.fetch(this.host.feedUrl, { accept: 'application/vnd.github+json' });
      const releases = (await res.json()) as Release[];
      if (!Array.isArray(releases)) throw new Error('bad feed');
      const r = pickRelease(releases, this.host.version);
      const target = r ? assetFor(r, process.platform, process.arch, !!process.env.APPIMAGE) : null;
      if (!r || !target) {
        this.set(null);
        return 'latest';
      }
      this.release = r;
      this.target = target;
      this.set({ status: 'available', version: r.tag_name.replace(/^v/, ''), percent: 0, notesUrl: r.html_url });
      return 'available';
    } catch {
      // A failed background check stays silent; the next one retries.
      return 'error';
    }
  }

  /** The toolbar button: download when available, install when ready. */
  async activate(): Promise<void> {
    if (this.busy) return;
    const s = this.state;
    if (!s) return;
    if (!this.host.packaged) return this.host.reveal(s.notesUrl);
    this.busy = s.status === 'ready' ? this.install() : s.status === 'available' || s.status === 'error' ? this.download() : Promise.resolve();
    try {
      await this.busy;
    } finally {
      this.busy = null;
    }
  }

  async download(): Promise<void> {
    const r = this.release;
    const target = this.target;
    if (!r || !target) return;
    const version = r.tag_name.replace(/^v/, '');
    this.set({ status: 'downloading', version, percent: 0, notesUrl: r.html_url });
    try {
      const sumsAsset = r.assets.find((a) => a.name === 'SHA256SUMS.txt');
      if (!sumsAsset) throw new Error('release has no SHA256SUMS.txt');
      const sums = parseSums(await (await this.fetch(sumsAsset.browser_download_url)).text());
      const expected = sums.get(target.asset.name);
      if (!expected) throw new Error('no checksum for this installer');
      await fs.mkdir(this.host.dir, { recursive: true });
      const out = join(this.host.dir, target.asset.name);
      const part = `${out}.part`;
      const res = await this.fetch(target.asset.browser_download_url);
      const total = Number(res.headers.get('content-length')) || target.asset.size || 0;
      const hash = createHash('sha256');
      const ws = createWriteStream(part);
      let got = 0;
      let lastPct = -1;
      const reader = res.body!.getReader();
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        hash.update(value);
        got += value.byteLength;
        if (!ws.write(value)) await new Promise<void>((ok) => ws.once('drain', () => ok()));
        const pct = total ? Math.min(99, Math.floor((got / total) * 100)) : 0;
        if (pct !== lastPct) {
          lastPct = pct;
          this.set({ status: 'downloading', version, percent: pct, notesUrl: r.html_url });
        }
      }
      await new Promise<void>((ok, fail) => ws.end((e?: Error | null) => (e ? fail(e) : ok())));
      if (hash.digest('hex') !== expected) {
        await fs.rm(part, { force: true });
        throw new Error('checksum mismatch');
      }
      await fs.rename(part, out);
      this.file = out;
      this.set({ status: 'ready', version, percent: 100, notesUrl: r.html_url });
    } catch (e) {
      this.set({ status: 'error', version, percent: 0, notesUrl: r.html_url, error: (e as Error).message });
    }
  }

  async install(): Promise<void> {
    const file = this.file;
    const s = this.state;
    if (!file || !s || !this.target) return;
    this.set({ ...s, status: 'installing' });
    try {
      const done = await this.installFile(file, this.target.kind, s.version);
      if (done) return this.host.quit();
      this.host.reveal(file);
      this.set({ ...s, status: 'ready' });
    } catch (e) {
      this.set({ ...s, status: 'error', error: (e as Error).message });
    }
  }

  /** Returns true when an installer will take over after we quit, false when the user must finish. */
  private async installFile(file: string, kind: InstallKind, version: string): Promise<boolean> {
    switch (kind) {
      case 'mac-zip': {
        const bundle = resolve(process.execPath, '../../..');
        if (!bundle.endsWith('.app') || !(await writable(dirname(bundle))) || !(await writable(bundle))) return false;
        const stage = join(this.host.dir, `stage-${version}`);
        await fs.rm(stage, { recursive: true, force: true });
        await fs.mkdir(stage, { recursive: true });
        await run('/usr/bin/ditto', ['-x', '-k', file, stage]);
        const fresh = join(stage, bundle.split('/').pop()!);
        if (!existsSync(fresh)) throw new Error('unexpected archive layout');
        const script = join(this.host.dir, 'install.sh');
        await fs.writeFile(script, MAC_SWAP, { mode: 0o700 });
        spawn('/bin/sh', [script, String(process.pid), bundle, fresh], { detached: true, stdio: 'ignore' }).unref();
        return true;
      }
      case 'win-nsis':
        spawn(file, ['/S', '--updated', '--force-run'], { detached: true, stdio: 'ignore' }).unref();
        return true;
      case 'linux-appimage': {
        const current = process.env.APPIMAGE;
        if (!current || !(await writable(dirname(current)))) return false;
        const next = `${current}.new`;
        await fs.copyFile(file, next);
        await fs.chmod(next, 0o755);
        await fs.rename(next, current);
        spawn(current, [], { detached: true, stdio: 'ignore' }).unref();
        return true;
      }
      case 'linux-deb':
        return false;
    }
  }

  private async fetch(url: string, o: { accept?: string } = {}): Promise<Response> {
    const allowed = this.host.allowUrl ?? isAllowedDownloadUrl;
    if (!allowed(url)) throw new Error('blocked update URL');
    const res = await this.host.session.fetch(url, {
      headers: { accept: o.accept ?? 'application/octet-stream', 'user-agent': `Vizulla/${this.host.version}` },
      redirect: 'follow',
      cache: 'no-store',
    });
    if (!allowed(res.url || url)) throw new Error('blocked update redirect');
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return res;
  }

  private set(next: UpdateInfo | null): void {
    this.state = next;
    this.host.onChange();
  }
}

async function writable(p: string): Promise<boolean> {
  try {
    await fs.access(p, fsc.W_OK);
    return true;
  } catch {
    return false;
  }
}

// Waits for Vizulla to exit, swaps the bundle (keeping the old one until the new
// one is in place), clears quarantine, and relaunches. Paths arrive as arguments.
const MAC_SWAP = `#!/bin/sh
pid="$1"; app="$2"; fresh="$3"
while kill -0 "$pid" 2>/dev/null; do sleep 0.2; done
rm -rf "$app.old"
if mv "$app" "$app.old" && /usr/bin/ditto "$fresh" "$app"; then
  rm -rf "$app.old" "$fresh"
else
  rm -rf "$app"; mv "$app.old" "$app"
fi
/usr/bin/xattr -dr com.apple.quarantine "$app" 2>/dev/null
/usr/bin/open "$app"
`;
