// API keys for BYO providers (AI-03, SEC-05): encrypted at rest with a keychain-held
// key, readable only in the browser process. WebUI only ever learns hasKey().
import { CryptoBox, type KeyProvider } from '../storage/crypto_box';
import { readJson, writeJsonAtomic } from '../storage/json_store';

export class ProviderKeys {
  private readonly box: CryptoBox;
  private data: Record<string, string>;

  constructor(private readonly path: string | null, keys: KeyProvider) {
    this.box = new CryptoBox(keys.getOrCreateKey('provider-keys'));
    this.data = path ? readJson(path, {}) : {};
  }

  hasKey(id: string): boolean {
    return !!this.data[id];
  }

  get(id: string): string | null {
    const v = this.data[id];
    if (!v) return null;
    try {
      return this.box.openString(v, id);
    } catch {
      return null;
    }
  }

  set(id: string, key: string): void {
    if (key) this.data[id] = this.box.sealString(key.trim(), id);
    else delete this.data[id];
    if (this.path) writeJsonAtomic(this.path, this.data);
  }
}
