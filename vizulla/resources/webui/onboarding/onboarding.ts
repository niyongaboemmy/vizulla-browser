// First run (P2-BRW-19): import → layout → AI mode → search → done. No account. Skippable.
import { css, html, nothing } from 'lit';
import { base, pageStyles } from '../shared/styles';
import { icon, logo } from '../shared/icons';
import '../shared/select';
import { VzPage } from '../shared/page_base';
import { applyLocale, applyTheme } from '../shared/theme';
import { t } from '@vz/common/i18n';

interface Data { prefs: { layout: string; aiMode: string; engine: string; theme: string; locale: string }; engines: { id: string; name: string }[]; locales: { id: string; name: string }[] }
const STEPS = ['welcome', 'import', 'layout', 'ai', 'search', 'done'] as const;

class VzOnboarding extends VzPage<Data> {
  static override properties = { ...VzPage.properties, step: { state: true }, sources: { state: true }, imported: { state: true } };
  step = 0;
  sources: { index: number; name: string; profile: string }[] | null = null;
  imported = '';
  static override styles = [base, pageStyles, css`
    :host { display: grid; place-items: center; min-height: 100vh; background: radial-gradient(900px 500px at 20% 0%, var(--vz-accent-soft), transparent 70%), var(--vz-bg); }
    .card { width: min(620px, calc(100vw - 32px)); padding: 34px 34px 24px; border-radius: 24px; }
    h1 { font-size: 28px; letter-spacing: -0.03em; margin: 0 0 8px; } .lead { color: var(--vz-text-2); margin: 0 0 22px; line-height: 1.55; }
    .opts { display: grid; gap: 10px; } .opts.two { grid-template-columns: 1fr 1fr; }
    .opt { display: flex; gap: 12px; align-items: flex-start; padding: 14px; border-radius: 14px; border: 1px solid var(--vz-border); background: var(--vz-bg-elev); cursor: pointer; text-align: start; transition: all var(--vz-dur); }
    .opt:hover { border-color: var(--vz-border-strong); } .opt[aria-pressed='true'] { border-color: var(--vz-accent); box-shadow: 0 0 0 3px color-mix(in srgb, var(--vz-accent) 18%, transparent); }
    .opt b { display: block; margin-bottom: 2px; } .opt span { font-size: var(--vz-text-s); color: var(--vz-text-2); } .opt .vz-icon { color: var(--vz-accent); margin-top: 2px; }
    .nav { display: flex; align-items: center; gap: 8px; margin-top: 26px; } .dots { display: flex; gap: 6px; margin-inline-end: auto; }
    .dots i { width: 7px; height: 7px; border-radius: 50%; background: var(--vz-border-strong); transition: all var(--vz-dur); } .dots i.on { background: var(--vz-accent); width: 20px; border-radius: 4px; }
    .hero { display: grid; margin-bottom: 18px; } .field { display: flex; flex-direction: column; gap: 8px; font-size: var(--vz-text-s); font-weight: 600; color: var(--vz-text-2); } .field vz-select { width: 100%; }
    select { height: 34px; }`];

  private async set(key: string, value: unknown): Promise<void> {
    await this.invoke('set', { key, value });
    const p = this.data!.prefs;
    if (key === 'tabs.layout') p.layout = String(value);
    if (key === 'ai.mode') p.aiMode = String(value);
    if (key === 'search.engine') p.engine = String(value);
    if (key === 'appearance.locale') {
      p.locale = String(value);
      applyLocale(value === 'auto' ? navigator.language : String(value));
    }
    if (key === 'appearance.theme') applyTheme(String(value), 'indigo');
    this.requestUpdate();
  }

  private next(): void {
    this.step = Math.min(STEPS.length - 1, this.step + 1);
    if (STEPS[this.step] === 'import' && !this.sources) void this.invoke<typeof this.sources>('detectImport').then((s) => (this.sources = s));
  }

  override render() {
    const d = this.data;
    if (!d) return this.loading();
    const s = STEPS[this.step];
    const opt = (pressed: boolean, ic: string, title: string, desc: string, on: () => void) =>
      html`<button class="opt" aria-pressed=${pressed} @click=${on}>${icon(ic, 18)}<div><b>${title}</b><span>${desc}</span></div></button>`;
    return html`<div class="card" role="main">
      ${s === 'welcome' ? html`<div class="hero">${logo(64)}</div><h1>${t('ob_welcome')}</h1><p class="lead">${t('ob_welcome_body')}</p>
        <div class="opts two">
          <div class="field">${t('set_language')} <vz-select label=${t('set_language')} .value=${d.prefs.locale} .options=${[{ id: 'auto', name: t('set_language_auto'), icon: 'globe' }, ...d.locales]}
            @change=${(e: CustomEvent<string>) => this.set('appearance.locale', e.detail)}></vz-select></div>
          <div class="field">${t('set_theme')} <vz-select label=${t('set_theme')} .value=${d.prefs.theme}
            .options=${['system', 'light', 'dark'].map((x) => ({ id: x, name: t(`theme_${x}` as never), icon: x === 'system' ? 'grid' : x === 'light' ? 'sun' : 'moon' }))}
            @change=${(e: CustomEvent<string>) => this.set('appearance.theme', e.detail)}></vz-select></div></div>` : nothing}
      ${s === 'import' ? html`<h1>${t('ob_import')}</h1><p class="lead">${t('ob_import_body')}</p><div class="opts">
        ${this.sources === null ? html`<p class="muted">${t('import_detecting')}</p>` : !this.sources.length ? html`<p class="muted">${t('import_none')}</p>` : this.sources.map((src) => opt(false, 'download', src.name, t('import_profile', { profile: src.profile }), async () => {
          const r = await this.invoke<{ bookmarks: number; history: number }>('runImport', { index: src.index, bookmarks: true, history: true });
          this.imported = t('import_done', { bookmarks: r.bookmarks, history: r.history, name: src.name });
        }))}
        ${this.imported ? html`<p style="color:var(--vz-ok)">${icon('check', 14)} ${this.imported}</p>` : nothing}</div>` : nothing}
      ${s === 'layout' ? html`<h1>${t('ob_layout')}</h1><p class="lead">${t('ob_layout_body')}</p><div class="opts two">
        ${opt(d.prefs.layout === 'horizontal', 'columns', t('layout_horizontal'), t('ob_layout_horizontal'), () => this.set('tabs.layout', 'horizontal'))}
        ${opt(d.prefs.layout === 'vertical', 'sidebar', t('layout_vertical'), t('ob_layout_vertical'), () => this.set('tabs.layout', 'vertical'))}</div>` : nothing}
      ${s === 'ai' ? html`<h1>${t('ob_ai')}</h1><p class="lead">${t('ob_ai_body')}</p><div class="opts">
        ${opt(d.prefs.aiMode === 'local', 'cpu', t('ai_mode_local'), t('ai_mode_local_desc'), () => this.set('ai.mode', 'local'))}
        ${opt(d.prefs.aiMode === 'cloud', 'cloud', t('ai_mode_cloud'), t('ai_mode_cloud_desc'), () => this.set('ai.mode', 'cloud'))}
        ${opt(d.prefs.aiMode === 'byo', 'key', t('ai_mode_byo'), t('ai_mode_byo_desc'), () => this.set('ai.mode', 'byo'))}
        ${opt(d.prefs.aiMode === 'off', 'x', t('ai_mode_off'), t('ai_mode_off_desc'), () => this.set('ai.mode', 'off'))}</div>` : nothing}
      ${s === 'search' ? html`<h1>${t('ob_search')}</h1><p class="lead">${t('ob_search_body')}</p><div class="opts two">
        ${d.engines.map((e) => opt(d.prefs.engine === e.id, 'search', e.name, '', () => this.set('search.engine', e.id)))}</div>` : nothing}
      ${s === 'done' ? html`<div class="hero">${icon('check', 30)}</div><h1>${t('ob_done')}</h1><p class="lead">${t('ob_done_body')}</p>` : nothing}
      <div class="nav"><div class="dots">${STEPS.map((_, i) => html`<i class=${i === this.step ? 'on' : ''}></i>`)}</div>
        ${this.step > 0 && s !== 'done' ? html`<button class="btn ghost" @click=${() => (this.step -= 1)}>${t('ob_back')}</button>` : nothing}
        ${s === 'done' ? html`<button class="btn primary" @click=${() => this.invoke('finish')}>${t('ob_start')}</button>`
          : html`<button class="btn ghost" @click=${() => this.invoke('finish')}>${t('ob_skip')}</button><button class="btn primary" @click=${() => this.next()}>${t('ob_next')}</button>`}</div>
    </div>`;
  }
}
customElements.define('vz-onboarding', VzOnboarding);
