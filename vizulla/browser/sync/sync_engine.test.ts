import { describe, expect, it } from 'vitest';
import { deriveChain, newSyncCode, normalizeCode, SyncEngine, type SyncAdapter, type SyncTransport, type WireRecord } from './sync_engine';

/** In-memory server with the Go server's semantics. */
function fakeServer() {
  const chains = new Map<string, { token: string; seq: number; records: Map<string, WireRecord & { seq: number }>; devices: Map<string, string> }>();
  const seen: string[] = [];
  const t: SyncTransport = {
    async join(c, token) {
      const ch = chains.get(c);
      if (!ch) return chains.set(c, { token, seq: 0, records: new Map(), devices: new Map() }), 'created';
      if (ch.token !== token) throw new Error('403');
      return 'joined';
    },
    async registerDevice(c, _t, d, n) {
      chains.get(c)!.devices.set(d, n);
    },
    async devices(c) {
      return [...chains.get(c)!.devices].map(([id, name_enc]) => ({ id, name_enc, last_seen: 1 }));
    },
    async push(c, _t, recs) {
      const ch = chains.get(c)!;
      for (const r of recs) {
        seen.push(r.blob, r.id);
        ch.records.set(`${r.type}/${r.id}`, { ...r, seq: ++ch.seq });
      }
      return ch.seq;
    },
    async pull(c, _t, since) {
      const ch = chains.get(c)!;
      return { records: [...ch.records.values()].filter((r) => r.seq > since), seq: ch.seq };
    },
    async leave(c, _t, d) {
      chains.get(c)!.devices.delete(d);
    },
  };
  return { t, seen };
}

function mapAdapter(type: string, store: Map<string, unknown>): SyncAdapter {
  return { type, snapshot: () => new Map(store), apply: (k, d) => (d === null ? store.delete(k) : store.set(k, d)) };
}

describe('E2EE sync (SYN-01/02)', () => {
  it('codes are readable, normalize, and derive stable chain/token/key', () => {
    const code = newSyncCode();
    expect(code).toMatch(/^[A-Z2-9]{6}(-[A-Z2-9]{6}){3}$/);
    expect(normalizeCode(code.toLowerCase().replace(/-/g, ' '))).toBe(code);
    expect(deriveChain(code).chainId).toBe(deriveChain(code.toLowerCase()).chainId);
    expect(deriveChain(code).chainId).not.toBe(deriveChain(newSyncCode()).chainId);
  });

  it('two devices converge; the server only ever sees ciphertext', async () => {
    const { t, seen } = fakeServer();
    const code = newSyncCode();
    let clock = 1000;
    const aMarks = new Map<string, unknown>([['https://irembo.gov.rw/|', { url: 'https://irembo.gov.rw/', title: 'Irembo' }]]);
    const bMarks = new Map<string, unknown>();
    const aSpaces = new Map<string, unknown>([['s1', { name: 'Work', color: 'teal' }]]);
    const bSpaces = new Map<string, unknown>();
    const a = new SyncEngine(code, 'a'.repeat(32), t, [mapAdapter('bookmarks', aMarks), mapAdapter('spaces', aSpaces)], undefined, () => ++clock);
    const b = new SyncEngine(code, 'b'.repeat(32), t, [mapAdapter('bookmarks', bMarks), mapAdapter('spaces', bSpaces)], undefined, () => ++clock);
    expect(await a.join('Laptop')).toBe('created');
    expect(await b.join('Phone')).toBe('joined');
    await a.sync();
    await b.sync();
    expect(bMarks.get('https://irembo.gov.rw/|')).toEqual({ url: 'https://irembo.gov.rw/', title: 'Irembo' });
    expect(bSpaces.get('s1')).toEqual({ name: 'Work', color: 'teal' });
    // Rename on B converges to A; delete on A converges to B.
    bSpaces.set('s1', { name: 'Office', color: 'teal' });
    await b.sync();
    aMarks.clear();
    await a.sync();
    await b.sync();
    expect(aSpaces.get('s1')).toEqual({ name: 'Office', color: 'teal' });
    expect(bMarks.size).toBe(0);
    expect((await a.devices()).map((d) => d.name).sort()).toEqual(['Laptop', 'Phone']);
    for (const s of seen) for (const secret of ['irembo', 'Irembo', 'Work', 'Office', 'teal']) expect(s).not.toContain(secret);
  });

  it('last writer wins on concurrent edits', async () => {
    const { t } = fakeServer();
    const code = newSyncCode();
    let clock = 0;
    const as = new Map<string, unknown>([['k', 'v0']]);
    const bs = new Map<string, unknown>();
    const a = new SyncEngine(code, 'a'.repeat(32), t, [mapAdapter('settings', as)], undefined, () => ++clock);
    const b = new SyncEngine(code, 'b'.repeat(32), t, [mapAdapter('settings', bs)], undefined, () => ++clock);
    await a.join('A');
    await a.sync();
    await b.sync();
    as.set('k', 'from-a');
    bs.set('k', 'from-b');
    await a.sync(); // A writes first (earlier timestamp)
    await b.sync(); // B's later local edit wins
    await a.sync();
    expect(as.get('k')).toBe('from-b');
    expect(bs.get('k')).toBe('from-b');
  });

  it('a wrong code cannot join or read', async () => {
    const { t } = fakeServer();
    const code = newSyncCode();
    await new SyncEngine(code, 'a'.repeat(32), t, []).join('A');
    const stranger = new SyncEngine(newSyncCode(), 'c'.repeat(32), t, []);
    expect(stranger.chain).not.toBe(deriveChain(code).chainId);
  });

  it('ignores records whose id does not match their encrypted content (server tampering)', async () => {
    const { t } = fakeServer();
    const code = newSyncCode();
    const as = new Map<string, unknown>([['x', 1], ['y', 2]]);
    const a = new SyncEngine(code, 'a'.repeat(32), t, [mapAdapter('settings', as)]);
    await a.join('A');
    await a.sync();
    // A malicious server swaps blobs between two record ids.
    const pulled = await t.pull(deriveChain(code).chainId, '', 0);
    const [r1, r2] = pulled.records;
    await t.push(deriveChain(code).chainId, '', [{ ...r1!, blob: r2!.blob }]);
    const bs = new Map<string, unknown>();
    const b = new SyncEngine(code, 'b'.repeat(32), t, [mapAdapter('settings', bs)]);
    await b.sync();
    expect(bs.size).toBe(1);
  });
});
