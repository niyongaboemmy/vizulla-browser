// AssistantService (P2-AI-04): T0 read-only page/PDF Q&A with citations.
//  - AI off → nothing runs (AI-09). No tools: the assistant cannot act (T0).
//  - First cloud use per site+provider needs the AI-05 disclosure, shown in
//    browser-owned UI (the overlay), never in page content.
//  - Context is the current tab only (PA-10), tagged UNTRUSTED_WEB.
//  - Conversations are session-only unless the user opts in (doc 06 §7).
//  - Every request is logged to the Privacy Dashboard (origin, size, where).
import { randomUUID } from 'node:crypto';
import { join } from 'node:path';
import type { BrowserApp } from '../browser_app';
import type { BrowserWindowController } from '../ui/browser_window';
import type { WebTab } from '../tabs/web_tab';
import { emitTo, type CallContext } from '../ui/ipc_router';
import { AssistantInterface, type AssistantMessage, type AssistantState, type CitationRef } from '@vz/common/mojom/assistant';
import { chunkBlocks, totalChars, type Block, type Chunk } from './context/chunker';
import { buildMessages, PROMPT_VERSION, type ChatMessage, type Task } from './context/prompt';
import { checkCitations, markersIn, revealSpan } from './context/citations';
import { EXTRACT_SCRIPT, HIGHLIGHT_CSS, ISOLATED_WORLD_ID, revealScript } from './context/page_scripts';
import { extractPdf } from './context/pdf_extract';
import { anthropic, gateway, google, isLocalUrl, onDevice, openaiLike, ProviderError, type Provider } from './providers/providers';
import { ProviderKeys } from './provider_keys';
import { route, sensitivityOf, type TaskKind } from './router/model_router';
import { originOf, siteOf } from '@vz/common/url';
import { t } from '@vz/common/i18n';
import { kVizullaAssistant } from '../vizulla_features';
import type { ProviderId } from '../prefs/prefs_schema';

interface Conversation {
  url: string;
  messages: AssistantMessage[];
  history: ChatMessage[];
  chunks: Map<string, Chunk>;
  controller: AbortController | null;
  lastTask?: Task;
  lastTabIds?: number[];
}

export interface LocalEngine {
  /** Runs a task on device. R2 replaces the in-process engine with the sandboxed ai_runtime. */
  run(task: Task, chunks: Chunk[]): Promise<string>;
  readonly generative: boolean;
}

export class AssistantService {
  readonly keys: ProviderKeys;
  private readonly convs = new Map<number, Conversation>();
  private readonly pdfTabs = new Set<number>();
  private deviceToken: { token: string; expires: number } | null = null;
  local: LocalEngine = { run: async (task, chunks) => (await import('@vz/components/ai_runtime/extractive')).answerExtractive(task, chunks), generative: false };
  onAnswer: ((w: BrowserWindowController, msg: AssistantMessage, conv: { url: string; title: string }) => void) | null = null;

  constructor(private readonly app: BrowserApp) {
    const p = app.profile;
    this.keys = p.register('providerKeys', new ProviderKeys(join(p.dir, 'Keys', 'provider_keys.json'), p.keys));
    this.bind();
    // PDF detection: the main-frame response's content type.
    p.pipeline.addHeaders({
      name: 'pdf-detect',
      onHeadersReceived: (d, headers) => {
        if (d.resourceType !== 'mainFrame' || d.webContentsId === undefined) return;
        const ct = Object.entries(headers).find(([k]) => k.toLowerCase() === 'content-type')?.[1]?.[0] ?? '';
        if (ct.includes('application/pdf')) this.pdfTabs.add(d.webContentsId);
        else this.pdfTabs.delete(d.webContentsId);
      },
    });
    app.hooks.ask.push((w, text) => {
      if (!this.enabled()) return false;
      w.setPanel('assistant');
      void this.run(w, { kind: 'ask', question: text });
      return true;
    });
    app.hooks.windowCreated.push((w) => {
      w.on('state', () => this.pushIfActiveChanged(w));
      w.on('tab-closed', (tab: WebTab) => this.convs.delete(tab.id));
      w.on('tab-navigated', (tab: WebTab) => {
        const wc = tab.wc;
        if (wc) tab.isPdf = this.pdfTabs.has(wc.id) || /\.pdf($|\?)/i.test(tab.url);
        if (tab.id === w.model.activeTabId) this.push(w);
      });
    });
    app.commandHandlers.set('ai.panel', (w) => w.togglePanel('assistant'));
    app.commandHandlers.set('ai.summarize', (w) => {
      w.setPanel('assistant');
      void this.run(w, { kind: 'summarize', style: 'key-points' });
    });
    app.hooks.selectionActions.push((w, _tab, text) => {
      if (!this.enabled()) return [];
      const act = (label: string, action: string) => ({ label, click: () => {
        w.setPanel('assistant');
        void this.run(w, { kind: 'selection', action, text });
      } });
      return [
        { label: t('ctx_ask_selection'), click: () => {
          w.setPanel('assistant');
          void this.run(w, { kind: 'ask', question: t('ask_about_selection', { text: text.slice(0, 300) }) });
        } },
        { label: t('ctx_ai_more'), submenu: [act(t('sel_explain'), 'Explain this passage simply'), act(t('sel_simplify'), 'Rewrite this passage in plain language'), act(t('sel_translate'), 'Translate this passage into the user\'s language'), act(t('sel_define'), 'Define the key terms in this passage'), act(t('sel_proofread'), 'Proofread this passage and list corrections')] },
      ];
    });
  }

  enabled(): boolean {
    return this.app.profile.prefs.get('ai.mode') !== 'off' && this.app.profile.features.isEnabled(kVizullaAssistant);
  }

  // ---------------------------------------------------------------- IPC

  private bind(): void {
    const win = (ctx: CallContext) => {
      const w = this.app.windowForSender(ctx.sender);
      if (!w) throw new Error('no window');
      return w;
    };
    this.app.router.bind(
      AssistantInterface,
      {
        getState: (ctx) => this.state(win(ctx)),
        summarize: (ctx, style) => this.run(win(ctx), { kind: 'summarize', style }),
        ask: (ctx, q) => this.run(win(ctx), { kind: 'ask', question: q }),
        compare: (ctx, tabIds, q) => this.run(win(ctx), { kind: 'compare', question: q || t('compare_default_question') }, tabIds),
        revealCitation: (ctx, messageId, chunkId) => this.reveal(win(ctx), messageId, chunkId),
        escalate: (ctx, messageId) => this.escalate(win(ctx), messageId),
        stop: (ctx) => this.stop(win(ctx)),
        clear: (ctx) => {
          const w = win(ctx);
          const id = w.model.activeTabId;
          if (id !== null) {
            this.stop(w);
            this.convs.delete(id);
          }
          this.push(w);
        },
        sendToNotes: (ctx, messageId) => this.app.runCommand(win(ctx), 'notes.fromAssistant', { messageId, text: this.findMessage(win(ctx), messageId)?.text ?? '' }),
      },
      { hosts: ['chrome'] },
    );
    // Settings page methods owned by the assistant.
    this.app.pages.define('settings', {
      setApiKey: (payload) => {
        const { provider, key } = payload as { provider: string; key: string };
        if (!['anthropic', 'openai', 'google', 'openai-compatible', 'gateway'].includes(provider) || typeof key !== 'string' || key.length > 400) throw new Error('bad key');
        this.keys.set(provider, key);
        return this.app.pages.settingsData();
      },
      resetDisclosures: () => {
        this.app.profile.prefs.set('ai.disclosedSites', []);
        return this.app.pages.settingsData();
      },
    });
  }

  // ---------------------------------------------------------------- state

  private conv(tabId: number, url: string): Conversation {
    let c = this.convs.get(tabId);
    if (!c) {
      c = { url, messages: [], history: [], chunks: new Map(), controller: null };
      this.convs.set(tabId, c);
    }
    return c;
  }

  private findMessage(w: BrowserWindowController, id: string): AssistantMessage | undefined {
    const tabId = w.model.activeTabId;
    return tabId === null ? undefined : this.convs.get(tabId)?.messages.find((m) => m.id === id);
  }

  state(w: BrowserWindowController): AssistantState {
    const tab = w.activeTab();
    const prefs = this.app.profile.prefs;
    const mode = prefs.get('ai.mode');
    const c = tab ? this.convs.get(tab.id) : undefined;
    const provider = this.describeProvider();
    return {
      tabId: tab?.id ?? null,
      url: tab?.url ?? '',
      title: tab?.title ?? '',
      mode,
      provider: provider.name,
      location: mode === 'off' ? 'off' : provider.location,
      busy: !!c?.controller,
      messages: c?.messages ?? [],
      pageKind: !tab ? 'none' : tab.url.startsWith('vizulla://') ? 'internal' : tab.isPdf ? 'pdf' : 'html',
    };
  }

  private lastPushed = new WeakMap<BrowserWindowController, number | null>();
  private pushIfActiveChanged(w: BrowserWindowController): void {
    const id = w.model.activeTabId;
    if (this.lastPushed.get(w) !== id) this.push(w);
  }

  private pushTimers = new WeakMap<BrowserWindowController, NodeJS.Timeout>();
  push(w: BrowserWindowController, throttle = false): void {
    if (throttle) {
      if (this.pushTimers.has(w)) return;
      this.pushTimers.set(w, setTimeout(() => {
        this.pushTimers.delete(w);
        this.push(w);
      }, 33));
      return;
    }
    this.lastPushed.set(w, w.model.activeTabId);
    emitTo(w.chrome.webContents, 'Assistant', 'state', this.state(w));
  }

  // ---------------------------------------------------------------- providers

  private describeProvider(): { id: ProviderId; name: string; location: 'on-device' | 'cloud' } {
    const p = this.app.profile.prefs;
    const mode = p.get('ai.mode');
    if (mode === 'local') return { id: 'local', name: t('ai_badge_device'), location: 'on-device' };
    if (mode === 'cloud') return { id: 'gateway', name: 'Vizulla Cloud', location: 'cloud' };
    const id = p.get('ai.provider');
    const names: Record<string, string> = { anthropic: 'Anthropic', openai: 'OpenAI', google: 'Google Gemini', 'openai-compatible': t('provider_compat'), gateway: 'Vizulla Cloud', local: t('ai_badge_device') };
    const location = id === 'local' || (id === 'openai-compatible' && isLocalUrl(p.get('ai.compatBaseUrl'))) ? 'on-device' : 'cloud';
    return { id, name: names[id] ?? id, location };
  }

  private provider(id: ProviderId): Provider {
    const p = this.app.profile.prefs;
    switch (id) {
      case 'anthropic': {
        const k = this.keys.get('anthropic');
        if (!k) throw new ProviderError(t('ai_err_no_key', { provider: 'Anthropic' }), 'no-key');
        return anthropic(k);
      }
      case 'openai': {
        const k = this.keys.get('openai');
        if (!k) throw new ProviderError(t('ai_err_no_key', { provider: 'OpenAI' }), 'no-key');
        return openaiLike('openai', 'OpenAI', 'https://api.openai.com/v1', k, 'cloud');
      }
      case 'google': {
        const k = this.keys.get('google');
        if (!k) throw new ProviderError(t('ai_err_no_key', { provider: 'Google' }), 'no-key');
        return google(k);
      }
      case 'openai-compatible': {
        const base = p.get('ai.compatBaseUrl');
        return openaiLike('openai-compatible', t('provider_compat'), base, this.keys.get('openai-compatible'), isLocalUrl(base) ? 'on-device' : 'cloud');
      }
      case 'gateway':
        return gateway(p.get('ai.gatewayUrl'), () => this.gatewayToken());
      case 'local':
        return onDevice((task, chunks) => this.local.run(task, chunks));
    }
  }

  private async gatewayToken(): Promise<string> {
    if (this.deviceToken && this.deviceToken.expires > Date.now() + 60_000) return this.deviceToken.token;
    const base = this.app.profile.prefs.get('ai.gatewayUrl');
    const r = await fetch(`${base.replace(/\/$/, '')}/v1/device`, { method: 'POST' }).catch((e: Error) => {
      throw new ProviderError(e.message, 'network');
    });
    if (!r.ok) throw new ProviderError(`gateway HTTP ${r.status}`, r.status === 429 ? 'quota' : 'http');
    const j = (await r.json()) as { token: string; expires_at: number };
    this.deviceToken = { token: j.token, expires: j.expires_at * 1000 };
    return j.token;
  }

  // ---------------------------------------------------------------- context

  async extract(tab: WebTab, idPrefix = 'c', tabId?: number): Promise<{ chunks: Chunk[]; title: string; scanned?: boolean; selection: string }> {
    const wc = tab.wc ?? tab.ensureLive();
    const origin = originOf(tab.url);
    if (tab.isPdf || this.pdfTabs.has(wc.id)) {
      const res = await wc.session.fetch(tab.url);
      const bytes = new Uint8Array(await res.arrayBuffer());
      const { blocks, scanned } = await extractPdf(bytes);
      return { chunks: chunkBlocks(blocks, { origin, idPrefix, tabId, maxChunks: 80 }), title: tab.title, scanned, selection: '' };
    }
    const r = (await wc.executeJavaScriptInIsolatedWorld(ISOLATED_WORLD_ID, [{ code: EXTRACT_SCRIPT }])) as { title: string; blocks: Block[]; selection: string };
    return { chunks: chunkBlocks(r.blocks ?? [], { origin, idPrefix, tabId }), title: r.title, selection: r.selection ?? '' };
  }

  // ---------------------------------------------------------------- run

  async run(w: BrowserWindowController, task: Task, tabIds?: number[]): Promise<void> {
    const tab = w.activeTab();
    if (!tab) return;
    const prefs = this.app.profile.prefs;
    const c = this.conv(tab.id, tab.url);
    if (c.url !== tab.url) {
      c.url = tab.url;
      c.history = [];
    }
    this.stop(w);
    const userText = task.kind === 'ask' ? task.question : task.kind === 'summarize' ? t(`ai_task_${task.style.replace('-', '_')}` as never) : task.kind === 'compare' ? `${t('ai_task_compare')}: ${task.question}` : `${task.action}: “${task.text.slice(0, 200)}”`;
    c.messages.push({ id: randomUUID().slice(0, 8), role: 'user', text: userText, citations: [], status: 'done' });
    const msg: AssistantMessage = { id: randomUUID().slice(0, 8), role: 'assistant', text: '', citations: [], status: 'streaming' };
    c.messages.push(msg);
    c.lastTask = task;
    c.lastTabIds = tabIds;
    const controller = new AbortController();
    c.controller = controller;
    this.push(w);

    const fail = (error: string) => {
      msg.status = 'error';
      msg.error = error;
      c.controller = null;
      this.push(w);
    };

    if (!this.enabled()) return fail(t('ai_err_off'));
    if (tab.url.startsWith('vizulla://') && task.kind !== 'selection') return fail(t('ai_err_internal_page'));

    // Context: current tab only (PA-10), or explicitly picked tabs (PA-05).
    let chunks: Chunk[] = [];
    let origins: string[] = [];
    try {
      if (task.kind === 'compare' && tabIds?.length) {
        for (const [i, id] of tabIds.slice(0, 20).entries()) {
          const other = w.tabs.get(id);
          if (!other || other.url.startsWith('vizulla://')) continue;
          const r = await this.extract(other, `t${i + 1}c`, id);
          chunks.push(...r.chunks.slice(0, Math.max(3, Math.floor(60 / tabIds.length))));
          origins.push(originOf(other.url));
        }
      } else {
        const r = await this.extract(tab);
        if (r.scanned) return fail(t('ai_err_scanned_pdf'));
        chunks = r.chunks;
        origins = [originOf(tab.url)];
      }
    } catch (e) {
      return fail(t('ai_err_extract', { reason: (e as Error).message.slice(0, 120) }));
    }
    if (!chunks.length && task.kind !== 'selection') return fail(t('ai_err_empty_page'));
    for (const ch of chunks) c.chunks.set(ch.id, ch);

    // Routing (R1: the user's mode and provider; R2 policy adds task and sensitivity).
    const kind: TaskKind = task.kind === 'compare' ? 'multi_tab_synthesis' : task.kind === 'summarize' ? 'summary' : task.kind === 'selection' ? 'selection' : 'qa';
    const desc = this.describeProvider();
    const decision = route({
      mode: prefs.get('ai.mode'),
      provider: desc.id,
      task: kind,
      sensitivity: w.profile.isPrivate ? 'high' : sensitivityOf(tab.url),
      deviceHasLocalProfile: true,
      privateWindow: w.profile.isPrivate,
      compatIsLocal: isLocalUrl(prefs.get('ai.compatBaseUrl')),
      generativeLocalAvailable: this.local.generative,
    });
    if (decision.kind === 'refuse') return fail(t('ai_err_refused'));
    const providerId: ProviderId = decision.kind === 'local' ? 'local' : decision.kind === 'cloud' ? decision.provider : 'local';
    let provider: Provider;
    try {
      provider = this.provider(providerId);
    } catch (e) {
      return fail((e as Error).message);
    }

    // AI-05 disclosure: first cloud use per site and provider, in browser-owned UI.
    if (provider.location === 'cloud') {
      const sites = [...new Set(origins.map((o) => siteOf(o)))];
      const pending = sites.filter((s) => !prefs.get('ai.disclosedSites').includes(`${s}|${provider.id}`));
      if (pending.length) {
        const ok = await w.overlay.dialog<{ allow: boolean; remember: boolean } | null>({
          type: 'disclosure', sites: pending, provider: provider.name, kb: Math.max(1, Math.round(totalChars(chunks) / 1024)), model: this.model(providerId),
        });
        if (!ok?.allow) {
          msg.status = 'stopped';
          msg.error = t('ai_disclosure_declined');
          c.controller = null;
          this.push(w);
          return;
        }
        if (ok.remember) prefs.set('ai.disclosedSites', [...prefs.get('ai.disclosedSites'), ...pending.map((s) => `${s}|${provider.id}`)]);
      }
    }

    const messages = buildMessages(task, chunks, c.history, prefs.get('ai.answerLanguage'));
    const bytesSent = messages.reduce((n, m) => n + m.content.length, 0);
    msg.location = provider.location;
    msg.provider = provider.name;
    msg.model = this.model(providerId);
    const t0 = Date.now();
    let ok = false;
    try {
      const attempt = () =>
        provider.generate({ messages, model: msg.model!, maxTokens: 900, signal: controller.signal, task, chunks }, (tok) => {
          msg.text += tok;
          msg.citations = this.citationRefs(c, markersIn(msg.text), w);
          this.push(w, true);
        });
      let out: { text: string };
      try {
        out = await attempt();
      } catch (e) {
        // One retry for transport failures before anything streamed (stale pooled sockets, blips).
        if (!(e instanceof ProviderError) || e.code !== 'network' || msg.text) throw e;
        console.warn('[vz] provider network error, retrying once:', e.message);
        out = await attempt();
      }
      const check = checkCitations(out.text || msg.text, chunks);
      msg.text = check.text;
      msg.citations = this.citationRefs(c, check.cited, w);
      msg.sourcing = task.kind === 'selection' ? undefined : check.status;
      msg.status = 'done';
      msg.canEscalate = provider.location === 'on-device' && check.status !== 'sourced' && prefs.get('ai.mode') === 'byo';
      c.history.push(messages.at(-1)!, { role: 'assistant', content: msg.text });
      c.history = c.history.slice(-8);
      ok = true;
      this.onAnswer?.(w, msg, { url: tab.url, title: tab.title });
    } catch (e) {
      const err = e as ProviderError;
      msg.status = err.code === 'aborted' ? 'stopped' : 'error';
      msg.error = err.code === 'aborted' ? undefined : errorText(err);
    } finally {
      if (c.controller === controller) c.controller = null;
      this.app.profile.privacy.recordAi({
        at: t0, feature: `assistant.${task.kind}`, origins, bytesSent, location: provider.location, provider: provider.name,
        model: `${msg.model} · ${PROMPT_VERSION}`, routeReason: decision.reason, ok,
      });
      this.app.pages.notify('privacy', 'changed');
      this.push(w);
    }
  }

  private model(id: ProviderId): string {
    return this.app.profile.prefs.get('ai.models')[id] ?? '';
  }

  private citationRefs(c: Conversation, ids: string[], w: BrowserWindowController): CitationRef[] {
    const out: CitationRef[] = [];
    for (const id of [...new Set(ids)]) {
      const ch = c.chunks.get(id);
      if (!ch) continue;
      out.push({ id, label: revealSpan(ch).slice(0, 90), page: ch.page, tabId: ch.tabId, title: ch.tabId !== undefined ? w.tabs.get(ch.tabId)?.title : undefined });
    }
    return out;
  }

  /**
   * One-shot completion for browser features that need a model answer as data
   * (the agent planner). Same routing, provider adapters, and privacy log as Q&A.
   */
  async complete(system: string, user: string, signal: AbortSignal, feature: string): Promise<string> {
    const desc = this.describeProvider();
    if (this.app.profile.prefs.get('ai.mode') === 'off') throw new ProviderError(t('ai_err_off'), 'http');
    const provider = this.provider(desc.id === 'local' ? 'gateway' : desc.id);
    const messages: ChatMessage[] = [{ role: 'system', content: system }, { role: 'user', content: user }];
    const t0 = Date.now();
    let ok = false;
    try {
      const r = await provider.generate({ messages, model: this.model(provider.id), maxTokens: 800, signal, task: { kind: 'ask', question: user }, chunks: [] }, () => {});
      ok = true;
      return r.text;
    } finally {
      this.app.profile.privacy.recordAi({ at: t0, feature, origins: [], bytesSent: system.length + user.length, location: provider.location, provider: provider.name, model: this.model(provider.id), routeReason: 'agent-plan→cloud', ok });
    }
  }

  stop(w: BrowserWindowController): void {
    const id = w.model.activeTabId;
    const c = id === null ? undefined : this.convs.get(id);
    c?.controller?.abort();
  }

  private async escalate(w: BrowserWindowController, messageId: string): Promise<void> {
    const id = w.model.activeTabId;
    const c = id === null ? undefined : this.convs.get(id);
    const msg = c?.messages.find((m) => m.id === messageId);
    if (!c?.lastTask || !msg) return;
    msg.canEscalate = false;
    // Escalation is never automatic and goes through the same disclosure (P4-AI-06).
    const saved = this.local;
    this.local = { ...saved, generative: false };
    try {
      await this.run(w, c.lastTask, c.lastTabIds);
    } finally {
      this.local = saved;
    }
  }

  /** Scroll to and highlight a cited passage: text search for HTML, page jump for PDFs (DD-5). */
  async reveal(w: BrowserWindowController, _messageId: string, chunkId: string): Promise<boolean> {
    const activeId = w.model.activeTabId;
    if (activeId === null) return false;
    const c = this.convs.get(activeId);
    const ch = c?.chunks.get(chunkId);
    if (!ch) return false;
    const tab = ch.tabId !== undefined ? w.tabs.get(ch.tabId) : w.activeTab();
    if (!tab) return false;
    if (tab.id !== activeId) w.activateTab(tab.id);
    const wc = tab.ensureLive();
    if (ch.page !== undefined) {
      const base = tab.url.split('#')[0];
      await wc.loadURL(`${base}#page=${ch.page}`).catch(() => undefined);
      return true;
    }
    await wc.insertCSS(HIGHLIGHT_CSS).catch(() => undefined);
    const found = (await wc.executeJavaScriptInIsolatedWorld(ISOLATED_WORLD_ID, [{ code: revealScript(revealSpan(ch)) }]).catch(() => false)) as boolean;
    if (!found) {
      // Fallback: a text fragment navigation (#:~:text=) handled by Blink.
      const words = revealSpan(ch).split(/\s+/).slice(0, 6).join(' ');
      wc.executeJavaScriptInIsolatedWorld(ISOLATED_WORLD_ID, [{ code: `location.hash = ':~:text=' + encodeURIComponent(${JSON.stringify(words)})` }]).catch(() => undefined);
    }
    return found;
  }
}

function errorText(e: ProviderError): string {
  switch (e.code) {
    case 'no-key':
      return e.message;
    case 'auth':
      return t('ai_err_auth');
    case 'quota':
      return t('ai_err_quota');
    case 'network':
      return t('ai_err_network');
    default:
      return t('ai_err_generic', { reason: e.message.slice(0, 160) });
  }
}
