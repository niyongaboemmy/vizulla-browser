// Password vault (ID-01): usernames and passwords encrypted at rest with a key
// held by the OS keychain (doc 05 §5). Secrets never cross IPC to renderers except
// the one value the user explicitly reveals or fills (C8).
// Breach check (P1-SEC-02): k-anonymity: only the first 5 hex chars of SHA-1 leave the device.
import { createHash } from 'node:crypto';
import { Database } from '../storage/database';
import { CryptoBox, type KeyProvider } from '../storage/crypto_box';

const MIGRATIONS = [
  `CREATE TABLE logins (
     id INTEGER PRIMARY KEY, origin TEXT NOT NULL, username_enc TEXT NOT NULL, password_enc TEXT NOT NULL,
     note_enc TEXT NOT NULL DEFAULT '', created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL,
     breached INTEGER, checked_at INTEGER);
   CREATE INDEX logins_origin ON logins(origin);`,
];

export interface LoginSummary {
  id: number;
  origin: string;
  username: string;
  breached: boolean | null;
  updatedAt: number;
}

export class PasswordVault {
  private readonly db: Database;
  private readonly box: CryptoBox;

  constructor(path: string, keys: KeyProvider, private readonly now: () => number = Date.now) {
    this.db = new Database(path, MIGRATIONS);
    this.box = new CryptoBox(keys.getOrCreateKey('vault'));
  }

  add(origin: string, username: string, password: string, note = ''): number {
    const existing = this.list(origin).find((l) => l.username === username);
    const t = this.now();
    if (existing) {
      this.db.run('UPDATE logins SET password_enc = ?, updated_at = ?, breached = NULL WHERE id = ?', this.box.sealString(password, origin), t, existing.id);
      return existing.id;
    }
    return this.db.run(
      'INSERT INTO logins (origin, username_enc, password_enc, note_enc, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)',
      origin, this.box.sealString(username, origin), this.box.sealString(password, origin), this.box.sealString(note, origin), t, t,
    ).lastInsertRowid;
  }

  list(origin?: string): LoginSummary[] {
    const rows = origin
      ? this.db.all<Record<string, unknown>>('SELECT * FROM logins WHERE origin = ? ORDER BY updated_at DESC', origin)
      : this.db.all<Record<string, unknown>>('SELECT * FROM logins ORDER BY origin, updated_at DESC');
    return rows.map((r) => ({
      id: Number(r.id),
      origin: String(r.origin),
      username: this.box.openString(String(r.username_enc), String(r.origin)),
      breached: r.breached === null || r.breached === undefined ? null : r.breached === 1,
      updatedAt: Number(r.updated_at),
    }));
  }

  /** The only way a password leaves the vault: an explicit reveal, copy, or fill. */
  reveal(id: number): { origin: string; username: string; password: string } | null {
    const r = this.db.get<Record<string, unknown>>('SELECT * FROM logins WHERE id = ?', id);
    if (!r) return null;
    const origin = String(r.origin);
    return { origin, username: this.box.openString(String(r.username_enc), origin), password: this.box.openString(String(r.password_enc), origin) };
  }

  remove(id: number): void {
    this.db.run('DELETE FROM logins WHERE id = ?', id);
  }

  count(): number {
    return Number(this.db.get<{ n: number }>('SELECT COUNT(*) AS n FROM logins')?.n ?? 0);
  }

  /** Checks every login against a k-anonymity range API. Returns the number found breached. */
  async checkBreaches(rangeFetch: (prefix: string) => Promise<string>): Promise<number> {
    let breached = 0;
    const cache = new Map<string, string>();
    for (const l of this.list()) {
      const secret = this.reveal(l.id);
      if (!secret) continue;
      const hit = await isBreached(secret.password, rangeFetch, cache);
      if (hit) breached++;
      this.db.run('UPDATE logins SET breached = ?, checked_at = ? WHERE id = ?', hit ? 1 : 0, this.now(), l.id);
    }
    return breached;
  }

  close(): void {
    this.db.close();
  }
}

export async function isBreached(password: string, rangeFetch: (prefix: string) => Promise<string>, cache = new Map<string, string>()): Promise<boolean> {
  const sha1 = createHash('sha1').update(password).digest('hex').toUpperCase();
  const prefix = sha1.slice(0, 5);
  const suffix = sha1.slice(5);
  let body = cache.get(prefix);
  if (body === undefined) {
    body = await rangeFetch(prefix);
    cache.set(prefix, body);
  }
  return body.split(/\r?\n/).some((line) => line.split(':')[0]?.trim().toUpperCase() === suffix && Number(line.split(':')[1] ?? 1) > 0);
}
