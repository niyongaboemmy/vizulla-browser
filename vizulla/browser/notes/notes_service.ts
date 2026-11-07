// Notes (P4-BRW-04/05, MEM-06): Markdown notes in the profile, linked to the page
// and Space they came from. Clips keep the source link plus a text fragment
// (#:~:text=) back to the exact passage.
import { dialog } from 'electron';
import { writeFileSync } from 'node:fs';
import type { BrowserApp } from '../browser_app';
import { Database } from '../storage/database';
import { join } from 'node:path';
import { emitTo, type CallContext } from '../ui/ipc_router';
import { NotesInterface, type NoteInfo } from '@vz/common/mojom/notes';
import { t } from '@vz/common/i18n';
import { kVizullaNotes } from '../vizulla_features';
import type { BrowserWindowController } from '../ui/browser_window';

const MIGRATIONS = [
  `CREATE TABLE notes (id INTEGER PRIMARY KEY, body TEXT NOT NULL, source_url TEXT, source_title TEXT, space_id TEXT,
     created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL);
   CREATE VIRTUAL TABLE notes_fts USING fts5(body, content='notes', content_rowid='id');
   CREATE TRIGGER notes_ai AFTER INSERT ON notes BEGIN INSERT INTO notes_fts(rowid, body) VALUES (new.id, new.body); END;
   CREATE TRIGGER notes_ad AFTER DELETE ON notes BEGIN INSERT INTO notes_fts(notes_fts, rowid, body) VALUES ('delete', old.id, old.body); END;
   CREATE TRIGGER notes_au AFTER UPDATE ON notes BEGIN
     INSERT INTO notes_fts(notes_fts, rowid, body) VALUES ('delete', old.id, old.body);
     INSERT INTO notes_fts(rowid, body) VALUES (new.id, new.body); END;`,
];

export function textFragmentUrl(url: string, quote: string): string {
  const words = quote.replace(/\s+/g, ' ').trim().split(' ');
  const enc = (s: string) => encodeURIComponent(s).replace(/-/g, '%2D');
  const frag = words.length > 12 ? `${enc(words.slice(0, 5).join(' '))},${enc(words.slice(-5).join(' '))}` : enc(words.join(' '));
  return `${url.split('#')[0]}#:~:text=${frag}`;
}

export function noteTitle(body: string): string {
  const first = body.split('\n').find((l) => l.trim()) ?? '';
  return first.replace(/^#+\s*|^>\s*|[*_`]/g, '').trim().slice(0, 80) || t('notes_untitled');
}

export class NotesStore {
  readonly db: Database;
  constructor(path: string, private readonly now: () => number = Date.now) {
    this.db = new Database(path, MIGRATIONS);
  }
  list(q?: string): NoteInfo[] {
    const rows = q?.trim()
      ? this.db.all<Record<string, unknown>>('SELECT n.* FROM notes_fts f JOIN notes n ON n.id = f.rowid WHERE notes_fts MATCH ? ORDER BY n.updated_at DESC LIMIT 200', q.trim().split(/\s+/).map((w) => `"${w.replace(/"/g, '')}"*`).join(' '))
      : this.db.all<Record<string, unknown>>('SELECT * FROM notes ORDER BY updated_at DESC LIMIT 500');
    return rows.map((r) => ({ id: Number(r.id), title: noteTitle(String(r.body)), body: String(r.body), sourceUrl: (r.source_url as string) ?? null, sourceTitle: (r.source_title as string) ?? null, spaceId: (r.space_id as string) ?? null, createdAt: Number(r.created_at), updatedAt: Number(r.updated_at) }));
  }
  get(id: number): NoteInfo | undefined {
    return this.list().find((n) => n.id === id);
  }
  create(body: string, source?: { url: string; title: string } | null, spaceId?: string | null): number {
    const t0 = this.now();
    return this.db.run('INSERT INTO notes (body, source_url, source_title, space_id, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)', body, source?.url ?? null, source?.title ?? null, spaceId ?? null, t0, t0).lastInsertRowid;
  }
  update(id: number, body: string): void {
    this.db.run('UPDATE notes SET body = ?, updated_at = ? WHERE id = ?', body, this.now(), id);
  }
  remove(id: number): void {
    this.db.run('DELETE FROM notes WHERE id = ?', id);
  }
  toMarkdown(ids?: number[]): string {
    return this.list()
      .filter((n) => !ids || ids.includes(n.id))
      .map((n) => `${n.body.trim()}\n${n.sourceUrl ? `\n— [${n.sourceTitle ?? n.sourceUrl}](${n.sourceUrl})\n` : ''}`)
      .join('\n---\n\n');
  }
}

export class NotesService {
  readonly store: NotesStore;

  constructor(private readonly app: BrowserApp) {
    const p = app.profile;
    this.store = p.register('notes', new NotesStore(join(p.dir, 'Notes.db')), () => this.store.db.close());
    const enabled = () => p.features.isEnabled(kVizullaNotes);
    const win = (ctx: CallContext) => app.windowForSender(ctx.sender);
    app.router.bind(
      NotesInterface,
      {
        list: (_c, q) => this.store.list(q),
        create: (ctx, body) => {
          const id = this.store.create(body ?? '', null, win(ctx)?.model.activeSpaceId);
          this.changed();
          return id;
        },
        update: (_c, id, body) => {
          this.store.update(id, body);
          this.changed(false);
        },
        remove: (_c, id) => {
          this.store.remove(id);
          this.changed();
        },
        openSource: (ctx, id) => {
          const n = this.store.get(id);
          if (n?.sourceUrl && /^https?:/.test(n.sourceUrl)) win(ctx)?.loadUrl(null, n.sourceUrl, { newTab: true });
        },
        exportMarkdown: async (ctx, id) => {
          const w = win(ctx);
          const r = await dialog.showSaveDialog(w?.win as unknown as Electron.BrowserWindow, { defaultPath: 'vizulla-notes.md', filters: [{ name: 'Markdown', extensions: ['md'] }] });
          if (r.canceled || !r.filePath) return false;
          writeFileSync(r.filePath, this.store.toMarkdown(id ? [id] : undefined));
          return true;
        },
      },
      { hosts: ['chrome'] },
    );
    app.commandHandlers.set('notes.panel', (w) => w.togglePanel('notes'));
    app.commandHandlers.set('notes.fromAssistant', (w, args) => {
      const tab = w.activeTab();
      const text = String(args?.text ?? '').trim();
      if (!text) return;
      this.store.create(text, tab && /^https?:/.test(tab.url) ? { url: tab.url, title: tab.title } : null, w.model.activeSpaceId);
      this.changed();
      w.toast(t('notes_saved'), { label: t('cmd_notes_panel'), run: () => w.setPanel('notes') });
    });
    app.hooks.selectionActions.push((w, tab, text) =>
      enabled() ? [{ label: t('notes_clip'), click: () => this.clip(w, tab.url, tab.title, text) }] : [],
    );
  }

  clip(w: BrowserWindowController, url: string, title: string, quote: string): number {
    const src = /^https?:/.test(url) ? { url: textFragmentUrl(url, quote), title } : null;
    const id = this.store.create(`> ${quote.trim().replace(/\n+/g, '\n> ')}\n\n`, src, w.model.activeSpaceId);
    this.changed();
    w.setPanel('notes');
    return id;
  }

  private changed(full = true): void {
    for (const w of this.app.windows) emitTo(w.chrome.webContents, 'Notes', 'changed', full);
  }
}
