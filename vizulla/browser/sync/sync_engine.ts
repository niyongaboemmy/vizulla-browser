// E2EE sync engine (P4 Track F, SYN-01/02).
// Everything derives from the sync code, which never leaves the device:
//   chainId = SHA-256("vz-chain|code")[:32]      (server address of the chain)
//   token   = SHA-256("vz-auth|code")            (server stores only its hash)
//   key     = scrypt(code, chainId)              (never sent; encrypts every record)
//   record id = HMAC(key, type|naturalKey)        (server can't see URLs or names)
// Merge is last-writer-wins per record; deletions are encrypted tombstones.
import { createHash, createHmac, randomBytes } from 'node:crypto';
import { CryptoBox, deriveKey } from '../storage/crypto_box';

export interface SyncRecordData {
  data: unknown | null;
  modified: number;
}

export interface SyncAdapter {
  type: string;
  /** Current local items by natural key. */
  snapshot(): Map<string, unknown>;
  /** Apply a remote change (null = delete). */
  apply(key: string, data: unknown | null): void;
}

export interface WireRecord {
  type: string;
  id: string;
  seq?: number;
  blob: string;
}

export interface SyncTransport {
  join(chainId: string, token: string): Promise<'created' | 'joined'>;
  registerDevice(chainId: string, token: string, deviceId: string, nameEnc: string): Promise<void>;
  devices(chainId: string, token: string): Promise<{ id: string; name_enc: string; last_seen: number }[]>;
  push(chainId: string, token: string, records: WireRecord[]): Promise<number>;
  pull(chainId: string, token: string, since: number): Promise<{ records: WireRecord[]; seq: number }>;
  leave(chainId: string, token: string, deviceId: string): Promise<void>;
}

export interface SyncState {
  seq: number;
  /** type/key → { hash of data, modified } as last agreed with the server. */
  known: Record<string, { hash: string; modified: number }>;
}

const B32 = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';

/** ~120-bit sync code in 4 readable groups (SYN-02). */
export function newSyncCode(): string {
  const bytes = randomBytes(24);
  const chars = [...bytes].map((b) => B32[b % 32]).join('');
  return chars.match(/.{6}/g)!.join('-');
}

export function normalizeCode(code: string): string {
  return code.toUpperCase().replace(/[^A-Z0-9]/g, '').match(/.{1,6}/g)?.join('-') ?? '';
}

export function deriveChain(code: string): { chainId: string; token: string; key: Buffer } {
  const c = normalizeCode(code);
  const chainId = createHash('sha256').update(`vz-chain|${c}`).digest('hex').slice(0, 32);
  const token = createHash('sha256').update(`vz-auth|${c}`).digest('hex');
  return { chainId, token, key: deriveKey(c, chainId) };
}

const hashOf = (v: unknown) => createHash('sha256').update(JSON.stringify(v ?? null)).digest('hex').slice(0, 24);

export class SyncEngine {
  private readonly chainId: string;
  private readonly token: string;
  private readonly key: Buffer;
  private readonly box: CryptoBox;

  constructor(
    code: string,
    readonly deviceId: string,
    private readonly transport: SyncTransport,
    private readonly adapters: SyncAdapter[],
    public state: SyncState = { seq: 0, known: {} },
    private readonly now: () => number = Date.now,
  ) {
    ({ chainId: this.chainId, token: this.token, key: this.key } = deriveChain(code));
    this.box = new CryptoBox(this.key);
  }

  get chain(): string {
    return this.chainId;
  }

  recordId(type: string, key: string): string {
    return createHmac('sha256', this.key).update(`${type}|${key}`).digest('hex').slice(0, 32);
  }

  async join(deviceName: string): Promise<'created' | 'joined'> {
    const r = await this.transport.join(this.chainId, this.token);
    await this.transport.registerDevice(this.chainId, this.token, this.deviceId, this.box.sealString(deviceName, 'device'));
    return r;
  }

  async devices(): Promise<{ id: string; name: string; lastSeen: number }[]> {
    const list = await this.transport.devices(this.chainId, this.token);
    return list.map((d) => {
      let name = '?';
      try {
        name = this.box.openString(d.name_enc, 'device');
      } catch {
        /* unreadable */
      }
      return { id: d.id, name, lastSeen: d.last_seen * 1000 };
    });
  }

  async leave(): Promise<void> {
    await this.transport.leave(this.chainId, this.token, this.deviceId);
  }

  /** One sync round: pull remote changes (LWW), then push local changes. */
  async sync(): Promise<{ pulled: number; pushed: number }> {
    const byType = new Map(this.adapters.map((a) => [a.type, a]));
    // Pull.
    const remote = await this.transport.pull(this.chainId, this.token, this.state.seq);
    let pulled = 0;
    const local = new Map(this.adapters.map((a) => [a.type, a.snapshot()]));
    for (const rec of remote.records) {
      const adapter = byType.get(rec.type);
      if (!adapter) continue;
      let payload: { key: string; data: unknown | null; modified: number };
      try {
        payload = JSON.parse(this.box.openString(rec.blob, `${rec.type}/${rec.id}`));
      } catch {
        continue; // not ours or tampered: ignore
      }
      if (this.recordId(rec.type, payload.key) !== rec.id) continue; // id must match its content
      const k = `${rec.type}/${payload.key}`;
      const known = this.state.known[k];
      const localData = local.get(rec.type)?.get(payload.key);
      const localChanged = known ? hashOf(localData ?? null) !== known.hash : localData !== undefined;
      // A pending local edit is stamped "now" when pushed, so it is the later write
      // and wins (last writer wins), unless the remote clock is ahead of ours.
      if (localChanged && payload.modified <= this.now()) continue;
      if (hashOf(localData ?? null) !== hashOf(payload.data)) {
        adapter.apply(payload.key, payload.data);
        pulled++;
      }
      this.state.known[k] = { hash: hashOf(payload.data), modified: payload.modified };
    }
    this.state.seq = remote.seq;
    // Push.
    const out: WireRecord[] = [];
    const t = this.now();
    for (const a of this.adapters) {
      const snap = a.snapshot();
      for (const [key, data] of snap) {
        const k = `${a.type}/${key}`;
        const h = hashOf(data);
        if (this.state.known[k]?.hash === h) continue;
        out.push(this.wire(a.type, key, data, t));
        this.state.known[k] = { hash: h, modified: t };
      }
      for (const k of Object.keys(this.state.known)) {
        if (!k.startsWith(`${a.type}/`)) continue;
        const key = k.slice(a.type.length + 1);
        if (snap.has(key) || this.state.known[k]!.hash === hashOf(null)) continue;
        out.push(this.wire(a.type, key, null, t));
        this.state.known[k] = { hash: hashOf(null), modified: t };
      }
    }
    for (let i = 0; i < out.length; i += 500) this.state.seq = Math.max(this.state.seq, await this.transport.push(this.chainId, this.token, out.slice(i, i + 500)));
    return { pulled, pushed: out.length };
  }

  private wire(type: string, key: string, data: unknown | null, modified: number): WireRecord {
    const id = this.recordId(type, key);
    return { type, id, blob: this.box.sealString(JSON.stringify({ key, data, modified, device: this.deviceId }), `${type}/${id}`) };
  }
}

/** HTTP transport for the Go sync server. */
export function httpTransport(base: string, fetcher: typeof fetch = fetch): SyncTransport {
  const url = (p: string) => `${base.replace(/\/$/, '')}${p}`;
  const call = async (method: string, path: string, token: string | null, body?: unknown) => {
    const res = await fetcher(url(path), { method, headers: { 'content-type': 'application/json', ...(token ? { authorization: `Bearer ${token}` } : {}) }, body: body ? JSON.stringify(body) : undefined });
    if (!res.ok) throw new Error(`sync HTTP ${res.status}`);
    return res.status === 204 ? null : res.json();
  };
  return {
    join: async (c, token) => ((await call('PUT', `/v1/chains/${c}`, null, { token })) as { created: boolean }).created ? 'created' : 'joined',
    registerDevice: async (c, token, dev, nameEnc) => void (await call('PUT', `/v1/chains/${c}/devices/${dev}`, token, { name_enc: nameEnc })),
    devices: async (c, token) => (await call('GET', `/v1/chains/${c}/devices`, token)) as { id: string; name_enc: string; last_seen: number }[],
    push: async (c, token, records) => ((await call('POST', `/v1/chains/${c}/records`, token, { records })) as { seq: number }).seq,
    pull: async (c, token, since) => (await call('GET', `/v1/chains/${c}/records?since=${since}`, token)) as { records: WireRecord[]; seq: number },
    leave: async (c, token, dev) => void (await call('DELETE', `/v1/chains/${c}/devices/${dev}`, token)),
  };
}
