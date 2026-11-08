// Password vault (ID-01): usernames and passwords encrypted at rest with a key
// held by the OS keychain (doc 05 §5). Secrets never cross IPC to renderers except
// the one value the user explicitly reveals or fills (C8).
// Breach check (P1-SEC-02): k-anonymity: only the first 5 hex chars of SHA-1 leave the device.
import { createHash, randomInt } from 'node:crypto';
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
  reveal(id: number): { origin: string; username: string; password: string; note: string } | null {
    const r = this.db.get<Record<string, unknown>>('SELECT * FROM logins WHERE id = ?', id);
    if (!r) return null;
    const origin = String(r.origin);
    return {
      origin,
      username: this.box.openString(String(r.username_enc), origin),
      password: this.box.openString(String(r.password_enc), origin),
      note: this.box.openString(String(r.note_enc), origin),
    };
  }

  update(id: number, patch: { username?: string; password?: string; note?: string }): boolean {
    const cur = this.reveal(id);
    if (!cur) return false;
    const next = { ...cur, ...patch };
    this.db.run(
      'UPDATE logins SET username_enc = ?, password_enc = ?, note_enc = ?, updated_at = ?, breached = CASE WHEN ? THEN NULL ELSE breached END WHERE id = ?',
      this.box.sealString(next.username, cur.origin), this.box.sealString(next.password, cur.origin), this.box.sealString(next.note, cur.origin),
      this.now(), next.password !== cur.password ? 1 : 0, id,
    );
    return true;
  }

  /** Weak and reused flags per login, computed here so passwords never leave the process. */
  health(): Map<number, { weak: boolean; reused: boolean }> {
    const secrets = this.list().map((l) => ({ id: l.id, pw: this.reveal(l.id)?.password ?? '' }));
    const counts = new Map<string, number>();
    for (const s of secrets) counts.set(s.pw, (counts.get(s.pw) ?? 0) + 1);
    return new Map(secrets.map((s) => [s.id, { weak: isWeak(s.pw), reused: (counts.get(s.pw) ?? 0) > 1 }]));
  }

  /** Chrome-compatible CSV (name,url,username,password,note). Only after the user confirms. */
  exportCsv(): string {
    const q = (v: string) => (/[",\n\r]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v);
    const rows = this.list().map((l) => {
      const s = this.reveal(l.id)!;
      return [new URL(s.origin).hostname, s.origin, s.username, s.password, s.note].map(q).join(',');
    });
    return ['name,url,username,password,note', ...rows].join('\n') + '\n';
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

const COMMON = new Set(['password', '123456', '12345678', '123456789', 'qwerty', 'azerty', 'abc123', 'letmein', 'welcome', 'admin', 'iloveyou', 'password1', '111111', '000000', 'monkey', 'dragon']);

/** A password is weak when short, very common, or built from one kind of character. */
export function isWeak(pw: string): boolean {
  if (pw.length < 8 || COMMON.has(pw.toLowerCase())) return true;
  const classes = [/[a-z]/, /[A-Z]/, /\d/, /[^A-Za-z0-9]/].filter((r) => r.test(pw)).length;
  if (pw.length >= 16) return classes < 1;
  return classes < (pw.length >= 12 ? 2 : 3);
}

const GEN_SETS = ['abcdefghijkmnopqrstuvwxyz', 'ABCDEFGHJKLMNPQRSTUVWXYZ', '23456789', '-_.!@#'];

/** A strong random password with every character class, no look-alike characters (l/1, O/0). */
export function generatePassword(length = 18): string {
  const all = GEN_SETS.join('');
  const out = GEN_SETS.map((set) => set[randomInt(set.length)]!);
  while (out.length < length) out.push(all[randomInt(all.length)]!);
  for (let i = out.length - 1; i > 0; i--) {
    const j = randomInt(i + 1);
    [out[i], out[j]] = [out[j]!, out[i]!];
  }
  return out.join('');
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
