// One owner for a session's webRequest hooks (the URLLoaderFactory proxy role,
// DD-3). Electron allows a single listener per event per session, so features
// register handlers here: HTTPS-First, Shields, the agent egress filter (R3)…
// Handlers run in priority order; the first decision wins.
import type { OnBeforeRequestListenerDetails, OnBeforeSendHeadersListenerDetails, OnHeadersReceivedListenerDetails, Session } from 'electron';

export type BeforeRequestDecision = { cancel: true; reason: string } | { redirectURL: string; reason: string } | null;

export interface BeforeRequestHandler {
  name: string;
  priority: number;
  onBeforeRequest(d: OnBeforeRequestListenerDetails): BeforeRequestDecision;
}

export interface HeadersHandler {
  name: string;
  onBeforeSendHeaders?(d: OnBeforeSendHeadersListenerDetails, headers: Record<string, string>): void;
  onHeadersReceived?(d: OnHeadersReceivedListenerDetails, headers: Record<string, string[]>): void;
}

export class RequestPipeline {
  private before: BeforeRequestHandler[] = [];
  private headers: HeadersHandler[] = [];
  readonly stats = { requests: 0, blocked: 0, redirected: 0, totalMs: 0 };

  constructor(readonly session: Session) {
    session.webRequest.onBeforeRequest((details, cb) => {
      const t0 = performance.now();
      // Stats cover network traffic only; vizulla:// resources never leave the device.
      if (/^(https?|wss?):/.test(details.url)) this.stats.requests++;
      let out: { cancel?: boolean; redirectURL?: string } = {};
      for (const h of this.before) {
        const d = h.onBeforeRequest(details);
        if (!d) continue;
        if ('cancel' in d) {
          this.stats.blocked++;
          out = { cancel: true };
        } else {
          this.stats.redirected++;
          out = { redirectURL: d.redirectURL };
        }
        break;
      }
      this.stats.totalMs += performance.now() - t0;
      cb(out);
    });
    session.webRequest.onBeforeSendHeaders((details, cb) => {
      const requestHeaders = { ...details.requestHeaders };
      for (const h of this.headers) h.onBeforeSendHeaders?.(details, requestHeaders);
      cb({ requestHeaders });
    });
    session.webRequest.onHeadersReceived((details, cb) => {
      if (!details.responseHeaders) return cb({});
      const responseHeaders = { ...details.responseHeaders };
      for (const h of this.headers) h.onHeadersReceived?.(details, responseHeaders);
      cb({ responseHeaders });
    });
  }

  addBeforeRequest(h: BeforeRequestHandler): void {
    this.before = [...this.before.filter((x) => x.name !== h.name), h].sort((a, b) => a.priority - b.priority);
  }

  addHeaders(h: HeadersHandler): void {
    this.headers = [...this.headers.filter((x) => x.name !== h.name), h];
  }

  remove(name: string): void {
    this.before = this.before.filter((x) => x.name !== name);
    this.headers = this.headers.filter((x) => x.name !== name);
  }
}

/** The URL of the document that made the request (for third-party checks). */
export function initiatorOf(d: { referrer?: string; frame?: { url: string } | null; resourceType: string; url: string }): string {
  if (d.resourceType === 'mainFrame') return d.url;
  try {
    return d.frame?.url || d.referrer || '';
  } catch {
    return d.referrer || '';
  }
}
