// Host for a utility-process service (the ServiceProcessHost role, handbook §5):
//  - lazy start on the first request (principle 3)
//  - unload after an idle period or on memory pressure (AI-08)
//  - restart after a crash and retry the request once (REL-02)
//  - per-request timeouts; nothing in-process
// The child speaks a tiny RPC over its parentPort: {id, method, params} → {id, result | error}.
import { utilityProcess, type UtilityProcess } from 'electron';
import { EventEmitter } from 'node:events';

interface Pending {
  method: string;
  params: unknown;
  resolve: (v: unknown) => void;
  reject: (e: Error) => void;
  timer: NodeJS.Timeout;
  retried: boolean;
}

export interface UtilityHostOptions {
  modulePath: string;
  serviceName: string;
  idleMs: number;
  timeoutMs: number;
  /** Sent right after start (e.g. keys or model handles chosen by the browser). */
  init?: () => unknown;
}

export class UtilityHost extends EventEmitter {
  private child: UtilityProcess | null = null;
  private nextId = 1;
  private readonly pending = new Map<number, Pending>();
  private idleTimer: NodeJS.Timeout | null = null;
  private retryQueue: number[] = [];
  private inFlightRetry: number | null = null;
  readonly stats = { starts: 0, crashes: 0, requests: 0, unloads: 0 };

  constructor(private readonly opts: UtilityHostOptions) {
    super();
  }

  get running(): boolean {
    return !!this.child;
  }

  get pid(): number | undefined {
    return this.child?.pid;
  }

  call<T>(method: string, params?: unknown): Promise<T> {
    this.stats.requests++;
    return new Promise<T>((resolve, reject) => {
      const id = this.nextId++;
      const p: Pending = { method, params, resolve: resolve as (v: unknown) => void, reject, retried: false, timer: this.armTimeout(id) };
      this.pending.set(id, p);
      // While recovering from a crash, new requests wait behind the retries.
      if (this.inFlightRetry !== null || this.retryQueue.length) this.retryQueue.push(id);
      else this.send(id, p);
    });
  }

  /** Unloads the process now; the next call restarts it. Memory returns to baseline (PERF-09). */
  unload(): void {
    if (!this.child) return;
    this.stats.unloads++;
    const c = this.child;
    this.child = null;
    c.removeAllListeners();
    c.kill();
    this.emit('unloaded');
  }

  private retryNext(): void {
    if (this.inFlightRetry !== null) return;
    const id = this.retryQueue.shift();
    if (id === undefined) return;
    const p = this.pending.get(id);
    if (!p) return this.retryNext();
    p.retried = true;
    this.inFlightRetry = id;
    this.send(id, p);
  }

  private armTimeout(id: number): NodeJS.Timeout {
    return setTimeout(() => {
      const p = this.pending.get(id);
      if (!p) return;
      this.pending.delete(id);
      p.reject(new Error(`${this.opts.serviceName}: ${p.method} timed out`));
    }, this.opts.timeoutMs);
  }

  private send(id: number, p: Pending): void {
    const child = this.ensure();
    child.postMessage({ id, method: p.method, params: p.params });
    this.touch();
  }

  private ensure(): UtilityProcess {
    if (this.child) return this.child;
    this.stats.starts++;
    const child = utilityProcess.fork(this.opts.modulePath, [], { serviceName: this.opts.serviceName, stdio: 'inherit' });
    this.child = child;
    const init = this.opts.init?.();
    if (init !== undefined) child.postMessage({ id: 0, method: '__init', params: init });
    child.on('message', (m: { id: number; result?: unknown; error?: string }) => {
      const p = this.pending.get(m.id);
      if (!p) return;
      this.pending.delete(m.id);
      clearTimeout(p.timer);
      if (m.error !== undefined) p.reject(new Error(m.error));
      else p.resolve(m.result);
      if (this.inFlightRetry === m.id) {
        this.inFlightRetry = null;
        this.retryNext();
      }
      this.touch();
    });
    child.on('exit', (code) => {
      if (this.child !== child) return;
      this.child = null;
      if (code !== 0) this.stats.crashes++;
      this.emit('exit', code);
      // A request that was already retried and crashed again is the likely culprit: fail it.
      // Everything else is retried once, one request at a time, so a poison request
      // can't take innocent ones down with it (REL-02).
      for (const [id, p] of [...this.pending]) {
        if (p.retried && this.inFlightRetry === id) {
          this.pending.delete(id);
          clearTimeout(p.timer);
          p.reject(new Error(`${this.opts.serviceName} crashed`));
        }
      }
      this.inFlightRetry = null;
      this.retryQueue = [...this.retryQueue, ...[...this.pending.keys()].filter((id) => !this.retryQueue.includes(id))];
      setTimeout(() => this.retryNext(), 50);
    });
    return child;
  }

  private touch(): void {
    if (this.idleTimer) clearTimeout(this.idleTimer);
    this.idleTimer = setTimeout(() => {
      if (!this.pending.size) this.unload();
    }, this.opts.idleMs);
    this.idleTimer.unref();
  }
}
