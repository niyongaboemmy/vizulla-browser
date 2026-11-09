// Local MCP server (Model Context Protocol, Streamable HTTP with JSON responses): lets
// AI coding tools (Claude Code, Cursor, VS Code…) see and use the browser while you
// build. Off by default. Listens on 127.0.0.1 only, needs a bearer token, refuses any
// request from a web page (Origin header) or with a foreign Host (DNS rebinding), asks
// once per tool before it connects, and never sees private windows.
import { app } from 'electron';
import { randomBytes } from 'node:crypto';
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import type { BrowserApp } from '../browser_app';
import type { BrowserWindowController } from '../ui/browser_window';
import type { WebTab } from '../tabs/web_tab';
import { pageMarkdown } from '../tools/dev_tools';

const PROTOCOL = '2025-06-18';
const MAX_BODY = 1_000_000;

interface Rpc {
  jsonrpc: '2.0';
  id?: string | number | null;
  method: string;
  params?: Record<string, unknown>;
}

export interface McpActivity {
  at: number;
  client: string;
  tool: string;
  ok: boolean;
}

const TOOLS = [
  { name: 'list_tabs', description: 'List the open tabs (id, title, URL, which one is active) in Vizulla’s regular windows.', inputSchema: { type: 'object', properties: {} } },
  {
    name: 'open_url',
    description: 'Open a URL in Vizulla (in a new tab by default) and wait for it to load. Returns the tab id.',
    inputSchema: { type: 'object', properties: { url: { type: 'string', description: 'http(s) URL' }, newTab: { type: 'boolean', default: true } }, required: ['url'] },
  },
  { name: 'read_page', description: 'The main content of a tab as Markdown (title, headings, text, links, tables). Defaults to the active tab.', inputSchema: { type: 'object', properties: { tabId: { type: 'number' } } } },
  { name: 'screenshot', description: 'A PNG screenshot of what a tab shows (the visible area). Defaults to the active tab.', inputSchema: { type: 'object', properties: { tabId: { type: 'number' } } } },
  {
    name: 'console_logs',
    description: 'Recent console messages (errors, warnings, logs) from a tab since it was opened. Defaults to the active tab.',
    inputSchema: { type: 'object', properties: { tabId: { type: 'number' }, level: { type: 'string', enum: ['all', 'warning', 'error'], default: 'all' }, limit: { type: 'number', default: 50 } } },
  },
];

export class McpServer {
  private server: Server | null = null;
  private port = 0;
  private readonly logs = new Map<number, { level: string; message: string; source: string; line: number; at: number }[]>();
  readonly activity: McpActivity[] = [];
  private readonly sessions = new Map<string, string>();

  constructor(private readonly app: BrowserApp) {
    const prefs = app.profile.prefs;
    if (!prefs.get('dev.mcpToken')) prefs.set('dev.mcpToken', randomBytes(24).toString('base64url'));
    prefs.observe('dev.mcp', (on) => void (on ? this.start() : this.stop()));
    // Console messages per tab (kept only while the server is on).
    app.hooks.windowCreated.push((w) => {
      w.on('tab-dom-ready', (tab: WebTab) => this.watch(tab));
    });
    if (prefs.get('dev.mcp')) void this.start();
  }

  get url(): string | null {
    return this.server ? `http://127.0.0.1:${this.port}/mcp` : null;
  }

  regenerateToken(): void {
    this.app.profile.prefs.set('dev.mcpToken', randomBytes(24).toString('base64url'));
    this.sessions.clear();
  }

  private watch(tab: WebTab): void {
    const wc = tab.wc;
    if (!wc || !this.server || this.logs.has(wc.id)) return;
    this.logs.set(wc.id, []);
    wc.on('console-message', (e) => {
      const list = this.logs.get(wc.id);
      if (!list) return;
      const d = e as unknown as { level: string; message: string; sourceId: string; lineNumber: number };
      list.push({ level: d.level, message: String(d.message).slice(0, 2000), source: d.sourceId, line: d.lineNumber, at: Date.now() });
      if (list.length > 300) list.shift();
    });
    wc.once('destroyed', () => this.logs.delete(wc.id));
  }

  async start(): Promise<void> {
    if (this.server) return;
    const prefs = this.app.profile.prefs;
    const server = createServer((req, res) => void this.handle(req, res));
    const listen = (port: number) =>
      new Promise<number>((resolve, reject) => {
        server.once('error', reject);
        server.listen(port, '127.0.0.1', () => resolve((server.address() as { port: number }).port));
      });
    try {
      this.port = await listen(prefs.get('dev.mcpPort'));
    } catch {
      this.port = await listen(0); // preferred port busy: any free one
    }
    this.server = server;
    for (const w of this.app.windows) for (const tab of w.tabs.values()) this.watch(tab);
    this.app.pages.notify('settings', 'changed');
  }

  stop(): void {
    this.server?.close();
    this.server = null;
    this.logs.clear();
    this.sessions.clear();
    this.app.pages.notify('settings', 'changed');
  }

  private send(res: ServerResponse, status: number, body?: unknown, headers: Record<string, string> = {}): void {
    res.writeHead(status, { 'content-type': 'application/json', 'cache-control': 'no-store', ...headers });
    res.end(body === undefined ? '' : JSON.stringify(body));
  }

  private async handle(req: IncomingMessage, res: ServerResponse): Promise<void> {
    const host = String(req.headers.host ?? '');
    if (!/^(127\.0\.0\.1|localhost)(:\d+)?$/.test(host) || req.headers.origin) return this.send(res, 403, { error: 'forbidden' });
    if (req.url?.split('?')[0] !== '/mcp') return this.send(res, 404, { error: 'not found' });
    if (req.headers.authorization !== `Bearer ${this.app.profile.prefs.get('dev.mcpToken')}`) return this.send(res, 401, { error: 'unauthorized' });
    if (req.method === 'DELETE') return this.send(res, 204);
    if (req.method !== 'POST') return this.send(res, 405, { error: 'POST only' }, { allow: 'POST, DELETE' });
    let raw = '';
    for await (const chunk of req) {
      raw += chunk;
      if (raw.length > MAX_BODY) return this.send(res, 413, { error: 'too large' });
    }
    let msg: Rpc | Rpc[];
    try {
      msg = JSON.parse(raw) as Rpc | Rpc[];
    } catch {
      return this.send(res, 400, { jsonrpc: '2.0', id: null, error: { code: -32700, message: 'Parse error' } });
    }
    const session = String(req.headers['mcp-session-id'] ?? '');
    const list = Array.isArray(msg) ? msg : [msg];
    const out = [];
    let newSession: string | null = null;
    for (const m of list) {
      if (m.method === 'initialize') {
        const client = String((m.params?.clientInfo as { name?: string } | undefined)?.name ?? 'Unknown tool').slice(0, 80);
        if (!(await this.approve(client))) {
          out.push({ jsonrpc: '2.0', id: m.id ?? null, error: { code: -32001, message: 'The user did not allow this tool to use Vizulla.' } });
          continue;
        }
        newSession = randomBytes(16).toString('hex');
        this.sessions.set(newSession, client);
        out.push({
          jsonrpc: '2.0',
          id: m.id ?? null,
          result: {
            protocolVersion: typeof m.params?.protocolVersion === 'string' ? m.params.protocolVersion : PROTOCOL,
            capabilities: { tools: { listChanged: false } },
            serverInfo: { name: 'vizulla', title: 'Vizulla Browser', version: app.getVersion() },
            instructions: 'Vizulla Browser: read and screenshot the user’s open tabs, open URLs and read console logs while developing. Private windows are never visible.',
          },
        });
        continue;
      }
      const client = this.sessions.get(session);
      if (m.id === undefined || m.id === null) continue; // notifications
      if (!client) {
        out.push({ jsonrpc: '2.0', id: m.id, error: { code: -32002, message: 'Initialize first.' } });
        continue;
      }
      if (m.method === 'ping') out.push({ jsonrpc: '2.0', id: m.id, result: {} });
      else if (m.method === 'tools/list') out.push({ jsonrpc: '2.0', id: m.id, result: { tools: TOOLS } });
      else if (m.method === 'tools/call') out.push({ jsonrpc: '2.0', id: m.id, result: await this.call(client, String(m.params?.name ?? ''), (m.params?.arguments ?? {}) as Record<string, unknown>) });
      else out.push({ jsonrpc: '2.0', id: m.id, error: { code: -32601, message: `Unknown method ${m.method}` } });
    }
    if (!out.length) return this.send(res, 202);
    this.send(res, 200, Array.isArray(msg) ? out : out[0], newSession ? { 'mcp-session-id': newSession } : {});
  }

  /** First connection of a tool: ask in the focused window; remembered once allowed. */
  private async approve(client: string): Promise<boolean> {
    const prefs = this.app.profile.prefs;
    if (prefs.get('dev.mcpClients').includes(client)) return true;
    const w = this.regularWindow();
    if (!w) return false;
    w.win.focus();
    const r = await w.overlay.dialog<{ action: 'allow' | 'deny' } | null>({ type: 'mcp-approve', client });
    if (r?.action !== 'allow') return false;
    prefs.set('dev.mcpClients', [...prefs.get('dev.mcpClients'), client]);
    this.app.pages.notify('settings', 'changed');
    return true;
  }

  private regularWindow(): BrowserWindowController | null {
    const f = this.app.focused();
    if (f && !f.profile.isPrivate) return f;
    return [...this.app.windows].find((w) => !w.profile.isPrivate) ?? null;
  }

  private tab(tabId: unknown): { w: BrowserWindowController; tab: WebTab } | null {
    for (const w of this.app.windows) {
      if (w.profile.isPrivate) continue;
      if (typeof tabId === 'number') {
        const tab = w.tabs.get(tabId);
        if (tab) return { w, tab };
      }
    }
    if (typeof tabId === 'number') return null;
    const w = this.regularWindow();
    const tab = w?.activeTab();
    return w && tab ? { w, tab } : null;
  }

  private async call(client: string, name: string, args: Record<string, unknown>): Promise<{ content: unknown[]; isError?: boolean }> {
    const text = (v: unknown) => ({ content: [{ type: 'text', text: typeof v === 'string' ? v : JSON.stringify(v, null, 2) }] });
    const fail = (message: string) => ({ content: [{ type: 'text', text: message }], isError: true });
    let result: { content: unknown[]; isError?: boolean };
    try {
      switch (name) {
        case 'list_tabs':
          result = text([...this.app.windows].filter((w) => !w.profile.isPrivate).map((w, i) => ({ window: i + 1, tabs: [...w.tabs.values()].map((tb) => ({ id: tb.id, title: tb.title, url: tb.url, active: tb.id === w.model.activeTabId })) })));
          break;
        case 'open_url': {
          const url = String(args.url ?? '');
          if (!/^https?:\/\//.test(url)) return fail('url must be http(s)');
          const w = this.regularWindow() ?? this.app.openWindow();
          const tab = args.newTab === false && w.activeTab() ? w.activeTab()! : w.createTab({ url, activate: true });
          const wc = tab.ensureLive();
          if (args.newTab === false) void wc.loadURL(url).catch(() => undefined);
          await new Promise<void>((resolve) => {
            const done = () => resolve();
            wc.once('did-stop-loading', done);
            setTimeout(done, 15_000);
          });
          result = text({ tabId: tab.id, title: wc.getTitle(), url: wc.getURL() });
          break;
        }
        case 'read_page': {
          const found = this.tab(args.tabId);
          const wc = found?.tab.ensureLive();
          if (!wc) return fail('no such tab');
          result = text((await pageMarkdown(wc)) || '(empty page)');
          break;
        }
        case 'screenshot': {
          const found = this.tab(args.tabId);
          const wc = found?.tab.wc;
          if (!wc) return fail('no such tab (or it is asleep)');
          let img = await wc.capturePage();
          if (img.getSize().width > 1280) img = img.resize({ width: 1280 });
          result = { content: [{ type: 'image', data: img.toPNG().toString('base64'), mimeType: 'image/png' }] };
          break;
        }
        case 'console_logs': {
          const found = this.tab(args.tabId);
          const wc = found?.tab.wc;
          if (!wc) return fail('no such tab (or it is asleep)');
          const level = String(args.level ?? 'all');
          const limit = Math.max(1, Math.min(300, Number(args.limit ?? 50)));
          const list = (this.logs.get(wc.id) ?? []).filter((l) => level === 'all' || (level === 'error' ? l.level === 'error' : l.level === 'error' || l.level === 'warning'));
          result = text(list.slice(-limit));
          break;
        }
        default:
          return fail(`unknown tool ${name}`);
      }
    } catch (err) {
      result = fail(err instanceof Error ? err.message : String(err));
    }
    this.activity.unshift({ at: Date.now(), client, tool: name, ok: !result.isError });
    this.activity.length = Math.min(this.activity.length, 50);
    return result;
  }
}

