// Privacy Dashboard data (P2-BRW-18, PRV-05/06): blocked counts by day/site/category
// and one row per AI request with what was sent (origin, size), where it was
// processed, and by which provider. Never the content itself. 30-day retention.
import { Database } from '../storage/database';

const MIGRATIONS = [
  `CREATE TABLE blocked (day TEXT NOT NULL, site TEXT NOT NULL, category TEXT NOT NULL, n INTEGER NOT NULL,
     PRIMARY KEY (day, site, category));
   CREATE TABLE ai_requests (
     id INTEGER PRIMARY KEY, at INTEGER NOT NULL, feature TEXT NOT NULL, origins TEXT NOT NULL,
     bytes_sent INTEGER NOT NULL, location TEXT NOT NULL, provider TEXT NOT NULL, model TEXT NOT NULL,
     route_reason TEXT NOT NULL, ok INTEGER NOT NULL);
   CREATE INDEX ai_at ON ai_requests(at DESC);`,
];

export interface AiRequestRecord {
  at: number;
  feature: string;
  origins: string[];
  bytesSent: number;
  location: 'on-device' | 'cloud';
  provider: string;
  model: string;
  routeReason: string;
  ok: boolean;
}

export class PrivacyLog {
  private readonly db: Database;
  private pending = new Map<string, number>();
  private flushTimer: NodeJS.Timeout | null = null;

  constructor(path: string, private readonly now: () => number = Date.now) {
    this.db = new Database(path, MIGRATIONS);
  }

  /** Called on the request path: buffered in memory, flushed every few seconds. */
  recordBlocked(site: string, category: string): void {
    const key = `${this.day()}|${site}|${category}`;
    this.pending.set(key, (this.pending.get(key) ?? 0) + 1);
    if (!this.flushTimer) {
      this.flushTimer = setTimeout(() => this.flush(), 5000);
      this.flushTimer.unref?.();
    }
  }

  flush(): void {
    if (this.flushTimer) clearTimeout(this.flushTimer);
    this.flushTimer = null;
    if (!this.pending.size) return;
    const batch = this.pending;
    this.pending = new Map();
    this.db.transaction(() => {
      for (const [key, n] of batch) {
        const [day, site, category] = key.split('|') as [string, string, string];
        this.db.run('INSERT INTO blocked (day, site, category, n) VALUES (?, ?, ?, ?) ON CONFLICT(day, site, category) DO UPDATE SET n = n + excluded.n', day, site, category, n);
      }
    });
  }

  recordAi(r: AiRequestRecord): void {
    this.db.run(
      'INSERT INTO ai_requests (at, feature, origins, bytes_sent, location, provider, model, route_reason, ok) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)',
      r.at, r.feature, JSON.stringify(r.origins), r.bytesSent, r.location, r.provider, r.model, r.routeReason, r.ok ? 1 : 0,
    );
  }

  summary(days = 30) {
    this.flush();
    const since = this.day(this.now() - days * 86_400_000);
    const byCategory = this.db.all<{ category: string; n: number }>('SELECT category, SUM(n) AS n FROM blocked WHERE day >= ? GROUP BY category', since);
    const bySite = this.db.all<{ site: string; n: number }>('SELECT site, SUM(n) AS n FROM blocked WHERE day >= ? GROUP BY site ORDER BY n DESC LIMIT 20', since);
    const byDay = this.db.all<{ day: string; n: number }>('SELECT day, SUM(n) AS n FROM blocked WHERE day >= ? GROUP BY day ORDER BY day', since);
    const ai = this.db
      .all<Record<string, unknown>>('SELECT * FROM ai_requests WHERE at >= ? ORDER BY at DESC LIMIT 500', this.now() - days * 86_400_000)
      .map((r) => ({
        at: Number(r.at), feature: String(r.feature), origins: JSON.parse(String(r.origins)) as string[], bytesSent: Number(r.bytes_sent),
        location: String(r.location), provider: String(r.provider), model: String(r.model), routeReason: String(r.route_reason), ok: r.ok === 1,
      }));
    return {
      blocked: {
        total: byCategory.reduce((s, r) => s + Number(r.n), 0),
        byCategory: Object.fromEntries(byCategory.map((r) => [r.category, Number(r.n)])),
        bySite: bySite.map((r) => ({ site: r.site, n: Number(r.n) })),
        byDay: byDay.map((r) => ({ day: r.day, n: Number(r.n) })),
      },
      ai,
      aiCloudCount: ai.filter((a) => a.location === 'cloud').length,
      aiLocalCount: ai.filter((a) => a.location === 'on-device').length,
    };
  }

  purge(retentionDays: number): void {
    this.flush();
    this.db.run('DELETE FROM blocked WHERE day < ?', this.day(this.now() - retentionDays * 86_400_000));
    this.db.run('DELETE FROM ai_requests WHERE at < ?', this.now() - retentionDays * 86_400_000);
  }

  clearAll(): void {
    this.pending.clear();
    this.db.run('DELETE FROM blocked');
    this.db.run('DELETE FROM ai_requests');
  }

  close(): void {
    this.flush();
    this.db.close();
  }

  private day(t = this.now()): string {
    return new Date(t).toISOString().slice(0, 10);
  }
}
