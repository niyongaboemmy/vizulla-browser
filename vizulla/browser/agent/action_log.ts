// Action Log (P5-BRW-05, AGT-08, C15): every observation summary, tool call,
// enforcer verdict, confirmation, and reasoning summary. 30-day TTL.
import { Database } from '../storage/database';

const MIGRATIONS = [
  `CREATE TABLE log (id INTEGER PRIMARY KEY, task_id TEXT NOT NULL, at INTEGER NOT NULL, kind TEXT NOT NULL,
     summary TEXT NOT NULL, verdict TEXT, origin TEXT, step INTEGER);
   CREATE INDEX log_task ON log(task_id, at);
   CREATE TABLE tasks (id TEXT PRIMARY KEY, goal TEXT NOT NULL, started_at INTEGER NOT NULL, ended_at INTEGER, status TEXT NOT NULL, session TEXT NOT NULL);`,
];

export type LogKind = 'plan' | 'approval' | 'observe' | 'call' | 'verdict' | 'confirm' | 'result' | 'detector' | 'egress' | 'error' | 'user';

export class ActionLog {
  private readonly db: Database;
  constructor(path: string, private readonly now: () => number = Date.now) {
    this.db = new Database(path, MIGRATIONS);
  }
  startTask(id: string, goal: string, session: string): void {
    this.db.run('INSERT OR REPLACE INTO tasks (id, goal, started_at, status, session) VALUES (?, ?, ?, ?, ?)', id, goal.slice(0, 500), this.now(), 'running', session);
  }
  endTask(id: string, status: string): void {
    this.db.run('UPDATE tasks SET ended_at = ?, status = ? WHERE id = ?', this.now(), status, id);
  }
  add(taskId: string, kind: LogKind, summary: string, extra: { verdict?: string; origin?: string; step?: number } = {}): void {
    this.db.run('INSERT INTO log (task_id, at, kind, summary, verdict, origin, step) VALUES (?, ?, ?, ?, ?, ?, ?)', taskId, this.now(), kind, summary.slice(0, 1000), extra.verdict ?? null, extra.origin ?? null, extra.step ?? null);
  }
  tasks(limit = 50) {
    return this.db.all<Record<string, unknown>>('SELECT * FROM tasks ORDER BY started_at DESC LIMIT ?', limit).map((r) => ({ id: String(r.id), goal: String(r.goal), startedAt: Number(r.started_at), endedAt: r.ended_at ? Number(r.ended_at) : null, status: String(r.status), session: String(r.session) }));
  }
  entries(taskId: string) {
    return this.db.all<Record<string, unknown>>('SELECT * FROM log WHERE task_id = ? ORDER BY id', taskId).map((r) => ({ at: Number(r.at), kind: String(r.kind), summary: String(r.summary), verdict: (r.verdict as string) ?? null, origin: (r.origin as string) ?? null, step: r.step === null ? null : Number(r.step) }));
  }
  purge(days = 30): void {
    const cutoff = this.now() - days * 86_400_000;
    this.db.run('DELETE FROM log WHERE at < ?', cutoff);
    this.db.run('DELETE FROM tasks WHERE started_at < ?', cutoff);
  }
  clear(): void {
    this.db.run('DELETE FROM log');
    this.db.run('DELETE FROM tasks');
  }
  close(): void {
    this.db.close();
  }
}
