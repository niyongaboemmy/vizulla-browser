import { generateKeyPairSync } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { signBlob, verifyBlob } from './list_signature';
import { ShieldsEngine } from './shields_engine';

const baseline = readFileSync(join(__dirname, '../../app/resources/shields/baseline.txt'), 'utf8');

describe('ShieldsEngine (P1-BRW-02)', () => {
  const engine = ShieldsEngine.fromLists([baseline, '||ads.example.org^\nexample.org##.promo-box\n@@||ads.example.org/allowed.js']);

  it('blocks ad and tracker requests, labels categories', () => {
    expect(engine.check('https://securepubads.g.doubleclick.net/tag/js/gpt.js', 'https://news.site/', 'script')).toMatchObject({ block: true, category: 'ads' });
    expect(engine.check('https://www.google-analytics.com/analytics.js', 'https://news.site/', 'script')).toMatchObject({ block: true, category: 'trackers' });
    expect(engine.check('https://news.site/app.js', 'https://news.site/', 'script').block).toBe(false);
  });

  it('honors exception rules and $third-party', () => {
    expect(engine.check('https://ads.example.org/x.js', 'https://a.com/', 'script').block).toBe(true);
    expect(engine.check('https://ads.example.org/allowed.js', 'https://a.com/', 'script').block).toBe(false);
    // First-party use of a $third-party-only rule is allowed.
    expect(engine.check('https://cdn.segment.com/analytics.js', 'https://segment.com/', 'script').block).toBe(false);
  });

  it('ignores non-http(s) requests', () => {
    expect(engine.check('vizulla://settings', '', 'mainFrame').block).toBe(false);
    expect(engine.check('data:text/plain,hi', '', 'image').block).toBe(false);
  });

  it('returns site-specific and generic cosmetic CSS', () => {
    const css = engine.cosmetic('https://example.org/page').css;
    expect(css).toContain('.promo-box');
    expect(css).toContain('display: none');
  });

  it('round-trips through serialization', () => {
    const copy = ShieldsEngine.deserialize(engine.serialize());
    expect(copy.check('https://doubleclick.net/x', 'https://a.com/', 'image').block).toBe(true);
  });

  it('check() median stays under 0.1 ms', () => {
    const urls = ['https://cdn.site/app.js', 'https://doubleclick.net/a', 'https://img.site/x.png', 'https://www.google-analytics.com/collect'];
    const t: number[] = [];
    for (let i = 0; i < 4000; i++) {
      const s = performance.now();
      engine.check(urls[i % 4]!, 'https://site.com/', 'image');
      t.push(performance.now() - s);
    }
    t.sort((a, b) => a - b);
    expect(t[t.length >> 1]!).toBeLessThan(0.1);
  });
});

describe('signed list blobs (P1-CLD-03)', () => {
  const { privateKey, publicKey } = generateKeyPairSync('ed25519');
  const priv = privateKey.export({ type: 'pkcs8', format: 'pem' }).toString();
  const pub = publicKey.export({ type: 'spki', format: 'pem' }).toString();
  const other = generateKeyPairSync('ed25519').publicKey.export({ type: 'spki', format: 'pem' }).toString();
  const blob = ShieldsEngine.fromLists([baseline]).serialize();
  const manifest = signBlob(blob, 7, priv);

  it('accepts a correctly signed blob', () => expect(verifyBlob(blob, manifest, [other, pub])).toEqual({ ok: true }));
  it('rejects a tampered blob', () => {
    const bad = Uint8Array.from(blob);
    bad[100] = bad[100]! ^ 0xff;
    expect(verifyBlob(bad, manifest, [pub])).toEqual({ ok: false, reason: 'hash-mismatch' });
  });
  it('rejects an unknown signer', () => expect(verifyBlob(blob, manifest, [other])).toEqual({ ok: false, reason: 'bad-signature' }));
  it('rejects a tampered manifest', () => expect(verifyBlob(blob, { ...manifest, version: 8 }, [pub]).ok).toBe(false));
  it('rejects rollback to an older version', () => expect(verifyBlob(blob, manifest, [pub], 9)).toEqual({ ok: false, reason: 'rollback' }));
});
