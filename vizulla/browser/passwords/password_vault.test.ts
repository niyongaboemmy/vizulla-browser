import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { MemoryKeyProvider, CryptoBox, deriveKey } from '../storage/crypto_box';
import { isBreached, PasswordVault } from './password_vault';

describe('PasswordVault (ID-01, C8)', () => {
  it('encrypts at rest and only reveals on request', () => {
    const keys = new MemoryKeyProvider();
    const v = new PasswordVault(':memory:', keys);
    const id = v.add('https://a.com', 'alice', 'hunter2');
    const raw = (v as unknown as { db: { all(s: string): Record<string, string>[] } }).db.all('SELECT * FROM logins')[0]!;
    expect(JSON.stringify(raw)).not.toContain('hunter2');
    expect(JSON.stringify(raw)).not.toContain('alice');
    expect(v.list()).toEqual([expect.objectContaining({ origin: 'https://a.com', username: 'alice' })]);
    expect(JSON.stringify(v.list())).not.toContain('hunter2');
    expect(v.reveal(id)!.password).toBe('hunter2');
    expect(v.add('https://a.com', 'alice', 'new')).toBe(id);
    expect(v.reveal(id)!.password).toBe('new');
  });

  it('a ciphertext moved to another origin does not decrypt (AAD binding)', () => {
    const box = new CryptoBox(Buffer.alloc(32, 7));
    const sealed = box.sealString('secret', 'https://a.com');
    expect(() => box.openString(sealed, 'https://evil.com')).toThrow();
    expect(box.openString(sealed, 'https://a.com')).toBe('secret');
  });

  it('breach check sends only a 5-char SHA-1 prefix (P1-SEC-02)', async () => {
    const sent: string[] = [];
    const sha = createHash('sha1').update('password123').digest('hex').toUpperCase();
    const range = async (prefix: string) => {
      sent.push(prefix);
      return `0000000000000000000000000000000000A:3\r\n${sha.slice(5)}:24000\r\n`;
    };
    expect(await isBreached('password123', range)).toBe(true);
    expect(await isBreached('correct horse battery staple', async () => '')).toBe(false);
    expect(sent).toEqual([sha.slice(0, 5)]);
    expect(sent[0]).toHaveLength(5);
  });

  it('derives stable keys from sync codes', () => {
    expect(deriveKey('ABCD-EFGH', 'chain1').equals(deriveKey('ABCD-EFGH', 'chain1'))).toBe(true);
    expect(deriveKey('ABCD-EFGH', 'chain1').equals(deriveKey('ABCD-EFGH', 'chain2'))).toBe(false);
  });
});
