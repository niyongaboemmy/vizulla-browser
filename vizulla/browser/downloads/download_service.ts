// Downloads: saved to the user's Downloads folder by default, listed at vizulla://downloads.
import { app, shell, type DownloadItem, type Session } from 'electron';
import { EventEmitter } from 'node:events';
import { existsSync } from 'node:fs';
import { join, parse } from 'node:path';

export interface DownloadInfo {
  id: number;
  url: string;
  filename: string;
  path: string;
  state: 'progressing' | 'completed' | 'cancelled' | 'interrupted' | 'paused';
  received: number;
  total: number;
  startedAt: number;
  mime: string;
}

export class DownloadService extends EventEmitter {
  private nextId = 1;
  private readonly items = new Map<number, { info: DownloadInfo; item: DownloadItem | null }>();

  attach(session: Session, opts: { private?: boolean } = {}): void {
    session.on('will-download', (_e, item) => {
      const id = this.nextId++;
      const dir = app.getPath('downloads');
      const path = uniquePath(dir, item.getFilename());
      item.setSavePath(path);
      const info: DownloadInfo = {
        id, url: item.getURL(), filename: parse(path).base, path, state: 'progressing', received: 0,
        total: item.getTotalBytes(), startedAt: Date.now(), mime: item.getMimeType(),
      };
      this.items.set(id, { info, item });
      const upd = () => {
        info.received = item.getReceivedBytes();
        info.total = item.getTotalBytes();
        info.state = item.isPaused() ? 'paused' : (item.getState() as DownloadInfo['state']);
        this.emit('changed', info);
      };
      item.on('updated', upd);
      item.once('done', () => {
        upd();
        this.items.get(id)!.item = null;
        if (opts.private) setTimeout(() => this.items.delete(id), 0);
      });
      this.emit('started', info);
    });
  }

  list(): DownloadInfo[] {
    return [...this.items.values()].map((x) => x.info).sort((a, b) => b.startedAt - a.startedAt);
  }

  active(): number {
    return this.list().filter((d) => d.state === 'progressing').length;
  }

  action(id: number, what: 'pause' | 'resume' | 'cancel' | 'open' | 'show' | 'remove'): void {
    const x = this.items.get(id);
    if (!x) return;
    switch (what) {
      case 'pause':
        x.item?.pause();
        break;
      case 'resume':
        x.item?.resume();
        break;
      case 'cancel':
        x.item?.cancel();
        break;
      case 'open':
        if (existsSync(x.info.path)) void shell.openPath(x.info.path);
        break;
      case 'show':
        shell.showItemInFolder(x.info.path);
        break;
      case 'remove':
        x.item?.cancel();
        this.items.delete(id);
        break;
    }
    this.emit('changed', x.info);
  }

  clear(): void {
    for (const [id, x] of this.items) if (!x.item) this.items.delete(id);
    this.emit('changed', null);
  }
}

function uniquePath(dir: string, name: string): string {
  const safe = name.replace(/[/\\?%*:|"<>\u0000-\u001f]/g, '_').slice(0, 200) || 'download';
  const { name: base, ext } = parse(safe);
  let p = join(dir, safe);
  for (let i = 1; existsSync(p); i++) p = join(dir, `${base} (${i})${ext}`);
  return p;
}
