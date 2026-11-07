// vizulla:// internal pages (DD-6). Everything ships in resources: no remote code,
// a strict CSP, and only the hosts listed here exist. Agent and private sessions
// do not get this handler, so pages driven by the agent cannot open internal pages.
import { protocol, type Session } from 'electron';
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { extname, join, normalize, sep } from 'node:path';

const MIME: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
  '.json': 'application/json',
  '.map': 'application/json',
  '.txt': 'text/plain; charset=utf-8',
};

const CSP = [
  "default-src 'none'",
  "script-src 'self'",
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data: blob: https: http: vizulla:",
  "font-src 'self' data:",
  "connect-src 'self'",
  "media-src 'self' blob:",
  "base-uri 'none'",
  "form-action 'none'",
  "frame-ancestors 'none'",
].join('; ');

export function registerVizullaScheme(): void {
  protocol.registerSchemesAsPrivileged([
    { scheme: 'vizulla', privileges: { standard: true, secure: true, supportFetchAPI: true, stream: true, codeCache: true } },
  ]);
}

export interface WebUIProtocolOptions {
  outDir: string;
  /** Dynamic pages (e.g. vizulla://reader/<id>) rendered by browser code. */
  dynamic?: Record<string, (url: URL) => Promise<Response | null> | Response | null>;
}

export function installWebUIHandler(session: Session, opts: WebUIProtocolOptions): string[] {
  const webuiDir = join(opts.outDir, 'webui');
  const resDir = join(opts.outDir, 'resources');
  const hosts = existsSync(webuiDir) ? readdirSync(webuiDir).filter((d) => statSync(join(webuiDir, d)).isDirectory()) : [];

  session.protocol.handle('vizulla', async (request) => {
    const url = new URL(request.url);
    const host = url.hostname;
    const dyn = opts.dynamic?.[host];
    if (dyn) {
      const r = await dyn(url);
      if (r) return withHeaders(r);
    }
    let base: string;
    let rel = decodeURIComponent(url.pathname).replace(/^\/+/, '');
    if (host === 'resources') base = resDir;
    else if (hosts.includes(host)) {
      base = join(webuiDir, host);
      // Pages are single-page apps: unknown paths without an extension serve index.html.
      if (!rel || !extname(rel)) rel = 'index.html';
    } else return notFound();

    const file = normalize(join(base, rel));
    if (!file.startsWith(base + sep) || !existsSync(file) || !statSync(file).isFile()) return notFound();
    return withHeaders(
      new Response(readFileSync(file), { headers: { 'content-type': MIME[extname(file)] ?? 'application/octet-stream' } }),
    );
  });
  return hosts;
}

function withHeaders(r: Response): Response {
  const headers = new Headers(r.headers);
  headers.set('content-security-policy', CSP);
  headers.set('x-content-type-options', 'nosniff');
  headers.set('cross-origin-opener-policy', 'same-origin');
  headers.set('cache-control', 'no-cache');
  return new Response(r.body, { status: r.status, headers });
}

function notFound(): Response {
  return new Response('Not found', { status: 404, headers: { 'content-type': 'text/plain' } });
}
