// <vz-notes>: Notes side panel (P4-BRW-04). Markdown editing with preview,
// source links back to the clipped passage, search, export.
import { LitElement, css, html, nothing } from 'lit';
import { base } from '../shared/styles';
import { icon } from '../shared/icons';
import { client, on } from '../shared/bridge';
import { renderMarkdown } from '../shared/markdown';
import { NotesInterface, type NoteInfo } from '@vz/common/mojom/notes';
import { t, getLocale } from '@vz/common/i18n';
import { registerPanel } from './panels';

const api = client(NotesInterface);

class VzNotes extends LitElement {
  static override properties = { notes: { state: true }, current: { state: true }, preview: { state: true }, q: { state: true } };
  notes: NoteInfo[] = [];
  current: NoteInfo | null = null;
  preview = false;
  q = '';
  private saveTimer = 0;

  static override styles = [base, css`
    :host { display: flex; flex-direction: column; height: 100%; min-height: 0; }
    .bar { display: flex; gap: 6px; align-items: center; padding: 10px 12px; }
    .bar input { flex: 1; height: 30px; }
    .list { flex: 1; overflow: auto; padding: 0 8px 8px; }
    .items { list-style: none; margin: 0; padding: 0; }
    .item { display: block; width: 100%; text-align: start; border: 0; background: transparent; padding: 10px; border-radius: 10px; cursor: pointer; }
    .item:hover { background: var(--vz-surface-hover); }
    .item b { display: block; font-size: var(--vz-text-m); margin-bottom: 2px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
    .item span { font-size: var(--vz-text-xs); color: var(--vz-text-3); }
    .editor { flex: 1; display: flex; flex-direction: column; min-height: 0; padding: 0 12px 12px; }
    textarea { flex: 1; resize: none; font: 13.5px/1.6 var(--vz-font); padding: 12px; border-radius: 12px; }
    .preview { flex: 1; overflow: auto; padding: 4px 4px; font-size: 13.5px; line-height: 1.6; user-select: text; }
    .preview p { margin: 0 0 8px; }
    .src { display: flex; align-items: center; gap: 6px; margin-top: 8px; font-size: var(--vz-text-xs); color: var(--vz-text-2); }
    .src button { border: 0; background: none; color: var(--vz-accent); cursor: pointer; padding: 0; font-size: inherit; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; max-width: 90%; }
    .empty { text-align: center; color: var(--vz-text-2); padding: 32px 16px; font-size: var(--vz-text-s); }`];

  override connectedCallback(): void {
    super.connectedCallback();
    void this.load();
    on<boolean>('Notes', 'changed', (full) => full && this.load());
  }

  private async load(): Promise<void> {
    this.notes = await api.list(this.q || undefined);
    if (this.current) this.current = this.notes.find((n) => n.id === this.current!.id) ?? null;
  }

  private edit(body: string): void {
    if (!this.current) return;
    this.current = { ...this.current, body };
    clearTimeout(this.saveTimer);
    const id = this.current.id;
    this.saveTimer = window.setTimeout(() => void api.update(id, body), 400);
  }

  override render() {
    const fmt = new Intl.DateTimeFormat(getLocale(), { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });
    if (this.current) {
      const n = this.current;
      return html`<div class="bar">
          <button class="icon-btn" aria-label=${t('notes_back')} @click=${() => ((this.current = null), void this.load())}>${icon('chevron-left', 16)}</button>
          <span style="flex:1"></span>
          <button class="btn ghost" @click=${() => (this.preview = !this.preview)}>${icon(this.preview ? 'note' : 'eye', 13)} ${this.preview ? t('notes_edit') : t('notes_preview')}</button>
          <button class="icon-btn" aria-label=${t('notes_export')} title=${t('notes_export')} @click=${() => api.exportMarkdown(n.id)}>${icon('download', 15)}</button>
          <button class="icon-btn" aria-label=${t('action_delete')} @click=${async () => { await api.remove(n.id); this.current = null; }}>${icon('trash', 15)}</button>
        </div>
        <div class="editor">
          ${this.preview ? html`<div class="preview">${renderMarkdown(n.body, () => html``)}</div>`
            : html`<textarea aria-label=${t('notes_body')} .value=${n.body} placeholder=${t('notes_placeholder')} @input=${(e: InputEvent) => this.edit((e.target as HTMLTextAreaElement).value)}></textarea>`}
          ${n.sourceUrl ? html`<div class="src">${icon('external', 12)} <button @click=${() => api.openSource(n.id)} title=${n.sourceUrl}>${n.sourceTitle ?? n.sourceUrl}</button></div>` : nothing}
        </div>`;
    }
    return html`<div class="bar">
        <input type="search" placeholder=${t('history_search')} aria-label=${t('history_search')} @input=${(e: InputEvent) => ((this.q = (e.target as HTMLInputElement).value), void this.load())} />
        <button class="btn primary" @click=${async () => { const id = await api.create(''); await this.load(); this.current = this.notes.find((x) => x.id === id) ?? null; this.preview = false; }}>${icon('plus', 14)} ${t('notes_new')}</button>
        <button class="icon-btn" aria-label=${t('notes_export_all')} title=${t('notes_export_all')} @click=${() => api.exportMarkdown()}>${icon('download', 15)}</button>
      </div>
      <div class="list">
        ${this.notes.length ? html`<ul class="items">${this.notes.map((n) => html`<li><button class="item" @click=${() => ((this.current = n), (this.preview = false))}>
            <b>${n.title}</b><span>${fmt.format(n.updatedAt)}${n.sourceTitle ? ` · ${n.sourceTitle}` : ''}</span></button></li>`)}</ul>`
          : html`<div class="empty">${icon('note', 24)}<p>${t('notes_empty')}</p></div>`}
      </div>`;
  }
}
customElements.define('vz-notes', VzNotes);
registerPanel('notes', 'vz-notes', () => t('cmd_notes_panel'), 'note');
