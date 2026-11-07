// KeyProvider backed by the OS keychain through Electron safeStorage
// (Keychain on macOS, DPAPI on Windows, libsecret on Linux). The wrapped key
// file is useless without the OS credential, so a copied profile is unreadable
// on another device (P4-SEC-02 done-when).
import { randomBytes } from 'node:crypto';
import { existsSync, readFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import type { KeyProvider } from './crypto_box';
import { writeJsonAtomic } from './json_store';

export interface SafeStorageLike {
  isEncryptionAvailable(): boolean;
  encryptString(plain: string): Buffer;
  decryptString(enc: Buffer): string;
}

export class KeychainKeyProvider implements KeyProvider {
  private readonly cache = new Map<string, Buffer>();

  constructor(private readonly dir: string, private readonly safe: SafeStorageLike) {}

  get available(): boolean {
    return this.safe.isEncryptionAvailable();
  }

  getOrCreateKey(name: string): Buffer {
    const cached = this.cache.get(name);
    if (cached) return cached;
    const file = this.file(name);
    let key: Buffer;
    if (existsSync(file)) {
      const { wrapped } = JSON.parse(readFileSync(file, 'utf8')) as { wrapped: string };
      key = Buffer.from(this.safe.decryptString(Buffer.from(wrapped, 'base64')), 'base64');
    } else {
      key = randomBytes(32);
      writeJsonAtomic(file, { v: 1, wrapped: this.safe.encryptString(key.toString('base64')).toString('base64') });
    }
    this.cache.set(name, key);
    return key;
  }

  deleteKey(name: string): void {
    this.cache.delete(name);
    rmSync(this.file(name), { force: true });
  }

  private file(name: string): string {
    if (!/^[a-z0-9_-]+$/.test(name)) throw new Error('bad key name');
    return join(this.dir, `${name}.key`);
  }
}
