// Model manager (P4-AI-02): signed manifest from the model CDN (ed25519), downloads
// with hash verification, disk-space checks, removal, and the 90-day "unused"
// prompt. A tampered manifest or model is rejected. Models are untrusted input
// even when signed (C12): the runtime fuzzes its parsers.
import { createHash, createPublicKey, verify } from 'node:crypto';
import { createWriteStream, existsSync, mkdirSync, renameSync, rmSync, statSync, statfsSync } from 'node:fs';
import { join } from 'node:path';
import { readJson, writeJsonAtomic } from '../../storage/json_store';

export interface ModelEntry {
  id: string;
  kind: 'generate' | 'embed' | 'classify';
  engine: string;
  url: string;
  sha256: string;
  size_bytes: number;
  min_profile: string;
  license: string;
  languages: string[];
}

export interface Manifest {
  manifest_version: number;
  models: ModelEntry[];
}

export interface SignedManifest {
  manifest: Manifest;
  signature: string;
}

const canonical = (m: Manifest) => Buffer.from(`vizulla-models-v1\n${JSON.stringify(m)}`);

export function verifyManifest(s: SignedManifest, publicKeysPem: readonly string[], minVersion = 0): Manifest {
  if (!s?.manifest || typeof s.signature !== 'string') throw new Error('malformed manifest');
  const ok = publicKeysPem.some((k) => {
    try {
      return verify(null, canonical(s.manifest), createPublicKey(k), Buffer.from(s.signature, 'base64'));
    } catch {
      return false;
    }
  });
  if (!ok) throw new Error('bad manifest signature');
  if (s.manifest.manifest_version < minVersion) throw new Error('manifest rollback');
  for (const m of s.manifest.models) {
    if (!/^[a-z0-9._-]{3,80}$/.test(m.id) || !/^[0-9a-f]{64}$/.test(m.sha256) || !/^https:\/\//.test(m.url)) throw new Error(`bad model entry ${m.id}`);
  }
  return s.manifest;
}

export function signManifest(m: Manifest, sign: (data: Buffer) => Buffer): SignedManifest {
  return { manifest: m, signature: sign(canonical(m)).toString('base64') };
}

interface InstallRecord {
  id: string;
  sha256: string;
  path: string;
  installedAt: number;
  lastUsed: number;
}

export class ModelManager {
  private records: Record<string, InstallRecord>;

  constructor(private readonly dir: string, private readonly now: () => number = Date.now) {
    mkdirSync(dir, { recursive: true });
    this.records = readJson(join(dir, 'installed.json'), {});
  }

  installed(): InstallRecord[] {
    return Object.values(this.records).filter((r) => existsSync(r.path));
  }

  markUsed(id: string): void {
    const r = this.records[id];
    if (!r) return;
    r.lastUsed = this.now();
    this.save();
  }

  /** Models unused for 90 days: the UI offers to remove them (doc 06 §7). */
  stale(days = 90): InstallRecord[] {
    return this.installed().filter((r) => this.now() - r.lastUsed > days * 86_400_000);
  }

  async install(entry: ModelEntry, fetcher: typeof fetch = fetch, opts: { meteredOk?: boolean; metered?: boolean } = {}): Promise<InstallRecord> {
    if (opts.metered && !opts.meteredOk) throw new Error('metered network: ask the user first');
    const free = (() => {
      try {
        const s = statfsSync(this.dir);
        return s.bavail * s.bsize;
      } catch {
        return Number.MAX_SAFE_INTEGER;
      }
    })();
    if (free < entry.size_bytes * 1.2 + 512 * 1024 * 1024) throw new Error('not enough disk space');
    const tmp = join(this.dir, `${entry.id}.part`);
    const final = join(this.dir, `${entry.id}.bin`);
    // Resume a partial download when the server supports ranges.
    const have = existsSync(tmp) ? statSync(tmp).size : 0;
    const res = await fetcher(entry.url, { headers: have ? { range: `bytes=${have}-` } : {} });
    if (!res.ok || !res.body) throw new Error(`download failed: HTTP ${res.status}`);
    const append = res.status === 206 && have > 0;
    const hash = createHash('sha256');
    if (append) {
      const { readFileSync } = await import('node:fs');
      hash.update(readFileSync(tmp));
    }
    const out = createWriteStream(tmp, { flags: append ? 'a' : 'w' });
    const reader = res.body.getReader();
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      hash.update(value);
      if (!out.write(value)) await new Promise<void>((r) => out.once('drain', () => r()));
    }
    await new Promise<void>((r, j) => out.end((e?: Error) => (e ? j(e) : r())));
    const digest = hash.digest('hex');
    if (digest !== entry.sha256) {
      rmSync(tmp, { force: true });
      throw new Error('model hash mismatch: rejected');
    }
    renameSync(tmp, final);
    const rec = { id: entry.id, sha256: digest, path: final, installedAt: this.now(), lastUsed: this.now() };
    this.records[entry.id] = rec;
    this.save();
    return rec;
  }

  remove(id: string): void {
    const r = this.records[id];
    if (r) rmSync(r.path, { force: true });
    delete this.records[id];
    this.save();
  }

  private save(): void {
    writeJsonAtomic(join(this.dir, 'installed.json'), this.records);
  }
}

/** Device capability profile (P4-AI-03): does this device meet the local AI profile? */
export function deviceProfile(info: { totalMemBytes: number; cpus: number; arch: string; gpu?: string }): { tier: 'RD-1' | 'RD-2' | 'RD-3' | 'none'; localGenerative: boolean; localSmallTasks: boolean } {
  const gb = info.totalMemBytes / 2 ** 30;
  const appleSilicon = info.arch === 'arm64' && (info.gpu ?? '').toLowerCase().includes('apple');
  const tier = gb >= 16 && (appleSilicon || info.cpus >= 8) ? 'RD-3' : gb >= 8 ? 'RD-2' : gb >= 4 ? 'RD-1' : 'none';
  return { tier, localGenerative: tier === 'RD-3', localSmallTasks: tier !== 'none' };
}
