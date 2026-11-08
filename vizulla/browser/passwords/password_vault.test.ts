import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { MemoryKeyProvider, CryptoBox, deriveKey } from '../storage/crypto_box';
import { generatePassword, isBreached, isWeak, PasswordVault } from './password_vault';

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

  it('edits a login, flags weak and reused passwords, and exports CSV', () => {
    const v = new PasswordVault(':memory:', new MemoryKeyProvider());
    const a = v.add('https://a.com', 'alice', 'Correct-Horse-9');
    const b = v.add('https://b.com', 'bob', 'Correct-Horse-9');
    const c = v.add('https://c.com', 'carol', 'qwerty');
    expect(v.health().get(a)).toEqual({ weak: false, reused: true });
    expect(v.health().get(c)).toEqual({ weak: true, reused: false });
    expect(v.update(b, { password: 'Another-Long-One-7', note: 'work, "main"' })).toBe(true);
    expect(v.health().get(a)!.reused).toBe(false);
    expect(v.reveal(b)).toMatchObject({ username: 'bob', password: 'Another-Long-One-7', note: 'work, "main"' });
    const csv = v.exportCsv().split('\n');
    expect(csv[0]).toBe('name,url,username,password,note');
    expect(csv).toContain('b.com,https://b.com,bob,Another-Long-One-7,"work, ""main"""');
    expect(v.update(999, { password: 'x' })).toBe(false);
  });

  it('generates strong passwords and rates weak ones', () => {
    for (let i = 0; i < 50; i++) {
      const pw = generatePassword();
      expect(pw).toHaveLength(18);
      expect(isWeak(pw)).toBe(false);
      expect(pw).not.toMatch(/[lO01]/);
    }
    expect(new Set(Array.from({ length: 20 }, () => generatePassword())).size).toBe(20);
    expect(['short', 'password1', 'lowercaseonly', 'abcdefgh12'].map(isWeak)).toEqual([true, true, true, true]);
    expect(['Tr0ub4dor&3x', 'a very long passphrase indeed'].map(isWeak)).toEqual([false, false]);
  });
});
