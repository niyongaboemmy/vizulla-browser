// Dialog registry for the overlay layer. Each dialog type renders browser-owned
// UI and resolves with a JSON result. Phases add types (disclosure, agent plan…).
import { html, nothing, type TemplateResult } from 'lit';
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

// Permission prompt (Chrome's 2024 model): allow while visiting, allow this time, never.
registerDialog('permission', (d, host) => {
  const kinds = (d.kinds as string[] | undefined) ?? [];
  const who = d.embeddedIn ? t('perm_embedded', { origin: String(d.origin), top: String(d.embeddedIn) }) : String(d.origin);
  const detail = d.detail ? String(d.detail) : '';
  const fileLine = detail ? t(detail.startsWith('write:') ? 'perm_file_write' : 'perm_file_read', { path: detail.slice(detail.indexOf(':') + 1) }) : '';
  return html`
    <h2 id="dlg-title" class="perm-title">${t('perm_title', { origin: who })}</h2>
    <ul class="perm-asks">${kinds.map((k) => html`<li>${icon(permIcon(k), 18)}<span>${k === 'file-system' && fileLine ? fileLine : t(`perm_ask_${k.replace(/-/g, '_')}` as never)}</span></li>`)}</ul>
    <div class="perm-actions">
      <button class="btn primary" autofocus @click=${() => host.resolve({ answer: 'allow-always' })}>${t('perm_allow_visit')}</button>
      <button class="btn" @click=${() => host.resolve({ answer: 'allow-once' })}>${t('perm_allow_once')}</button>
      <button class="btn" @click=${() => host.resolve({ answer: 'block' })}>${t('perm_never')}</button>
    </div>`;
});

// Device chooser (WebUSB, Web Serial, WebHID, Web Bluetooth): the site gets only the chosen device.
registerDialog('device-chooser', (d, host) => {
  const draft = host.draft as { id?: string };
  const devices = (d.devices as { id: string; name: string }[] | undefined) ?? [];
  draft.id ??= devices[0]?.id;
  return html`
    <div class="perm-head">${icon('cpu', 22)}<div><h2 id="dlg-title">${t('dev_title', { origin: String(d.origin) })}</h2>
      <p class="muted">${t(`dev_choose_${String(d.kind)}` as never)}</p></div></div>
    ${devices.length
      ? html`<div class="dev-list" role="radiogroup" aria-label=${t(`dev_choose_${String(d.kind)}` as never)}>${devices.map((x) => html`<label class="dev ${draft.id === x.id ? 'on' : ''}">
          <input type="radio" name="dev" .checked=${draft.id === x.id} @change=${() => ((draft.id = x.id), host.requestUpdate())} />${icon('cpu', 15)}<span>${x.name}</span></label>`)}</div>`
      : html`<p class="muted">${t('dev_none')}</p>`}
    <div class="actions"><span style="flex:1"></span>
      <button class="btn" @click=${() => host.resolve(null)}>${t('action_cancel')}</button>
      <button class="btn primary" ?disabled=${!draft.id} @click=${() => host.resolve({ id: draft.id })}>${t('dev_connect')}</button></div>`;
});

// Screen sharing: entire screens, windows and tabs, with live thumbnails.
registerDialog('display-picker', (d, host) => {
  type Src = { id: string; name: string; kind: 'screen' | 'window'; thumb: string | null; icon: string | null };
  const draft = host.draft as { id?: string; tab?: 'screen' | 'window' | 'tab'; audio?: boolean };
  const sources = (d.sources as Src[] | undefined) ?? [];
  const tabs = (d.tabs as { id: string; name: string; favicon: string | null }[] | undefined) ?? [];
  draft.tab ??= tabs.length ? 'tab' : 'screen';
  const shown = draft.tab === 'tab' ? [] : sources.filter((x) => x.kind === draft.tab);
  const seg = (id: 'tab' | 'window' | 'screen', label: string, n: number) =>
    html`<button role="tab" aria-selected=${draft.tab === id} ?disabled=${!n} @click=${() => ((draft.tab = id), (draft.id = undefined), host.requestUpdate())}>${label}</button>`;
  return html`
    <h2 id="dlg-title">${t('dp_title', { origin: String(d.origin) })}</h2>
    <div class="dp-tabs" role="tablist">${seg('tab', t('dp_tabs'), tabs.length)}${seg('window', t('dp_windows'), sources.filter((x) => x.kind === 'window').length)}${seg('screen', t('dp_screens'), sources.filter((x) => x.kind === 'screen').length)}</div>
    ${draft.tab === 'tab'
      ? html`<div class="dp-tablist" role="listbox">${tabs.map((x) => html`<button role="option" aria-selected=${draft.id === x.id} class="dp-tab ${draft.id === x.id ? 'on' : ''}" @click=${() => ((draft.id = x.id), host.requestUpdate())}>
          ${x.favicon ? html`<img src=${x.favicon} alt="" />` : icon('globe', 14)}<span>${x.name}</span></button>`)}</div>`
      : html`<div class="dp-grid" role="listbox">${shown.map((x) => html`<button role="option" aria-selected=${draft.id === x.id} class="dp-src ${draft.id === x.id ? 'on' : ''}" @click=${() => ((draft.id = x.id), host.requestUpdate())}>
          <span class="dp-thumb">${x.thumb ? html`<img src=${x.thumb} alt="" />` : icon('columns', 24)}</span>
          <span class="dp-name">${x.icon ? html`<img src=${x.icon} alt="" />` : nothing}${x.name}</span></button>`)}</div>`}
    <div class="actions">
      ${d.audio || draft.tab === 'tab' ? html`<label class="check"><input type="checkbox" .checked=${!!draft.audio} @change=${(e: Event) => (draft.audio = (e.target as HTMLInputElement).checked)} /> ${t('dp_audio')}</label>` : nothing}
      <span style="flex:1"></span>
      <button class="btn" @click=${() => host.resolve(null)}>${t('action_cancel')}</button>
      <button class="btn primary" ?disabled=${!draft.id} @click=${() => host.resolve({ id: draft.id, audio: !!draft.audio })}>${t('dp_share')}</button>
    </div>`;
});

function permIcon(p: string): string {
  return ({ camera: 'eye', microphone: 'volume', geolocation: 'globe', notifications: 'info', 'display-capture': 'columns', 'clipboard-read': 'copy', 'file-system': 'folder', midi: 'music', 'local-network': 'globe', 'local-fonts': 'edit', 'window-management': 'columns' } as Record<string, string>)[p] ?? 'key';
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
