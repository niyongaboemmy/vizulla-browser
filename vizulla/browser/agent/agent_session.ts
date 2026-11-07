// Agent Session (P5-BRW-01/02, DD-10, C5, C7a/b). Stage A: a fresh in-memory
// session per task: no access to the user's cookies, storage, or extensions,
// destroyed at task end. Its own request pipeline blocks every request to an
// origin outside the plan (strict mode) and scans outgoing data for private values.
import { session as electronSession, type Session } from 'electron';
import { randomUUID } from 'node:crypto';
import { RequestPipeline } from '../net/request_pipeline';
import { scanEgress, type PrivateValue } from './egress';
import { siteOf } from '@vz/common/url';

export interface EgressEvent {
  url: string;
  reason: 'off-plan-origin' | 'private-data';
  labels?: string[];
}

export class AgentSession {
  readonly session: Session;
  readonly partition = `agent-${randomUUID()}`;
  readonly pipeline: RequestPipeline;
  readonly blocked: EgressEvent[] = [];
  onBlocked: ((e: EgressEvent) => void) | null = null;

  constructor(private readonly allowed: () => Set<string>, private readonly privateValues: () => PrivateValue[], existing?: { session: Session; pipeline: RequestPipeline }, private readonly webContentsFilter?: () => Set<number>) {
    this.session = existing?.session ?? electronSession.fromPartition(this.partition, { cache: false });
    this.pipeline = existing?.pipeline ?? new RequestPipeline(this.session);
    this.pipeline.addBeforeRequest({
      name: existing ? `agent-egress-${this.partition}` : 'agent-egress',
      priority: 1,
      onBeforeRequest: (d) => {
        // In a logged-in grant the session is shared: filter only the agent's tabs.
        if (this.webContentsFilter && (d.webContentsId === undefined || !this.webContentsFilter().has(d.webContentsId))) return null;
        if (!/^(https?|wss?):/.test(d.url)) return d.url.startsWith('devtools:') || d.url.startsWith('data:') ? null : this.block({ url: d.url, reason: 'off-plan-origin' });
        let origin: string;
        try {
          origin = new URL(d.url).origin.replace(/^ws/, 'http');
        } catch {
          return this.block({ url: d.url, reason: 'off-plan-origin' });
        }
        const allowed = this.allowed();
        const ok = d.resourceType === 'mainFrame' ? allowed.has(origin) : [...allowed].some((a) => siteOf(a) === siteOf(origin));
        if (!ok) return this.block({ url: d.url, reason: 'off-plan-origin' });
        // C7b: private values must not leave toward an origin that wasn't approved for them.
        const body = (d.uploadData ?? []).map((u) => (u.bytes ? Buffer.from(u.bytes).toString('utf8') : '')).join('&');
        const hits = scanEgress(origin, d.url, body, this.privateValues());
        if (hits.length) return this.block({ url: d.url, reason: 'private-data', labels: hits.map((h) => h.label) });
        return null;
      },
    });
  }

  private block(e: EgressEvent): { cancel: true; reason: string } {
    this.blocked.push(e);
    if (this.blocked.length > 500) this.blocked.shift();
    this.onBlocked?.(e);
    return { cancel: true, reason: `agent-egress:${e.reason}` };
  }

  async destroy(): Promise<void> {
    this.pipeline.remove(`agent-egress-${this.partition}`);
    if (!this.webContentsFilter) await this.session.clearStorageData().catch(() => undefined);
  }
}
