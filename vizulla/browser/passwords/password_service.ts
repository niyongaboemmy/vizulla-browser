// Password manager, browser side (ID-01): offers to save or update a login after a
// sign-in, fills a saved account from the toolbar key button, generates strong
// passwords, and backs the vizulla://passwords page. Messages from pages are only
// accepted from a tab's top frame, and logins are bound to that frame's origin.
import { clipboard, ipcMain, Menu, type IpcMainEvent, type MenuItemConstructorOptions } from 'electron';
import { join } from 'node:path';
import { t } from '@vz/common/i18n';
import type { BrowserApp } from '../browser_app';
import type { BrowserWindowController } from '../ui/browser_window';
import type { WebTab } from '../tabs/web_tab';
import { generatePassword, PasswordVault } from './password_vault';

const MAX_NEVER = 500;

export class PasswordService {
  readonly vault: PasswordVault;
  /** Tabs whose page shows a password field (webContents id → new-password form?). */
  private readonly forms = new Map<number, { newPassword: boolean }>();

  constructor(private readonly app: BrowserApp) {
    const p = app.profile;
    this.vault = p.register('vault', new PasswordVault(join(p.dir, 'Vault.db'), p.keys), () => this.vault.close());
    ipcMain.on('vz:pw-form', (e, d: { form?: boolean; newPassword?: boolean }) => this.onForm(e, d));
    ipcMain.on('vz:pw-submit', (e, d: { username?: unknown; password?: unknown }) => void this.onSubmit(e, d));
    try {
      p.session.registerPreloadScript({ type: 'frame', id: 'vz-passwords', filePath: app.joinOut('preload', 'passwords_preload.js') });
    } catch (err) {
      console.warn('[vz] password manager unavailable', err);
    }
  }

  /** The origin of a top-frame sender, or null when the message must be ignored. */
  private originOf(e: IpcMainEvent): string | null {
    const f = e.senderFrame;
    if (!f || f !== e.sender.mainFrame) return null;
    try {
      const u = new URL(f.url);
      const local = !!process.env.VZ_TEST && u.protocol === 'http:' && u.hostname === '127.0.0.1';
      return u.protocol === 'https:' || local ? u.origin : null;
    } catch {
      return null;
    }
  }

  private onForm(e: IpcMainEvent, d: { form?: boolean; newPassword?: boolean }): void {
    if (!this.originOf(e)) return;
    const id = e.sender.id;
    if (d.form) this.forms.set(id, { newPassword: !!d.newPassword });
    else this.forms.delete(id);
    e.sender.once('destroyed', () => this.forms.delete(id));
    this.app.windowForSender(e.sender)?.pushState();
  }

  private async onSubmit(e: IpcMainEvent, d: { username?: unknown; password?: unknown }): Promise<void> {
    const origin = this.originOf(e);
    const p = this.app.profile;
    const w = this.app.windowForSender(e.sender);
    if (!origin || !w || w.profile.isPrivate || !p.prefs.get('passwords.offerToSave')) return;
    if (p.prefs.get('passwords.neverSave').includes(origin)) return;
    const username = typeof d.username === 'string' ? d.username.slice(0, 256) : '';
    const password = typeof d.password === 'string' ? d.password.slice(0, 1024) : '';
    if (!password) return;
    const existing = this.vault.list(origin).find((l) => l.username === username);
    if (existing && this.vault.reveal(existing.id)?.password === password) return;
    const r = await w.overlay.dialog<{ action: 'save' | 'never' | 'dismiss'; username?: string } | null>({
      type: 'save-password', site: new URL(origin).host, username, update: !!existing,
    });
    if (r?.action === 'never') p.prefs.set('passwords.neverSave', [...p.prefs.get('passwords.neverSave'), origin].slice(-MAX_NEVER));
    if (r?.action !== 'save') return;
    this.vault.add(origin, existing ? username : (r.username ?? username).trim().slice(0, 256), password);
    w.toast(t('pw_saved'), { label: t('pw_manage'), run: () => this.open(w) }, 4000);
    this.app.pages.notify('passwords', 'changed');
    w.pushState();
  }

  /** Toolbar key button state for a tab. */
  status(tab: WebTab): { logins: number; form: boolean } {
    const origin = this.tabOrigin(tab);
    return { logins: origin ? this.vault.list(origin).length : 0, form: !!(tab.wc && this.forms.has(tab.wc.id)) };
  }

  private tabOrigin(tab: WebTab): string | null {
    try {
      const u = new URL(tab.wc?.mainFrame.url ?? tab.url);
      return /^https?:$/.test(u.protocol) ? u.origin : null;
    } catch {
      return null;
    }
  }

  /** The key button: saved accounts to fill, a generated password, and the manager. */
  showMenu(w: BrowserWindowController, tab: WebTab, point?: { x: number; y: number }): void {
    const origin = this.tabOrigin(tab);
    const form = tab.wc ? this.forms.get(tab.wc.id) : undefined;
    const logins = origin ? this.vault.list(origin) : [];
    const items: MenuItemConstructorOptions[] = [
      ...logins.map((l) => ({ label: l.username || t('pw_no_username'), sublabel: new URL(l.origin).host, click: () => this.fill(tab, l.id) })),
      ...(logins.length ? [{ type: 'separator' as const }] : []),
      { label: t('pw_generate'), enabled: !!form, click: () => this.fillGenerated(tab) },
      { type: 'separator' },
      { label: t('pw_manage'), click: () => this.open(w) },
    ];
    w.showMenuAt(Menu.buildFromTemplate(items), point);
  }

  fill(tab: WebTab, id: number): void {
    const s = this.vault.reveal(id);
    const frame = tab.wc?.mainFrame;
    // Only ever fill a login into a page of the origin it was saved for.
    if (!s || !frame || this.tabOrigin(tab) !== s.origin) return;
    frame.send('vz:pw-fill', { username: s.username, password: s.password });
  }

  fillGenerated(tab: WebTab): void {
    const frame = tab.wc?.mainFrame;
    if (!frame || !this.tabOrigin(tab)) return;
    const password = generatePassword();
    frame.send('vz:pw-fill', { password, generated: true });
    // Also on the clipboard, in case the page uses a field we don't recognise.
    clipboard.writeText(password);
  }

  open(w: BrowserWindowController): void {
    const existing = [...w.tabs.values()].find((x) => x.url.startsWith('vizulla://passwords'));
    if (existing) w.activateTab(existing.id);
    else w.loadUrl(null, 'vizulla://passwords/', { newTab: true });
  }
}
