// <vz-assistant>: the assistant side panel (P2-AI-06). Summary buttons, chat,
// streaming render, citation chips that reveal the passage, the processing
// location badge (UI-2), stop, copy as Markdown, and send to Notes (R2).
import { LitElement, css, html, nothing } from 'lit';
import { base } from '../shared/styles';
import { icon } from '../shared/icons';
import { client, on } from '../shared/bridge';
import { renderMarkdown } from '../shared/markdown';
import { AssistantInterface, type AssistantMessage, type AssistantState } from '@vz/common/mojom/assistant';
import { t } from '@vz/common/i18n';
import type { WindowState } from '@vz/common/types';
import { registerPanel } from './panels';
import { shell } from './shell';

const api = client(AssistantInterface);

class VzAssistant extends LitElement {
  static override properties = { state: { attribute: false }, a: { state: true }, draft: { state: true }, picking: { state: true }, picked: { state: true } };
  state!: WindowState;
  a: AssistantState | null = null;
  draft = '';
  picking = false;
  picked = new Set<number>();
  private stick = true;

  static override styles = [
    base,
    css`
      :host { display: flex; flex-direction: column; min-height: 0; height: 100%; }
      .head { display: flex; align-items: center; gap: 8px; padding: 4px 14px 8px; }
      .badge { display: inline-flex; align-items: center; gap: 5px; font-size: var(--vz-text-xs); font-weight: 700; padding: 3px 8px; border-radius: 999px; }
      .badge.dev { background: color-mix(in srgb, var(--vz-ok) 14%, transparent); color: var(--vz-ok); }
      .badge.cloud { background: color-mix(in srgb, var(--vz-warn) 16%, transparent); color: var(--vz-warn); }
      .page { flex: 1; min-width: 0; font-size: var(--vz-text-s); color: var(--vz-text-2); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
      .scroll { flex: 1; overflow-y: auto; padding: 4px 14px 14px; min-height: 0; }
      .quick { display: flex; flex-wrap: wrap; gap: 6px; padding: 4px 0 12px; }
      .quick { justify-content: center; gap: 10px; }
      .quick button { display: grid; place-items: center; width: 44px; height: 44px; border-radius: 50%; border: 0; background: var(--vz-surface-2); cursor: pointer; color: var(--vz-text-2); transition: all var(--vz-dur) var(--vz-ease); }
      .quick button:hover:not([disabled]) { background: var(--vz-accent-soft); color: var(--vz-accent); transform: translateY(-2px); }
      .quick button[aria-pressed='true'] { background: var(--vz-accent); color: var(--vz-on-accent); }
      .empty { text-align: center; padding: 30px 12px 10px; color: var(--vz-text-2); }
      .empty .orb { width: 64px; height: 64px; border-radius: 22px; margin: 18px auto 14px; animation: float 4s ease-in-out infinite; display: grid; place-items: center; color: #fff; background: linear-gradient(135deg, var(--vz-accent), color-mix(in srgb, var(--vz-accent) 35%, #22d3ee)); }
      @keyframes float { 50% { transform: translateY(-6px) rotate(4deg); } }
      .empty h3 { margin: 0 0 6px; color: var(--vz-text); font-size: 15px; font-weight: 650; }
      .empty p { margin: 0; font-size: var(--vz-text-s); line-height: 1.5; }
      .msg { margin: 12px 0; animation: in 200ms var(--vz-ease); }
      @keyframes in { from { opacity: 0; transform: translateY(4px); } }
      .msg.user { display: flex; justify-content: flex-end; }
      .msg.user .bubble { background: var(--vz-accent); color: var(--vz-on-accent); border-radius: 14px 14px 4px 14px; padding: 8px 12px; max-width: 85%; font-size: var(--vz-text-m); line-height: 1.45; }
      .answer { font-size: 13.5px; line-height: 1.6; user-select: text; }
      .answer p { margin: 0 0 8px; }
      .answer ul, .answer ol { margin: 0 0 8px; padding-inline-start: 20px; }
      .answer li { margin: 3px 0; }
      .answer code { font-family: var(--vz-font-mono); font-size: 12px; background: var(--vz-surface-2); padding: 1px 4px; border-radius: 4px; }
      .md-h { font-weight: 700; }
      .md-table { overflow-x: auto; margin: 4px 0 10px; }
      .md-table table { border-collapse: collapse; font-size: 12px; }
      .md-table th, .md-table td { border: 1px solid var(--vz-border); padding: 4px 8px; text-align: start; vertical-align: top; }
      .md-table th { background: var(--vz-surface-2); }
      .cite { display: inline-flex; align-items: center; justify-content: center; min-width: 18px; height: 17px; padding: 0 5px; margin: 0 1px; border-radius: 6px; border: 0; cursor: pointer;
        font-size: 10.5px; font-weight: 700; vertical-align: 1px; background: var(--vz-accent-soft); color: var(--vz-accent); transition: transform var(--vz-dur); }
      .cite:hover { transform: translateY(-1px); background: var(--vz-accent); color: var(--vz-on-accent); }
      .caret { display: inline-block; width: 7px; height: 14px; margin-inline-start: 2px; vertical-align: -2px; background: var(--vz-accent); border-radius: 2px; animation: blink 1s steps(2) infinite; }
      @keyframes blink { 50% { opacity: 0; } }
      .meta { display: flex; align-items: center; gap: 6px; flex-wrap: wrap; margin-top: 6px; font-size: var(--vz-text-xs); color: var(--vz-text-3); }
      .meta .icon-btn { width: 24px; height: 24px; }
      .partial { color: var(--vz-warn); font-weight: 600; display: inline-flex; gap: 4px; align-items: center; }
      .sources { display: flex; flex-direction: column; gap: 4px; margin-top: 8px; }
      .source { display: flex; gap: 8px; align-items: flex-start; text-align: start; border: 1px solid var(--vz-border); background: var(--vz-surface-2); border-radius: 8px; padding: 6px 8px; cursor: pointer; font-size: var(--vz-text-xs); color: var(--vz-text-2); }
      .source:hover { border-color: var(--vz-accent); }
      .source b { color: var(--vz-accent); }
      .err { padding: 10px 12px; border-radius: 10px; background: color-mix(in srgb, var(--vz-danger) 10%, transparent); color: var(--vz-danger); font-size: var(--vz-text-s); display: flex; gap: 8px; }
      .err button { margin-inline-start: auto; }
      .thinking { display: inline-flex; gap: 4px; padding: 6px 0; }
      .thinking i { width: 6px; height: 6px; border-radius: 50%; background: var(--vz-text-3); animation: dot 1.2s infinite; }
      .thinking i:nth-child(2) { animation-delay: .15s; } .thinking i:nth-child(3) { animation-delay: .3s; }
      @keyframes dot { 0%, 80%, 100% { opacity: .25; transform: scale(.8); } 40% { opacity: 1; transform: scale(1); } }
      .composer { margin: 0 10px 10px; border: 1px solid var(--vz-border); border-radius: 18px; background: var(--vz-omnibox); padding: 8px 8px 6px 12px; transition: border-color var(--vz-dur), box-shadow var(--vz-dur); }
      .composer:focus-within { background: var(--vz-toolbar); border-color: var(--vz-accent); box-shadow: 0 0 0 3px color-mix(in srgb, var(--vz-accent) 18%, transparent); }
      textarea { width: 100%; border: 0; padding: 0; resize: none; background: transparent; min-height: 22px; max-height: 140px; font-size: 13.5px; line-height: 1.45; box-shadow: none !important; }
      .row { display: flex; align-items: center; gap: 6px; margin-top: 4px; }
      .row .grow { flex: 1; font-size: var(--vz-text-xs); color: var(--vz-text-3); }
      .send { width: 30px; height: 30px; border-radius: 10px; border: 0; background: var(--vz-accent); color: var(--vz-on-accent); display: grid; place-items: center; cursor: pointer; }
      .send[disabled] { opacity: .4; cursor: default; }
      .picker { margin: 0 10px 8px; border: 1px solid var(--vz-border); border-radius: 12px; padding: 8px; max-height: 200px; overflow: auto; background: var(--vz-surface-2); }
      .picker label { display: flex; gap: 8px; align-items: center; padding: 4px; font-size: var(--vz-text-s); border-radius: 6px; cursor: pointer; }
      .picker label:hover { background: var(--vz-surface-hover); }
      .picker .ellipsis { white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
      .off { padding: 24px; text-align: center; color: var(--vz-text-2); }
    `,
  ];

  override connectedCallback(): void {
    super.connectedCallback();
    on<AssistantState>('Assistant', 'state', (s) => (this.a = s));
    void api.getState().then((s: AssistantState) => (this.a = s));
  }

  protected override updated(): void {
    const el = this.renderRoot.querySelector('.scroll');
    if (el && this.stick) el.scrollTop = el.scrollHeight;
  }

  private onScroll(e: Event): void {
    const el = e.target as HTMLElement;
    this.stick = el.scrollHeight - el.scrollTop - el.clientHeight < 40;
  }

  private send(): void {
    const q = this.draft.trim();
    if (!q || this.a?.busy) return;
    this.stick = true;
    if (this.picking && this.picked.size) {
      void api.compare([...this.picked], q);
      this.picking = false;
    } else void api.ask(q);
    this.draft = '';
  }

  private copy(m: AssistantMessage): void {
    const md = `${m.text}\n\n${m.citations.map((c) => `[${c.id}] “${c.label}”`).join('\n')}\n\n— ${this.a?.title} (${this.a?.url})`;
    void navigator.clipboard.writeText(md);
  }

  override render() {
    const a = this.a;
    if (!a) return nothing;
    if (a.mode === 'off')
      return html`<div class="off">${icon('sparkle', 26)}<p>${t('ai_off_panel')}</p><button class="btn" @click=${() => shell.runCommand('page.settings')}>${t('cmd_settings')}</button></div>`;
    const dev = a.location === 'on-device';
    const blocked = a.pageKind === 'internal' || a.pageKind === 'none';
    return html`
      <div class="head">
        <span class="badge ${dev ? 'dev' : 'cloud'}" title=${t('ai_where_tooltip')}>${icon(dev ? 'cpu' : 'cloud', 12)} ${dev ? t('ai_badge_device') : t('ai_badge_cloud', { provider: a.provider })}</span>
        <span class="page" title=${a.url}>${a.pageKind === 'pdf' ? html`${icon('reader', 11)} ` : nothing}${a.title}</span>
        ${a.messages.length ? html`<button class="icon-btn" aria-label=${t('ai_clear')} title=${t('ai_clear')} @click=${() => api.clear()}>${icon('trash', 14)}</button>` : nothing}
      </div>
      <div class="scroll" @scroll=${(e: Event) => this.onScroll(e)} aria-live="polite">
        ${!a.messages.length
          ? html`<div class="empty"><div class="orb">${icon('sparkle', 28)}</div><h3>${blocked ? t('ai_err_internal_page') : t('ai_empty_title')}</h3></div>`
          : nothing}
        ${!blocked
          ? html`<div class="quick">
              <button aria-label=${t('ai_tldr')} title=${t('ai_tldr')} @click=${() => api.summarize('tldr')} ?disabled=${a.busy}>${icon('zap', 18)}</button>
              <button aria-label=${t('ai_key_points')} title=${t('ai_key_points')} @click=${() => api.summarize('key-points')} ?disabled=${a.busy}>${icon('reader', 18)}</button>
              <button aria-label=${t('ai_outline')} title=${t('ai_outline')} @click=${() => api.summarize('outline')} ?disabled=${a.busy}>${icon('layers', 18)}</button>
              ${this.state.features.VizullaMultiTab ? html`<button aria-label=${t('ai_compare_tabs')} title=${t('ai_compare_tabs')} aria-pressed=${this.picking} @click=${() => (this.picking = !this.picking)}>${icon('table', 18)}</button>` : nothing}
            </div>`
          : nothing}
        ${a.messages.map((m) => this.renderMessage(m))}
      </div>
      ${this.picking ? this.renderPicker() : nothing}
      <div class="composer">
        <textarea class="bare" rows="1" .value=${this.draft} placeholder=${this.picking ? t('ai_compare_placeholder') : t('cb_ask_placeholder')} aria-label=${t('cb_ask_placeholder')} ?disabled=${blocked}
          @input=${(e: InputEvent) => {
            const el = e.target as HTMLTextAreaElement;
            this.draft = el.value;
            el.style.height = 'auto';
            el.style.height = `${el.scrollHeight}px`;
          }}
          @keydown=${(e: KeyboardEvent) => {
            if (e.key === 'Enter' && !e.shiftKey) {
              e.preventDefault();
              this.send();
            }
          }}></textarea>
        <div class="row"><span class="grow" title=${t('ai_composer_hint')}>${icon(dev ? 'cpu' : 'cloud', 12)}</span>
          ${a.busy
            ? html`<button class="send" aria-label=${t('action_stop')} @click=${() => api.stop()}>${icon('stop', 13)}</button>`
            : html`<button class="send" aria-label=${t('ai_send')} ?disabled=${!this.draft.trim() || blocked} @click=${() => this.send()}>${icon('send', 14)}</button>`}
        </div>
      </div>`;
  }

  private renderPicker() {
    const tabs = this.state.tabs.filter((x) => x.spaceId === this.state.activeSpaceId && /^https?:/.test(x.url));
    return html`<div class="picker" role="group" aria-label=${t('ai_compare_tabs')}>
      ${tabs.map((x) => html`<label><input type="checkbox" .checked=${this.picked.has(x.id)} ?disabled=${!this.picked.has(x.id) && this.picked.size >= 20}
        @change=${(e: Event) => {
          const s = new Set(this.picked);
          if ((e.target as HTMLInputElement).checked) s.add(x.id);
          else s.delete(x.id);
          this.picked = s;
        }} /><span class="ellipsis">${x.title}</span></label>`)}
    </div>`;
  }

  private renderMessage(m: AssistantMessage) {
    if (m.role === 'user') return html`<div class="msg user"><div class="bubble">${m.text}</div></div>`;
    const cite = (id: string) => {
      const c = m.citations.find((x) => x.id === id);
      const n = m.citations.findIndex((x) => x.id === id) + 1;
      return html`<button class="cite" title=${c ? `${c.title ? `${c.title}: ` : ''}${c.page ? `p. ${c.page} · ` : ''}“${c.label}”` : id} aria-label=${t('ai_cite_label', { n: n || id })}
        @click=${() => api.revealCitation(m.id, id)}>${n || id}</button>`;
    };
    return html`<div class="msg">
      ${m.text ? html`<div class="answer">${renderMarkdown(m.text, cite)}${m.status === 'streaming' ? html`<span class="caret"></span>` : nothing}</div>` : m.status === 'streaming' ? html`<div class="thinking" aria-label=${t('ai_thinking')}><i></i><i></i><i></i></div>` : nothing}
      ${m.status === 'error' ? html`<div class="err" role="alert">${icon('alert', 14)}<span>${m.error}</span>${/key|clé/i.test(m.error ?? '') ? html`<button class="btn" @click=${() => shell.runCommand('page.settings')}>${t('cmd_settings')}</button>` : nothing}</div>` : nothing}
      ${m.status === 'stopped' && m.error ? html`<div class="meta">${m.error}</div>` : nothing}
      ${m.status === 'done' && m.citations.length
        ? html`<div class="sources">${m.citations.slice(0, 6).map((c, i) => html`<button class="source" @click=${() => api.revealCitation(m.id, c.id)}><b>${i + 1}</b><span>${c.title ? html`<strong>${c.title}</strong> · ` : nothing}${c.page ? `p. ${c.page} · ` : ''}${c.label}…</span></button>`)}</div>`
        : nothing}
      ${m.status === 'done'
        ? html`<div class="meta">
            ${m.location === 'on-device' ? icon('cpu', 11) : icon('cloud', 11)} ${m.provider}${m.model ? ` · ${m.model}` : ''}
            ${m.sourcing && m.sourcing !== 'sourced' ? html`<span class="partial">${icon('alert', 11)} ${m.sourcing === 'unsourced' ? t('ai_unsourced') : t('ai_partially_sourced')}</span>` : nothing}
            <span style="flex:1"></span>
            ${m.canEscalate ? html`<button class="btn ghost" style="height:24px;font-size:11px" @click=${() => api.escalate(m.id)}>${icon('cloud', 11)} ${t('ai_ask_cloud')}</button>` : nothing}
            <button class="icon-btn" aria-label=${t('ai_copy')} title=${t('ai_copy')} @click=${() => this.copy(m)}>${icon('copy', 13)}</button>
            ${this.state.features.VizullaNotes ? html`<button class="icon-btn" aria-label=${t('ai_to_notes')} title=${t('ai_to_notes')} @click=${() => api.sendToNotes(m.id)}>${icon('note', 13)}</button>` : nothing}
          </div>`
        : nothing}
    </div>`;
  }
}
customElements.define('vz-assistant', VzAssistant);
registerPanel('assistant', 'vz-assistant', () => t('cmd_ai_panel'), 'sparkle');
