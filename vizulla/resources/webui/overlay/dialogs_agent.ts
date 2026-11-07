// Browser-owned agent dialogs: plan approval (doc 05 §8.3) and the PermissionBroker
// confirmation (P6-BRW-01). The confirm button arms only after a short delay and a
// key release, so a held-down key can't confirm by accident.
import { html, nothing } from 'lit';
import { icon } from '../shared/icons';
import { t } from '@vz/common/i18n';
import { registerDialog, type DialogHost } from './dialogs';

interface PlanStep { label: string; origin: string; tier: number; dataFields: string[] }

const tierBadge = (tier: number) => html`<span class="chip" style=${tier >= 3 ? 'color:var(--vz-warn);background:color-mix(in srgb,var(--vz-warn) 15%,transparent)' : ''}>T${tier} · ${t(`agent_tier_${tier}` as never)}</span>`;

function armed(host: DialogHost): boolean {
  const d = host.draft as { armedAt?: number; keyUp?: boolean };
  if (d.armedAt === undefined) {
    d.armedAt = Date.now() + 700;
    d.keyUp = false;
    const up = () => {
      d.keyUp = true;
      host.requestUpdate();
    };
    window.addEventListener('keyup', up, { once: true });
    window.addEventListener('pointerup', up, { once: true });
    setTimeout(() => host.requestUpdate(), 720);
  }
  return Date.now() >= d.armedAt && (d.keyUp ?? false);
}

registerDialog('agent-plan', (d, host) => {
  const draft = host.draft as { removed?: number[]; values?: Record<string, string>; session?: 'isolated' | 'grant'; grantOrigin?: string };
  draft.removed ??= [];
  draft.values ??= { ...(d.values as Record<string, string>) };
  draft.session ??= 'isolated';
  const steps = d.steps as PlanStep[];
  const origins = d.origins as string[];
  return html`
    <h2 id="dlg-title">${icon('bot', 18)} ${t('agent_plan_title')}</h2>
    <p class="muted"><b>${t('agent_goal')}:</b> ${d.goal}</p>
    <ol style="padding-inline-start:20px;margin:0 0 12px;line-height:1.5">
      ${steps.map((s, i) => html`<li style=${draft.removed!.includes(i) ? 'opacity:.4;text-decoration:line-through' : ''}>
        ${s.label} <span class="faint">${s.origin}</span> ${tierBadge(s.tier)}
        ${s.dataFields.length ? html`<div class="faint" style="font-size:12px">${icon('alert', 11)} ${t('agent_uses_data', { fields: s.dataFields.join(', ') })}</div>` : nothing}
        ${s.tier >= 4 ? html`<div class="faint" style="font-size:12px">${icon('alert', 11)} ${t('agent_needs_confirm')}</div>` : nothing}
        <button class="btn ghost" style="height:22px;font-size:11px" @click=${() => {
          draft.removed = draft.removed!.includes(i) ? draft.removed!.filter((x) => x !== i) : [...draft.removed!, i];
          host.requestUpdate();
        }}>${draft.removed!.includes(i) ? t('agent_keep_step') : t('agent_skip_step')}</button></li>`)}
    </ol>
    ${Object.keys(draft.values).length ? html`<div class="field"><span>${t('agent_your_values')}</span>
      ${Object.entries(draft.values).map(([k, v]) => html`<label style="display:flex;gap:8px;align-items:center;font-size:12px"><span style="min-width:90px">${k.replace(/^v\d+:/, '')}</span>
        <input type="text" style="flex:1;height:28px" .value=${v} @input=${(e: InputEvent) => (draft.values![k] = (e.target as HTMLInputElement).value)} /></label>`)}</div>` : nothing}
    <p class="muted" style="font-size:12px">${icon('globe', 11)} ${t('agent_sites_allowed')}: ${origins.join(', ')}</p>
    ${d.stageB ? html`<div class="field"><span>${t('agent_session')}</span>
      <label class="check"><input type="radio" name="sess" .checked=${draft.session === 'isolated'} @change=${() => ((draft.session = 'isolated'), host.requestUpdate())} /> ${t('agent_isolated')}</label>
      <label class="check"><input type="radio" name="sess" .checked=${draft.session === 'grant'} @change=${() => ((draft.session = 'grant'), (draft.grantOrigin = steps[0]?.origin), host.requestUpdate())} /> ${t('agent_grant_for', { origin: steps[0]?.origin ?? '', minutes: String(d.grantMinutes) })}</label></div>` : html`<p class="muted" style="font-size:12px">${icon('shield', 11)} ${t('agent_isolated_note')}</p>`}
    <div class="actions">
      <button class="btn" @click=${() => host.resolve({ run: false })}>${t('action_cancel')}</button>
      <button class="btn primary" autofocus @click=${() => host.resolve({ run: true, removed: draft.removed, values: draft.values, session: draft.session, grantOrigin: draft.grantOrigin })}>${icon('play', 13)} ${t('agent_run')}</button>
    </div>`;
});

registerDialog('agent-confirm', (d, host) => {
  const fields = d.fields as { name: string; value: string }[];
  const personal = d.personal as { field: string; value: string } | null;
  const ok = armed(host);
  return html`
    <h2 id="dlg-title">${icon('alert', 18)} ${d.kind === 'personal-data' ? t('agent_confirm_personal') : t('agent_confirm_commit', { action: String(d.action) })}</h2>
    <p class="muted">${t('agent_confirm_dest')}: <b style="color:var(--vz-text)">${d.destination}</b>${d.method ? ` · ${d.method}` : ''}</p>
    ${personal ? html`<p class="muted">${t('agent_confirm_field')}: <b style="color:var(--vz-text)">${personal.field}</b> = <code>${personal.value || '—'}</code></p>` : nothing}
    ${fields.length ? html`<table style="width:100%;border-collapse:collapse;font-size:12px;margin-bottom:8px">${fields.map((f) => html`<tr><td style="padding:4px 8px;border-top:1px solid var(--vz-border);color:var(--vz-text-2)">${f.name}</td><td style="padding:4px 8px;border-top:1px solid var(--vz-border)"><code>${f.value}</code></td></tr>`)}</table>` : nothing}
    <p class="faint" style="font-size:12px">${t('agent_confirm_step')}: ${d.step}</p>
    <div class="actions">
      <button class="btn" autofocus @click=${() => host.resolve({ confirm: false })}>${t('action_cancel')}</button>
      <button class="btn primary" ?disabled=${!ok} @click=${() => ok && host.resolve({ confirm: true })}>${t('agent_confirm_button')}</button>
    </div>`;
});
