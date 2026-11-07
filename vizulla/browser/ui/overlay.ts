// The overlay layer: a transparent WebContentsView stacked above page content for
// browser-owned surfaces (Command Bar, Space editor, AI disclosure, permission
// prompts, agent plan approval and confirmations). Pages can't draw over it (C9).
// Created lazily on first use (P3-BRW-01) and detached when idle.
import { WebContentsView, type BaseWindow } from 'electron';
import { randomUUID } from 'node:crypto';
import { emitTo } from './ipc_router';

export type OverlaySurface =
  | { kind: 'command-bar'; mode: 'palette' | 'address' | 'tab-search' | 'ask'; anchor?: { x: number; y: number; width: number; height: number }; initial: string; newTab: boolean }
  | { kind: 'shields'; anchor: { x: number; y: number; width: number; height: number }; status: unknown }
  | { kind: 'dialog'; id: string; dialog: Record<string, unknown> & { type: string } };

export class OverlayController {
  private view: WebContentsView | null = null;
  private attached = false;
  private ready = false;
  private queue: OverlaySurface[] = [];
  private current: OverlaySurface | null = null;
  private readonly pending = new Map<string, (result: unknown) => void>();
  onClosed: ((surface: OverlaySurface | null, result: unknown) => void) | null = null;

  constructor(private readonly win: BaseWindow, private readonly preload: string, private readonly sessionFor: () => Electron.Session) {}

  get webContents() {
    return this.view?.webContents ?? null;
  }

  get isOpen(): boolean {
    return this.attached;
  }

  get surface(): OverlaySurface | null {
    return this.current;
  }

  show(surface: OverlaySurface): void {
    // Dialogs queue behind each other; a Command Bar request replaces a Command Bar.
    if (this.current?.kind === 'dialog' && surface.kind !== 'dialog') return;
    if (this.current?.kind === 'dialog' && surface.kind === 'dialog') {
      this.queue.push(surface);
      return;
    }
    this.current = surface;
    this.ensureView();
    this.attach();
    if (this.ready) emitTo(this.view!.webContents, 'Overlay', 'show', surface);
  }

  /** Shows a dialog and resolves with what the user chose. Browser-owned: the page never sees it. */
  dialog<T>(dialog: Record<string, unknown> & { type: string }): Promise<T> {
    const id = randomUUID().replace(/-/g, '');
    return new Promise<T>((resolve) => {
      this.pending.set(id, resolve as (r: unknown) => void);
      this.show({ kind: 'dialog', id, dialog });
    });
  }

  onReady(): void {
    this.ready = true;
    if (this.current && this.view) emitTo(this.view.webContents, 'Overlay', 'show', this.current);
  }

  dialogResult(id: string, result: unknown): void {
    const resolve = this.pending.get(id);
    if (!resolve) return;
    this.pending.delete(id);
    resolve(result);
    if (this.current?.kind === 'dialog' && this.current.id === id) this.close(result);
  }

  close(result?: unknown): void {
    const was = this.current;
    // Closing a dialog without a choice resolves it as cancelled.
    if (was?.kind === 'dialog' && this.pending.has(was.id)) {
      const r = this.pending.get(was.id)!;
      this.pending.delete(was.id);
      r(null);
    }
    this.current = null;
    const next = this.queue.shift();
    if (next) {
      this.show(next);
    } else {
      this.detach();
      if (this.view) emitTo(this.view.webContents, 'Overlay', 'hide');
    }
    this.onClosed?.(was, result);
  }

  layout(): void {
    if (!this.view || !this.attached) return;
    const [width, height] = this.win.getContentSize();
    this.view.setBounds({ x: 0, y: 0, width: width!, height: height! });
  }

  destroy(): void {
    for (const r of this.pending.values()) r(null);
    this.pending.clear();
    if (this.view && !this.view.webContents.isDestroyed()) this.view.webContents.close();
    this.view = null;
  }

  private ensureView(): void {
    if (this.view && !this.view.webContents.isDestroyed()) return;
    this.ready = false;
    this.view = new WebContentsView({
      webPreferences: { session: this.sessionFor(), preload: this.preload, sandbox: true, contextIsolation: true, nodeIntegration: false, spellcheck: true },
    });
    this.view.setBackgroundColor('#00000000');
    void this.view.webContents.loadURL('vizulla://overlay/');
  }

  private attach(): void {
    if (!this.view) return;
    // Re-adding moves the view to the top of the stack.
    this.win.contentView.addChildView(this.view);
    this.attached = true;
    this.layout();
    this.view.webContents.focus();
  }

  private detach(): void {
    if (!this.view || !this.attached) return;
    this.win.contentView.removeChildView(this.view);
    this.attached = false;
  }
}
