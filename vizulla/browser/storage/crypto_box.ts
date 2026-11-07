// Authenticated encryption for data at rest (doc 06 §7, DD-9).
// AES-256-GCM with a random 96-bit nonce per record. The key never leaves the
// browser process; it is held in the OS keychain through a KeyProvider.
import { createCipheriv, createDecipheriv, randomBytes, scryptSync } from 'node:crypto';

export interface KeyProvider {
  /** Returns the 32-byte key for `name`, creating and storing it on first use. */
  getOrCreateKey(name: string): Buffer;
  /** Destroys the key: everything encrypted under it becomes unreadable (crypto-shredding). */
  deleteKey(name: string): void;
}

const VERSION = 1;

export class CryptoBox {
  constructor(private readonly key: Buffer) {
    if (key.length !== 32) throw new Error('CryptoBox needs a 32-byte key');
  }

  seal(plaintext: Buffer | string, aad = ''): Buffer {
    const iv = randomBytes(12);
    const c = createCipheriv('aes-256-gcm', this.key, iv);
    c.setAAD(Buffer.from(aad));
    const body = Buffer.concat([c.update(typeof plaintext === 'string' ? Buffer.from(plaintext) : plaintext), c.final()]);
    return Buffer.concat([Buffer.from([VERSION]), iv, c.getAuthTag(), body]);
  }

  open(sealed: Buffer | Uint8Array, aad = ''): Buffer {
    const buf = Buffer.from(sealed);
    if (buf.length < 29 || buf[0] !== VERSION) throw new Error('bad sealed record');
    const d = createDecipheriv('aes-256-gcm', this.key, buf.subarray(1, 13));
    d.setAAD(Buffer.from(aad));
    d.setAuthTag(buf.subarray(13, 29));
    return Buffer.concat([d.update(buf.subarray(29)), d.final()]);
  }

  sealString(s: string, aad = ''): string {
    return this.seal(s, aad).toString('base64');
  }

  openString(s: string, aad = ''): string {
    return this.open(Buffer.from(s, 'base64'), aad).toString('utf8');
  }
}

/** Derive a key from a human secret (sync codes, SYN-02). scrypt with N=2^15. */
export function deriveKey(secret: string, salt: string): Buffer {
  return scryptSync(secret.normalize('NFKC'), `vizulla:${salt}`, 32, { N: 1 << 15, r: 8, p: 1, maxmem: 64 * 1024 * 1024 });
}

/** In-memory key provider for tests and for private sessions. */
export class MemoryKeyProvider implements KeyProvider {
  private readonly keys = new Map<string, Buffer>();
  getOrCreateKey(name: string): Buffer {
    let k = this.keys.get(name);
    if (!k) this.keys.set(name, (k = randomBytes(32)));
    return k;
  }
  deleteKey(name: string): void {
    this.keys.delete(name);
  }
}
