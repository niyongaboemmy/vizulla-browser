// Google accounts and Gemini, as Chrome has them: the toolbar avatar shows the Google account
// you're signed in with on the web, its menu lists every signed-in account to switch between,
// and "Ask Gemini" opens Gemini beside the page as the account you chose.
//
// Privacy: nothing is asked of Google until Google's own sign-in cookies exist (you signed in
// on a Google site yourself), and Settings can turn the whole feature off.
import { clipboard, Menu, nativeTheme, WebContentsView, type MenuItemConstructorOptions } from 'electron';
import type { BrowserApp } from '../browser_app';
import type { BrowserWindowController } from '../ui/browser_window';
import { t } from '@vz/common/i18n';
import { geminiUrl, googleUrls, isGeminiPanelHost, isGoogleHost, parseListAccounts, photoAt, withAuthUser, type GoogleAccount } from './accounts';

/** Google's sign-in cookies: a change means an account signed in or out. */
const AUTH_COOKIE = /^(SID|__Secure-1PSID|__Secure-3PSID|LSID|__Host-1PLSID|__Host-3PLSID)$/;
const TEST = process.env.VZ_TEST === '1';
/** Tests point the account list at the harness (which has no Google cookies to wait for). */
const FAKE = TEST && !!process.env.VZ_GOOGLE_ACCOUNTS_URL;
const LIST_URL = (FAKE && process.env.VZ_GOOGLE_ACCOUNTS_URL) || 'https://accounts.google.com/ListAccounts?gpsia=1&source=ChromiumBrowser&json=standard';
const GEMINI = (index: number) => (TEST && process.env.VZ_GEMINI_URL) || geminiUrl(index);

export interface GoogleState {
  accounts: Omit<GoogleAccount, 'id'>[];
  /** Email of the account Gemini and account switching use. */
  active: string | null;
  gemini: boolean;
}

/** Types text into Gemini's prompt box (waiting for the app to start), without sending it. */
const INSERT_PROMPT = (text: string) => `new Promise((done) => {
  const text = ${JSON.stringify(text)};
  const end = Date.now() + 10000;
  const go = () => {
    const el = document.querySelector('rich-textarea [contenteditable="true"], div.ql-editor[contenteditable="true"], [contenteditable="true"][role="textbox"], textarea');
    if (el) {
      el.focus();
      if (!document.execCommand('insertText', false, text) && 'value' in el) { el.value += text; el.dispatchEvent(new Event('input', { bubbles: true })); }
      done(true);
    } else if (Date.now() > end) done(false);
    else setTimeout(go, 200);
  };
  go();
})`;

export class GoogleService {
  private accounts: GoogleAccount[] = [];
  private readonly photos = new Map<string, string>();
  private readonly views = new Map<BrowserWindowController, { view: WebContentsView; index: number }>();
  private timer: NodeJS.Timeout | null = null;
  private running: Promise<void> | null = null;

  constructor(private readonly app: BrowserApp) {
    const prefs = app.profile.prefs;
    app.profile.session.cookies.on('changed', (_e, c) => {
      if (AUTH_COOKIE.test(c.name) && (isGoogleHost((c.domain ?? '').replace(/^\./, '')) || FAKE)) this.schedule(1200);
    });
    this.schedule(2500);
    prefs.observe('google.accounts', () => void this.refresh());
    prefs.observe('google.gemini', () => app.broadcastState());
    prefs.observe('google.activeAccount', () => {
      app.broadcastState();
      for (const [w, v] of this.views) if (v.index !== this.activeIndex()) this.loadGemini(w);
    });
    app.hooks.ensurePanel.push((w, panel) => panel === 'gemini' && this.ensureView(w));
    app.hooks.selectionActions.push((w, _tab, text) =>
      this.geminiOn() ? [{ label: t('gemini_ask_selection', { text: text.length > 32 ? `${text.slice(0, 30)}…` : text }), click: () => void this.ask(w, `“${text.trim()}”\n\n`) }] : [],
    );
    app.commandHandlers.set('google.gemini', (w) => w.togglePanel('gemini'));
  }

  // ------------------------------------------------------------------ accounts

  private schedule(ms: number): void {
    if (this.timer) clearTimeout(this.timer);
    this.timer = setTimeout(() => {
      this.timer = null;
      void this.refresh();
    }, ms);
    this.timer.unref?.();
  }

  /** Re-reads the signed-in accounts (one at a time; a call during a refresh waits for it). */
  refresh(): Promise<void> {
    this.running ??= this.load().finally(() => (this.running = null));
    return this.running;
  }

  private async load(): Promise<void> {
    if (!this.app.profile.prefs.get('google.accounts')) return this.set([]);
    const s = this.app.profile.session;
    try {
      if (!FAKE) {
        const cookies = await s.cookies.get({ domain: 'google.com' });
        if (!cookies.some((c) => AUTH_COOKIE.test(c.name))) return this.set([]);
      }
      // ListAccounts answers a POST (a GET is refused) with the session's Google cookies.
      const r = await s.fetch(LIST_URL, { method: 'POST', body: '', headers: { 'content-type': 'application/x-www-form-urlencoded' }, credentials: 'include', cache: 'no-store', signal: AbortSignal.timeout(8000) } as RequestInit);
      if (!r.ok) return; // a passing failure keeps the accounts already shown
      const list = parseListAccounts(await r.text());
      await Promise.all(list.map((a) => this.photo(a)));
      this.set(list);
    } catch (e) {
      console.warn('[vz] google accounts', (e as Error).message);
    }
  }

  /** Photos become data URLs (the overlay can't load remote images, and they stay offline). */
  private async photo(a: GoogleAccount): Promise<void> {
    if (!a.photo) return;
    const url = photoAt(a.photo, 96);
    if (!this.photos.has(url)) {
      try {
        const r = await this.app.profile.session.fetch(url, { credentials: 'omit', signal: AbortSignal.timeout(6000) } as RequestInit);
        const type = r.headers.get('content-type') ?? '';
        const buf = Buffer.from(await r.arrayBuffer());
        if (r.ok && /^image\/(png|jpeg|webp|gif)/.test(type) && buf.length < 200_000) this.photos.set(url, `data:${type.split(';')[0]};base64,${buf.toString('base64')}`);
      } catch {
        /* the initial letter stands in */
      }
    }
    a.photo = this.photos.get(url) ?? null;
  }

  private set(list: GoogleAccount[]): void {
    if (JSON.stringify(list) === JSON.stringify(this.accounts)) return;
    this.accounts = list;
    this.app.broadcastState();
  }

  private signedIn(): GoogleAccount[] {
    return this.app.profile.prefs.get('google.accounts') ? this.accounts.filter((a) => !a.signedOut) : [];
  }

  /** The account Gemini and switching use: the one chosen, else Google's default (authuser 0). */
  active(): GoogleAccount | null {
    const list = this.signedIn();
    const want = this.app.profile.prefs.get('google.activeAccount');
    return list.find((a) => a.email === want) ?? list[0] ?? null;
  }

  private activeIndex(): number {
    return this.active()?.index ?? 0;
  }

  private geminiOn(): boolean {
    return this.app.profile.prefs.get('google.gemini') && this.signedIn().length > 0;
  }

  state(w: BrowserWindowController): GoogleState | null {
    if (w.profile.isPrivate || !this.app.profile.prefs.get('google.accounts')) return null;
    return {
      accounts: this.accounts.map(({ id: _id, ...a }) => a),
      active: this.active()?.email ?? null,
      gemini: this.app.profile.prefs.get('google.gemini'),
    };
  }

  // ------------------------------------------------------------------ account menu

  /** The toolbar avatar's menu: Google accounts first, then Vizulla profiles (overlay.ts renders it). */
  menu(w: BrowserWindowController) {
    void this.refresh();
    const cur = this.app.profiles.current();
    return {
      google: this.state(w),
      profile: { id: cur.id, name: cur.name, color: cur.color },
      profiles: this.app.profiles.list().filter((p) => p.id !== cur.id).sort((a, b) => b.lastUsed - a.lastUsed).map((p) => ({ id: p.id, name: p.name, color: p.color })),
    };
  }

  /** An account menu choice. Returns the menu again when it stays open. */
  action(w: BrowserWindowController, id: string): ReturnType<GoogleService['menu']> | null {
    const [verb, arg = ''] = id.split(/:(.*)/s) as [string, string?];
    const tab = (url: string) => w.loadUrl(null, url, { newTab: true });
    w.overlay.close();
    switch (verb) {
      case 'use': {
        const a = this.signedIn().find((x) => x.email === arg);
        if (!a) break;
        this.app.profile.prefs.set('google.activeAccount', a.email);
        // On a Google page, show it as the newly chosen account straight away.
        const cur = w.activeTab();
        if (cur && cur.url && /^https:/.test(cur.url) && isGoogleHost(new URL(cur.url).hostname)) cur.wc?.loadURL(withAuthUser(cur.url, a.index));
        w.toast(t('google_using', { email: a.email }));
        break;
      }
      case 'signin-again':
        tab(googleUrls.signInAgain(arg));
        break;
      case 'add':
        tab(googleUrls.add());
        break;
      case 'signin':
        tab(googleUrls.signIn());
        break;
      case 'manage':
        tab(googleUrls.manage(this.activeIndex()));
        break;
      case 'signout':
        tab(googleUrls.signOut());
        break;
      case 'gemini':
        w.setPanel('gemini');
        break;
      case 'profile':
        this.app.profiles.open(arg);
        break;
      case 'profile-add':
        this.app.openProfiles(w, true);
        break;
      case 'profile-manage':
        this.app.openProfiles(w);
        break;
      case 'private':
        void this.app.openWindow({ private: true });
        break;
      case 'settings':
        tab('vizulla://settings/#appearance');
        break;
    }
    return null;
  }

  // ------------------------------------------------------------------ Gemini panel

  private ensureView(w: BrowserWindowController): void {
    if (this.views.has(w) || w.profile.isPrivate) return;
    const view = new WebContentsView({
      webPreferences: { session: this.app.profile.session, sandbox: true, contextIsolation: true, nodeIntegration: false, spellcheck: true },
    });
    view.setBackgroundColor(nativeTheme.shouldUseDarkColors ? '#1b1c1f' : '#ffffff');
    view.setBorderRadius(14);
    const wc = view.webContents;
    // Gemini's own links (sources, YouTube, docs) open as tabs beside it, never inside the panel.
    wc.setWindowOpenHandler(({ url }) => {
      if (/^https?:/.test(url)) w.createTab({ url, afterId: w.activeTab()?.id, activate: true });
      return { action: 'deny' };
    });
    wc.on('will-navigate', (e, url) => {
      try {
        if (isGeminiPanelHost(new URL(url).hostname) || (TEST && url.startsWith('http://127.0.0.1'))) return;
      } catch {
        /* not a URL */
      }
      e.preventDefault();
      if (/^https?:/.test(url)) w.createTab({ url, afterId: w.activeTab()?.id, activate: true });
    });
    wc.on('context-menu', (_e, p) => {
      const items: MenuItemConstructorOptions[] = p.isEditable
        ? [{ label: t('ctx_cut'), role: 'cut', enabled: p.editFlags.canCut }, { label: t('ctx_copy'), role: 'copy', enabled: p.editFlags.canCopy }, { label: t('ctx_paste'), role: 'paste', enabled: p.editFlags.canPaste }, { label: t('ctx_select_all'), role: 'selectAll' }]
        : [
            ...(p.selectionText.trim() ? [{ label: t('ctx_copy'), role: 'copy' as const }, { type: 'separator' as const }] : []),
            ...(p.linkURL ? [{ label: t('ctx_open_link_new_tab'), click: () => w.createTab({ url: p.linkURL, activate: false }) }, { label: t('ctx_copy_link'), click: () => clipboard.writeText(p.linkURL) }, { type: 'separator' as const }] : []),
            { label: t('cmd_nav_back'), enabled: wc.navigationHistory.canGoBack(), click: () => wc.navigationHistory.goBack() },
            { label: t('cmd_nav_reload'), click: () => wc.reload() },
            { label: t('gemini_open_tab'), click: () => this.panelAction(w, 'tab') },
          ];
      Menu.buildFromTemplate(items).popup();
    });
    this.views.set(w, { view, index: this.activeIndex() });
    this.loadGemini(w);
    w.setPanelView(view);
    w.win.once('closed', () => {
      this.views.delete(w);
      if (!wc.isDestroyed()) wc.close();
    });
  }

  private loadGemini(w: BrowserWindowController): void {
    const v = this.views.get(w);
    if (!v) return;
    v.index = this.activeIndex();
    void v.view.webContents.loadURL(GEMINI(v.index)).catch(() => undefined);
  }

  /** Opens Gemini beside the page and types `text` into its prompt (not sent: you finish the question). */
  async ask(w: BrowserWindowController, text: string): Promise<void> {
    w.setPanel('gemini');
    const wc = this.views.get(w)?.view.webContents;
    if (!wc) return;
    if (wc.isLoading()) await new Promise<void>((r) => wc.once('did-stop-loading', () => r()));
    const ok = await wc.executeJavaScript(INSERT_PROMPT(text), true).catch(() => false);
    if (ok) wc.focus();
    else {
      clipboard.writeText(text);
      w.toast(t('gemini_copied'));
    }
  }

  /** The Gemini panel's header buttons. */
  panelAction(w: BrowserWindowController, what: 'page' | 'tab' | 'reload'): void {
    const v = this.views.get(w);
    if (what === 'page') {
      const tab = w.activeTab();
      if (tab && /^https?:/.test(tab.url)) void this.ask(w, t('gemini_page_prompt', { title: tab.title || tab.url, url: tab.url }) + '\n\n');
    } else if (what === 'tab') {
      w.createTab({ url: v?.view.webContents.getURL() || GEMINI(this.activeIndex()), activate: true });
      w.setPanel(null);
    } else if (v) this.loadGemini(w);
  }

  /** For tests: what the Gemini panel shows in a window. */
  panelUrl(w: BrowserWindowController): string | null {
    return this.views.get(w)?.view.webContents.getURL() ?? null;
  }
}
