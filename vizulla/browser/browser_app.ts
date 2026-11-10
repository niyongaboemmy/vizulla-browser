// BrowserApp: process-wide wiring (the ChromeBrowserMainExtraParts role).
// Binds IPC interfaces, routes commands, builds the application menu with
// Chrome-compatible accelerators, runs tab lifecycle timers, and exposes the
// extension points later phases register into (panels, AI actions, agent).
import { app, BrowserWindow, ipcMain, Menu, type MenuItemConstructorOptions, nativeTheme, powerMonitor, type Session, session as electronSession, shell, systemPreferences } from 'electron';
import { join } from 'node:path';
import type { Profile } from './profile';
import { BrowserWindowController, WEBUI_PRELOAD, type WindowInit } from './ui/browser_window';
import { IpcRouter, emitTo, type CallContext } from './ui/ipc_router';
import { OverlayInterface, PagesInterface, ShellInterface } from '@vz/common/mojom/shell';
import { installWebUIHandler } from './ui/webui_protocol';
import { COMMANDS, findCommand, type CommandDef } from './command_bar/commands';
import { resolveAccept, suggest, type SuggestSources } from './command_bar/suggest';
import { setLocale, resolveLocale, t, type StringKey } from '@vz/common/i18n';
import { displayUrl, searchUrl, securityStateOf, setCustomEngine } from '@vz/common/url';
import type { AgentBarState, PanelKind, Suggestion } from '@vz/common/types';
import { ALL_FEATURES } from './vizulla_features';
import { InternalPages } from './ui/internal_pages';
import { confirmNl } from './ai/ai_features';
import { UpdateService } from './updates/update_service';
import { PasswordService } from './passwords/password_service';
import { ExtensionsService } from './extensions/extensions_service';
import { WebTab } from './tabs/web_tab';
import { installJsDialogs, type DialogHost } from './ui/js_dialogs';
import { installPasskeys } from './ui/passkeys';
import { profileArgs, Profiles } from './profiles/profiles';
import { BRANDING } from '../app/branding';
import { destinationUrl, matchDestinations } from './command_bar/destinations';
import { EngineSuggest } from './command_bar/engine_suggest';
import { ToolsService } from './tools/tools_service';
import { installDevTools } from './tools/dev_tools';
import { McpServer } from './mcp/mcp_server';
import { permissionsUi } from './permissions/permissions_ui';

export type CommandHandler = (w: BrowserWindowController, args?: Record<string, unknown>) => unknown;
export type PageMethod = (payload: unknown, ctx: CallContext & { window: BrowserWindowController | null }) => unknown;

/** Accept-Language per UI language, most specific first; English is the fallback everywhere. */
const WEB_LANGUAGES: Record<string, string[]> = {
  en: ['en-US', 'en'],
  fr: ['fr-FR', 'fr', 'en'],
  rw: ['rw-RW', 'rw', 'en', 'fr'],
  sw: ['sw', 'sw-KE', 'sw-TZ', 'en'],
};

export class BrowserApp {
  readonly windows = new Set<BrowserWindowController>();
  readonly router = new IpcRouter();
  readonly chromeSession: Session;
  readonly preloadPath: string;
  readonly commandHandlers = new Map<string, CommandHandler>();
  readonly pageHandlers = new Map<string, Record<string, PageMethod>>();
  /** Hooks for later phases. Each defaults to a no-op. */
  readonly hooks = {
    ask: [] as ((w: BrowserWindowController, text: string) => boolean)[],
    ensurePanel: [] as ((w: BrowserWindowController, panel: PanelKind) => void)[],
    selectionActions: [] as ((w: BrowserWindowController, tab: import('./tabs/web_tab').WebTab, text: string, p: Electron.ContextMenuParams) => MenuItemConstructorOptions[])[],
    agentBarState: null as ((w: BrowserWindowController) => AgentBarState | null) | null,
    tabInput: [] as ((w: BrowserWindowController, tab: import('./tabs/web_tab').WebTab, e: Electron.Event, input: Electron.Input) => boolean)[],
    suggestSources: [] as ((p: Profile, base: SuggestSources) => Partial<SuggestSources>)[],
    windowCreated: [] as ((w: BrowserWindowController) => void)[],
    /** Async work (e.g. Memory recall over IPC) done before a synchronous suggest pass. */
    prefetchSuggest: [] as ((w: BrowserWindowController, q: string) => Promise<void>)[],
  };
  quitting = false;
  locale = 'en';
  private lastFocused: BrowserWindowController | null = null;
  private privateProfiles = new Set<Profile>();
  private timers: NodeJS.Timeout[] = [];
  readonly pages: InternalPages;
  readonly updates: UpdateService;
  readonly passwords: PasswordService;
  readonly extensions: ExtensionsService;
  /** Permission prompts, device choosers and the screen picker (permissions_ui.ts). */
  private readonly permissionsUi = permissionsUi(this);
  readonly tools: ToolsService;
  /** Installed web apps (apps/web_apps.ts), set up with the phase services. */
  webApps: import('./apps/web_apps').WebAppsService | null = null;
  /** Google accounts on the web and Gemini (google/google_service.ts), set up with the phase services. */
  google: import('./google/google_service').GoogleService | null = null;
  /** Sign-in and payment popups open from pages (ui/popup_window.ts). */
  readonly popups = new Set<import('./ui/popup_window').PopupWindow>();
  /** An installed app's window in front takes the menu shortcuts it understands. */
  appCommand: ((id: string) => boolean) | null = null;
  mcp!: McpServer;
  private readonly engineSuggest = new EngineSuggest();
  /** Where each window's extensions menu was opened (popups anchor there). */
  private readonly extensionsAnchor = new WeakMap<BrowserWindowController, { x: number; y: number; width: number; height: number }>();
  readonly profiles: Profiles;

  constructor(readonly profile: Profile, readonly outDir: string) {
    this.preloadPath = WEBUI_PRELOAD(outDir);
    this.chromeSession = electronSession.fromPartition('persist:vizulla-chrome');
    // Every web frame's settings in one synchronous call (preload/page_preload.ts).
    ipcMain.on('vz:page-config', (e) => {
      e.returnValue = {
        langs: this.webLanguages.get(e.sender.session) ?? [],
        farble: this.farbleConfig?.(e.sender.session, e.senderFrame?.top?.url ?? e.sender.getURL()) ?? { level: 'off', seed: 0 },
        // Same-site prefetch on hover: regular windows only (private ones keep nothing ahead of a click).
        preload: profile.prefs.get('performance.preloadPages') && e.sender.session === profile.session && !e.senderFrame?.parent,
        cosmetic: e.sender.session !== this.chromeSession,
        scripts: e.sender.session === this.chromeSession ? [] : profile.shields.scriptsFor(e.senderFrame?.url ?? e.sender.getURL(), e.senderFrame?.top?.url ?? e.sender.getURL()),
      };
    });
    // A page switched its own theme: the frame samples its colour again (page_preload.ts).
    ipcMain.on('vz:page-color-changed', (e) => void this.findTabByWebContents(e.sender)?.tab.samplePageColor());
    ipcMain.handle('vz:cosmetic', (e, f: unknown) => {
      const list = (v: unknown) => (Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string' && x.length <= 300).slice(0, 2000) : []);
      const o = (f ?? {}) as Record<string, unknown>;
      const frame = e.senderFrame?.url ?? e.sender.getURL();
      return profile.shields.cosmeticFor(frame, e.senderFrame?.top?.url ?? frame, { classes: list(o.classes), ids: list(o.ids), hrefs: list(o.hrefs) });
    });
    installJsDialogs(this);
    installPasskeys(this);
    this.applyLocale();
    WebTab.fonts = () => {
      const p = profile.prefs;
      const family = Object.fromEntries((['standard', 'serif', 'sansSerif', 'monospace'] as const).map((k) => [k, p.get(`fonts.${k}`)]).filter(([, v]) => v));
      return { ...(Object.keys(family).length ? { defaultFontFamily: family } : {}), ...(p.get('fonts.minimumSize') ? { minimumFontSize: p.get('fonts.minimumSize') } : {}) };
    };
    profile.prefs.observe('appearance.locale', () => {
      this.applyLocale();
      this.buildMenu();
      this.broadcastState();
    });
    for (const k of ['appearance.theme', 'appearance.accent', 'appearance.density', 'appearance.siteColors', 'tabs.layout', 'tabs.classic', 'ai.mode', 'flags.user'] as const) {
      profile.prefs.observe(k, () => this.broadcastState());
    }
    profile.prefs.observe('appearance.theme', (v) => {
      nativeTheme.themeSource = v === 'high-contrast' ? 'dark' : v;
    });
    nativeTheme.themeSource = profile.prefs.get('appearance.theme') === 'high-contrast' ? 'dark' : (profile.prefs.get('appearance.theme') as 'system' | 'light' | 'dark');
    nativeTheme.on('updated', () => this.broadcastState());
    profile.prefs.observe('shields.doh', () => profile.shields.applyDnsConfig());
    setCustomEngine(profile.prefs.get('search.custom'));
    profile.prefs.observe('search.custom', (v) => {
      setCustomEngine(v);
      if (!v && profile.prefs.get('search.engine') === 'custom') profile.prefs.set('search.engine', 'duckduckgo');
    });
    profile.spaces.on('changed', () => this.broadcastState());
    profile.spaces.on('archive-changed', () => this.broadcastState());

    for (const s of [this.chromeSession, profile.session]) installWebUIHandler(s, { outDir, dynamic: {} });
    profile.permissions.install(profile.session, this.permissionsUi);
    this.blockWebUINavigationFromWeb(profile.session);

    const testFeed = !!process.env.VZ_TEST && !!process.env.VZ_UPDATE_FEED;
    this.updates = new UpdateService({
      // A private, in-memory session: update checks carry no cookies or history.
      session: electronSession.fromPartition('vizulla-updates'),
      version: app.getVersion(),
      packaged: app.isPackaged || testFeed,
      feedUrl: BRANDING.updateFeedUrl,
      dir: join(app.getPath('userData'), 'Updates'),
      autoCheck: () => profile.prefs.get('updates.autoCheck'),
      onChange: () => this.broadcastState(),
      quit: () => {
        this.prepareToQuit();
        app.quit();
      },
      reveal: (target) => (/^https:/.test(target) ? this.openInTab(target) : shell.showItemInFolder(target)),
      allowUrl: testFeed ? (u) => u.startsWith('http://127.0.0.1:') : undefined,
    });
    if (!process.env.VZ_TEST || testFeed) this.updates.start(testFeed ? 500 : 15_000);
    const pa = profileArgs(process.argv, app.getPath('userData'));
    this.profiles = new Profiles(pa.id, pa.root, () => void this.openWindow());
    this.passwords = new PasswordService(this);
    this.extensions = new ExtensionsService(this, profile);
    this.tools = new ToolsService(this);
    installDevTools(this);
    this.pages = new InternalPages(this);
    this.bindInterfaces();
    this.registerBaseCommands();
    this.buildMenu();
    this.startTimers();
    void this.extensions.start();
    this.mcp = new McpServer(this);
    // Optional (macOS): private windows lock when Vizulla goes to the background.
    if (process.platform === 'darwin') {
      app.on('did-resign-active', () => {
        if (!this.profile.prefs.get('privacy.lockPrivate') || !systemPreferences.canPromptTouchID()) return;
        for (const w of this.windows) if (w.profile.isPrivate) void w.lockPrivate();
      });
    }
  }

  userDataPath(): string {
    return app.getPath('userData');
  }

  /** The window and tab that own a tab's web contents (extensions, context menus). */
  findTabByWebContents(wc: Electron.WebContents): { window: BrowserWindowController; tab: WebTab } | null {
    for (const w of this.windows) for (const tab of w.tabs.values()) if (tab.wc === wc) return { window: w, tab };
    return null;
  }

  /** Where a page's dialogs appear (ui/js_dialogs.ts): its window's overlay, with its tab brought forward. */
  dialogHost(wc: Electron.WebContents): DialogHost | null {
    const found = this.findTabByWebContents(wc);
    if (found) {
      return {
        overlay: found.window.overlay,
        // The overlay can't load remote images: only an embedded (data:) favicon is shown.
        favicon: found.tab.favicon?.startsWith('data:image/') ? found.tab.favicon : null,
        focus: () => {
          if (found.window.activeTab()?.id !== found.tab.id) found.window.activateTab(found.tab.id);
          if (found.window.win.isMinimized()) found.window.win.restore();
        },
      };
    }
    const popup = [...this.popups].find((p) => p.wc === wc);
    if (popup) return { overlay: popup.overlay, favicon: null, focus: () => popup.focus() };
    return this.appDialogHost?.(wc) ?? null;
  }

  /** Large overlay results by one-time token (Overlay.stashBlob), taken once. */
  private readonly blobs = new Map<string, { at: number; data: string }>();
  takeBlob(token: unknown): string | null {
    if (typeof token !== 'string') return null;
    const b = this.blobs.get(token);
    this.blobs.delete(token);
    return b?.data ?? null;
  }

  /** What an app window's overlay needs to look right (no browser window behind it). */
  private appOverlayState() {
    const p = this.profile.prefs;
    return { locale: this.locale, theme: p.get('appearance.theme'), accent: p.get('appearance.accent'), density: p.get('appearance.density') };
  }

  /** Installed web apps' windows host their own dialogs (apps/web_apps.ts). */
  appDialogHost: ((wc: Electron.WebContents) => DialogHost | null) | null = null;

  // ------------------------------------------------------------ windows

  openWindow(opts: { private?: boolean; restore?: import('./spaces/spaces_service').SessionWindow | null; profile?: Profile; init?: WindowInit } = {}): BrowserWindowController {
    let profile = opts.profile ?? this.profile;
    if (opts.private && !opts.profile) {
      profile = this.profile.createPrivate();
      this.privateProfiles.add(profile);
      installWebUIHandler(profile.session, { outDir: this.outDir, dynamic: {} });
      this.applyWebLanguage(profile.session);
      profile.permissions.install(profile.session, this.permissionsUi);
    }
    const w = new BrowserWindowController(this, profile, opts.restore ?? null, opts.init);
    this.windows.add(w);
    this.lastFocused = w;
    for (const fn of this.hooks.windowCreated) fn(w);
    return w;
  }

  /**
   * Moves live tabs between windows of one profile: dragged out of a strip
   * ('new', placed at the drop point), dragged onto another strip, or from the
   * tab menu. Agent tabs stay put. A window left with no tabs closes.
   */
  moveTabs(ids: number[], to: BrowserWindowController | 'new', opts: { index?: number; point?: { x: number; y: number } } = {}): BrowserWindowController | null {
    const owner = (id: number) => [...this.windows].find((w) => w.tabs.has(id));
    const first = ids.map(owner).find(Boolean);
    if (!first) return null;
    const profile = to === 'new' ? first.profile : to.profile;
    const picked = ids
      .map((id) => ({ id, from: owner(id) }))
      .filter((x): x is { id: number; from: BrowserWindowController } => !!x.from && x.from.profile === profile && x.from !== to);
    // Dragging every tab out of a window is just moving that window.
    if (to === 'new' && picked.length && picked.every((x) => x.from === first) && picked.length === first.model.all().length) {
      if (opts.point) first.win.setPosition(Math.round(opts.point.x - 120), Math.round(opts.point.y - 16));
      first.win.focus();
      return first;
    }
    const released = picked.map((x) => ({ from: x.from, r: x.from.releaseTab(x.id) })).filter((x) => x.r);
    if (!released.length) return null;
    let target: BrowserWindowController;
    if (to === 'new') {
      const [width, height] = first.win.getSize();
      const bounds = opts.point
        ? { x: Math.round(opts.point.x - 120), y: Math.round(opts.point.y - 16), width: width!, height: height! }
        : { ...first.win.getBounds(), x: first.win.getBounds().x + 32, y: first.win.getBounds().y + 32 };
      target = this.openWindow({ profile, init: { bounds, adopt: released.map((x) => x.r!) } });
    } else {
      target = to;
      released.forEach((x, i) => target.adoptTab(x.r!.tab, { pinned: x.r!.pinned, index: opts.index === undefined ? undefined : opts.index + i, activate: i === released.length - 1 }));
    }
    for (const from of new Set(released.map((x) => x.from))) {
      if (!from.model.all().length) from.win.close();
      else if (!from.model.visible().length) from.createTab({ url: 'vizulla://newtab/', activate: true });
    }
    target.win.focus();
    target.focusActive();
    return target;
  }

  /** Other windows of the same profile, for "Move to window" menus. */
  windowChoices(w: BrowserWindowController): { w: BrowserWindowController; label: string }[] {
    return this.windowsOf(w.profile)
      .filter((x) => x !== w)
      .map((x) => ({ w: x, label: x.activeTab()?.title || t('window_untitled') }));
  }

  restoreOrOpen(): void {
    const saved = this.profile.prefs.get('tabs.restoreOnStartup') ? this.profile.spaces.loadWindows() : [];
    if (!this.profile.prefs.get('tabs.restoreOnStartup')) for (const w of this.profile.spaces.loadWindows()) this.profile.spaces.forgetWindow(w.key);
    if (saved.length) for (const s of saved) this.openWindow({ restore: s });
    else this.openWindow();
  }

  onWindowClosed(w: BrowserWindowController): void {
    this.windows.delete(w);
    if (this.lastFocused === w) this.lastFocused = [...this.windows].at(-1) ?? null;
    if (w.profile.isPrivate && !this.windowsOf(w.profile).length) {
      this.privateProfiles.delete(w.profile);
      void w.profile.session.clearStorageData().catch(() => undefined);
      w.profile.shutdown();
    }
    this.buildMenu();
  }

  windowsOf(profile: Profile): BrowserWindowController[] {
    return [...this.windows].filter((w) => w.profile === profile);
  }

  setLastFocused(w: BrowserWindowController): void {
    this.lastFocused = w;
  }

  focused(): BrowserWindowController | null {
    return [...this.windows].find((w) => w.win.isFocused()) ?? this.lastFocused ?? [...this.windows][0] ?? null;
  }

  broadcastState(): void {
    for (const w of this.windows) w.pushState();
  }

  windowForSender(wc: Electron.WebContents): BrowserWindowController | null {
    for (const w of this.windows) {
      if (w.chrome.webContents === wc || w.overlay.webContents === wc) return w;
      for (const tab of w.tabs.values()) if (tab.wc === wc) return w;
    }
    return null;
  }

  // ------------------------------------------------------------ hooks used by windows

  ask(w: BrowserWindowController, text: string): void {
    for (const fn of this.hooks.ask) if (fn(w, text)) return;
    // Without the assistant: fall back to search, never silently drop input.
    const tab = w.activeTab();
    w.loadUrl(tab?.id ?? null, searchUrl(this.profile.prefs.get('search.engine'), text));
  }

  ensurePanel(w: BrowserWindowController, panel: PanelKind): void {
    for (const fn of this.hooks.ensurePanel) fn(w, panel);
  }

  selectionActions(w: BrowserWindowController, tab: import('./tabs/web_tab').WebTab, text: string, p: Electron.ContextMenuParams): MenuItemConstructorOptions[] {
    return this.hooks.selectionActions.flatMap((fn) => fn(w, tab, text, p));
  }

  agentBarState(w: BrowserWindowController): AgentBarState | null {
    return this.hooks.agentBarState?.(w) ?? null;
  }

  handleTabInput(w: BrowserWindowController, tab: import('./tabs/web_tab').WebTab, e: Electron.Event, input: Electron.Input): void {
    for (const fn of this.hooks.tabInput) if (fn(w, tab, e, input)) return;
  }

  // ------------------------------------------------------------ commands

  commandEnabled(c: CommandDef, w: BrowserWindowController | null): boolean {
    if (c.feature) {
      const f = ALL_FEATURES.find((x) => x.name === c.feature);
      if (f && !(w?.profile ?? this.profile).features.isEnabled(f)) return false;
    }
    if (c.id.startsWith('ai.') && this.profile.prefs.get('ai.mode') === 'off') return false;
    return !!this.commandHandlers.get(c.id);
  }

  async runCommand(w: BrowserWindowController | null, id: string, args?: Record<string, unknown>): Promise<void> {
    if (!w && this.appCommand?.(id)) return;
    // A sign-in popup in front takes the shortcuts it understands (⌘W closes it, not the tab behind).
    if (!w && [...this.popups].find((p) => !p.win.isDestroyed() && p.win.isFocused())?.command(id)) return;
    const target = w ?? this.focused();
    const handler = this.commandHandlers.get(id);
    const def = findCommand(id);
    if (!handler || !target || (def && !this.commandEnabled(def, target))) return;
    await handler(target, args);
  }

  private registerBaseCommands(): void {
    const tab = (w: BrowserWindowController) => w.activeTab();
    const page = (url: string) => (w: BrowserWindowController) => {
      const existing = [...w.tabs.values()].find((x) => x.url.startsWith(url));
      if (existing) w.activateTab(existing.id);
      else w.createTab({ url, activate: true });
    };
    const c = this.commandHandlers;
    c.set('tab.new', (w) => this.openNewTab(w));
    c.set('tab.close', (w) => {
      const x = tab(w);
      if (x) w.closeTab(x.id);
    });
    c.set('tab.reopen', (w) => w.reopenClosed());
    c.set('tab.duplicate', (w) => {
      const x = tab(w);
      if (x) w.createTab({ nav: x.navState(), url: x.url, title: x.title, afterId: x.id, activate: true });
    });
    c.set('tab.pin', (w) => {
      const x = tab(w);
      if (x) w.model.setPinned(x.id, !w.model.get(x.id)!.pinned);
    });
    c.set('tab.mute', (w) => {
      const x = tab(w);
      if (!x) return;
      x.muted = !x.muted;
      x.wc?.setAudioMuted(x.muted);
      w.pushState();
    });
    c.set('tab.next', (w) => {
      w.model.cycle(1);
      w.focusActive();
    });
    c.set('tab.previous', (w) => {
      w.model.cycle(-1);
      w.focusActive();
    });
    c.set('tab.search', (w) => this.openCommandBar(w, 'tab-search'));
    c.set('tab.closeOthers', (w) => {
      const keep = w.model.activeTabId;
      for (const m of w.model.visible()) if (m.id !== keep && !m.pinned) w.closeTab(m.id);
    });
    c.set('tab.archiveIdle', (w) => {
      const n = w.autoArchive(Date.now(), true);
      if (!n) w.toast(t('toast_nothing_to_archive'), undefined, 2500);
    });
    c.set('tab.group', (w, args) => {
      const x = tab(w);
      if (x && !w.model.get(x.id)!.pinned) w.model.createGroup([x.id], String(args?.title ?? t('group_default_title')), w.state().accent);
    });
    c.set('tab.split', (w) => {
      const visible = w.model.visible().filter((m) => m.id !== w.model.activeTabId);
      if (w.state().splitTabId !== null) w.setSplit(null);
      else if (visible.length) w.setSplit([...visible].sort((a, b) => b.lastActive - a.lastActive)[0]!.id);
      else w.toast(t('toast_split_needs_tab'), undefined, 2500);
    });
    c.set('tab.moveToSpace', (w, args) => {
      const x = tab(w);
      const space = this.resolveSpace(w, args?.space);
      if (x && space) w.model.moveToSpace(x.id, space);
    });
    c.set('space.new', (w, args) => {
      if (args?.name) {
        const s = w.profile.spaces.create({ name: String(args.name) });
        w.switchSpace(s.id);
      } else void w.editSpace(null);
    });
    c.set('space.rename', (w, args) => {
      if (args?.name) w.profile.spaces.update(w.model.activeSpaceId, { name: String(args.name) });
      else void w.editSpace(w.model.activeSpaceId);
    });
    c.set('space.delete', (w) => void w.deleteSpace(w.model.activeSpaceId));
    c.set('space.switch', (w, args) => {
      const s = this.resolveSpace(w, args?.space);
      if (s) w.switchSpace(s);
    });
    c.set('space.next', (w) => w.cycleSpace(1));
    c.set('space.previous', (w) => w.cycleSpace(-1));
    c.set('focus.toggle', (w) => void w.focusMode());
    c.set('nav.back', (w) => tab(w)?.wc?.navigationHistory.goBack());
    c.set('nav.forward', (w) => tab(w)?.wc?.navigationHistory.goForward());
    c.set('nav.reload', (w) => tab(w)?.wc?.reload());
    c.set('nav.hardReload', (w) => tab(w)?.wc?.reloadIgnoringCache());
    c.set('nav.focusAddress', (w) => this.openCommandBar(w, 'address'));
    c.set('nav.commandBar', (w) => this.openCommandBar(w, 'palette'));
    c.set('nav.copyUrl', (w) => w.copyUrl());
    c.set('nav.bookmark', (w) => {
      const x = tab(w);
      if (!x || !/^https?:/.test(x.url)) return;
      if (w.profile.history.isBookmarked(x.url)) {
        const b = w.profile.history.bookmarks().find((y) => y.url === x.url);
        if (b) w.profile.history.removeBookmark(b.id);
        w.toast(t('toast_bookmark_removed'), undefined, 2500);
      } else {
        w.profile.history.addBookmark(x.url, x.title);
        w.toast(t('toast_bookmarked'), undefined, 2500);
      }
    });
    c.set('view.toggleSidebar', (w) => w.profile.prefs.set('tabs.sidebarCollapsed', !w.profile.prefs.get('tabs.sidebarCollapsed')));
    c.set('view.toggleLayout', (w) => w.profile.prefs.set('tabs.layout', w.profile.prefs.get('tabs.layout') === 'vertical' ? 'horizontal' : 'vertical'));
    c.set('view.classic', (w) => {
      const on = !w.profile.prefs.get('tabs.classic');
      w.profile.prefs.set('tabs.classic', on);
      if (on) w.setPanel(null);
    });
    c.set('view.find', (w) => emitTo(w.chrome.webContents, 'Shell', 'find-open'));
    c.set('view.zoomIn', (w) => tab(w) && w.zoom(tab(w)!.id, 'in'));
    c.set('view.zoomOut', (w) => tab(w) && w.zoom(tab(w)!.id, 'out'));
    c.set('view.zoomReset', (w) => tab(w) && w.zoom(tab(w)!.id, 'reset'));
    c.set('view.devtools', (w) => tab(w)?.wc?.toggleDevTools());
    c.set('view.fullscreen', (w) => w.win.setFullScreen(!w.win.isFullScreen()));
    c.set('view.theme', (w) => {
      const order = ['system', 'light', 'dark', 'high-contrast'] as const;
      const cur = order.indexOf(w.profile.prefs.get('appearance.theme'));
      w.profile.prefs.set('appearance.theme', order[(cur + 1) % order.length]!);
      w.toast(t('toast_theme', { theme: t(`theme_${order[(cur + 1) % order.length]!.replace('-', '_')}` as StringKey) }), undefined, 2000);
    });
    c.set('shields.toggleSite', (w) => {
      const x = tab(w);
      if (!x?.url.startsWith('http')) return;
      const on = !w.profile.shields.isSiteEnabled(x.url);
      w.profile.shields.setSiteEnabled(x.url, on);
      x.wc?.reload();
      w.toast(on ? t('toast_shields_on') : t('toast_shields_off'), undefined, 2500);
    });
    c.set('privacy.clearHistory', async (w) => {
      const ok = await w.overlay.dialog<boolean | null>({ type: 'confirm', title: t('clear_history_title'), body: t('clear_history_body'), confirm: t('action_clear'), danger: true });
      if (!ok) return;
      w.profile.history.clearAll();
      await w.profile.session.clearCache();
      w.toast(t('toast_history_cleared'));
    });
    c.set('window.newPrivate', () => void this.openWindow({ private: true }));
    c.set('window.new', () => void this.openWindow());
    c.set('app.checkUpdates', async (w) => {
      w.toast(t('upd_checking'), undefined, 2000);
      const r = await this.updates.check();
      if (r === 'latest') w.toast(t('upd_latest'), undefined, 3000);
      else if (r === 'error') w.toast(t('upd_failed', { error: 'offline' }), undefined, 4000);
    });
    c.set('app.update', () => void this.updates.activate());
    c.set('window.next', (w) => {
      const list = this.windowsOf(w.profile);
      if (list.length > 1) list[(list.indexOf(w) + 1) % list.length]!.win.focus();
    });
    c.set('tab.moveToNewWindow', (w) => {
      const id = w.model.activeTabId;
      if (id !== null && w.model.all().length > 1) this.moveTabs([id], 'new');
    });
    c.set('page.settings', page('vizulla://settings'));
    c.set('page.settingsShields', page('vizulla://settings/shields'));
    c.set('page.settingsPermissions', page('vizulla://settings/permissions'));
    c.set('page.history', page('vizulla://history'));
    c.set('page.passwords', (w) => this.passwords.open(w));
    c.set('profile.manage', (w) => this.openProfiles(w));
    c.set('profile.add', (w) => this.openProfiles(w, true));
    c.set('page.downloads', page('vizulla://downloads'));
    c.set('page.extensions', page('vizulla://extensions'));
    c.set('page.taskManager', page('vizulla://task-manager'));
    c.set('page.apps', page('vizulla://apps'));
    c.set('app.install', (w) => {
      const x = tab(w);
      if (x && this.webApps?.stateFor(x.wc)?.state === 'installable') void this.webApps.promptInstall(w, x.id);
      else if (x && this.webApps?.stateFor(x.wc)?.state === 'installed') this.webApps.openInApp(w, x.id);
      else w.toast(t('app_not_installable'), undefined, 3000);
    });
    c.set('window.closePrivate', () => {
      for (const x of [...this.windows]) if (x.profile.isPrivate) x.win.close();
    });
    c.set('page.bookmarks', page('vizulla://bookmarks'));
    c.set('page.privacy', page('vizulla://privacy'));
    c.set('page.archive', page('vizulla://archive'));
    c.set('page.flags', page('vizulla://flags'));
    c.set('page.import', page('vizulla://settings/import'));
    c.set('page.about', page('vizulla://about'));
  }

  private resolveSpace(w: BrowserWindowController, v: unknown): string | null {
    if (typeof v !== 'string' || !v) return null;
    const spaces = w.profile.spaces.list();
    const byId = spaces.find((s) => s.id === v);
    if (byId) return byId.id;
    const q = v.toLowerCase();
    return (spaces.find((s) => s.name.toLowerCase() === q) ?? spaces.find((s) => s.name.toLowerCase().includes(q)))?.id ?? null;
  }

  /** Like Chrome: "+" and ⌘T open a New Tab page right away, with the address bar ready to type. */
  openNewTab(w: BrowserWindowController): void {
    w.loadUrl(null, 'vizulla://newtab/', { newTab: true });
    this.openCommandBar(w, 'address');
  }

  openCommandBar(w: BrowserWindowController, mode: 'palette' | 'address' | 'tab-search' | 'ask', anchor?: { x: number; y: number; width: number; height: number }, newTab = false): void {
    const tab = w.activeTab();
    const initial = mode === 'address' && !newTab && tab && !tab.url.startsWith('vizulla://newtab') ? tab.url : mode === 'palette' ? '' : '';
    w.overlay.show({ kind: 'command-bar', mode, anchor, initial, newTab });
  }

  // ------------------------------------------------------------ IPC

  private bindInterfaces(): void {
    const win = (ctx: CallContext) => {
      const w = this.windowForSender(ctx.sender);
      if (!w) throw new Error('no window');
      return w;
    };
    const overlayOf = (ctx: CallContext) => {
      const o = this.windowForSender(ctx.sender)?.overlay ?? this.webApps?.overlayForSender(ctx.sender) ?? [...this.popups].find((p) => p.overlay.webContents === ctx.sender)?.overlay;
      if (!o) throw new Error('no overlay');
      return o;
    };
    this.router.bind(
      ShellInterface,
      {
        getState: (ctx) => win(ctx).state(),
        newTab: (ctx, url) => {
          const w = win(ctx);
          if (url) w.loadUrl(null, url, { newTab: true });
          else this.openNewTab(w);
        },
        closeTab: (ctx, id) => win(ctx).closeTab(id),
        activateTab: (ctx, id) => win(ctx).activateTab(id),
        navigate: (ctx, id, input) => win(ctx).navigate(id, input),
        goBack: (ctx, id) => win(ctx).tabs.get(id)?.wc?.navigationHistory.goBack(),
        goForward: (ctx, id) => win(ctx).tabs.get(id)?.wc?.navigationHistory.goForward(),
        reload: (ctx, id, hard) => {
          const tab = win(ctx).tabs.get(id);
          if (!tab) return;
          if (tab.discarded || tab.crashed) {
            tab.destroy();
            tab.ensureLive();
          } else if (hard) tab.wc?.reloadIgnoringCache();
          else tab.wc?.reload();
        },
        stop: (ctx, id) => win(ctx).tabs.get(id)?.wc?.stop(),
        setPinned: (ctx, id, pinned) => win(ctx).model.setPinned(id, pinned),
        setMuted: (ctx, id, muted) => {
          const tab = win(ctx).tabs.get(id);
          if (!tab) return;
          tab.muted = muted;
          tab.wc?.setAudioMuted(muted);
          win(ctx).pushState();
        },
        moveTab: (ctx, id, index, groupId) => win(ctx).model.move(id, index, groupId === undefined ? undefined : groupId || null),
        moveTabToSpace: (ctx, id, spaceId) => {
          if (win(ctx).profile.spaces.get(spaceId)) win(ctx).model.moveToSpace(id, spaceId);
        },
        showTabMenu: (ctx, id, point, selection) => this.showTabMenu(win(ctx), id, point, selection),
        showPasswordMenu: (ctx, id, point) => {
          const w = win(ctx);
          const tab = w.tabs.get(id);
          if (tab) this.passwords.showMenu(w, tab, point);
        },
        showProfileMenu: (ctx, point) => this.showProfileMenu(win(ctx), point),
        openAccountMenu: (ctx, anchor) => {
          const w = win(ctx);
          if (w.profile.isPrivate) return;
          if (!this.google) return this.showProfileMenu(w, { x: anchor.x, y: anchor.y + anchor.height + 4 });
          w.overlay.show({ kind: 'accounts', anchor, menu: this.google.menu(w) });
        },
        setPanelView: (ctx, r) => win(ctx).setPanelViewBounds(r ?? null),
        geminiAction: (ctx, what) => this.google?.panelAction(win(ctx), what),
        showTip: (ctx, r, doc) => void win(ctx).tip.show(r, doc),
        installApp: (ctx, id) => void this.webApps?.promptInstall(win(ctx), id),
        openInApp: (ctx, id) => this.webApps?.openInApp(win(ctx), id),
        hideTip: (ctx) => win(ctx).tip.hide(),
        detachTabs: (ctx, ids, point) => void this.moveTabs(ids.filter((x) => win(ctx).tabs.has(x)), 'new', { point }),
        adoptTabs: (ctx, ids, index) => void this.moveTabs(ids, win(ctx), { index }),
        showSpaceMenu: (ctx, spaceId, point) => this.showSpaceMenu(win(ctx), spaceId, point),
        showAppMenu: (ctx, point) => win(ctx).showMenuAt(this.appMenu(win(ctx)), point),
        switchSpace: (ctx, id) => win(ctx).switchSpace(id),
        createSpace: (ctx, input) => {
          const w = win(ctx);
          if (input?.name) w.switchSpace(w.profile.spaces.create({ name: input.name, color: input.color, icon: input.icon }).id);
          else void w.editSpace(null);
        },
        editSpace: (ctx, id) => void win(ctx).editSpace(id),
        updateSpace: (ctx, id, patch) => win(ctx).profile.spaces.update(id, patch),
        deleteSpace: (ctx, id) => void win(ctx).deleteSpace(id),
        reorderSpaces: (ctx, ids) => win(ctx).profile.spaces.reorder(ids),
        createGroup: (ctx, ids, title) => win(ctx).model.createGroup(ids, title || t('group_default_title'), win(ctx).state().accent),
        updateGroup: (ctx, id, patch) => win(ctx).model.updateGroup(id, patch),
        ungroup: (ctx, id) => win(ctx).model.ungroup(id),
        setContentBounds: (ctx, main, split) => win(ctx).setContentBounds(main, split),
        setSidebar: (ctx, s) => {
          const p = win(ctx).profile.prefs;
          if (s.collapsed !== undefined) p.set('tabs.sidebarCollapsed', s.collapsed);
          if (s.width !== undefined) p.set('tabs.sidebarWidth', s.width);
          this.broadcastState();
        },
        setPanel: (ctx, panel, width) => win(ctx).setPanel(panel ?? null, width),
        openCommandBar: (ctx, mode, anchor) => this.openCommandBar(win(ctx), mode, anchor),
        runCommand: (ctx, id, args) => this.runCommand(win(ctx), id, (args ?? undefined) as Record<string, unknown> | undefined),
        dismissToast: (ctx, id) => win(ctx).dismissToast(id),
        toastAction: (ctx, id) => win(ctx).toastAction(id),
        find: (ctx, id, text, o) => {
          const wc = win(ctx).tabs.get(id)?.wc;
          if (wc && text) wc.findInPage(text, { forward: o.forward, findNext: o.findNext });
        },
        stopFind: (ctx, id) => win(ctx).tabs.get(id)?.wc?.stopFindInPage('clearSelection'),
        restoreArchived: (ctx, id) => win(ctx).restoreArchived(id),
        openShieldsPanel: (ctx, anchor) => {
          const w = win(ctx);
          const tab = w.activeTab();
          if (!tab?.wc) return;
          w.overlay.show({ kind: 'shields', anchor, status: w.profile.shields.status(tab.wc.id, tab.url) });
        },
        openSiteInfo: (ctx, anchor) => {
          const w = win(ctx);
          const info = this.siteInfo(w);
          if (info) w.overlay.show({ kind: 'site-info', anchor, info });
        },
        openToolsMenu: (ctx, anchor) => {
          const w = win(ctx);
          this.tools.anchors.set(w, anchor);
          this.tools.openMenu(w, anchor);
        },
        openAppMenu: (ctx, anchor) => {
          const w = win(ctx);
          w.overlay.show({ kind: 'app-menu', anchor, menu: this.appMenuModel(w) });
        },
        openExtensionsMenu: (ctx, anchor) => {
          const w = win(ctx);
          if (w.profile.isPrivate) return;
          this.extensionsAnchor.set(w, anchor);
          w.overlay.show({ kind: 'extensions', anchor, items: this.extensions.menuItems() });
        },
        windowControl: (ctx, what) => {
          const w = win(ctx).win;
          if (what === 'minimize') w.minimize();
          else if (what === 'maximize') (w.isMaximized() ? w.unmaximize() : w.maximize());
          else w.close();
        },
        agentControl: (ctx, what) => this.runCommand(win(ctx), `agent.control.${what}`),
      },
      { hosts: ['chrome'] },
    );

    this.router.bind(
      OverlayInterface,
      {
        // An installed app's window has its own overlay (dialogs, permission prompts): these resolve
        // the overlay by its sender, not only browser windows'.
        ready: (ctx) => overlayOf(ctx).onReady(),
        getState: (ctx) => this.windowForSender(ctx.sender)?.state() ?? this.appOverlayState(),
        runCommand: (ctx, id) => this.runCommand(win(ctx), id),
        close: (ctx, result) => overlayOf(ctx).close(result),
        stashBlob: (ctx, token, data) => {
          // Large results (an installing app's icons) travel apart from the small dialog result.
          if (!/^data:image\/png;base64,[A-Za-z0-9+/=]+$/.test(data)) throw new Error('not a PNG');
          this.blobs.set(token, { at: Date.now(), data });
          for (const [k, b] of this.blobs) if (Date.now() - b.at > 120_000) this.blobs.delete(k);
        },
        query: async (ctx, input, mode) => {
          const w = win(ctx);
          await Promise.all(this.hooks.prefetchSuggest.map((fn) => fn(w, input).catch(() => undefined)));
          const r = suggest(input, mode, this.suggestSources(w));
          // Search-engine suggestions under the search row (address bar, normal windows).
          if (mode === 'address' && r.route === 'search' && !w.profile.isPrivate && w.profile.prefs.get('search.suggestions')) {
            const list = await this.engineSuggest.get(w.profile.prefs.get('search.engine'), input);
            if (list.length) {
              const rows: Suggestion[] = list.map((s) => ({ id: `search:${s}`, kind: 'search', title: s, detail: t('cb_engine_suggestion'), icon: 'search', section: 'search' }));
              const at = r.suggestions.findIndex((s) => s.kind === 'search');
              if (at >= 0) r.suggestions.splice(at + 1, 0, ...rows);
              else r.suggestions.push(...rows);
              r.suggestions = r.suggestions.slice(0, 16);
            }
          }
          // Warm up a connection to the site the top row would open (DNS + TLS), as
          // Chrome's omnibox does; Enter then lands sooner.
          const top = r.suggestions[0];
          if (top?.kind === 'url' && top.id.startsWith('nav:https://')) {
            try {
              w.profile.session.preconnect({ url: top.id.slice(4), numSockets: 1 });
            } catch {
              /* not a valid URL yet */
            }
          }
          return r;
        },
        accept: (ctx, input, suggestionId, opts) => this.acceptCommandBar(win(ctx), input, suggestionId, opts),
        dialogResult: (ctx, id, result) => overlayOf(ctx).dialogResult(id, result),
        setShieldsForSite: (ctx, on) => {
          const w = win(ctx);
          const tab = w.activeTab();
          if (!tab?.wc || !tab.url.startsWith('http')) return null;
          w.profile.shields.setSiteEnabled(tab.url, on);
          tab.wc.reload();
          return w.profile.shields.status(tab.wc.id, tab.url);
        },
        setAdsForSite: (ctx, allow) => {
          const w = win(ctx);
          const tab = w.activeTab();
          if (!tab?.wc || !tab.url.startsWith('http')) return null;
          w.profile.shields.setAdsAllowed(tab.url, allow);
          tab.wc.reload();
          return w.profile.shields.status(tab.wc.id, tab.url);
        },
        setSitePermission: (ctx, kindId, value) => {
          const w = win(ctx);
          const info = this.siteInfo(w);
          if (!info || !['allow', 'block', 'ask'].includes(value)) return info;
          w.profile.permissions.set(info.origin, kindId, value === 'ask' ? null : (value as 'allow' | 'block'));
          return this.siteInfo(w);
        },
        resetSitePermissions: (ctx) => {
          const w = win(ctx);
          const info = this.siteInfo(w);
          if (info) w.profile.permissions.resetSite(info.origin);
          w.activeTab()?.wc?.reload();
          return this.siteInfo(w);
        },
        accountAction: (ctx, id) => this.google?.action(win(ctx), id) ?? null,
        appMenuAction: (ctx, id) => {
          const w = win(ctx);
          // Zoom and theme rows keep the menu open, so the change can be seen and adjusted.
          if (/^theme:(system|light|dark)$/.test(id)) {
            this.profile.prefs.set('appearance.theme', id.slice(6) as 'system' | 'light' | 'dark');
            return this.appMenuModel(w);
          }
          const stay = id === 'view.zoomIn' || id === 'view.zoomOut' || id === 'view.zoomReset';
          if (!stay) w.overlay.close();
          if (id === 'tools.menu') {
            this.tools.openMenu(w);
            return null;
          }
          this.runCommand(w, id);
          return stay ? this.appMenuModel(w) : null;
        },
        extensionMenu: (ctx, id, action) => {
          const w = win(ctx);
          if (action === 'pin' || action === 'unpin') this.extensions.setPinned(id, action === 'pin');
          else if (action === 'manage') {
            w.overlay.close();
            this.openInTab('vizulla://extensions/');
          } else if (action === 'open') {
            w.overlay.close();
            this.extensions.activate(w, id, this.extensionsAnchor.get(w) ?? { x: 0, y: 0, width: 0, height: 0 });
          }
          return this.extensions.menuItems();
        },
      },
      { hosts: ['overlay'] },
    );

    this.router.bind(
      PagesInterface,
      {
        getInitialData: async (ctx) => {
          const handlers = this.pageHandlers.get(ctx.host);
          const w = this.windowForSender(ctx.sender);
          // A page's init may be async (e.g. extensions finish loading first).
          const data = (await handlers?.init?.(null, { ...ctx, window: w })) ?? null;
          const theme = w?.profile.isPrivate ? 'dark' : this.profile.prefs.get('appearance.theme');
          return { locale: this.locale, theme, accent: this.profile.prefs.get('appearance.accent'), data };
        },
        invoke: (ctx, method, payload) => {
          const fn = this.pageHandlers.get(ctx.host)?.[method];
          if (!fn || method === 'init') throw new Error(`unknown method ${ctx.host}.${method}`);
          return fn(payload, { ...ctx, window: this.windowForSender(ctx.sender) });
        },
      },
      { hosts: this.pages.hosts },
    );
  }

  suggestSources(w: BrowserWindowController): SuggestSources {
    const p = w.profile;
    const spaces = new Map(p.spaces.list().map((s) => [s.id, s.name]));
    const base: SuggestSources = {
      // Tab search spans every window of the profile; other windows are labelled.
      tabs: () => {
        const wins = this.windowsOf(p);
        return wins
          .flatMap((x, n) => x.model.all().map((m) => ({ x, m, label: x === w || wins.length < 2 ? '' : ` · ${t('window_n', { n: n + 1 })}` })))
          .sort((a, b) => Number(b.x === w) - Number(a.x === w) || b.m.lastActive - a.m.lastActive)
          .map(({ x, m, label }) => {
            const tab = x.tabs.get(m.id)!;
            return { id: m.id, title: tab.title, url: tab.url, favicon: tab.favicon, spaceName: (spaces.get(m.spaceId) ?? '') + label, pinned: m.pinned, active: x === w && m.id === w.model.activeTabId };
          })
          .filter((x) => !x.url.startsWith('vizulla://newtab'));
      },
      history: (q, n) => p.history.search(q, n),
      bookmarks: (q, n) => p.history.searchBookmarks(q, n),
      archive: (q, n) =>
        p.spaces.listArchive(undefined, 200).filter((a) => !q || `${a.title} ${a.url}`.toLowerCase().includes(q.toLowerCase())).slice(0, n),
      inlineCompletion: (q) => p.history.inlineCompletion(q),
      commandTitle: (c) => t(c.title),
      commandEnabled: (c) => this.commandEnabled(c, w),
      shortcutLabel: (a) => acceleratorLabel(a),
      searchEngine: p.prefs.get('search.engine'),
      aiEnabled: p.prefs.get('ai.mode') !== 'off',
      destinations: (q, n, group) =>
        matchDestinations(q, (d) => t(d.title), n, group)
          .filter(({ d }) => !d.command || this.commandHandlers.has(d.command))
          .flatMap(({ d }) => {
            const target = d.command ? `cmd:${d.command}` : destinationUrl(d, (k) => t(k));
            return target ? [{ id: d.id, title: t(d.title), detail: t(`cb_dest_${d.group}`), icon: d.icon, target: d.command ? target : `nav:${target}` }] : [];
          }),
      strings: {
        goTo: t('cb_go_to'), searchFor: t('cb_search_with'), ask: t('cb_ask_assistant'), switchToTab: t('cb_switch_to_tab'), restoreArchived: t('cb_restore_archived'),
        scopes: { tabs: t('cb_scope_tabs'), history: t('cb_scope_history'), bookmarks: t('cb_scope_bookmarks'), settings: t('cb_scope_settings'), tools: t('cb_scope_tools') },
      },
    };
    for (const fn of this.hooks.suggestSources) Object.assign(base, fn(p, base));
    return base;
  }

  private acceptCommandBar(w: BrowserWindowController, input: string, suggestionId: string | undefined, opts: { newTab?: boolean; route?: string }): void {
    const action = resolveAccept(input, suggestionId, w.profile.prefs.get('search.engine'));
    w.overlay.close();
    const tab = w.activeTab();
    const newTab = opts.newTab || !tab;
    switch (action.kind) {
      case 'navigate':
        w.loadUrl(newTab ? null : tab!.id, action.url, { typed: action.typed, newTab });
        break;
      case 'switch-tab': {
        const owner = this.windowsOf(w.profile).find((x) => x.tabs.has(action.tabId)) ?? w;
        owner.activateTab(action.tabId);
        if (owner !== w) owner.win.focus();
        break;
      }
      case 'command':
        if (suggestionId?.startsWith('nl:')) void confirmNl(this, w, action.id).then((ok) => { if (ok) void this.runCommand(w, action.id, action.args); });
        else void this.runCommand(w, action.id, action.args);
        break;
      case 'ask':
        this.ask(w, action.text);
        break;
      case 'restore-archived':
        w.restoreArchived(action.id);
        break;
      case 'memory':
        void this.runCommand(w, 'memory.open', { id: action.id });
        break;
    }
  }

  private showTabMenu(w: BrowserWindowController, id: number, point?: { x: number; y: number }, selection?: number[]): void {
    const tab = w.tabs.get(id);
    const m = w.model.get(id);
    if (!tab || !m) return;
    const sel = (selection ?? []).filter((x) => w.tabs.has(x));
    if (sel.length > 1 && sel.includes(id)) return this.showMultiTabMenu(w, sel, point);
    const spaces = w.profile.spaces.list().filter((s) => s.id !== m.spaceId);
    const windows = this.windowChoices(w);
    const groups = w.model.groupList(m.spaceId);
    const items: MenuItemConstructorOptions[] = [
      { label: m.pinned ? t('ctx_unpin') : t('ctx_pin'), click: () => w.model.setPinned(id, !m.pinned) },
      { label: tab.muted ? t('ctx_unmute') : t('ctx_mute'), click: () => {
        tab.muted = !tab.muted;
        tab.wc?.setAudioMuted(tab.muted);
        w.pushState();
      } },
      { label: t('cmd_tab_duplicate'), click: () => w.createTab({ nav: tab.navState(), url: tab.url, title: tab.title, afterId: id }) },
      { label: t('ctx_open_split'), enabled: id !== w.model.activeTabId, click: () => w.setSplit(id) },
      { type: 'separator' },
      { label: t('ctx_move_to_space'), enabled: spaces.length > 0, submenu: spaces.map((s) => ({ label: s.name, click: () => w.model.moveToSpace(id, s.id) })) },
      { label: t('ctx_move_to_new_window'), enabled: !tab.agent, click: () => this.moveTabs([id], 'new') },
      ...(windows.length ? [{ label: t('ctx_move_to_window'), enabled: !tab.agent, submenu: windows.map((x) => ({ label: x.label, click: () => this.moveTabs([id], x.w) })) }] : []),
      {
        label: t('ctx_add_to_group'),
        enabled: !m.pinned,
        submenu: [
          { label: t('ctx_new_group'), click: () => w.model.createGroup([id], t('group_default_title'), w.state().accent) },
          ...(groups.length ? [{ type: 'separator' as const }] : []),
          ...groups.map((g) => ({ label: g.title, click: () => {
            const list = w.model.visible(m.spaceId);
            const last = list.map((x) => x.groupId).lastIndexOf(g.id);
            w.model.move(id, last + 1, g.id);
          } })),
        ],
      },
      ...(m.groupId ? [{ label: t('ctx_remove_from_group'), click: () => w.model.move(id, w.model.visible(m.spaceId).findIndex((x) => x.id === id), null) }] : []),
      { label: t('ctx_copy_link'), click: () => require('electron').clipboard.writeText(tab.url) },
      { label: t('ctx_sleep_tab'), enabled: !tab.discarded && id !== w.model.activeTabId, click: () => w.discardTab(id) },
      { type: 'separator' },
      { label: t('cmd_tab_close'), click: () => w.closeTab(id) },
      { label: t('cmd_tab_close_others'), click: () => w.model.visible(m.spaceId).filter((x) => x.id !== id && !x.pinned).forEach((x) => w.closeTab(x.id)) },
    ];
    w.showMenuAt(Menu.buildFromTemplate(items), point);
  }

  /** The toolbar avatar: this profile, the others, and profile management. */
  private showProfileMenu(w: BrowserWindowController, point?: { x: number; y: number }): void {
    const cur = this.profiles.current();
    const others = this.profiles.list().filter((p) => p.id !== cur.id).sort((a, b) => b.lastUsed - a.lastUsed);
    const items: MenuItemConstructorOptions[] = [
      { label: cur.name, sublabel: t('profile_current'), enabled: false },
      { type: 'separator' },
      ...others.map((p) => ({ label: p.name, click: () => this.profiles.open(p.id) })),
      ...(others.length ? [{ type: 'separator' as const }] : []),
      { label: t('profile_add'), click: () => this.openProfiles(w, true) },
      { label: t('profile_manage'), click: () => this.openProfiles(w) },
      { type: 'separator' },
      { label: t('cmd_new_private'), click: () => void this.openWindow({ private: true }) },
    ];
    w.showMenuAt(Menu.buildFromTemplate(items), point);
  }

  openProfiles(w: BrowserWindowController, add = false): void {
    w.loadUrl(null, add ? 'vizulla://profiles/#new' : 'vizulla://profiles/', { newTab: true });
  }

  private showMultiTabMenu(w: BrowserWindowController, ids: number[], point?: { x: number; y: number }): void {
    const metas = ids.map((x) => w.model.get(x)!).filter(Boolean);
    const count = metas.length;
    const allPinned = metas.every((x) => x.pinned);
    const unpinned = metas.filter((x) => !x.pinned).map((x) => x.id);
    const spaces = w.profile.spaces.list().filter((s) => s.id !== w.model.activeSpaceId);
    const windows = this.windowChoices(w);
    const items: MenuItemConstructorOptions[] = [
      { label: t('ctx_selected_tabs', { count }), enabled: false },
      { type: 'separator' },
      { label: t(allPinned ? 'ctx_unpin_tabs' : 'ctx_pin_tabs', { count }), click: () => ids.forEach((x) => w.model.setPinned(x, !allPinned)) },
      { label: t('ctx_group_tabs', { count: unpinned.length }), enabled: unpinned.length > 0, click: () => w.model.createGroup(unpinned, t('group_default_title'), w.state().accent) },
      { label: t('ctx_move_to_space'), enabled: spaces.length > 0, submenu: spaces.map((s) => ({ label: s.name, click: () => ids.forEach((x) => w.model.moveToSpace(x, s.id)) })) },
      { label: t('ctx_move_to_new_window'), click: () => this.moveTabs(ids, 'new') },
      ...(windows.length ? [{ label: t('ctx_move_to_window'), submenu: windows.map((x) => ({ label: x.label, click: () => this.moveTabs(ids, x.w) })) }] : []),
      { label: t('ctx_bookmark_tabs', { count }), click: () => ids.forEach((x) => { const tb = w.tabs.get(x); if (tb && !tb.url.startsWith('vizulla://')) w.profile.history.addBookmark(tb.url, tb.title); }) },
      { type: 'separator' },
      { label: t('ctx_close_tabs', { count }), click: () => ids.forEach((x) => w.closeTab(x)) },
    ];
    w.showMenuAt(Menu.buildFromTemplate(items), point);
  }

  private showSpaceMenu(w: BrowserWindowController, spaceId: string, point?: { x: number; y: number }): void {
    const many = w.profile.spaces.list().length > 1;
    w.showMenuAt(
      Menu.buildFromTemplate([
        { label: t('space_edit_title'), click: () => void w.editSpace(spaceId) },
        { label: t('cmd_space_new'), click: () => void w.editSpace(null) },
        { type: 'separator' },
        { label: t('space_delete'), enabled: many, click: () => void w.deleteSpace(spaceId) },
      ]),
      point,
    );
  }

  /** Web pages may not navigate or redirect into vizulla:// pages (only the browser opens them). */
  private blockWebUINavigationFromWeb(s: Session): void {
    app.on('web-contents-created', (_e, wc) => {
      if (wc.session !== s) return;
      wc.on('will-navigate', (e, url) => {
        if (url.startsWith('vizulla://') && !wc.getURL().startsWith('vizulla://')) e.preventDefault();
      });
      wc.on('will-frame-navigate', (e) => {
        if (!e.isMainFrame && e.url.startsWith('vizulla://')) e.preventDefault();
      });
    });
  }

  // ------------------------------------------------------------ menu & accelerators

  /** The site-info panel (lock icon): connection security and this site's permissions. */
  siteInfo(w: BrowserWindowController) {
    const tab = w.activeTab();
    if (!tab?.wc || !/^https?:/.test(tab.url)) return null;
    const origin = new URL(tab.url).origin;
    return { origin, host: new URL(origin).host, security: securityStateOf(tab.url, tab.certError), rows: w.profile.permissions.forSite(origin, tab.wc.id) };
  }

  /** The ⋮ menu (glass, in the overlay): Chrome's layout with Vizulla's tools. */
  appMenuModel(w: BrowserWindowController) {
    const item = (id: string, sub = false) => {
      const c = findCommand(id);
      return c ? { id, label: t(c.title), shortcut: acceleratorLabel(c.accelerator) ?? '', enabled: this.commandEnabled(c, w), sub } : null;
    };
    const group = (...ids: (string | [string, true])[]) => ids.map((x) => (Array.isArray(x) ? item(x[0], true) : item(x))).filter(Boolean);
    const u = this.updates.info();
    const model = {
      zoom: Math.round((w.activeTab()?.zoom ?? 1) * 100),
      // Private windows are always dark: no theme row there.
      theme: w.profile.isPrivate ? null : this.profile.prefs.get('appearance.theme'),
      update: u && (u.status === 'available' || u.status === 'ready') ? t(u.status === 'ready' ? 'upd_ready' : 'upd_available', { version: u.version }) : null,
      groups: [
        group('tab.new', 'window.new', 'window.newPrivate'),
        group('page.history', 'page.downloads', 'page.bookmarks', 'page.passwords', 'page.extensions', 'page.apps'),
        group(['tools.menu', true], 'view.find', 'tools.print', 'tools.savePdf', 'page.taskManager'),
        group('page.settings', 'page.about'),
      ],
    };
    // A page that can be installed (or is): its own item at the top, like Chrome's "Install…".
    const inst = w.profile.isPrivate ? null : this.webApps?.stateFor(w.activeTab()?.wc);
    if (inst) model.groups.unshift([{ id: 'app.install', label: t(inst.state === 'installable' ? 'app_install_menu' : 'app_open_in', { name: inst.name }), shortcut: '', enabled: true, sub: false }]);
    return model;
  }

  appMenu(w: BrowserWindowController | null): Menu {
    const item = (id: string): MenuItemConstructorOptions => {
      const c = findCommand(id)!;
      return { label: t(c.title), accelerator: c.accelerator, enabled: this.commandEnabled(c, w), click: () => void this.runCommand(null, id) };
    };
    const hidden: MenuItemConstructorOptions[] = [];
    // Chrome's other DevTools shortcuts: F12 everywhere, Ctrl+Shift+I on Windows/Linux.
    for (const accel of ['F12', ...(process.platform === 'darwin' ? [] : ['Ctrl+Shift+I'])]) {
      hidden.push({ label: 'DevTools', accelerator: accel, visible: false, acceleratorWorksWhenHidden: true, click: () => void this.runCommand(null, 'view.devtools') });
    }
    for (let i = 1; i <= 9; i++) {
      hidden.push({ label: `Tab ${i}`, accelerator: `CmdOrCtrl+${i}`, visible: false, acceleratorWorksWhenHidden: true, click: () => {
        const f = this.focused();
        if (f) {
          f.model.selectIndex(i);
          f.focusActive();
        }
      } });
      hidden.push({ label: `Space ${i}`, accelerator: `CmdOrCtrl+Alt+${i}`, visible: false, acceleratorWorksWhenHidden: true, click: () => {
        const f = this.focused();
        const s = f?.profile.spaces.list()[i - 1];
        if (f && s) f.switchSpace(s.id);
      } });
    }
    const template: MenuItemConstructorOptions[] = [
      ...(process.platform === 'darwin'
        ? [{ label: 'Vizulla', submenu: [item('page.about'), item('app.checkUpdates'), { type: 'separator' }, item('page.settings'), { type: 'separator' }, { role: 'services' }, { type: 'separator' }, { role: 'hide' }, { role: 'hideOthers' }, { role: 'unhide' }, { type: 'separator' }, { role: 'quit' }] } as MenuItemConstructorOptions]
        : []),
      { label: t('menu_file'), submenu: [item('tab.new'), item('window.new'), item('window.newPrivate'), item('window.closePrivate'), item('tab.reopen'), { type: 'separator' }, item('tab.close'), item('page.import'), ...(process.platform !== 'darwin' ? [{ type: 'separator' } as const, { role: 'quit' } as const] : [])] },
      { label: t('menu_edit'), submenu: [{ role: 'undo' }, { role: 'redo' }, { type: 'separator' }, { role: 'cut' }, { role: 'copy' }, { role: 'paste' }, { role: 'selectAll' }, { type: 'separator' }, item('view.find'), item('nav.copyUrl')] },
      { label: t('menu_view'), submenu: [item('nav.commandBar'), item('nav.focusAddress'), item('view.toggleSidebar'), item('view.toggleLayout'), item('view.classic'), item('view.reader'), item('ai.panel'), { type: 'separator' }, item('view.zoomIn'), item('view.zoomOut'), item('view.zoomReset'), item('view.fullscreen'), { type: 'separator' }, item('view.devtools'), item('view.inspect'), item('view.source'), item('page.taskManager')] },
      { label: t('menu_tabs'), submenu: [item('tab.next'), item('tab.previous'), item('tab.search'), item('tab.pin'), item('tab.mute'), item('tab.duplicate'), item('tab.split'), item('tab.archiveIdle'), { type: 'separator' }, item('space.next'), item('space.previous'), item('space.new'), item('focus.toggle'), ...hidden] },
      { label: t('menu_go'), submenu: [item('nav.back'), item('nav.forward'), item('nav.reload'), item('nav.hardReload'), { type: 'separator' }, item('page.history'), item('page.bookmarks'), item('nav.bookmark'), item('page.downloads'), item('page.passwords'), item('page.extensions'), item('page.privacy'), item('page.archive')] },
      { label: t('menu_window'), role: 'windowMenu' },
      { label: t('menu_help'), role: 'help', submenu: [item('page.about'), item('app.checkUpdates'), item('page.flags'), { label: t('menu_report_issue'), click: () => void shell.openExternal('https://github.com/') }] },
    ];
    return Menu.buildFromTemplate(template);
  }

  buildMenu(): void {
    const menu = this.appMenu(this.focused());
    Menu.setApplicationMenu(menu);
    for (const w of this.windows) if (process.platform !== 'darwin') (w.win as unknown as BrowserWindow).setMenu?.(menu);
  }

  // ------------------------------------------------------------ lifecycle

  private startTimers(): void {
    // Auto-archive every 10 minutes and once shortly after startup (P2-BRW-09).
    const archive = () => {
      for (const w of this.windows) w.autoArchive();
      this.profile.spaces.purgeArchive(this.profile.prefs.get('tabs.archiveRetentionDays'));
      this.profile.privacy.purge(this.profile.prefs.get('privacy.logRetentionDays'));
    };
    this.timers.push(setTimeout(archive, 60_000), setInterval(archive, 10 * 60_000));
    // Memory Saver: discard background tabs idle longer than the threshold (TAB-07).
    this.timers.push(
      setInterval(() => {
        const base = this.profile.prefs.get('tabs.memorySaverMinutes');
        if (!base) return;
        // Adaptive: sooner on battery, much sooner when the computer is short of memory.
        const mem = process.getSystemMemoryInfo();
        const low = mem.total > 0 && mem.free / mem.total < 0.05;
        const mins = low ? Math.min(base, 5) : powerMonitor.isOnBatteryPower() ? Math.min(base, 15) : base;
        const exempt = new Set(this.profile.prefs.get('tabs.discardExemptSites'));
        const now = Date.now();
        for (const w of this.windows) {
          for (const m of w.model.all()) {
            const tab = w.tabs.get(m.id);
            if (!tab || tab.discarded || now - m.lastActive < mins * 60_000) continue;
            try {
              if (exempt.has(new URL(tab.url).hostname)) continue;
            } catch {
              /* ignore */
            }
            if (w.discardTab(m.id)) w.pushState();
          }
        }
      }, 60_000),
    );
    for (const x of this.timers) x.unref?.();
  }

  private applyLocale(): void {
    const pref = this.profile.prefs.get('appearance.locale');
    this.locale = pref === 'auto' ? resolveLocale(app.getPreferredSystemLanguages()) : pref;
    setLocale(this.locale);
    this.applyWebLanguage(this.profile.session);
    for (const p of this.privateProfiles) this.applyWebLanguage(p.session);
  }

  /**
   * Websites see the browser's language: the Accept-Language header and
   * navigator.language(s) follow it, so sites open in Kinyarwanda, Kiswahili,
   * French or English when they offer it. "Auto" keeps the system's languages.
   */
  applyWebLanguage(ses: Session): void {
    const pref = this.profile.prefs.get('appearance.locale');
    const list = pref === 'auto' || pref === 'pseudo' ? app.getPreferredSystemLanguages() : WEB_LANGUAGES[pref] ?? ['en-US', 'en'];
    const langs = [...new Set([...list, 'en'])].slice(0, 6);
    ses.setUserAgent(ses.getUserAgent(), langs.join(','));
    this.webLanguages.set(ses, langs);
    if (!this.langPreloaded.has(ses)) {
      this.langPreloaded.add(ses);
      try {
        ses.registerPreloadScript({ type: 'frame', id: 'vz-page', filePath: this.joinOut('preload', 'page_preload.js') });
      } catch (err) {
        console.warn('[vz] page preload unavailable', err);
      }
    }
  }

  private readonly webLanguages = new WeakMap<Session, string[]>();
  /** Fingerprinting protection settings for a frame (shields/platform_features.ts). */
  farbleConfig: ((ses: Session, topUrl: string) => { level: 'off' | 'standard' | 'strict'; seed: number }) | null = null;
  private readonly langPreloaded = new WeakSet<Session>();

  prepareToQuit(): void {
    if (this.quitting) return;
    this.quitting = true;
    for (const w of this.windows) w.saveNow();
  }

  /**
   * Clear on exit: cookies, site storage and cache go; history, passwords and
   * extensions' own data stay. Capped so a stuck remover never blocks quitting.
   */
  async clearSiteData(): Promise<void> {
    const s = this.profile.session;
    const excludeOrigins = s.extensions.getAllExtensions().map((x) => `chrome-extension://${x.id}`);
    const work = s.clearData({ dataTypes: ['cache', 'cookies', 'fileSystems', 'indexedDB', 'localStorage', 'serviceWorkers', 'webSQL', 'backgroundFetch'], excludeOrigins });
    await Promise.race([work.catch((e) => console.warn('[vz] clear on exit failed', e)), new Promise((r) => setTimeout(r, 4000))]);
  }

  /** Opens a URL in a new tab of the focused window. */
  openInTab(url: string): void {
    const w = this.focused() ?? this.openWindow();
    w.loadUrl(null, url, { newTab: true });
  }

  shutdown(): void {
    this.prepareToQuit();
    this.updates.stop();
    for (const x of this.timers) clearInterval(x);
    for (const p of this.privateProfiles) p.shutdown();
    this.profile.shutdown();
  }

  /** Commands listed for vizulla:// pages that show shortcuts (settings, about). */
  commandList(): { id: string; title: string; shortcut?: string; category: string }[] {
    return COMMANDS.filter((c) => this.commandEnabled(c, this.focused())).map((c) => ({ id: c.id, title: t(c.title), shortcut: acceleratorLabel(c.accelerator), category: c.category }));
  }

  joinOut(...p: string[]): string {
    return join(this.outDir, ...p);
  }
}

export function acceleratorLabel(a: string | undefined): string | undefined {
  if (!a) return undefined;
  const mac = process.platform === 'darwin';
  return a
    .split('+')
    .map((k) => {
      if (k === 'CmdOrCtrl') return mac ? '⌘' : 'Ctrl';
      if (k === 'Alt') return mac ? '⌥' : 'Alt';
      if (k === 'Shift') return mac ? '⇧' : 'Shift';
      if (k === 'Ctrl') return mac ? '⌃' : 'Ctrl';
      if (k === 'Right') return '→';
      if (k === 'Left') return '←';
      return k;
    })
    .join(mac ? '' : '+');
}
