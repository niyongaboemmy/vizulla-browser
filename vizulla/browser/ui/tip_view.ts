// Shell tooltips that don't fit in the window chrome (a tab's tooltip with tabs on
// top has the page right below it, and pages are drawn above the chrome view).
// A small transparent view, sized to the bubble and stacked above everything,
// shows the bubble the shell measured. It never sits under the pointer (the
// bubble is placed beside its control), so it can't steal the hover.
import { WebContentsView, type BaseWindow, type Session } from 'electron';

const PAGE = `data:text/html;charset=utf-8,${encodeURIComponent(
  '<!doctype html><html><head><meta charset="utf-8"><style>html,body{margin:0;background:transparent;overflow:hidden}</style></head><body></body></html>',
)}`;

export class TipView {
  private view: WebContentsView | null = null;
  private loaded: Promise<void> | null = null;
  private attached = false;
  private seq = 0;

  constructor(private readonly win: BaseWindow, private readonly session: () => Session) {}

  async show(r: { x: number; y: number; width: number; height: number }, doc: string): Promise<void> {
    const n = ++this.seq;
    this.ensure();
    await this.loaded;
    const wc = this.view!.webContents;
    if (wc.isDestroyed()) return;
    // Paint first, then attach: the view never flashes the previous bubble.
    await wc.executeJavaScript(`document.body.innerHTML = ${JSON.stringify(doc)}; void document.body.offsetWidth; true`).catch(() => undefined);
    if (n !== this.seq) return;
    this.view!.setBounds({ x: Math.round(r.x), y: Math.round(r.y), width: Math.ceil(r.width), height: Math.ceil(r.height) });
    // Re-adding moves the view to the top of the stack (above pages and the overlay).
    this.win.contentView.addChildView(this.view!);
    this.attached = true;
  }

  hide(): void {
    this.seq++;
    if (!this.view || !this.attached) return;
    this.attached = false;
    try {
      this.win.contentView.removeChildView(this.view);
    } catch {
      /* window closing */
    }
  }

  destroy(): void {
    this.hide();
    if (this.view && !this.view.webContents.isDestroyed()) this.view.webContents.close();
    this.view = null;
  }

  private ensure(): void {
    if (this.view && !this.view.webContents.isDestroyed()) return;
    this.view = new WebContentsView({ webPreferences: { session: this.session(), sandbox: true, contextIsolation: true, nodeIntegration: false, javascript: true, spellcheck: false } });
    this.view.setBackgroundColor('#00000000');
    this.view.webContents.setIgnoreMenuShortcuts(true);
    this.loaded = this.view.webContents.loadURL(PAGE).catch(() => undefined);
  }
}
