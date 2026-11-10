// BrowserWindowController: one window. Owns the chrome WebUI view (vizulla://chrome),
// the tab views, the overlay layer, and the window's TabStripModel.
//
// View stack (bottom → top): chrome UI (sidebar, toolbar, panels) · tab view(s)
// placed in the content rect the chrome UI reports · overlay (when open).
import { BaseWindow, clipboard, Menu, nativeTheme, screen, systemPreferences, WebContentsView, type WebContents } from 'electron';
import { EventEmitter } from 'node:events';
import { randomUUID } from 'node:crypto';
import { join } from 'node:path';
import type { BrowserApp } from '../browser_app';
import type { Profile } from '../profile';
import { TabStripModel } from '../tabs/tab_strip_model';
import { logicalUrl, WebTab, type WebTabOptions } from '../tabs/web_tab';
import type { NavState, SessionWindow } from '../spaces/spaces_service';
import { OverlayController } from './overlay';
import { TipView } from './tip_view';
import { PopupWindow } from './popup_window';
import { holdsMedia } from '../tabs/tab_lifecycle';
import { emitTo } from './ipc_router';
import { buildPageContextMenu } from './context_menu';
import { classifyInput, displayUrl, searchUrl, siteOf } from '@vz/common/url';
import { windowBackground } from '@vz/common/tokens';
import { t } from '@vz/common/i18n';
import type { PanelKind, Rect, SpaceColor, SpaceIcon, TabInfo, ToastInfo, WindowState } from '@vz/common/types';
import { kVizullaAutoArchive } from '../vizulla_features';

import { isMac } from './glass';
import { inkFor, neutralFrame } from '@vz/common/color';

export interface CreateTabOptions {
  url?: string;
  nav?: NavState | null;
  title?: string;
  favicon?: string | null;
  spaceId?: string;
  activate?: boolean;
  afterId?: number;
  openerId?: number | null;
  pinned?: boolean;
  groupId?: string | null;
  discarded?: boolean;
  lastActive?: number;
  adoptView?: WebContentsView;
  agent?: boolean;
  session?: Electron.Session;
}

/** A window opened from tabs dragged out of another window. */
export interface WindowInit {
  bounds?: Rect;
  adopt?: { tab: WebTab; pinned: boolean }[];
}

interface ClosedTab {
  spaceId: string;
  url: string;
  title: string;
  nav: NavState;
  pinned: boolean;
}

export class BrowserWindowController extends EventEmitter {
  readonly key: string;
  readonly win: BaseWindow;
  readonly chrome: WebContentsView;
  readonly overlay: OverlayController;
  readonly tip: TipView;
  readonly model: TabStripModel;
  readonly tabs = new Map<number, WebTab>();
  private contentRect: Rect = { x: 0, y: 0, width: 0, height: 0 };
  private splitRect: Rect | null = null;
  private splitTabId: number | null = null;
  private panel: PanelKind | null = null;
  /** A web page shown in the side panel (Gemini), and where the chrome UI says it goes. */
  private panelView: WebContentsView | null = null;
  private panelViewRect: Rect | null = null;
  private toasts: (ToastInfo & { timer: NodeJS.Timeout; run?: () => void })[] = [];
  private readonly closed: ClosedTab[] = [];
  private stateTimer: NodeJS.Timeout | null = null;
  private saveTimer: NodeJS.Timeout | null = null;
  private attachedViews = new Set<WebContentsView>();
  private htmlFullscreen = false;
  private destroyed = false;
  private chromeReady = false;

  constructor(readonly app: BrowserApp, readonly profile: Profile, restore: SessionWindow | null, init: WindowInit = {}) {
    super();
    this.key = restore?.key ?? randomUUID();
    const prefs = profile.prefs;
    const bounds = init.bounds ?? restore?.bounds ?? defaultBounds();
    this.win = new BaseWindow({
      ...bounds,
      minWidth: 400,
      minHeight: 360,
      show: false,
      title: profile.isPrivate ? 'Vizulla — Private' : 'Vizulla',
      // The frame is solid, coloured like the visited site (shell.ts), the same on every OS: no
      // see-through OS material (it made text hard to read over busy wallpapers).
      backgroundColor: windowBackground(this.resolvedTheme()),
      ...(isMac
        ? { titleBarStyle: 'hiddenInset', trafficLightPosition: { x: 14, y: 14 } }
        : { titleBarStyle: 'hidden', titleBarOverlay: this.titleBarOverlay() }),
    } as Electron.BaseWindowConstructorOptions);
    // The theme changed (Settings, or the computer's appearance while following it): solid frames
    // and Windows/Linux caption buttons follow, so nothing is left in the old colours.
    const onTheme = () => {
      if (this.destroyed) return;
      this.win.setBackgroundColor(windowBackground(this.resolvedTheme()));
      this.updateCaptionButtons();
    };
    nativeTheme.on('updated', onTheme);
    this.win.once('closed', () => nativeTheme.off('updated', onTheme));
    this.chrome = new WebContentsView({
      webPreferences: {
        session: app.chromeSession,
        preload: app.preloadPath,
        sandbox: true,
        contextIsolation: true,
        nodeIntegration: false,
        spellcheck: false,
        backgroundThrottling: false,
      },
    });
    this.chrome.setBackgroundColor('#00000000');
    this.win.contentView.addChildView(this.chrome);
    this.overlay = new OverlayController(this.win, app.preloadPath, () => app.chromeSession);
    this.tip = new TipView(this.win, () => app.chromeSession);
    this.overlay.onClosed = (surface) => {
      if (surface?.kind === 'command-bar') this.focusActive();
    };

    const spaces = profile.spaces.list();
    const activeSpace = restore?.activeSpaceId && spaces.some((s) => s.id === restore.activeSpaceId) ? restore.activeSpaceId : spaces[0]!.id;
    this.model = new TabStripModel(activeSpace);
    this.model.on('changed', () => {
      this.syncViews();
      this.pushState();
      this.scheduleSave();
    });
    this.panel = null;

    this.win.on('resize', () => {
      this.overlay.layout();
      this.scheduleSave();
    });
    this.win.on('move', () => this.scheduleSave());
    this.win.on('focus', () => {
      this.app.setLastFocused(this);
      this.pushState();
    });
    this.win.on('blur', () => this.pushState());
    this.win.on('enter-full-screen', () => this.pushState());
    this.win.on('leave-full-screen', () => this.pushState());
    this.win.on('close', () => this.onClose());
    // Private windows: no screenshots or screen recording of their content (on by default).
    if (profile.isPrivate && prefs.get('privacy.privateCaptureProtection')) this.win.setContentProtection(true);
    this.chrome.webContents.on('did-finish-load', () => {
      this.chromeReady = true;
      this.lastState = ''; // a (re)loaded chrome UI needs the full state
      this.pushState(true);
    });
    this.chrome.webContents.on('render-process-gone', () => {
      // The chrome UI must never stay dead: reload it.
      this.chromeReady = false;
      setTimeout(() => !this.destroyed && void this.chrome.webContents.loadURL('vizulla://chrome/'), 200);
    });
    this.layoutChrome();
    this.win.on('resize', () => this.layoutChrome());
    void this.chrome.webContents.loadURL('vizulla://chrome/');

    if (restore?.tabs.length) {
      for (const g of restore.groups) this.model.restoreGroup(g);
      for (const tab of restore.tabs) {
        const created = this.createTab({
          nav: tab.nav, url: tab.url, title: tab.title, favicon: tab.favicon, spaceId: tab.spaceId, pinned: tab.pinned,
          groupId: tab.groupId, lastActive: tab.lastActive, discarded: true, activate: false,
        });
        if (tab.active) this.model.setActiveForSpace(tab.spaceId, created.id);
      }
      this.model.switchSpace(activeSpace);
      this.activeTab()?.ensureLive();
    }
    for (const a of init.adopt ?? []) this.adoptTab(a.tab, { pinned: a.pinned });
    if (!this.model.visible().length) this.createTab({ url: 'vizulla://newtab/', activate: true });

    this.win.show();
    if (isMac) this.win.setWindowButtonVisibility(true);
  }

  // ---------------------------------------------------------------- tabs

  activeTab(): WebTab | null {
    const id = this.model.activeTabId;
    return id === null ? null : (this.tabs.get(id) ?? null);
  }

  createTab(o: CreateTabOptions): WebTab {
    const spaceId = o.spaceId ?? this.model.activeSpaceId;
    const tab = new WebTab({
      session: o.session ?? this.profile.session,
      url: o.url,
      nav: o.nav,
      title: o.title,
      favicon: o.favicon,
      discarded: o.discarded,
      preload: this.app.preloadPath,
      agent: o.agent,
      adoptView: o.adoptView,
    });
    tab.setOpener(this.openerFor(tab));
    this.tabs.set(tab.id, tab);
    this.wireTab(tab);
    this.model.add(
      { id: tab.id, spaceId, openerId: o.openerId ?? null, pinned: o.pinned ?? false, groupId: o.groupId ?? null, lastActive: o.lastActive },
      { afterId: o.afterId, activate: o.activate ?? true },
    );
    return tab;
  }

  private openerFor(tab: WebTab): WebTabOptions['onOpen'] {
    return ({ url, disposition, features, options }) => {
      // A sign-in or payment popup (window.open with a size or `popup`): a small window over this one, as in Chrome.
      if (disposition === 'new-window' && !tab.agent && /^(https?:|about:blank|$)/.test(url)) return new PopupWindow(this.app, this, options, features).wc;
      const view = new WebContentsView({ webContents: (options as { webContents?: WebContents }).webContents, webPreferences: options.webPreferences } as Electron.WebContentsViewConstructorOptions);
      const child = this.createTab({
        adoptView: view, url, spaceId: this.model.get(tab.id)?.spaceId, afterId: tab.id, openerId: tab.id,
        activate: disposition !== 'background-tab', agent: tab.agent, session: tab.session,
      });
      return child.wc;
    };
  }

  /** Hands a live tab to another window: the page keeps running, nothing is closed or recorded. */
  releaseTab(id: number): { tab: WebTab; pinned: boolean } | null {
    const tab = this.tabs.get(id);
    const meta = this.model.get(id);
    if (!tab || !meta || tab.agent) return null;
    if (this.splitTabId === id) this.splitTabId = null;
    this.detachView(tab.view);
    this.unwire.get(id)?.();
    this.unwire.delete(id);
    this.tabs.delete(id);
    this.model.remove(id);
    return { tab, pinned: meta.pinned };
  }

  /** Takes a tab released by another window into the active Space. */
  adoptTab(tab: WebTab, o: { pinned?: boolean; index?: number; activate?: boolean } = {}): void {
    this.tabs.set(tab.id, tab);
    tab.setOpener(this.openerFor(tab));
    this.wireTab(tab);
    this.model.add({ id: tab.id, spaceId: this.model.activeSpaceId, openerId: null, pinned: o.pinned ?? false }, { index: o.index, activate: o.activate ?? true });
  }

  private readonly unwire = new Map<number, () => void>();

  private wireTab(tab: WebTab): void {
    const profile = this.profile;
    const offs: (() => void)[] = [];
    const on = (event: string, fn: (...args: any[]) => void): void => {
      tab.on(event, fn);
      offs.push(() => tab.off(event, fn));
    };
    this.unwire.set(tab.id, () => offs.forEach((off) => off()));
    on('updated', () => this.pushState());
    // Extensions see every live tab (chrome.tabs); a discarded tab rejoins when it wakes.
    on('live', (wc: Electron.WebContents) => {
      this.app.extensions.addTab(wc, this);
      if (this.activeTab() === tab) this.app.extensions.selectTab(wc);
    });
    if (tab.wc) this.app.extensions.addTab(tab.wc, this);
    on('main-frame-navigation-start', () => {
      if (tab.wc) profile.shields.resetCounts(tab.wc.id);
    });
    on('navigated', (url: string) => {
      if (!profile.isPrivate && !tab.agent) profile.history.addVisit(url, tab.title, { typed: this.pendingTyped.delete(tab.id) });
      this.emit('tab-navigated', tab);
      this.scheduleSave();
    });
    on('title', (title: string) => {
      if (!profile.isPrivate && !tab.agent) profile.history.updateTitle(tab.url, title);
      this.scheduleSave();
    });
    on('favicon', (fav: string) => !profile.isPrivate && profile.history.updateFavicon(tab.url, fav));
    on('dom-ready', () => {
      if (tab.wc) void profile.shields.applyCosmetic(tab.wc);
      this.emit('tab-dom-ready', tab);
    });
    on('did-finish-load', () => this.emit('tab-loaded', tab));
    on('load-failed', ({ code, desc, url }: { code: number; desc: string; url: string }) => {
      const wc = tab.wc;
      if (!wc) return;
      if (profile.shields.handleUpgradeFailure(wc, url)) return;
      if (url.startsWith('vizulla://error')) return;
      const q = new URLSearchParams({ code: String(code), desc, url });
      void wc.loadURL(`vizulla://error/?${q.toString()}`).catch(() => undefined);
    });
    on('context-menu', (params: Electron.ContextMenuParams) => {
      const menu = buildPageContextMenu(this, tab, params);
      menu.popup({ window: this.win as unknown as Electron.BrowserWindow });
    });
    on('input', (e: Electron.Event, input: Electron.Input) => this.app.handleTabInput(this, tab, e, input));
    on('html-fullscreen', (on: boolean) => {
      this.htmlFullscreen = on;
      this.win.setFullScreen(on);
      this.syncViews();
      this.pushState();
    });
    on('closed-by-page', () => this.closeTab(tab.id, { fromPage: true }));
    on('found', (r: Electron.Result) => emitTo(this.chrome.webContents, 'Shell', 'found', { tabId: tab.id, active: r.activeMatchOrdinal, total: r.matches }));
    on('zoom-key', (dir: 'in' | 'out') => this.zoom(tab.id, dir));
  }

  private readonly pendingTyped = new Set<number>();

  closeTab(id: number, opts: { fromPage?: boolean; noUndo?: boolean } = {}): void {
    const tab = this.tabs.get(id);
    const meta = this.model.get(id);
    if (!tab || !meta) return;
    if (!opts.noUndo && !tab.agent && !this.profile.isPrivate) {
      this.closed.push({ spaceId: meta.spaceId, url: logicalUrl(tab.url), title: tab.title, nav: tab.navState(), pinned: meta.pinned });
      if (this.closed.length > 25) this.closed.shift();
    }
    if (this.splitTabId === id) this.splitTabId = null;
    this.detachView(tab.view);
    this.tabs.delete(id);
    this.unwire.delete(id);
    this.emit('tab-closed', tab);
    if (!opts.fromPage) tab.destroy();
    this.model.remove(id);
    // A window always shows something: an empty Space gets the start page.
    if (!this.model.visible().length && !this.destroyed) this.createTab({ url: 'vizulla://newtab/', activate: true });
  }

  reopenClosed(): void {
    const c = this.closed.pop();
    if (!c) return;
    const spaceId = this.profile.spaces.get(c.spaceId) ? c.spaceId : this.model.activeSpaceId;
    if (spaceId !== this.model.activeSpaceId) this.model.switchSpace(spaceId);
    this.createTab({ nav: c.nav, url: c.url, title: c.title, spaceId, pinned: c.pinned, activate: true });
  }

  activateTab(id: number): void {
    this.model.activate(id);
    this.focusActive();
  }

  navigate(tabId: number, input: string, opts: { newTab?: boolean } = {}): void {
    const r = classifyInput(input);
    let url: string;
    if (r.route === 'navigate') url = r.url;
    else if (r.route === 'search') url = searchUrl(this.profile.prefs.get('search.engine'), r.text);
    else if (r.route === 'ask') {
      this.app.ask(this, r.text);
      return;
    } else return;
    this.loadUrl(tabId, url, { typed: r.route === 'navigate', newTab: opts.newTab });
  }

  loadUrl(tabId: number | null, url: string, opts: { typed?: boolean; newTab?: boolean } = {}): void {
    if (/^(javascript|vbscript):/i.test(url)) return;
    let tab = tabId !== null ? this.tabs.get(tabId) : undefined;
    if (!tab || opts.newTab || this.model.get(tab.id)?.pinned && siteOf(url) !== siteOf(tab.url) && !tab.url.startsWith('vizulla://newtab')) {
      tab = this.createTab({ url, activate: true, afterId: tab?.id });
    } else {
      const wc = tab.ensureLive();
      void wc.loadURL(url).catch(() => undefined);
      this.model.activate(tab.id);
    }
    if (opts.typed) this.pendingTyped.add(tab.id);
    tab.url = url;
    this.focusActive();
    this.pushState();
  }

  zoom(tabId: number, dir: 'in' | 'out' | 'reset'): void {
    const tab = this.tabs.get(tabId);
    const wc = tab?.wc;
    if (!tab || !wc) return;
    const steps = [0.25, 0.33, 0.5, 0.67, 0.75, 0.8, 0.9, 1, 1.1, 1.25, 1.5, 1.75, 2, 2.5, 3, 4, 5];
    const cur = wc.getZoomFactor();
    const nearest = steps.reduce((best, s, k) => (Math.abs(s - cur) < Math.abs(steps[best]! - cur) ? k : best), 0);
    const next = dir === 'reset' ? 1 : steps[Math.max(0, Math.min(steps.length - 1, nearest + (dir === 'in' ? 1 : -1)))]!;
    wc.setZoomFactor(next);
    tab.zoom = next;
    this.toast(t('toast_zoom', { pct: Math.round(next * 100) }), undefined, 1500);
    this.pushState();
  }

  /** Private windows only: pages hidden until the user unlocks with Touch ID. */
  locked = false;

  async lockPrivate(): Promise<void> {
    if (!this.profile.isPrivate || this.locked || this.destroyed) return;
    this.locked = true;
    this.syncViews();
    this.pushState();
    for (;;) {
      const r = await this.overlay.dialog<{ action: 'unlock' } | null>({ type: 'private-locked' });
      if (this.destroyed) return;
      if (r?.action !== 'unlock') continue;
      try {
        await systemPreferences.promptTouchID(t('private_unlock_reason'));
        break;
      } catch {
        /* cancelled: stay locked */
      }
    }
    this.locked = false;
    this.syncViews();
    this.pushState();
    this.focusActive();
  }

  /** Puts a background tab to sleep. Automatic sleep spares tabs with media; "Sleep tab" (`byUser`) doesn't. */
  discardTab(id: number, byUser = false): boolean {
    const tab = this.tabs.get(id);
    if (!tab || tab.discarded || id === this.model.activeTabId || id === this.splitTabId || tab.agent) return false;
    if (!byUser && holdsMedia(tab, Date.now())) return false;
    this.detachView(tab.view);
    tab.discard();
    return true;
  }

  // ---------------------------------------------------------------- spaces

  switchSpace(spaceId: string): void {
    if (!this.profile.spaces.get(spaceId)) return;
    this.splitTabId = null;
    this.model.switchSpace(spaceId);
    if (!this.model.visible().length) this.createTab({ url: 'vizulla://newtab/', spaceId, activate: true });
    this.activeTab()?.ensureLive();
    this.focusActive();
  }

  cycleSpace(offset: number): void {
    const spaces = this.profile.spaces.list();
    const i = spaces.findIndex((s) => s.id === this.model.activeSpaceId);
    const next = spaces[(((i + offset) % spaces.length) + spaces.length) % spaces.length];
    if (next) this.switchSpace(next.id);
  }

  async editSpace(spaceId: string | null): Promise<void> {
    const existing = spaceId ? this.profile.spaces.get(spaceId) : undefined;
    const r = await this.overlay.dialog<{ name: string; color: SpaceColor; icon: SpaceIcon } | null>({
      type: 'space-edit',
      title: existing ? t('space_edit_title') : t('space_new_title'),
      name: existing?.name ?? '',
      color: existing?.color ?? null,
      icon: existing?.icon ?? 'star',
    });
    if (!r) return;
    if (existing) this.profile.spaces.update(existing.id, r);
    else {
      const s = this.profile.spaces.create(r);
      this.switchSpace(s.id);
    }
    this.app.broadcastState();
  }

  async deleteSpace(spaceId: string): Promise<void> {
    const space = this.profile.spaces.get(spaceId);
    if (!space || this.profile.spaces.list().length <= 1) return;
    const ok = await this.overlay.dialog<boolean | null>({
      type: 'confirm',
      title: t('space_delete_title', { name: space.name }),
      body: t('space_delete_body'),
      confirm: t('action_delete'),
      danger: true,
    });
    if (!ok) return;
    // Tabs of a deleted Space are archived into the next Space so nothing is lost.
    const target = this.profile.spaces.list().find((s) => s.id !== spaceId)!;
    for (const w of this.app.windowsOf(this.profile)) {
      for (const m of w.model.visible(spaceId)) {
        const tab = w.tabs.get(m.id);
        if (tab && !tab.url.startsWith('vizulla://newtab')) this.profile.spaces.archive({ spaceId: target.id, url: tab.url, title: tab.title, favicon: tab.favicon, nav: tab.navState() });
        w.closeTab(m.id, { noUndo: true });
      }
      if (w.model.activeSpaceId === spaceId) w.switchSpace(target.id);
    }
    this.profile.spaces.remove(spaceId);
    this.app.broadcastState();
  }

  // ---------------------------------------------------------------- archive & focus

  /** Archives unpinned tabs idle longer than the threshold (TAB-04). Returns how many. */
  autoArchive(now = Date.now(), force = false): number {
    if (!this.profile.features.isEnabled(kVizullaAutoArchive) || (!force && !this.profile.prefs.get('tabs.archiveEnabled'))) return 0;
    const threshold = force ? 30 * 60_000 : this.profile.prefs.get('tabs.archiveAfterHours') * 3600_000;
    const archived: { id: number; spaceId: string }[] = [];
    for (const m of [...this.model.all()]) {
      const tab = this.tabs.get(m.id);
      if (!tab || m.pinned || tab.agent || holdsMedia(tab, now)) continue;
      if (this.model.activeForSpace(m.spaceId) === m.id) continue;
      if (now - m.lastActive < threshold) continue;
      if (tab.url.startsWith('vizulla://newtab')) {
        this.closeTab(m.id, { noUndo: true });
        continue;
      }
      const aid = this.profile.spaces.archive({ spaceId: m.spaceId, url: tab.url, title: tab.title, favicon: tab.favicon, nav: tab.navState() });
      archived.push({ id: aid, spaceId: m.spaceId });
      this.closeTab(m.id, { noUndo: true });
    }
    if (archived.length) {
      this.toast(t('toast_archived', { count: archived.length }), {
        label: t('action_undo'),
        run: () => archived.forEach((a) => this.restoreArchived(a.id, false)),
      });
    }
    return archived.length;
  }

  restoreArchived(id: number, activate = true): void {
    const a = this.profile.spaces.takeArchived(id);
    if (!a) return;
    const spaceId = this.profile.spaces.get(a.spaceId) ? a.spaceId : this.model.activeSpaceId;
    if (activate && spaceId !== this.model.activeSpaceId) this.model.switchSpace(spaceId);
    this.createTab({ nav: a.nav, url: a.url, title: a.title, favicon: a.favicon, spaceId, activate, discarded: !activate });
  }

  /** Focus (TAB-08): discard every tab outside the active Space, except audible ones. */
  focusMode(): number {
    let n = 0;
    for (const m of this.model.all()) if (m.spaceId !== this.model.activeSpaceId && this.discardTab(m.id)) n++;
    this.toast(t('toast_focus', { count: n }));
    return n;
  }

  // ---------------------------------------------------------------- layout

  setContentBounds(main: Rect, split?: Rect): void {
    this.contentRect = main;
    this.splitRect = split ?? null;
    this.layoutTabs();
  }

  setSplit(tabId: number | null): void {
    if (tabId !== null && (!this.tabs.has(tabId) || tabId === this.model.activeTabId)) tabId = null;
    this.splitTabId = tabId;
    if (tabId !== null) this.tabs.get(tabId)?.ensureLive();
    this.syncViews();
    this.pushState();
  }

  setPanel(panel: PanelKind | null, width?: number): void {
    if (panel !== undefined) this.panel = this.panel === panel && width === undefined ? this.panel : panel;
    if (width) this.profile.prefs.set('tabs.panelWidth', width);
    this.pushState();
    if (panel) this.app.ensurePanel(this, panel);
    this.syncViews();
  }

  setPanelView(view: WebContentsView | null): void {
    if (this.panelView && this.panelView !== view) this.detachView(this.panelView);
    this.panelView = view;
    this.syncViews();
  }

  setPanelViewBounds(r: Rect | null): void {
    this.panelViewRect = r && r.width > 0 && r.height > 0 ? r : null;
    this.syncViews();
  }

  togglePanel(panel: PanelKind): void {
    this.setPanel(this.panel === panel ? null : panel);
  }

  get panelKind(): PanelKind | null {
    return this.panel;
  }

  private layoutChrome(): void {
    const [width, height] = this.win.getContentSize();
    this.chrome.setBounds({ x: 0, y: 0, width: width!, height: height! });
  }

  private layoutTabs(): void {
    const active = this.activeTab();
    if (this.htmlFullscreen && active?.view) {
      const [width, height] = this.win.getContentSize();
      active.view.setBounds({ x: 0, y: 0, width: width!, height: height! });
      active.view.setBorderRadius(0);
      return;
    }
    // Edge-to-edge page area (no inset frame): the page gets every pixel.
    const radius = 0;
    if (active?.view) {
      active.view.setBounds(roundRect(this.contentRect));
      active.view.setBorderRadius(radius);
    }
    if (this.panelView && this.panelViewRect && this.attachedViews.has(this.panelView)) this.panelView.setBounds(roundRect(this.panelViewRect));
    if (this.splitTabId !== null && this.splitRect) {
      const s = this.tabs.get(this.splitTabId);
      if (s?.view) {
        s.view.setBounds(roundRect(this.splitRect));
        s.view.setBorderRadius(radius);
      }
    }
  }

  /** Attaches exactly the visible tab views (active + split), detaches the rest. */
  private syncViews(): void {
    if (this.destroyed) return;
    const want = new Set<WebContentsView>();
    const active = this.activeTab();
    // A locked private window shows no page until Touch ID (privacy.lockPrivate).
    if (active && !this.locked) {
      active.ensureLive();
      if (active.view) want.add(active.view);
    }
    if (this.splitTabId !== null && !this.locked) {
      const s = this.tabs.get(this.splitTabId);
      if (s?.view && this.model.get(this.splitTabId)?.spaceId === this.model.activeSpaceId) want.add(s.view);
      else this.splitTabId = null;
    }
    // The Gemini panel's page, while its panel is open (never over a page in full screen).
    if (this.panelView && this.panel === 'gemini' && this.panelViewRect && !this.locked && !this.htmlFullscreen) want.add(this.panelView);
    for (const v of this.attachedViews) if (!want.has(v)) this.detachView(v);
    // The tip view is always topmost; take it down so the indexes below stay right.
    if ([...want].some((v) => !this.attachedViews.has(v))) this.tip.hide();
    for (const v of want) {
      if (!this.attachedViews.has(v)) {
        // Tabs stack above the chrome view and below an open overlay. Never pass
        // an explicit `undefined` index: Electron reads it as 0 (bottom of the stack),
        // which hides the page under the chrome UI.
        if (this.overlay.isOpen) this.win.contentView.addChildView(v, this.win.contentView.children.length - 1);
        else this.win.contentView.addChildView(v);
        this.attachedViews.add(v);
      }
    }
    this.layoutTabs();
  }

  private detachView(v: WebContentsView | null): void {
    if (!v || !this.attachedViews.has(v)) return;
    this.attachedViews.delete(v);
    try {
      this.win.contentView.removeChildView(v);
    } catch {
      /* already gone */
    }
  }

  focusActive(): void {
    if (this.overlay.isOpen) return;
    const tab = this.activeTab();
    const wc = tab?.wc;
    if (!wc) return;
    wc.focus();
    this.app.extensions.selectTab(wc);
  }

  // ---------------------------------------------------------------- toasts

  toast(text: string, action?: { label: string; run: () => void }, ms = 6000): void {
    const id = randomUUID().replace(/-/g, '').slice(0, 12);
    const timer = setTimeout(() => this.dismissToast(id), ms);
    this.toasts.push({ id, text, action: action ? { label: action.label, command: id } : undefined, timer, run: action?.run });
    if (this.toasts.length > 3) this.dismissToast(this.toasts[0]!.id);
    this.pushState();
  }

  dismissToast(id: string): void {
    const i = this.toasts.findIndex((x) => x.id === id);
    if (i < 0) return;
    clearTimeout(this.toasts[i]!.timer);
    this.toasts.splice(i, 1);
    this.pushState();
  }

  toastAction(id: string): void {
    const x = this.toasts.find((y) => y.id === id);
    x?.run?.();
    this.dismissToast(id);
  }

  // ---------------------------------------------------------------- state

  tabInfo(id: number): TabInfo | null {
    const tab = this.tabs.get(id);
    const m = this.model.get(id);
    if (!tab || !m) return null;
    const i = tab.info();
    let shown = i.displayUrl;
    if (tab.url.startsWith('vizulla://error')) {
      try {
        shown = displayUrl(new URL(tab.url).searchParams.get('url') ?? '');
      } catch {
        /* keep */
      }
    }
    return {
      id,
      spaceId: m.spaceId,
      groupId: m.groupId,
      pinned: m.pinned,
      lastActive: m.lastActive,
      blocked: tab.wc ? this.profile.shields.blockedCount(tab.wc.id) : 0,
      passwords: this.profile.isPrivate ? { logins: 0, form: false } : this.app.passwords.status(tab),
      inUse: tab.wc ? this.profile.permissions.usedBy(tab.wc.id) : [],
      ...i,
      url: logicalUrl(tab.url),
      displayUrl: shown,
      title: tab.url.startsWith('vizulla://newtab') ? t('tab_new_title') : i.title,
    };
  }

  state(): WindowState {
    const prefs = this.profile.prefs;
    const spaces = this.profile.spaces.list();
    const tabs = spaces.flatMap((s) => this.model.visible(s.id).map((m) => this.tabInfo(m.id)!).filter(Boolean));
    return {
      windowId: this.chrome.webContents.id,
      spaces,
      activeSpaceId: this.model.activeSpaceId,
      tabs,
      groups: this.model.groupList(),
      activeTabId: this.model.activeTabId,
      splitTabId: this.splitTabId,
      layout: prefs.get('tabs.classic') ? 'horizontal' : prefs.get('tabs.layout'),
      classic: prefs.get('tabs.classic'),
      sidebarCollapsed: prefs.get('tabs.sidebarCollapsed'),
      sidebarWidth: prefs.get('tabs.sidebarWidth'),
      panel: this.panel,
      panelWidth: prefs.get('tabs.panelWidth'),
      toasts: this.toasts.map(({ id, text, action }) => ({ id, text, action })),
      archiveCount: this.profile.spaces.archiveCount(this.model.activeSpaceId),
      asleepCount: tabs.filter((x) => x.discarded && x.spaceId === this.model.activeSpaceId).length,
      agent: this.app.agentBarState(this),
      platform: this.profile.isPrivate ? `${process.platform}:private` : process.platform,
      locale: this.app.locale,
      // Private windows are always dark, like Chrome's Incognito.
      theme: this.profile.isPrivate ? 'dark' : prefs.get('appearance.theme'),
      accent: spaces.find((s) => s.id === this.model.activeSpaceId)?.color ?? prefs.get('appearance.accent'),
      density: prefs.get('appearance.density'),
      aiMode: prefs.get('ai.mode'),
      features: this.profile.features.snapshot(),
      update: this.app.updates.info(),
      google: this.app.google?.state(this) ?? null,
      glass: false,
      // The frame takes the site's colour (like mobile browsers), except in private windows and high contrast.
      chromeColor: this.profile.isPrivate || this.resolvedTheme() === 'high-contrast' || !prefs.get('appearance.siteColors') ? null : (this.activeTab()?.pageColor ?? null),
      active: this.win.isFocused(),
      extensions: this.profile.isPrivate ? { pinned: [], count: 0, activeWcId: null } : { ...this.app.extensions.toolbar(), activeWcId: this.activeTab()?.wc?.id ?? null },
      profile: { ...pick(this.app.profiles.current()), count: this.app.profiles.list().length },
      fullscreen: this.win.isFullScreen() || this.htmlFullscreen,
      install: this.profile.isPrivate ? null : (this.app.webApps?.stateFor(this.activeTab()?.wc) ?? null),
      bookmarks: prefs.get('tabs.classic') ? this.profile.history.bookmarks().slice(0, 30).map((b) => ({ url: b.url, title: b.title })) : [],
    };
  }

  pushState(immediate = false): void {
    if (this.destroyed || !this.chromeReady) return;
    if (immediate) {
      if (this.stateTimer) clearTimeout(this.stateTimer);
      this.stateTimer = null;
      this.sendState();
      return;
    }
    if (this.stateTimer) return;
    this.stateTimer = setTimeout(() => {
      this.stateTimer = null;
      if (!this.destroyed) this.sendState();
    }, 16);
  }

  private lastState = '';

  private sendState(): void {
    // Many tab events change nothing visible (e.g. repeated loading pings): skip those.
    const state = this.state();
    const json = JSON.stringify(state);
    if (json === this.lastState) return;
    this.updateCaptionButtons();
    this.lastState = json;
    emitTo(this.chrome.webContents, 'Shell', 'state', state);
    // The OS window title follows the active tab (Window menu, Mission Control, taskbar).
    const title = this.activeTab()?.title;
    const many = this.app.profiles.list().length > 1;
    const name = this.profile.isPrivate ? 'Vizulla — Private' : many ? `Vizulla — ${this.app.profiles.current().name}` : 'Vizulla';
    this.win.setTitle(title ? `${title} — ${name}` : name);
    this.emit('state');
  }

  sessionSnapshot(): SessionWindow {
    const b = this.win.getNormalBounds();
    return {
      key: this.key,
      activeSpaceId: this.model.activeSpaceId,
      bounds: { x: b.x, y: b.y, width: b.width, height: b.height },
      groups: this.model.groupList(),
      tabs: this.model
        .all()
        .filter((m) => !this.tabs.get(m.id)?.agent)
        .map((m) => {
          const tab = this.tabs.get(m.id)!;
          return {
            spaceId: m.spaceId, groupId: m.groupId, pinned: m.pinned, url: logicalUrl(tab.url), title: tab.title, favicon: tab.favicon,
            nav: tab.navState(), lastActive: m.lastActive, active: this.model.activeForSpace(m.spaceId) === m.id,
          };
        }),
    };
  }

  private scheduleSave(): void {
    if (this.profile.isPrivate || this.destroyed || this.saveTimer) return;
    this.saveTimer = setTimeout(() => {
      this.saveTimer = null;
      if (!this.destroyed) this.profile.spaces.saveWindow(this.sessionSnapshot());
    }, 800);
  }

  saveNow(): void {
    if (this.profile.isPrivate || this.destroyed) return;
    if (this.saveTimer) clearTimeout(this.saveTimer);
    this.saveTimer = null;
    this.profile.spaces.saveWindow(this.sessionSnapshot());
  }

  /** Windows/Linux caption buttons: the ink that reads on the frame's current colour. */
  private titleBarOverlay(): Electron.TitleBarOverlay {
    const theme = this.resolvedTheme();
    const frame = (theme !== 'high-contrast' && !this.profile.isPrivate && this.profile.prefs.get('appearance.siteColors') && this.activeTab()?.pageColor) || neutralFrame(theme);
    return { color: '#00000000', symbolColor: inkFor(frame) === 'dark' ? '#0f172a' : '#eef1f6', height: 40 };
  }

  private lastCaption = '';
  private updateCaptionButtons(): void {
    if (isMac) return;
    const o = this.titleBarOverlay();
    if (o.symbolColor === this.lastCaption) return;
    this.lastCaption = o.symbolColor!;
    (this.win as unknown as { setTitleBarOverlay?: (x: Electron.TitleBarOverlayOptions) => void }).setTitleBarOverlay?.(o);
  }

  resolvedTheme(): 'light' | 'dark' | 'high-contrast' {
    const pref = this.profile.prefs.get('appearance.theme');
    if (pref === 'high-contrast' || nativeTheme.shouldUseHighContrastColors) return 'high-contrast';
    if (this.profile.isPrivate) return 'dark';
    if (pref === 'light' || pref === 'dark') return pref;
    return nativeTheme.shouldUseDarkColors ? 'dark' : 'light';
  }

  copyUrl(): void {
    const tab = this.activeTab();
    if (!tab) return;
    clipboard.writeText(tab.url);
    this.toast(t('toast_copied_url'), undefined, 2000);
  }

  showMenuAt(menu: Menu, point?: { x: number; y: number }): void {
    menu.popup({ window: this.win as unknown as Electron.BrowserWindow, ...(point ? { x: Math.round(point.x), y: Math.round(point.y) } : {}) });
  }

  private onClose(): void {
    if (this.destroyed) return;
    // The last regular window keeps its session for restore; others forget theirs.
    // Quitting: the session was saved in prepareToQuit(). Closing one of several
    // windows forgets it; closing the last one keeps it for restore.
    if (!this.profile.isPrivate && !this.app.quitting) {
      if (this.app.windowsOf(this.profile).length > 1) this.profile.spaces.forgetWindow(this.key);
      else this.saveNow();
    }
    this.destroyed = true;
    if (this.stateTimer) clearTimeout(this.stateTimer);
    if (this.saveTimer) clearTimeout(this.saveTimer);
    for (const tab of this.tabs.values()) tab.destroy();
    this.tabs.clear();
    this.overlay.destroy();
    this.tip.destroy();
    if (!this.chrome.webContents.isDestroyed()) this.chrome.webContents.close();
    this.app.onWindowClosed(this);
  }

  get isDestroyed(): boolean {
    return this.destroyed;
  }
}

function roundRect(r: Rect): Rect {
  return { x: Math.round(r.x), y: Math.round(r.y), width: Math.max(0, Math.round(r.width)), height: Math.max(0, Math.round(r.height)) };
}

function defaultBounds() {
  const { workArea } = screen.getPrimaryDisplay();
  const width = Math.min(1440, Math.round(workArea.width * 0.86));
  const height = Math.min(940, Math.round(workArea.height * 0.88));
  return { width, height, x: workArea.x + Math.round((workArea.width - width) / 2), y: workArea.y + Math.round((workArea.height - height) / 2) };
}

export const WEBUI_PRELOAD = (outDir: string) => join(outDir, 'preload', 'webui_preload.js');

const pick = (p: { id: string; name: string; color: string }) => ({ id: p.id, name: p.name, color: p.color });
