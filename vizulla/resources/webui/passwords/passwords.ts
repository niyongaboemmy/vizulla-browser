// vizulla://passwords: the Password Manager. Saved logins by site with search,
// details (copy, reveal behind Touch ID, edit, delete), Checkup (compromised,
// reused, weak), and settings (offer to save, import/export, never-saved sites).
// Passwords reach this page only when the user reveals one.
import { css, html, nothing, type TemplateResult } from 'lit';
import { base, pageStyles } from '../shared/styles';
import { icon } from '../shared/icons';
import { VzPage } from '../shared/page_base';
import { page } from '../shared/bridge';
import { t } from '@vz/common/i18n';

interface Login {
  id: number;
  origin: string;
  username: string;
  breached: boolean | null;
  updatedAt: number;
  weak: boolean;
  reused: boolean;
}
interface Data {
  logins: Login[];
  offerToSave: boolean;
  neverSave: string[];
  biometric: boolean;
}
type View = 'list' | 'checkup' | 'settings';

const host = (origin: string) => {
  try {
    return new URL(origin).host.replace(/^www\./, '');
  } catch {
    return origin;
  }
};
const HUES = [212, 262, 330, 18, 152, 190, 38, 280];
const mono = (origin: string, size = 36) => {
  const h = host(origin);
  const hue = HUES[[...h].reduce((n, c) => n + c.charCodeAt(0), 0) % HUES.length];
  return html`<span class="mono" aria-hidden="true" style="--h:${hue};width:${size}px;height:${size}px;font-size:${Math.round(size * 0.42)}px">${(h[0] ?? '?').toUpperCase()}</span>`;
};

class VzPasswords extends VzPage<Data> {
  static override properties = {
    ...VzPage.properties,
    view: { state: true }, q: { state: true }, open: { state: true }, revealed: { state: true },
    editing: { state: true }, adding: { state: true }, busy: { state: true }, flash: { state: true }, confirmDelete: { state: true },
  };
  view: View = 'list';
  q = '';
  open: number | null = null;
  revealed: Record<number, { password: string; note: string }> = {};
  editing: number | null = null;
  adding = false;
  busy = '';
  flash = '';
  confirmDelete: number | null = null;
  private draft: Record<string, string> = {};
  private flashTimer = 0;

  static override styles = [
    base,
    pageStyles,
    css`
      .hero { display: flex; align-items: center; gap: 14px; margin-bottom: 20px; flex-wrap: wrap; }
      .hero .badge { width: 52px; height: 52px; border-radius: 50%; display: grid; place-items: center; background: var(--vz-accent-soft); color: var(--vz-accent); flex: none; }
      .hero h1 { font-size: var(--vz-text-2xl); font-weight: 700; letter-spacing: -0.02em; margin: 0; }
      .hero .grow { flex: 1; min-width: 160px; }
      .hero input[type=search] { width: min(300px, 100%); }
      .add { width: 40px; height: 40px; border-radius: 50%; border: 0; background: var(--vz-accent); color: var(--vz-on-accent); display: grid; place-items: center; cursor: pointer; transition: transform var(--vz-dur) var(--vz-ease), filter var(--vz-dur); }
      .add:hover { filter: brightness(1.08); transform: rotate(90deg); }
      .add:active { transform: rotate(90deg) scale(.92); }
      .tabs { display: inline-flex; gap: 2px; padding: 4px; border-radius: 999px; background: var(--vz-surface-2); margin-bottom: 18px; }
      .tabs button { display: inline-flex; align-items: center; gap: 6px; height: 34px; padding: 0 16px; border: 0; border-radius: 999px; background: transparent; color: var(--vz-text-2); cursor: pointer; font-weight: 600; transition: background var(--vz-dur), color var(--vz-dur); }
      .tabs button[aria-selected='true'] { background: var(--vz-bg-elev); color: var(--vz-accent); box-shadow: 0 0 0 1px var(--vz-glass-border); }
      .tabs .count { min-width: 18px; height: 18px; padding: 0 5px; border-radius: 999px; font-size: 11px; display: grid; place-items: center; background: var(--vz-danger); color: #fff; }
      .mono { border-radius: 50%; display: grid; place-items: center; flex: none; color: #fff; font-weight: 700; background: hsl(var(--h) 70% 52%); }
      .letter { font-size: var(--vz-text-xs); font-weight: 700; letter-spacing: .08em; color: var(--vz-text-3); margin: 14px 16px 6px; }
      .item { border-radius: 18px; transition: background var(--vz-dur); }
      .item + .item { margin-top: 2px; }
      .item.open { background: var(--vz-surface-2); }
      .row-btn { all: unset; box-sizing: border-box; width: 100%; display: flex; align-items: center; gap: 12px; padding: 10px 14px; cursor: pointer; border-radius: 18px; }
      .row-btn:hover { background: var(--vz-surface-hover); }
      .row-btn:focus-visible { outline: 2px solid var(--vz-focus); outline-offset: -2px; }
      .row-btn .who { flex: 1; min-width: 0; display: flex; flex-direction: column; }
      .row-btn .site { font-weight: 600; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
      .row-btn .user { color: var(--vz-text-2); font-size: var(--vz-text-s); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
      .flags { display: flex; gap: 4px; }
      .flag { width: 22px; height: 22px; border-radius: 50%; display: grid; place-items: center; }
      .flag.bad { color: var(--vz-danger); background: color-mix(in srgb, var(--vz-danger) 12%, transparent); }
      .flag.warn { color: var(--vz-warn); background: color-mix(in srgb, var(--vz-warn) 14%, transparent); }
      .chev { color: var(--vz-text-3); transition: transform 220ms var(--vz-ease); }
      .item.open .chev { transform: rotate(180deg); }
      .detail { padding: 2px 14px 14px 62px; display: grid; gap: 8px; animation: vz-rise 260ms var(--vz-ease); }
      .field-row { display: flex; align-items: center; gap: 8px; min-height: 40px; padding: 0 6px 0 14px; border-radius: 999px; background: var(--vz-bg-elev); border: 1px solid var(--vz-border); }
      .field-row .lbl { width: 92px; flex: none; color: var(--vz-text-3); font-size: var(--vz-text-s); }
      .field-row .val { flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
      .field-row .val.secret { font-family: var(--vz-font-mono); letter-spacing: .04em; }
      .note { padding: 10px 14px; border-radius: 16px; background: var(--vz-bg-elev); border: 1px solid var(--vz-border); white-space: pre-wrap; color: var(--vz-text-2); font-size: var(--vz-text-s); }
      .acts { display: flex; gap: 6px; flex-wrap: wrap; margin-top: 4px; }
      .form { display: grid; gap: 10px; }
      .form label { display: grid; gap: 6px; font-size: var(--vz-text-s); font-weight: 600; color: var(--vz-text-2); }
      .form .pw { display: flex; gap: 6px; } .form .pw input { flex: 1; font-family: var(--vz-font-mono); }
      .form textarea { min-height: 70px; resize: vertical; }
      .empty-state { text-align: center; padding: 48px 20px; }
      .empty-state .orb { width: 76px; height: 76px; border-radius: 50%; margin: 0 auto 16px; display: grid; place-items: center; background: var(--vz-accent-soft); color: var(--vz-accent); animation: float 5s ease-in-out infinite; }
      @keyframes float { 50% { transform: translateY(-6px); } }
      .stats { display: grid; grid-template-columns: repeat(3, 1fr); gap: 12px; margin-bottom: 16px; }
      .stat { padding: 18px; border-radius: 22px; background: var(--vz-bg-elev); border: 1px solid var(--vz-border); display: grid; gap: 6px; animation: vz-rise 380ms var(--vz-ease) both; }
      .stat:nth-child(2) { animation-delay: 60ms; } .stat:nth-child(3) { animation-delay: 120ms; }
      .stat .ic { width: 36px; height: 36px; border-radius: 50%; display: grid; place-items: center; }
      .stat .n { font-size: 30px; font-weight: 750; letter-spacing: -0.02em; font-variant-numeric: tabular-nums; }
      .stat .d { color: var(--vz-text-2); font-size: var(--vz-text-s); }
      .stat.bad .ic { color: var(--vz-danger); background: color-mix(in srgb, var(--vz-danger) 12%, transparent); }
      .stat.warn .ic { color: var(--vz-warn); background: color-mix(in srgb, var(--vz-warn) 14%, transparent); }
      .stat.ok .ic { color: var(--vz-ok); background: color-mix(in srgb, var(--vz-ok) 14%, transparent); }
      .allgood { display: flex; align-items: center; gap: 14px; padding: 18px 20px; }
      .allgood .ic { width: 44px; height: 44px; border-radius: 50%; display: grid; place-items: center; color: var(--vz-ok); background: color-mix(in srgb, var(--vz-ok) 14%, transparent); animation: pop 420ms var(--vz-ease); }
      @keyframes pop { from { transform: scale(.4); opacity: 0; } 70% { transform: scale(1.1); } }
      .issue { display: flex; align-items: center; gap: 12px; padding: 10px 14px; }
      .issue .who { flex: 1; min-width: 0; }
      .toast { position: fixed; left: 50%; bottom: 24px; transform: translateX(-50%); padding: 10px 18px; border-radius: 999px; background: var(--vz-text); color: var(--vz-bg); font-weight: 600; font-size: var(--vz-text-s); animation: vz-rise 220ms var(--vz-ease); }
      @media (max-width: 640px) { .stats { grid-template-columns: 1fr; } .detail { padding-left: 14px; } .field-row .lbl { width: 70px; } }
    `,
  ];

  protected override loaded(): void {
    page.on('changed', () => void this.invoke<Data>('init').then((d) => (this.data = d)));
  }

  private say(text: string): void {
    this.flash = text;
    clearTimeout(this.flashTimer);
    this.flashTimer = window.setTimeout(() => (this.flash = ''), 1800);
  }

  private get filtered(): Login[] {
    const q = this.q.trim().toLowerCase();
    const list = [...this.data!.logins].sort((a, b) => host(a.origin).localeCompare(host(b.origin)));
    return q ? list.filter((l) => `${host(l.origin)} ${l.username}`.toLowerCase().includes(q)) : list;
  }

  override render() {
    const d = this.data;
    if (!d) return this.loading();
    const issues = d.logins.filter((l) => l.breached).length;
    const tab = (id: View, ic: string, label: string, badge = 0) => html`<button role="tab" aria-selected=${this.view === id} @click=${() => (this.view = id)}>
      ${icon(ic, 15)}<span>${label}</span>${badge ? html`<span class="count">${badge}</span>` : nothing}</button>`;
    return html`<div class="page">
      <div class="hero rise">
        <span class="badge">${icon('key', 24)}</span>
        <div class="grow"><h1>${t('pm_title')}</h1><div class="muted">${t('pw_count', { count: d.logins.length })}</div></div>
        ${this.view === 'list'
          ? html`<input type="search" placeholder=${t('pm_search')} aria-label=${t('pm_search')} .value=${this.q} @input=${(e: InputEvent) => (this.q = (e.target as HTMLInputElement).value)} />`
          : nothing}
        <button class="add" title=${t('pm_add')} aria-label=${t('pm_add')} @click=${() => ((this.adding = true), (this.view = 'list'), (this.draft = {}))}>${icon('plus', 20)}</button>
      </div>
      <div class="tabs" role="tablist">${tab('list', 'key', t('pm_tab_passwords'))}${tab('checkup', 'shield', t('pm_tab_checkup'), issues)}${tab('settings', 'settings', t('pm_tab_settings'))}</div>
      ${this.view === 'list' ? this.renderList() : this.view === 'checkup' ? this.renderCheckup() : this.renderSettings()}
      ${this.flash ? html`<div class="toast" role="status">${this.flash}</div>` : nothing}
    </div>`;
  }

  // ---- list

  private renderList(): TemplateResult {
    const list = this.filtered;
    let letter = '';
    return html`${this.adding ? this.renderAdd() : nothing}
      ${list.length
        ? html`<div class="card rise" style="padding:6px">${list.map((l) => {
            const first = host(l.origin)[0]?.toUpperCase() ?? '';
            const head = first !== letter && !this.q ? html`<div class="letter">${first}</div>` : nothing;
            letter = first;
            return html`${head}${this.renderItem(l)}`;
          })}</div>`
        : !this.adding
          ? html`<div class="card empty-state rise"><div class="orb">${icon('key', 32)}</div><h2>${this.q ? t('pm_no_match') : t('pm_empty')}</h2>
              ${this.q ? nothing : html`<p class="muted">${t('pm_empty_body')}</p><button class="btn primary" @click=${() => ((this.adding = true), (this.draft = {}))}>${icon('plus', 15)} ${t('pm_add')}</button>`}</div>`
          : nothing}`;
  }

  private renderItem(l: Login): TemplateResult {
    const open = this.open === l.id;
    return html`<div class="item ${open ? 'open' : ''}">
      <button class="row-btn" aria-expanded=${open} @click=${() => this.toggle_(l.id)}>
        ${mono(l.origin)}
        <span class="who"><span class="site">${host(l.origin)}</span><span class="user">${l.username || t('pw_no_username')}</span></span>
        <span class="flags">
          ${l.breached ? html`<span class="flag bad" title=${t('pm_compromised')}>${icon('alert', 13)}</span>` : nothing}
          ${l.reused ? html`<span class="flag warn" title=${t('pm_reused')}>${icon('copy', 12)}</span>` : nothing}
          ${l.weak ? html`<span class="flag warn" title=${t('pm_weak')}>${icon('lock', 12)}</span>` : nothing}
        </span>
        <span class="chev">${icon('chevron-down', 16)}</span>
      </button>
      ${open ? (this.editing === l.id ? this.renderEdit(l) : this.renderDetail(l)) : nothing}
    </div>`;
  }

  private toggle_(id: number): void {
    this.open = this.open === id ? null : id;
    this.editing = null;
    this.confirmDelete = null;
  }

  private async reveal(id: number): Promise<boolean> {
    if (this.revealed[id]) return true;
    const r = await this.invoke<{ password: string; note: string } | null>('reveal', id);
    if (r) this.revealed = { ...this.revealed, [id]: { password: r.password, note: r.note } };
    return !!r;
  }

  private renderDetail(l: Login): TemplateResult {
    const secret = this.revealed[l.id];
    const copy = async (field: 'username' | 'password') => (await this.invoke<boolean>('copy', { id: l.id, field })) && this.say(t('pm_copied'));
    return html`<div class="detail">
      <div class="field-row"><span class="lbl">${t('pw_username')}</span><span class="val">${l.username || '—'}</span>
        <button class="icon-btn" title=${t('pm_copy')} aria-label=${t('pm_copy')} @click=${() => copy('username')}>${icon('copy', 15)}</button></div>
      <div class="field-row"><span class="lbl">${t('pw_password')}</span><span class="val secret">${secret?.password ?? '••••••••••••'}</span>
        <button class="icon-btn" title=${secret ? t('pm_hide') : t('pw_reveal')} aria-label=${secret ? t('pm_hide') : t('pw_reveal')}
          @click=${() => (secret ? (this.revealed = { ...this.revealed, [l.id]: undefined as never }) : void this.reveal(l.id))}>${icon(secret ? 'eye-off' : 'eye', 15)}</button>
        <button class="icon-btn" title=${t('pm_copy')} aria-label=${t('pm_copy')} @click=${() => copy('password')}>${icon('copy', 15)}</button></div>
      ${secret?.note ? html`<div class="note">${secret.note}</div>` : nothing}
      <div class="acts">
        <button class="btn" @click=${async () => {
          if (!(await this.reveal(l.id))) return;
          const s = this.revealed[l.id]!;
          this.draft = { username: l.username, password: s.password, note: s.note };
          this.editing = l.id;
        }}>${icon('edit', 14)} ${t('pm_edit')}</button>
        <button class="btn" @click=${() => this.invoke('open', l.origin)}>${icon('external', 14)} ${t('pm_open_site')}</button>
        <span style="flex:1"></span>
        ${this.confirmDelete === l.id
          ? html`<button class="btn" @click=${() => (this.confirmDelete = null)}>${t('action_cancel')}</button>
              <button class="btn danger primary" @click=${async () => ((this.data = await this.invoke<Data>('remove', l.id)), (this.open = null), this.say(t('pm_deleted')))}>${icon('trash', 14)} ${t('action_delete')}</button>`
          : html`<button class="btn danger" @click=${() => (this.confirmDelete = l.id)}>${icon('trash', 14)} ${t('action_delete')}</button>`}
      </div>
    </div>`;
  }

  private pwInput(): TemplateResult {
    return html`<span class="pw"><input type="text" spellcheck="false" autocomplete="off" .value=${this.draft.password ?? ''} @input=${(e: InputEvent) => (this.draft.password = (e.target as HTMLInputElement).value)} aria-label=${t('pw_password')} />
      <button class="icon-btn" type="button" title=${t('pw_generate')} aria-label=${t('pw_generate')} @click=${async () => ((this.draft = { ...this.draft, password: await this.invoke<string>('generate') }), this.requestUpdate())}>${icon('wand', 16)}</button></span>`;
  }

  private renderEdit(l: Login): TemplateResult {
    return html`<form class="detail form" @submit=${async (e: SubmitEvent) => {
        e.preventDefault();
        if (!this.draft.password) return;
        this.data = await this.invoke<Data>('update', { id: l.id, username: this.draft.username, password: this.draft.password, note: this.draft.note });
        this.revealed = { ...this.revealed, [l.id]: { password: this.draft.password, note: this.draft.note ?? '' } };
        this.editing = null;
        this.say(t('pm_saved'));
      }}>
      <label>${t('pw_username')}<input type="text" .value=${this.draft.username ?? ''} @input=${(e: InputEvent) => (this.draft.username = (e.target as HTMLInputElement).value)} /></label>
      <label>${t('pw_password')}${this.pwInput()}</label>
      <label>${t('pm_note')}<textarea .value=${this.draft.note ?? ''} @input=${(e: InputEvent) => (this.draft.note = (e.target as HTMLTextAreaElement).value)}></textarea></label>
      <div class="acts"><span style="flex:1"></span><button class="btn" type="button" @click=${() => (this.editing = null)}>${t('action_cancel')}</button>
        <button class="btn primary" type="submit">${icon('check', 14)} ${t('action_save')}</button></div>
    </form>`;
  }

  private renderAdd(): TemplateResult {
    return html`<form class="card section form rise" style="margin-bottom:14px" @submit=${async (e: SubmitEvent) => {
        e.preventDefault();
        if (!this.draft.site || !this.draft.password) return;
        try {
          this.data = await this.invoke<Data>('add', { site: this.draft.site, username: this.draft.username ?? '', password: this.draft.password, note: this.draft.note });
          this.adding = false;
          this.say(t('pm_saved'));
        } catch {
          this.say(t('pm_bad_site'));
        }
      }}>
      <h2>${t('pm_add')}</h2>
      <label>${t('pm_site')}<input type="url" required placeholder="https://example.com" .value=${this.draft.site ?? ''} @input=${(e: InputEvent) => (this.draft.site = (e.target as HTMLInputElement).value)} /></label>
      <label>${t('pw_username')}<input type="text" .value=${this.draft.username ?? ''} @input=${(e: InputEvent) => (this.draft.username = (e.target as HTMLInputElement).value)} /></label>
      <label>${t('pw_password')}${this.pwInput()}</label>
      <label>${t('pm_note')}<textarea .value=${this.draft.note ?? ''} @input=${(e: InputEvent) => (this.draft.note = (e.target as HTMLTextAreaElement).value)}></textarea></label>
      <div class="acts"><span style="flex:1"></span><button class="btn" type="button" @click=${() => (this.adding = false)}>${t('action_cancel')}</button>
        <button class="btn primary" type="submit">${icon('check', 14)} ${t('action_save')}</button></div>
    </form>`;
  }

  // ---- checkup

  private renderCheckup(): TemplateResult {
    const d = this.data!;
    const groups = [
      { key: 'bad', icon: 'alert', title: t('pm_compromised'), desc: t('pm_compromised_desc'), list: d.logins.filter((l) => l.breached) },
      { key: 'warn', icon: 'copy', title: t('pm_reused'), desc: t('pm_reused_desc'), list: d.logins.filter((l) => l.reused) },
      { key: 'warn', icon: 'lock', title: t('pm_weak'), desc: t('pm_weak_desc'), list: d.logins.filter((l) => l.weak) },
    ];
    const total = groups.reduce((n, g) => n + g.list.length, 0);
    return html`<div class="stats">${groups.map((g) => html`<div class="stat ${g.list.length ? g.key : 'ok'}">
        <span class="ic">${icon(g.list.length ? g.icon : 'check', 18)}</span><span class="n">${g.list.length}</span><strong>${g.title}</strong><span class="d">${g.desc}</span></div>`)}</div>
      <div class="card rise">
        <div class="allgood">
          <span class="ic">${icon(total ? 'shield' : 'check', 22)}</span>
          <div class="grow" style="flex:1"><div class="title" style="font-weight:650">${total ? t('pm_issues', { count: total }) : t('pm_all_good')}</div><div class="muted">${t('pw_desc')}</div></div>
          <button class="btn primary" ?disabled=${!d.logins.length || this.busy === 'check'} @click=${async () => {
            this.busy = 'check';
            const r = await this.invoke<Data & { breached: number }>('checkBreaches').catch(() => null);
            this.busy = '';
            if (r) this.data = r;
            this.say(r ? (r.breached ? t('pw_breached', { count: r.breached }) : t('pw_no_breaches')) : t('upd_failed', { error: 'offline' }));
          }}>${this.busy === 'check' ? html`<span class="spin" style="display:inline-grid">${icon('loader', 14)}</span> ${t('pw_checking')}` : html`${icon('refresh', 14)} ${t('pm_check_now')}`}</button>
        </div>
        ${groups.filter((g) => g.list.length).map((g) => html`<div class="section"><div class="title" style="margin-bottom:6px">${g.title}</div>
          ${g.list.map((l) => html`<div class="issue">${mono(l.origin, 30)}<div class="who"><div style="font-weight:600">${host(l.origin)}</div><div class="muted" style="font-size:12px">${l.username}</div></div>
            <button class="btn" @click=${() => this.invoke('open', l.origin)}>${icon('external', 13)} ${t('pm_change')}</button></div>`)}</div>`)}
      </div>`;
  }

  // ---- settings

  private renderSettings(): TemplateResult {
    const d = this.data!;
    return html`<div class="card rise">
      <div class="section row"><div class="grow"><div class="title">${t('pm_offer_save')}</div><div class="desc muted">${t('pm_offer_save_desc')}</div></div>
        ${this.toggle(d.offerToSave, async (v) => (this.data = await this.invoke<Data>('setOfferToSave', v)), t('pm_offer_save'))}</div>
      <div class="section row"><div class="grow"><div class="title">${t('pw_import_csv')}</div><div class="desc muted">${t('import_passwords_hint')}</div></div>
        <button class="btn" @click=${async () => {
          const r = await this.invoke<Data & { imported: number }>('importCsv');
          this.data = r;
          if (r.imported) this.say(t('pw_imported', { count: r.imported }));
        }}>${icon('download', 14)} ${t('pm_import')}</button></div>
      <div class="section row"><div class="grow"><div class="title">${t('pw_export')}</div><div class="desc muted">${t('pm_export_desc')}</div></div>
        <button class="btn" ?disabled=${!d.logins.length} @click=${async () => (await this.invoke<boolean>('exportCsv')) && this.say(t('pm_exported'))}>${icon('upload', 14)} ${t('pm_export')}</button></div>
      <div class="section"><div class="title">${t('pm_never_saved')}</div>
        ${d.neverSave.length
          ? d.neverSave.map((o) => html`<div class="issue">${mono(o, 28)}<div class="who">${host(o)}</div>
              <button class="btn" @click=${async () => (this.data = await this.invoke<Data>('allowSaving', o))}>${t('pm_allow')}</button></div>`)
          : html`<div class="muted" style="padding-top:6px">${t('pm_never_saved_none')}</div>`}</div>
    </div>`;
  }
}
customElements.define('vz-passwords', VzPasswords);
