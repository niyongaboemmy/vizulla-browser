import { createHash, generateKeyPairSync, sign } from 'node:crypto';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { deviceProfile, ModelManager, signManifest, verifyManifest, type Manifest } from './model_manager';
import { classifyIntent } from '@vz/components/ai_runtime/intent';

const { privateKey, publicKey } = generateKeyPairSync('ed25519');
const pub = publicKey.export({ type: 'spki', format: 'pem' }).toString();
const weights = Buffer.from('fake model weights '.repeat(1000));
const entry = { id: 'vz-gen-3b-q4', kind: 'generate' as const, engine: 'llama.cpp', url: 'https://models.example/vz.bin', sha256: createHash('sha256').update(weights).digest('hex'), size_bytes: weights.length, min_profile: 'RD-3', license: 'Apache-2.0', languages: ['en', 'fr'] };
const manifest: Manifest = { manifest_version: 3, models: [entry] };
const signed = signManifest(manifest, (d) => sign(null, d, privateKey));
const serve = (body: Buffer) => (async () => new Response(new Uint8Array(body))) as unknown as typeof fetch;

describe('model manager (P4-AI-02)', () => {
  it('accepts a signed manifest; rejects tampering, unknown keys, rollback', () => {
    expect(verifyManifest(signed, [pub]).models[0]!.id).toBe('vz-gen-3b-q4');
    expect(() => verifyManifest({ ...signed, manifest: { ...manifest, models: [{ ...entry, url: 'https://evil.example/x' }] } }, [pub])).toThrow(/signature/);
    const other = generateKeyPairSync('ed25519').publicKey.export({ type: 'spki', format: 'pem' }).toString();
    expect(() => verifyManifest(signed, [other])).toThrow(/signature/);
    expect(() => verifyManifest(signed, [pub], 4)).toThrow(/rollback/);
  });
  it('installs a model whose hash matches and rejects a tampered download', async () => {
    const mm = new ModelManager(mkdtempSync(join(tmpdir(), 'vz-models-')));
    const tampered = Buffer.from(weights);
    tampered[10] = 0;
    await expect(mm.install(entry, serve(tampered))).rejects.toThrow(/hash mismatch/);
    expect(mm.installed()).toHaveLength(0);
    const rec = await mm.install(entry, serve(weights));
    expect(rec.sha256).toBe(entry.sha256);
    expect(mm.installed()).toHaveLength(1);
    await expect(mm.install(entry, serve(weights), { metered: true })).rejects.toThrow(/metered/);
  });
  it('flags models unused for 90 days', async () => {
    let now = 1_800_000_000_000;
    const mm = new ModelManager(mkdtempSync(join(tmpdir(), 'vz-models-')), () => now);
    await mm.install(entry, serve(weights));
    now += 91 * 86_400_000;
    expect(mm.stale().map((r) => r.id)).toEqual(['vz-gen-3b-q4']);
    mm.markUsed('vz-gen-3b-q4');
    expect(mm.stale()).toHaveLength(0);
  });
});

describe('device profile (P4-AI-03)', () => {
  it('tiers devices', () => {
    expect(deviceProfile({ totalMemBytes: 16 * 2 ** 30, cpus: 10, arch: 'arm64', gpu: 'Apple M2 Pro' }).tier).toBe('RD-3');
    expect(deviceProfile({ totalMemBytes: 8 * 2 ** 30, cpus: 4, arch: 'x64' })).toMatchObject({ tier: 'RD-2', localGenerative: false, localSmallTasks: true });
    expect(deviceProfile({ totalMemBytes: 2 * 2 ** 30, cpus: 2, arch: 'x64' }).localSmallTasks).toBe(false);
  });
});

describe('intent classifier (P4-AI-12)', () => {
  const top = (q: string) => classifyIntent(q)[0]!.label;
  it.each([
    ['what does the pro plan include?', 'ask'],
    ['mute this tab', 'command'],
    ['move this tab to my work space', 'command'],
    ['the laptop review I read yesterday', 'recall'],
    ['book a table for two on friday', 'agent'],
    ['kigali weather', 'search'],
  ])('%s → %s', (q, label) => expect(top(q)).toBe(label));
  it('is fast (≤ 30 ms p95 budget, well under)', () => {
    const t = performance.now();
    for (let i = 0; i < 1000; i++) classifyIntent('compare the laptops I looked at yesterday');
    expect((performance.now() - t) / 1000).toBeLessThan(1);
  });
});
