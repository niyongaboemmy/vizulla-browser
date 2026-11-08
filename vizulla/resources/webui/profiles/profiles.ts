// vizulla://profiles: the profile picker and manager (like Chrome's). Pick a
// profile to open it, add one, rename or recolor, delete (only when closed).
import { css, html, nothing, type TemplateResult } from 'lit';
import { base, pageStyles } from '../shared/styles';
import { icon, logo } from '../shared/icons';
import { VzPage } from '../shared/page_base';
import { t } from '@vz/common/i18n';
import { PROFILE_HEX } from '@vz/common/tokens';

interface Entry { id: string; name: string; color: string; running: boolean; lastUsed: number }
interface Data { current: string; profiles: Entry[]; colors: string[] }

export function avatar(name: string, color: string, size = 72): TemplateResult {
  return html`<span class="avatar" aria-hidden="true" style="--c:${PROFILE_HEX[color] ?? PROFILE_HEX.blue};width:${size}px;height:${size}px;font-size:${Math.round(size * 0.42)}px">${(name.trim()[0] ?? '?').toUpperCase()}</span>`;
}

class VzProfiles extends VzPage<Data> {
  static override properties = { ...VzPage.properties, editing: { state: true }, confirm: { state: true }, note: { state: true } };
  /** 'new', a profile id, or null. */
  editing: string | null = null;
  confirm: string | null = null;
  note = '';
  private draft = { name: '', color: 'blue' };

  static override styles = [
    base,
    pageStyles,
    css`
      :host { background: radial-gradient(900px 520px at 50% -10%, color-mix(in srgb, var(--vz-accent) 12%, transparent), transparent 70%), var(--vz-bg); }
      .wrap { max-width: 860px; margin: 0 auto; padding: 9vh 20px 60px; text-align: center; }
      h1 { font-size: 30px; letter-spacing: -0.02em; margin: 18px 0 6px; }
      .grid { display: flex; flex-wrap: wrap; justify-content: center; gap: 14px; margin-top: 34px; }
      .card-p { position: relative; width: 168px; padding: 22px 12px 16px; border-radius: 26px; border: 1px solid var(--vz-glass-border);
        background: var(--vz-glass-strong); backdrop-filter: blur(20px) saturate(170%); display: flex; flex-direction: column; align-items: center; gap: 12px;
        animation: vz-rise 380ms var(--vz-ease) both; transition: transform var(--vz-dur) var(--vz-ease), border-color var(--vz-dur); }
      .card-p:hover { transform: translateY(-4px); border-color: color-mix(in srgb, var(--vz-accent) 40%, transparent); }
      .card-p .open { all: unset; position: absolute; inset: 0; border-radius: 26px; cursor: pointer; }
      .card-p .open:focus-visible { outline: 2px solid var(--vz-focus); outline-offset: 2px; }
      .avatar { border-radius: 50%; display: grid; place-items: center; color: #fff; font-weight: 700; background: var(--c); flex: none; transition: transform var(--vz-dur) var(--vz-ease); }
      .card-p:hover .avatar { transform: scale(1.06); }
      .name { font-weight: 650; max-width: 100%; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
      .state { font-size: 11px; font-weight: 700; color: var(--vz-accent); background: var(--vz-accent-soft); padding: 2px 9px; border-radius: 999px; }
      .state.idle { visibility: hidden; }
      .tools { position: absolute; top: 8px; right: 8px; display: flex; gap: 2px; opacity: 0; transition: opacity var(--vz-dur); z-index: 1; }
      .card-p:hover .tools, .card-p:focus-within .tools { opacity: 1; }
      .add-card { border-style: dashed; color: var(--vz-text-2); }
      .add-card .avatar { background: var(--vz-surface-2); color: var(--vz-accent); }
      .editor { max-width: 420px; margin: 28px auto 0; text-align: left; padding: 22px; border-radius: 26px; border: 1px solid var(--vz-glass-border);
        background: var(--vz-glass-strong); backdrop-filter: blur(20px) saturate(170%); animation: vz-rise 300ms var(--vz-ease); display: grid; gap: 14px; }
      .editor .preview { display: flex; align-items: center; gap: 14px; }
      .editor label { display: grid; gap: 6px; font-size: var(--vz-text-s); font-weight: 600; color: var(--vz-text-2); }
      .swatches { display: flex; gap: 8px; flex-wrap: wrap; }
      .sw { width: 30px; height: 30px; border-radius: 50%; border: 0; cursor: pointer; background: var(--c); transition: transform var(--vz-dur) var(--vz-ease); display: grid; place-items: center; color: #fff; }
      .sw:hover { transform: scale(1.12); }
      .sw[aria-checked='true'] { outline: 2px solid var(--c); outline-offset: 3px; }
      .acts { display: flex; gap: 8px; justify-content: flex-end; flex-wrap: wrap; }
      .warn { color: var(--vz-danger); font-size: var(--vz-text-s); }
    `,
  ];

  protected override loaded(): void {
    if (location.hash === '#new') this.startEdit('new');
  }

  private startEdit(id: string): void {
    const p = this.data!.profiles.find((x) => x.id === id);
    this.draft = p ? { name: p.name, color: p.color } : { name: '', color: this.data!.colors[this.data!.profiles.length % this.data!.colors.length]! };
    this.editing = id;
    this.confirm = null;
    this.note = '';
  }

  override render() {
    const d = this.data;
    if (!d) return this.loading();
    return html`<div class="wrap">
      <div class="rise" style="display:inline-grid">${logo(56)}</div>
      <h1 class="rise" style="--i:1">${t('profile_title')}</h1>
      <p class="muted rise" style="--i:2">${t('profile_subtitle')}</p>
      <div class="grid">
        ${d.profiles.map((p, i) => html`<div class="card-p" style="animation-delay:${80 + i * 50}ms">
          <button class="open" aria-label="${t('profile_open')} ${p.name}" @click=${() => this.invoke('open', p.id)}></button>
          <div class="tools">
            <button class="icon-btn" title=${t('profile_edit')} aria-label="${t('profile_edit')} ${p.name}" @click=${() => this.startEdit(p.id)}>${icon('edit', 14)}</button>
          </div>
          ${avatar(p.name, p.color)}
          <span class="name">${p.name}</span>
          <span class="state ${p.id === d.current || p.running ? '' : 'idle'}">${p.id === d.current ? t('profile_current') : t('profile_open_now')}</span>
        </div>`)}
        <div class="card-p add-card" style="animation-delay:${80 + d.profiles.length * 50}ms">
          <button class="open" aria-label=${t('profile_add')} @click=${() => this.startEdit('new')}></button>
          <span class="avatar" style="width:72px;height:72px">${icon('plus', 28)}</span>
          <span class="name">${t('profile_add')}</span><span class="state idle">.</span>
        </div>
      </div>
      ${this.editing ? this.renderEditor() : nothing}
    </div>`;
  }

  private renderEditor(): TemplateResult {
    const d = this.data!;
    const isNew = this.editing === 'new';
    const target = d.profiles.find((p) => p.id === this.editing);
    const save = async () => {
      if (!this.draft.name.trim()) return;
      this.data = isNew
        ? await this.invoke<Data>('create', { name: this.draft.name, color: this.draft.color })
        : await this.invoke<Data>('update', { id: this.editing, patch: { name: this.draft.name, color: this.draft.color } });
      this.editing = null;
    };
    return html`<form class="editor" @submit=${(e: SubmitEvent) => (e.preventDefault(), void save())}>
      <div class="preview">${avatar(this.draft.name || '?', this.draft.color, 52)}<strong style="font-size:17px">${isNew ? t('profile_add') : t('profile_edit')}</strong></div>
      <label>${t('profile_name')}<input type="text" maxlength="40" required autofocus .value=${this.draft.name}
        @input=${(e: InputEvent) => ((this.draft = { ...this.draft, name: (e.target as HTMLInputElement).value }), this.requestUpdate())} /></label>
      <div class="field"><div style="font-size:var(--vz-text-s);font-weight:600;color:var(--vz-text-2);margin-bottom:8px">${t('profile_color')}</div>
        <div class="swatches" role="radiogroup" aria-label=${t('profile_color')}>${d.colors.map((c) => html`<button type="button" class="sw" role="radio" aria-label=${c}
          aria-checked=${this.draft.color === c} style="--c:${PROFILE_HEX[c]}" @click=${() => ((this.draft = { ...this.draft, color: c }), this.requestUpdate())}>${this.draft.color === c ? icon('check', 14) : nothing}</button>`)}</div></div>
      ${this.note ? html`<div class="warn" role="alert">${this.note}</div>` : nothing}
      <div class="acts">
        ${target && target.id !== 'default' && target.id !== d.current
          ? this.confirm === target.id
            ? html`<button type="button" class="btn danger primary" @click=${async () => {
                try {
                  this.data = await this.invoke<Data>('remove', target.id);
                  this.editing = null;
                } catch {
                  this.note = t('profile_delete_open');
                }
              }}>${icon('trash', 14)} ${t('profile_delete_confirm', { name: target.name })}</button>`
            : html`<button type="button" class="btn danger" @click=${() => (this.confirm = target.id)}>${icon('trash', 14)} ${t('profile_delete')}</button>`
          : nothing}
        <span style="flex:1"></span>
        <button type="button" class="btn" @click=${() => (this.editing = null)}>${t('action_cancel')}</button>
        <button type="submit" class="btn primary" ?disabled=${!this.draft.name.trim()}>${icon('check', 14)} ${isNew ? t('profile_create') : t('action_save')}</button>
      </div>
    </form>`;
  }
}
customElements.define('vz-profiles', VzProfiles);
