// One tab: a WebContentsView plus the state the UI shows. A discarded tab keeps
// its navigation entries and no renderer (TAB-07); it reloads on activation.
import { WebContentsView, type Session, type WebContents } from 'electron';
import { EventEmitter } from 'node:events';
import { displayUrl, securityStateOf } from '@vz/common/url';
import type { NavState } from '../spaces/spaces_service';
import { choosePageColor, frameColor } from '@vz/common/color';

let nextTabId = 1;

/** The address a tab is really on: an error page stands in for the URL that failed. */
export function logicalUrl(url: string): string {
  if (!url.startsWith('vizulla://error')) return url;
  try {
    return new URL(url).searchParams.get('url') || url;
  } catch {
    return url;
  }
}

export interface WebTabOptions {
  session: Session;
  url?: string;
  nav?: NavState | null;
  title?: string;
  favicon?: string | null;
  discarded?: boolean;
  preload: string;
  /** Agent tabs run in an isolated session and get no internal-page preload. */
  agent?: boolean;
  /** Called to turn a window.open into a real tab. Must return the new tab's WebContents. */
  onOpen?: (opts: { url: string; disposition: string; features: string; options: Electron.BrowserWindowConstructorOptions }) => WebContents | null;
  /** Lets an existing WebContents (created by window.open) be adopted. */
  adoptView?: WebContentsView;
}

const SAMPLE_PAGE_COLOR = `(() => {
  const solid = (el) => {
    for (let n = el; n && n.nodeType === 1; n = n.parentElement) {
      const c = getComputedStyle(n).backgroundColor;
      if (c && c !== 'transparent' && !/^rgba\\([^)]*,\\s*0(\\.0+)?\\s*\\)$/.test(c)) return c;
    }
    return null;
  };
  // Along the top edge: where most points agree (a header, a hero), else the body/root.
  const votes = new Map();
  for (const x of [0.15, 0.5, 0.85]) {
    const el = document.elementFromPoint(innerWidth * x, 2);
    const c = el && solid(el);
    if (c) votes.set(c, (votes.get(c) || 0) + 1);
  }
  const top = [...votes].sort((a, b) => b[1] - a[1])[0];
  if (top && top[1] >= 2) return top[0];
  return (document.body && solid(document.body)) || solid(document.documentElement);
})()`;

export class WebTab extends EventEmitter {
  readonly id = nextTabId++;
  readonly session: Session;
  readonly agent: boolean;
  view: WebContentsView | null = null;
  url: string;
  title: string;
  favicon: string | null;
  /** The site's colour for the window frame, like mobile browsers: its theme-color, else its page background. */
  pageColor: string | null = null;
  private themeColor: string | null = null;
  private sampledColor: string | null = null;
  loading = false;
  audible = false;
  muted = false;
  certError = false;
  isPdf = false;
  zoom = 1;
  crashed = false;
  private nav: NavState | null;
  private readonly preload: string;
  private onOpen: WebTabOptions['onOpen'];

  constructor(opts: WebTabOptions) {
    super();
    this.session = opts.session;
    this.agent = !!opts.agent;
    this.preload = opts.preload;
    this.onOpen = opts.onOpen;
    this.url = opts.url ?? opts.nav?.entries[opts.nav.index]?.url ?? 'vizulla://newtab';
    this.title = opts.title ?? opts.nav?.entries[opts.nav.index]?.title ?? '';
    this.favicon = opts.favicon ?? null;
    this.nav = opts.nav ?? null;
    if (opts.adoptView) this.attach(opts.adoptView);
    else if (!opts.discarded) this.ensureLive();
  }

  private setPageColor(c: string | null): void {
    if (c === this.pageColor) return;
    this.pageColor = c;
    this.emit('updated');
  }

  /**
   * The page's colour where it meets the frame (like Safari): the first solid background along the
   * top edge (sticky headers, hero sections), else the body's or the root's. Also called when the
   * page switches its own theme (page_preload.ts notices and asks).
   */
  async samplePageColor(): Promise<void> {
    const wc = this.wc;
    if (!wc || !/^https?:/.test(wc.getURL())) return;
    try {
      const css = (await wc.executeJavaScriptInIsolatedWorld(1_002_004, [{ code: SAMPLE_PAGE_COLOR }])) as string | null;
      if (this.wc !== wc) return;
      this.sampledColor = frameColor(css);
      this.setPageColor(choosePageColor(this.themeColor, this.sampledColor));
    } catch {
      /* navigating away */
    }
  }

  /** Re-targets window.open when the tab moves to another window. */
  setOpener(fn: WebTabOptions['onOpen']): void {
    this.onOpen = fn;
  }

  get discarded(): boolean {
    return !this.view;
  }

  get wc(): WebContents | null {
    return this.view && !this.view.webContents.isDestroyed() ? this.view.webContents : null;
  }

  /**
   * Whether a page may open this popup (shields/platform_features.ts): Electron has no
   * popup blocker of its own. Returning false denies it.
   */
  static popupPolicy: ((opener: WebContents, url: string, disposition: string) => boolean) | null = null;

  /** The user's fonts (Settings → Appearance). Only used where a page sets no font of its own. */
  static fonts: () => Pick<Electron.WebPreferences, 'defaultFontFamily' | 'minimumFontSize'> = () => ({});

  static createView(session: Session, preload: string, agent: boolean, extra: Electron.WebPreferences = {}): WebContentsView {
    return new WebContentsView({
      webPreferences: {
        ...WebTab.fonts(),
        ...extra,
        session,
        sandbox: true,
        contextIsolation: true,
        nodeIntegration: false,
        // Run the session's preloads in iframes too (dialogs, fingerprinting protection, Shields
        // scriptlets and element hiding). Sandboxed and isolated: frames still get no Node or IPC.
        nodeIntegrationInSubFrames: true,
        webSecurity: true,
        // Internal pages get the WebUI bridge; the preload exposes nothing on web origins.
        preload: agent ? undefined : preload,
        spellcheck: !agent,
        safeDialogs: true,
        navigateOnDragDrop: false,
        autoplayPolicy: 'document-user-activation-required',
        // Cache compiled scripts from the first visit (not after V8's "hot" heuristic): faster repeat visits.
        v8CacheOptions: 'bypassHeatCheck',
      },
    });
  }

  /** Creates the renderer if the tab was discarded, restoring back/forward history. */
  ensureLive(): WebContents {
    if (this.wc) return this.wc;
    const view = WebTab.createView(this.session, this.preload, this.agent);
    this.attach(view);
    const wc = view.webContents;
    if (this.nav && this.nav.entries.length > 1) {
      void wc.navigationHistory
        .restore({ entries: this.nav.entries.map((e) => ({ url: e.url, title: e.title })), index: this.nav.index })
        .catch(() => wc.loadURL(this.url).catch(() => undefined));
    } else {
      wc.loadURL(this.url).catch(() => undefined);
    }
    this.emit('updated');
    return wc;
  }

  discard(): void {
    const wc = this.wc;
    if (!wc) return;
    this.nav = this.navState();
    this.emit('before-discard');
    this.view = null;
    wc.close();
    this.emit('updated');
  }

  destroy(): void {
    const wc = this.wc;
    this.view = null;
    if (wc && !wc.isDestroyed()) wc.close();
    this.removeAllListeners();
  }

  navState(): NavState {
    const wc = this.wc;
    if (!wc) return this.nav ?? { entries: [{ url: logicalUrl(this.url), title: this.title }], index: 0 };
    const all = wc.navigationHistory.getAllEntries();
    // Keep the last 50 entries around the current one.
    const index = wc.navigationHistory.getActiveIndex();
    const start = Math.max(0, all.length - 50);
    return { entries: all.slice(start).map((e) => ({ url: logicalUrl(e.url), title: e.title })), index: Math.max(0, index - start) };
  }

  info() {
    const wc = this.wc;
    return {
      url: this.url,
      displayUrl: displayUrl(this.url),
      title: this.title || displayUrl(this.url) || 'New Tab',
      favicon: this.favicon,
      loading: this.loading,
      audible: this.audible,
      muted: this.muted,
      discarded: this.discarded,
      security: securityStateOf(this.url, this.certError),
      canGoBack: wc ? wc.navigationHistory.canGoBack() : (this.nav?.index ?? 0) > 0,
      canGoForward: wc ? wc.navigationHistory.canGoForward() : !!this.nav && this.nav.index < this.nav.entries.length - 1,
      isPdf: this.isPdf,
      agent: this.agent,
      zoom: this.zoom,
    };
  }

  private attach(view: WebContentsView): void {
    this.view = view;
    this.crashed = false;
    view.setBackgroundColor('#ffffff');
    const wc = view.webContents;
    // Listeners attach after construction, so 'live' is deferred a tick.
    queueMicrotask(() => !wc.isDestroyed() && this.emit('live', wc));
    wc.setZoomFactor(this.zoom);
    wc.setAudioMuted(this.muted);
    const upd = () => this.emit('updated');
    wc.on('did-start-loading', () => {
      this.loading = true;
      upd();
    });
    wc.on('did-stop-loading', () => {
      this.loading = false;
      upd();
    });
    wc.on('did-start-navigation', (details) => {
      if (details.isMainFrame && !details.isSameDocument) {
        this.certError = false;
        this.emit('main-frame-navigation-start', details.url);
      }
    });
    wc.on('did-navigate', (_e, url, httpResponseCode) => {
      // Vizulla's pages paint their own (theme) background; until then the window's shows, not a white flash.
      view.setBackgroundColor(url.startsWith('vizulla:') ? '#00000000' : '#ffffff');
      this.url = url;
      // A new document: its colour comes from its own theme-color or background.
      this.themeColor = null;
      this.sampledColor = null;
      this.setPageColor(null);
      this.isPdf = false;
      this.favicon = null;
      this.emit('navigated', url, httpResponseCode);
      upd();
    });
    // The site's colour: theme-color when it declares one (Chromium resolves light/dark variants),
    // else the page's own background, sampled when it's ready and after in-page navigations.
    wc.on('did-change-theme-color', (_e, color) => {
      this.themeColor = frameColor(color);
      this.setPageColor(choosePageColor(this.themeColor, this.sampledColor));
      void this.samplePageColor();
    });
    wc.on('dom-ready', () => void this.samplePageColor());
    wc.on('did-finish-load', () => void this.samplePageColor());
    wc.on('did-navigate-in-page', (_e, url, isMainFrame) => {
      if (!isMainFrame) return;
      void this.samplePageColor();
      this.url = url;
      this.emit('navigated-in-page', url);
      upd();
    });
    wc.on('page-title-updated', (_e, title) => {
      this.title = title;
      this.emit('title', title);
      upd();
    });
    wc.on('page-favicon-updated', (_e, favicons) => {
      const fav = favicons.find((f) => /^(https?|data):/.test(f));
      this.favicon = fav ?? null;
      if (fav) this.emit('favicon', fav);
      upd();
    });
    wc.on('audio-state-changed', (e) => {
      this.audible = e.audible;
      upd();
    });
    wc.on('dom-ready', () => this.emit('dom-ready'));
    wc.on('did-finish-load', () => this.emit('did-finish-load'));
    wc.on('did-fail-load', (_e, code, desc, url, isMainFrame) => {
      if (isMainFrame && code !== -3 /* ABORTED */) this.emit('load-failed', { code, desc, url });
    });
    wc.on('render-process-gone', (_e, details) => {
      if (details.reason === 'clean-exit') return;
      this.crashed = true;
      this.emit('crashed', details.reason);
      upd();
    });
    wc.on('found-in-page', (_e, r) => this.emit('found', r));
    wc.on('zoom-changed', (_e, dir) => this.emit('zoom-key', dir));
    wc.on('context-menu', (_e, params) => this.emit('context-menu', params));
    wc.on('before-input-event', (e, input) => this.emit('input', e, input));
    wc.on('enter-html-full-screen', () => this.emit('html-fullscreen', true));
    wc.on('leave-html-full-screen', () => this.emit('html-fullscreen', false));
    wc.on('destroyed', () => {
      if (this.view === view) {
        this.view = null;
        this.emit('closed-by-page');
      }
    });
    wc.on('will-prevent-unload', (e) => e.preventDefault());
    // window.open becomes a tab, or a popup window when the page asks for one (sizes, `popup`);
    // both keep the opener (ui/popup_window.ts).
    wc.setWindowOpenHandler((details) => {
      if (!this.onOpen) return { action: 'deny' };
      if (!/^(https?|about|blob|data):/.test(details.url) && details.url !== '') return { action: 'deny' };
      if (WebTab.popupPolicy && !WebTab.popupPolicy(wc, details.url, details.disposition)) return { action: 'deny' };
      return {
        action: 'allow',
        createWindow: (options) => this.onOpen!({ url: details.url, disposition: details.disposition, features: details.features, options }) as WebContents,
      };
    });
  }
}
