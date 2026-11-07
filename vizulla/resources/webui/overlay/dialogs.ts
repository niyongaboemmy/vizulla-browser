// Dialog registry for the overlay layer. Each dialog type renders browser-owned
// UI and resolves with a JSON result. Phases add types (disclosure, agent plan…).
import { html, type TemplateResult } from 'lit';
import { icon } from '../shared/icons';
import { t } from '@vz/common/i18n';
import { SPACE_COLORS, SPACE_ICONS } from '@vz/common/types';
import { ACCENTS } from '@vz/common/tokens';

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
