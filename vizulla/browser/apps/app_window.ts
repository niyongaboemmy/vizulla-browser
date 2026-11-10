// An installed web app's window: one page, no tabs or toolbar, on the profile's
// session (same sign-ins, Shields, permissions). Pages inside the app's scope stay
// here; anything else opens in the browser. Sign-in popups (window.open with
// features) keep their opener so OAuth flows complete. Dialogs and permission
// prompts appear in this window's own overlay.
import { BaseWindow, Menu, WebContentsView, clipboard, nativeImage, type WebContents } from 'electron';
import { EventEmitter } from 'node:events';
import type { BrowserApp } from '../browser_app';
import { OverlayController } from '../ui/overlay';
import { WebTab } from '../tabs/web_tab';
import { windowBackground } from '@vz/common/tokens';
import { t } from '@vz/common/i18n';
import { inScope } from './manifest';
import { appUserModelId } from './os_integration';
import type { InstalledApp } from './web_apps';

export class AppWindow extends EventEmitter {
  readonly win: BaseWindow;
  readonly view: WebContentsView;
  readonly overlay: OverlayController;

  constructor(private readonly app: BrowserApp, readonly info: InstalledApp, iconPath: string | null, url?: string) {
    super();
    const b = info.bounds;
    this.win = new BaseWindow({
      width: b?.width ?? 1100,
      height: b?.height ?? 760,
      ...(b ? { x: b.x, y: b.y } : {}),
      minWidth: 320,
      minHeight: 240,
      show: false,
      title: info.name,
      backgroundColor: info.backgroundColor && /^#[0-9a-f]{6}$/i.test(info.backgroundColor) ? info.backgroundColor : windowBackground(app.focused()?.resolvedTheme() ?? 'light'),
      ...(iconPath && process.platform !== 'darwin' ? { icon: nativeImage.createFromPath(iconPath) } : {}),
    });
    // Windows: its own taskbar button and icon, not Vizulla's.
    if (process.platform === 'win32') (this.win as unknown as { setAppDetails?: (o: Electron.AppDetailsOptions) => void }).setAppDetails?.({ appId: appUserModelId(info.id), ...(iconPath ? { appIconPath: iconPath } : {}) });
    this.view = WebTab.createView(app.profile.session, app.preloadPath, false);
    this.win.contentView.addChildView(this.view);
    this.overlay = new OverlayController(this.win, app.preloadPath, () => app.chromeSession);
    const layout = () => {
      const [width, height] = this.win.getContentSize();
      this.view.setBounds({ x: 0, y: 0, width: width!, height: height! });
      this.overlay.layout();
    };
    this.win.on('resize', layout);
    layout();
    this.wire(this.view.webContents);
    void this.view.webContents.loadURL(url && inScope(url, info.scope) ? url : info.startUrl).catch(() => undefined);
    this.view.webContents.once('did-finish-load', () => this.win.show());
    setTimeout(() => !this.win.isDestroyed() && this.win.show(), 2500).unref(); // slow start: show anyway
    this.win.on('close', () => this.emit('bounds', this.win.getBounds()));
    this.win.on('closed', () => {
      this.overlay.destroy();
      if (!this.view.webContents.isDestroyed()) this.view.webContents.close();
      this.emit('closed');
    });
  }

  get wc(): WebContents {
    return this.view.webContents;
  }

  focus(): void {
    if (this.win.isMinimized()) this.win.restore();
    this.win.show();
    this.win.focus();
  }

  /** Menu shortcuts while this window is in front (browser_app.runCommand). */
  command(id: string): boolean {
    const wc = this.wc;
    const zoom = (f: (z: number) => number) => wc.setZoomFactor(Math.max(0.3, Math.min(3, f(wc.getZoomFactor()))));
    const actions: Record<string, () => void> = {
      'tab.close': () => this.win.close(),
      'window.close': () => this.win.close(),
      'nav.reload': () => wc.reload(),
      'nav.hardReload': () => wc.reloadIgnoringCache(),
      'nav.back': () => wc.navigationHistory.goBack(),
      'nav.forward': () => wc.navigationHistory.goForward(),
      'view.zoomIn': () => zoom((z) => z + 0.1),
      'view.zoomOut': () => zoom((z) => z - 0.1),
      'view.zoomReset': () => wc.setZoomFactor(1),
      'view.devtools': () => wc.toggleDevTools(),
      'view.fullscreen': () => this.win.setFullScreen(!this.win.isFullScreen()),
      'nav.copyUrl': () => clipboard.writeText(wc.getURL()),
    };
    const run = actions[id];
    if (!run) return false;
    run();
    return true;
  }

  private openInBrowser(url: string): void {
    const w = this.app.focused() ?? this.app.openWindow();
    w.loadUrl(null, url, { newTab: true });
    w.win.focus();
  }

  private wire(wc: WebContents): void {
    wc.on('page-title-updated', (_e, title) => this.win.setTitle(title && title !== this.info.name ? `${this.info.name} – ${title}` : this.info.name));
    // Leaving the app's scope: that page belongs in the browser.
    const leave = (e: Electron.Event, url: string) => {
      if (inScope(url, this.info.scope) || !/^https?:/.test(url)) return;
      e.preventDefault();
      this.openInBrowser(url);
    };
    wc.on('will-navigate', leave);
    wc.on('will-frame-navigate', (e) => e.isMainFrame && leave(e as unknown as Electron.Event, e.url));
    wc.setWindowOpenHandler((d) => {
      if (WebTab.popupPolicy && !WebTab.popupPolicy(wc, d.url, d.disposition)) return { action: 'deny' };
      // A popup window (sign-in, payment): a real child window that keeps window.opener.
      if (d.disposition === 'new-window' && /^https?:|^about:blank/.test(d.url)) {
        return { action: 'allow', overrideBrowserWindowOptions: { width: 520, height: 680, autoHideMenuBar: true, webPreferences: { session: this.app.profile.session, sandbox: true, contextIsolation: true } } };
      }
      if (/^https?:/.test(d.url)) {
        if (inScope(d.url, this.info.scope)) void wc.loadURL(d.url);
        else this.openInBrowser(d.url);
      }
      return { action: 'deny' };
    });
    wc.on('did-create-window', (child) => child.webContents.setWindowOpenHandler(() => ({ action: 'deny' })));
    wc.on('context-menu', (_e, p) => this.contextMenu(p));
    wc.on('will-prevent-unload', (e) => e.preventDefault());
  }

  private contextMenu(p: Electron.ContextMenuParams): void {
    const wc = this.wc;
    const items: Electron.MenuItemConstructorOptions[] = [];
    if (p.linkURL && /^https?:/.test(p.linkURL)) {
      items.push({ label: t('ctx_open_link_new_tab'), click: () => this.openInBrowser(p.linkURL) }, { label: t('ctx_copy_link'), click: () => clipboard.writeText(p.linkURL) }, { type: 'separator' });
    }
    if (p.isEditable) items.push({ role: 'undo' }, { role: 'redo' }, { type: 'separator' }, { role: 'cut' }, { role: 'copy' }, { role: 'paste' }, { role: 'selectAll' });
    else if (p.selectionText) items.push({ role: 'copy' });
    if (!p.isEditable && !p.selectionText && !p.linkURL) {
      items.push(
        { label: t('cmd_nav_back'), enabled: wc.navigationHistory.canGoBack(), click: () => wc.navigationHistory.goBack() },
        { label: t('cmd_nav_forward'), enabled: wc.navigationHistory.canGoForward(), click: () => wc.navigationHistory.goForward() },
        { label: t('cmd_nav_reload'), click: () => wc.reload() },
        { type: 'separator' },
        { label: t('app_open_in_browser'), click: () => this.openInBrowser(wc.getURL()) },
        { label: t('ctx_copy_page_url'), click: () => clipboard.writeText(wc.getURL()) },
      );
    }
    items.push({ type: 'separator' }, { label: t('ctx_inspect'), click: () => wc.inspectElement(p.x, p.y) });
    Menu.buildFromTemplate(items).popup({ window: this.win as unknown as Electron.BrowserWindow });
  }
}
