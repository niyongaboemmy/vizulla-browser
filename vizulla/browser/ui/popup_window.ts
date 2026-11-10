// Popup windows: window.open with a size or `popup` (Sign in with Google, Apple, Microsoft,
// GitHub; payments), as Chrome, Edge and Safari open them — a small window over the page instead
// of a tab, keeping window.opener so the provider can hand the result back and close itself.
// - The title bar always names the site the popup is on (anti-phishing, like Chrome's popup
//   address bar), marked "Not secure" on plain http.
// - Its own overlay: JavaScript dialogs, permission prompts and the passkey sheet appear in it.
// - Nested popups are popups too; links that open tabs go to the opener's browser window.
import { BaseWindow, Menu, WebContentsView, clipboard, screen, type WebContents } from 'electron';
import type { BrowserApp } from '../browser_app';
import type { BrowserWindowController } from './browser_window';
import { OverlayController } from './overlay';
import { WebTab } from '../tabs/web_tab';
import { windowBackground } from '@vz/common/tokens';
import { t } from '@vz/common/i18n';
import { popupBounds, popupTitle } from './popup_layout';

export class PopupWindow {
  readonly win: BaseWindow;
  readonly view: WebContentsView;
  readonly overlay: OverlayController;

  constructor(
    private readonly app: BrowserApp,
    private readonly browser: BrowserWindowController | null,
    options: Electron.BrowserWindowConstructorOptions & { webContents?: WebContents },
    features: string,
  ) {
    const parent = browser?.win.getBounds() ?? screen.getPrimaryDisplay().workArea;
    const area = screen.getDisplayMatching(parent).workArea;
    this.win = new BaseWindow({
      ...popupBounds(features, parent, area),
      minWidth: 320,
      minHeight: 240,
      show: false,
      title: ' ',
      backgroundColor: windowBackground(browser?.resolvedTheme() ?? 'light'),
      minimizable: true,
      fullscreenable: false,
    });
    // The page Chromium already created for window.open (so window.opener is kept).
    this.view = new WebContentsView({ webContents: options.webContents, webPreferences: options.webPreferences } as Electron.WebContentsViewConstructorOptions);
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
    // Show once something paints; a slow provider still gets its window quickly.
    this.view.webContents.once('did-finish-load', () => this.show());
    setTimeout(() => this.show(), 700).unref();
    this.win.on('closed', () => {
      app.popups.delete(this);
      this.overlay.destroy();
      if (!this.view.webContents.isDestroyed()) this.view.webContents.close();
    });
    app.popups.add(this);
  }

  get wc(): WebContents {
    return this.view.webContents;
  }

  private show(): void {
    if (this.win.isDestroyed() || this.win.isVisible()) return;
    this.win.show();
    this.win.focus();
  }

  focus(): void {
    if (this.win.isMinimized()) this.win.restore();
    this.show();
    this.win.focus();
  }

  /** Menu shortcuts while the popup is in front. */
  command(id: string): boolean {
    const wc = this.wc;
    const actions: Record<string, () => void> = {
      'tab.close': () => this.win.close(),
      'window.close': () => this.win.close(),
      'nav.reload': () => wc.reload(),
      'nav.back': () => wc.navigationHistory.goBack(),
      'nav.forward': () => wc.navigationHistory.goForward(),
      'nav.copyUrl': () => clipboard.writeText(wc.getURL()),
      'view.devtools': () => wc.toggleDevTools(),
    };
    const run = actions[id];
    if (!run) return false;
    run();
    return true;
  }

  private openInBrowser(url: string): void {
    const w = this.browser && this.app.windows.has(this.browser) ? this.browser : (this.app.focused() ?? this.app.openWindow());
    w.createTab({ url, activate: true });
    w.win.focus();
  }

  private wire(wc: WebContents): void {
    const retitle = () => !this.win.isDestroyed() && this.win.setTitle(popupTitle(wc.getURL(), wc.getTitle(), t('security_insecure_short')));
    wc.on('page-title-updated', retitle);
    wc.on('did-navigate', retitle);
    wc.on('did-navigate-in-page', retitle);
    // The provider is done (window.close()): the popup goes away.
    wc.once('destroyed', () => !this.win.isDestroyed() && this.win.close());
    wc.setWindowOpenHandler((d) => {
      if (WebTab.popupPolicy && !WebTab.popupPolicy(wc, d.url, d.disposition)) return { action: 'deny' };
      if (d.disposition === 'new-window' && /^(https?:|about:blank)/.test(d.url)) {
        return { action: 'allow', createWindow: (options) => new PopupWindow(this.app, this.browser, options, d.features).wc };
      }
      if (/^https?:/.test(d.url)) this.openInBrowser(d.url);
      return { action: 'deny' };
    });
    wc.on('context-menu', (_e, p) => {
      const items: Electron.MenuItemConstructorOptions[] = [];
      if (p.linkURL && /^https?:/.test(p.linkURL)) items.push({ label: t('ctx_open_link_new_tab'), click: () => this.openInBrowser(p.linkURL) }, { label: t('ctx_copy_link'), click: () => clipboard.writeText(p.linkURL) }, { type: 'separator' });
      if (p.isEditable) items.push({ label: t('ctx_cut'), role: 'cut', enabled: p.editFlags.canCut }, { label: t('ctx_copy'), role: 'copy', enabled: p.editFlags.canCopy }, { label: t('ctx_paste'), role: 'paste', enabled: p.editFlags.canPaste }, { label: t('ctx_select_all'), role: 'selectAll' });
      else if (p.selectionText.trim()) items.push({ label: t('ctx_copy'), role: 'copy' });
      else items.push({ label: t('cmd_nav_back'), enabled: wc.navigationHistory.canGoBack(), click: () => wc.navigationHistory.goBack() }, { label: t('cmd_nav_reload'), click: () => wc.reload() });
      Menu.buildFromTemplate(items).popup();
    });
  }
}
