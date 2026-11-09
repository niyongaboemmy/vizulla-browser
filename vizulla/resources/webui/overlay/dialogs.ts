// Dialog registry for the overlay layer. Each dialog type renders browser-owned
// UI and resolves with a JSON result. Phases add types (disclosure, agent plan…).
import { html, type TemplateResult } from 'lit';
import { icon } from '../shared/icons';
import { t } from '@vz/common/i18n';
import { SPACE_COLORS, SPACE_ICONS } from '@vz/common/types';
import { ACCENTS } from '@vz/common/tokens';
import qrcode from 'qrcode-generator';

export interface DialogHost {
  resolve(result: unknown): void;
  cancel(): void;
  requestUpdate(): void;
  /** Scratch state for the dialog's inputs. */
  draft: Record<string, unknown>;
}

export type DialogRenderer = (d: Record<string, unknown>, host: DialogHost) => TemplateResult;
export const DIALOGS = new Map<string, DialogRenderer>();

export function registerDialog(type: string, r: DialogRenderer): void {
  DIALOGS.set(type, r);
}

const accent = (c: string) => (document.documentElement.dataset.theme === 'light' ? ACCENTS[c as keyof typeof ACCENTS].light : ACCENTS[c as keyof typeof ACCENTS].dark);

registerDialog('confirm', (d, host) => html`
  <h2 id="dlg-title">${d.title}</h2>
  ${d.body ? html`<p class="muted">${d.body}</p>` : ''}
  <div class="actions">
    <button class="btn" @click=${() => host.resolve(false)}>${t('action_cancel')}</button>
    <button class="btn primary ${d.danger ? 'danger' : ''}" autofocus @click=${() => host.resolve(true)}>${d.confirm ?? t('action_ok')}</button>
  </div>`);

registerDialog('space-edit', (d, host) => {
  const draft = host.draft as { name?: string; color?: string; icon?: string };
  draft.name ??= String(d.name ?? '');
  draft.color ??= String(d.color ?? SPACE_COLORS[Math.floor(Math.random() * SPACE_COLORS.length)]);
  draft.icon ??= String(d.icon ?? 'star');
  const submit = () => draft.name!.trim() && host.resolve({ name: draft.name!.trim(), color: draft.color, icon: draft.icon });
  return html`
    <h2 id="dlg-title">${d.title}</h2>
    <label class="field"><span>${t('space_name')}</span>
      <input type="text" maxlength="40" autofocus .value=${draft.name} placeholder=${t('space_name_placeholder')}
        @input=${(e: InputEvent) => ((draft.name = (e.target as HTMLInputElement).value), host.requestUpdate())}
        @keydown=${(e: KeyboardEvent) => e.key === 'Enter' && submit()} /></label>
    <div class="field"><span>${t('space_color')}</span>
      <div class="swatches" role="radiogroup" aria-label=${t('space_color')}>
        ${SPACE_COLORS.map((c) => html`<button class="swatch ${draft.color === c ? 'on' : ''}" role="radio" aria-checked=${draft.color === c} aria-label=${c}
          style="--c:${accent(c)}" @click=${() => ((draft.color = c), host.requestUpdate())}></button>`)}
      </div></div>
    <div class="field"><span>${t('space_icon')}</span>
      <div class="icons" role="radiogroup" aria-label=${t('space_icon')}>
        ${SPACE_ICONS.map((i) => html`<button class="icon-choice ${draft.icon === i ? 'on' : ''}" role="radio" aria-checked=${draft.icon === i} aria-label=${i}
          style="--c:${accent(draft.color!)}" @click=${() => ((draft.icon = i), host.requestUpdate())}>${icon(i, 18)}</button>`)}
      </div></div>
    <div class="actions">
      <button class="btn" @click=${() => host.cancel()}>${t('action_cancel')}</button>
      <button class="btn primary" ?disabled=${!draft.name!.trim()} @click=${submit}>${t('action_save')}</button>
    </div>`;
});

registerDialog('permission', (d, host) => {
  const draft = host.draft as { remember?: boolean };
  draft.remember ??= true;
  const kind = String(d.permission);
  return html`
    <div class="perm-head">${icon(permIcon(kind), 22)}<div><h2 id="dlg-title">${t('perm_title', { origin: String(d.origin) })}</h2>
      <p class="muted">${t(`perm_${kind.replace(/-/g, '_')}` as never) || kind}</p></div></div>
    <label class="check"><input type="checkbox" .checked=${draft.remember} @change=${(e: Event) => (draft.remember = (e.target as HTMLInputElement).checked)} /> ${t('perm_remember')}</label>
    <div class="actions">
      <button class="btn" @click=${() => host.resolve({ allow: false, remember: draft.remember })}>${t('perm_block')}</button>
      <button class="btn primary" @click=${() => host.resolve({ allow: true, remember: draft.remember })}>${t('perm_allow')}</button>
    </div>`;
});

function permIcon(p: string): string {
  if (p.includes('camera')) return 'eye';
  if (p.includes('microphone')) return 'volume';
  if (p === 'geolocation') return 'globe';
  if (p === 'notifications') return 'info';
  return 'key';
}

// Save or update a login after a sign-in (passwords). The password itself never
// reaches this dialog: it shows dots, and the browser keeps the value.
registerDialog('mcp-approve', (d, host) => html`
  <div class="pw-head"><span class="pw-key">${icon('code', 20)}</span>
    <div><h2 id="dlg-title">${t('mcp_approve_title', { client: String(d.client ?? '') })}</h2></div></div>
  <p class="muted">${t('mcp_approve_body')}</p>
  <ul class="perm-list"><li>${t('mcp_can_tabs')}</li><li>${t('mcp_can_read')}</li><li>${t('mcp_can_open')}</li></ul>
  <div class="actions">
    <span style="flex:1"></span>
    <button class="btn" @click=${() => host.resolve({ action: 'deny' })}>${t('mcp_deny')}</button>
    <button class="btn primary" autofocus @click=${() => host.resolve({ action: 'allow' })}>${t('mcp_allow')}</button>
  </div>`);

registerDialog('qr', (d, host) => {
  const qr = qrcode(0, 'M');
  qr.addData(String(d.url ?? ''));
  qr.make();
  const svg = qr.createSvgTag({ cellSize: 6, margin: 3, scalable: true });
  const png = () => {
    const n = qr.getModuleCount() + 6;
    const c = document.createElement('canvas');
    c.width = c.height = n * 10;
    const g = c.getContext('2d')!;
    g.fillStyle = '#fff';
    g.fillRect(0, 0, c.width, c.height);
    g.fillStyle = '#000';
    for (let r = 0; r < qr.getModuleCount(); r++) for (let k = 0; k < qr.getModuleCount(); k++) if (qr.isDark(r, k)) g.fillRect((k + 3) * 10, (r + 3) * 10, 10, 10);
    return c.toDataURL('image/png');
  };
  return html`
    <div class="qr-hero">
      <h2 id="dlg-title">${t('tool_qr_title')}</h2>
      <div class="qr-code" role="img" aria-label=${t('tool_qr')} .innerHTML=${svg}></div>
      <div class="muted qr-url">${d.url}</div>
    </div>
    <div class="actions">
      <button class="btn" @click=${() => host.resolve({ action: 'save', png: png() })}>${icon('download', 14)} ${t('tool_qr_save')}</button>
      <span style="flex:1"></span>
      <button class="btn" @click=${() => host.cancel()}>${t('action_close')}</button>
      <button class="btn primary" autofocus @click=${() => host.resolve({ action: 'copy' })}>${icon('copy', 14)} ${t('tool_qr_copy')}</button>
    </div>`;
});

registerDialog('private-locked', (_d, host) => html`
  <div class="lock-hero"><span class="lock-orb">${icon('lock', 28)}</span>
    <h2 id="dlg-title">${t('private_locked_title')}</h2>
    <p class="muted">${t('private_locked_body')}</p>
    <button class="btn primary" autofocus @click=${() => host.resolve({ action: 'unlock' })}>${icon('key', 15)} ${t('private_unlock')}</button>
  </div>`);

registerDialog('add-extension', (d, host) => {
  const perms = (d.permissions as string[] | undefined) ?? [];
  const line = (p: string) => (p.startsWith('sites:') ? t('extperm_sites', { sites: p.slice(6) }) : p === 'all-sites' ? t('extperm_all_sites') : t(`extperm_${p}` as never));
  return html`
    <div class="pw-head">${d.icon ? html`<img src=${String(d.icon)} alt="" width="40" height="40" style="border-radius:10px" />` : html`<span class="pw-key">${icon('puzzle', 20)}</span>`}
      <div><h2 id="dlg-title">${t('ext_add_title', { name: String(d.name ?? '') })}</h2></div></div>
    ${perms.length
      ? html`<p class="muted" style="margin:4px 0 6px">${t('ext_add_can')}</p><ul class="perm-list">${perms.map((p) => html`<li>${line(p)}</li>`)}</ul>`
      : html`<p class="muted">${t('ext_add_plain')}</p>`}
    <div class="actions">
      <span style="flex:1"></span>
      <button class="btn" @click=${() => host.resolve({ action: 'cancel' })}>${t('action_cancel')}</button>
      <button class="btn primary" autofocus @click=${() => host.resolve({ action: 'add' })}>${t('ext_add')}</button>
    </div>`;
});

registerDialog('save-password', (d, host) => {
  const draft = host.draft as { username?: string };
  draft.username ??= String(d.username ?? '');
  const update = !!d.update;
  return html`
    <div class="pw-head"><span class="pw-key">${icon('key', 20)}</span>
      <div><h2 id="dlg-title">${update ? t('pw_update_title') : t('pw_save_title')}</h2><div class="muted">${d.site}</div></div></div>
    <label class="field"><span>${t('pw_username')}</span>
      <input type="text" .value=${draft.username} ?readonly=${update} @input=${(e: InputEvent) => ((draft.username = (e.target as HTMLInputElement).value), host.requestUpdate())} /></label>
    <label class="field"><span>${t('pw_password')}</span><input type="password" value="••••••••••" readonly tabindex="-1" aria-hidden="true" /></label>
    <div class="actions">
      ${update ? '' : html`<button class="btn ghost" @click=${() => host.resolve({ action: 'never' })}>${t('pw_never')}</button>`}
      <span style="flex:1"></span>
      <button class="btn" @click=${() => host.resolve({ action: 'dismiss' })}>${t('pw_not_now')}</button>
      <button class="btn primary" autofocus @click=${() => host.resolve({ action: 'save', username: draft.username })}>${update ? t('pw_update') : t('action_save')}</button>
    </div>`;
});
