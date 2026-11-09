// vizulla://settings (P2-BRW-20, SET-01..05): every setting is searchable and
// reachable by keyboard. Sections are deep-linkable: vizulla://settings/<section>.
import { css, html, nothing, unsafeCSS, type TemplateResult } from 'lit';
import { base, pageStyles } from '../shared/styles';
import { icon } from '../shared/icons';
import '../shared/select';
import { VzPage, switchStyles, timeAgo } from '../shared/page_base';
import { applyLocale, applyTheme } from '../shared/theme';
import { t, getLocale, type StringKey } from '@vz/common/i18n';
import { page } from '../shared/bridge';

type Prefs = Record<string, unknown>;
interface Data {
  prefs: Prefs;
  engines: { id: string; name: string; hint?: string }[];
  locales: { id: string; name: string }[];
  providerKeys: Record<string, boolean>;
  permissions: { origin: string; permission: string; decision: string }[];
  passwords: number;
  shields: { engineVersion: number; ruleSource: string };
  isDefaultBrowser: boolean;
  encryption: string;
  touchId: boolean;
  mcp: { url: string | null; token: string; clients: string[]; activity: { at: number; client: string; tool: string; ok: boolean }[] } | null;
  features: Record<string, boolean>;
  sync: { enabled: boolean; deviceName: string; devices: { id: string; name: string; lastSeen: number }[]; lastSync: number | null; error: string | null; code?: string } | null;
}

const SECTIONS = [
  { id: 'general', icon: 'globe', title: 'settings_general' },
  { id: 'appearance', icon: 'grid', title: 'settings_appearance' },
  { id: 'tabs', icon: 'layers', title: 'settings_tabs' },
  { id: 'shields', icon: 'shield', title: 'settings_shields' },
  { id: 'ai', icon: 'sparkle', title: 'settings_ai' },
  { id: 'memory', icon: 'brain', title: 'settings_memory', feature: 'VizullaMemory' },
  { id: 'sync', icon: 'sync', title: 'settings_sync', feature: 'VizullaSync' },
  { id: 'agent', icon: 'bot', title: 'settings_agent' },
  { id: 'passwords', icon: 'key', title: 'settings_passwords' },
  { id: 'import', icon: 'download', title: 'settings_import' },
  { id: 'permissions', icon: 'lock', title: 'settings_permissions' },
  { id: 'developer', icon: 'code', title: 'settings_developer' },
] as const;

interface Row {
  section: string;
  label: string;
  desc?: string;
  control: () => TemplateResult;
  keywords?: string;
}

class VzSettings extends VzPage<Data> {
  static override properties = {
    ...VzPage.properties,
    section: { state: true },
    filter: { state: true },
    importSources: { state: true },
    importResult: { state: true },
    logins: { state: true },
    revealed: { state: true },
    keyDraft: { state: true },
    busy: { state: true },
    note: { state: true },
  };
  section = location.pathname.replace(/^\/+/, '') || 'general';
  /** ?q= opens Settings already searching (address-bar suggestions deep-link to one setting). */
  filter = new URLSearchParams(location.search).get('q') ?? '';
  importSources: { index: number; name: string; profile: string; browser: string }[] | null = null;
  importResult = '';
  logins: { id: number; origin: string; username: string; breached: boolean | null }[] | null = null;
  revealed: Record<number, string> = {};
  keyDraft: Record<string, string> = {};
  busy = '';
  note = '';

  static override styles = [
    base,
    pageStyles,
    css`
      ${unsafeCSS(switchStyles)}
      .layout { display: grid; grid-template-columns: 220px 1fr; gap: 28px; max-width: 1080px; margin: 0 auto; padding: 32px 28px 80px; }
      nav { position: sticky; top: 24px; align-self: start; display: flex; flex-direction: column; gap: 2px; }
      nav h1 { font-size: 22px; margin: 0 0 14px 10px; letter-spacing: -0.02em; }
      nav button { display: flex; align-items: center; gap: 10px; height: 36px; padding: 0 14px; border: 0; background: transparent; border-radius: 999px; cursor: pointer; color: var(--vz-text-2); font-weight: 550; text-align: start; }
      nav button:hover { background: var(--vz-surface-hover); color: var(--vz-text); }
      nav button[aria-current='page'] { background: var(--vz-accent-soft); color: var(--vz-accent); }
      .search { position: relative; margin-bottom: 18px; }
      .search input { width: 100%; height: 38px; padding-left: 36px; border-radius: 10px; }
      .search .vz-icon { position: absolute; left: 12px; top: 11px; color: var(--vz-text-3); }
      h2.sec-title { font-size: 20px; margin: 4px 0 14px; letter-spacing: -0.01em; }
      .row { padding: 12px 18px; }
      .row + .row { border-top: 1px solid var(--vz-border); }
      select { min-width: 180px; height: 32px; }
      .seg { display: inline-flex; flex-wrap: wrap; background: var(--vz-surface-2); border-radius: 999px; padding: 3px; gap: 2px; }
      .seg button { border: 0; background: transparent; padding: 6px 14px; border-radius: 999px; transition: background var(--vz-dur), color var(--vz-dur); cursor: pointer; font-size: var(--vz-text-s); font-weight: 600; color: var(--vz-text-2); }
      .seg button[aria-pressed='true'] { background: var(--vz-bg-elev); color: var(--vz-text); box-shadow: 0 0 0 1px var(--vz-border); }
      .key { display: flex; gap: 8px; align-items: center; }
      .key input { width: 240px; }
      .ok { color: var(--vz-ok); display: inline-flex; align-items: center; gap: 4px; font-size: var(--vz-text-s); font-weight: 600; }
      .bad { color: var(--vz-danger); font-weight: 600; font-size: var(--vz-text-s); }
      .group-label { font-size: var(--vz-text-xs); font-weight: 700; text-transform: uppercase; letter-spacing: .06em; color: var(--vz-text-3); margin: 22px 0 8px 4px; }
      .note { margin: 0 0 14px; padding: 10px 14px; border-radius: 10px; background: var(--vz-accent-soft); color: var(--vz-text); font-size: var(--vz-text-s); display: flex; gap: 8px; align-items: center; }
      .mode-cards { display: grid; grid-template-columns: repeat(2, 1fr); gap: 10px; padding: 14px 18px; }
      .mode-card { border: 1px solid var(--vz-border); border-radius: 12px; padding: 12px 14px; cursor: pointer; background: var(--vz-bg-elev); text-align: start; display: flex; gap: 10px; }
      .mode-card[aria-pressed='true'] { border-color: var(--vz-accent); box-shadow: 0 0 0 3px color-mix(in srgb, var(--vz-accent) 18%, transparent); }
      .mode-card b { display: block; margin-bottom: 2px; }
      .mode-card span { font-size: var(--vz-text-s); color: var(--vz-text-2); }
      table { width: 100%; border-collapse: collapse; }
      td { padding: 8px 18px; border-top: 1px solid var(--vz-border); font-size: var(--vz-text-s); }
      td.pw { font-family: var(--vz-font-mono); }
      .engine { display: flex; gap: 6px; align-items: center; flex-wrap: wrap; justify-content: flex-end; }
      .engine input[name=name] { width: 140px; } .engine input[name=url] { width: 260px; max-width: 100%; }
      .primary-ic { background: var(--vz-accent); color: var(--vz-on-accent); }
      .primary-ic:hover:not([disabled]) { background: var(--vz-accent); color: var(--vz-on-accent); filter: brightness(1.08); }
      @media (max-width: 760px) { .layout { grid-template-columns: 1fr; } nav { position: static; flex-direction: row; flex-wrap: wrap; } }
      @media (max-width: 560px) { .layout { padding: 20px 14px 56px; gap: 16px; } .mode-cards { grid-template-columns: 1fr; } .key input, select { width: 100%; min-width: 0; } }
    `,
  ];

  private engineError = '';

  /** Name + URL template with %s; saved through the same validated pref path as every setting. */
  private customEngine() {
    const cur = this.p['search.custom'] as { name: string; url: string } | null;
    const save = async (form: HTMLFormElement) => {
      const f = new FormData(form);
      const value = { name: String(f.get('name') ?? '').trim(), url: String(f.get('url') ?? '').trim() };
      try {
        await this.set('search.custom', value);
        await this.set('search.engine', 'custom');
        this.engineError = '';
      } catch {
        this.engineError = t('set_custom_engine_invalid');
      }
      this.requestUpdate();
    };
    return html`<form class="engine" @submit=${(e: SubmitEvent) => (e.preventDefault(), void save(e.target as HTMLFormElement))}>
      <input type="text" name="name" required maxlength="40" placeholder=${t('set_custom_engine_name')} aria-label=${t('set_custom_engine_name')} .value=${cur?.name ?? ''} />
      <input type="url" name="url" required placeholder="https://example.com/search?q=%s" aria-label=${t('set_custom_engine_url')} .value=${cur?.url ?? ''} />
      <button class="icon-btn primary-ic" type="submit" title=${t('action_save')} aria-label=${t('action_save')}>${icon('check', 16)}</button>
      ${cur ? html`<button class="icon-btn" type="button" title=${t('action_remove')} aria-label=${t('action_remove')} @click=${() => void this.set('search.custom', null)}>${icon('trash', 15)}</button>` : nothing}
    </form>`;
  }

  private async set(key: string, value: unknown): Promise<void> {
    this.data = { ...this.data!, ...(await this.invoke<Data>('set', { key, value })) };
    if (key === 'appearance.locale') applyLocale(String(value === 'auto' ? navigator.language : value));
    if (key === 'appearance.theme' || key === 'appearance.accent') applyTheme(String(this.p['appearance.theme']), String(this.p['appearance.accent']));
    this.requestUpdate();
  }

  private get p(): Prefs {
    return this.data!.prefs;
  }

  private go(id: string): void {
    this.section = id;
    this.filter = '';
    history.replaceState(null, '', `/${id}`);
    if (id === 'import' && !this.importSources) void this.invoke<typeof this.importSources>('detectImport').then((s) => (this.importSources = s));
    if (id === 'passwords' && !this.logins) void this.invoke<typeof this.logins>('listPasswords').then((l) => (this.logins = l));
  }

  protected override loaded(): void {
    page.on('changed', () => void this.invoke<Data>('init').then((d) => (this.data = d)));
    const q = this.filter;
    this.go(this.section);
    this.filter = q;
  }

  // ---- controls

  /** The row being rendered: switches and selects take its label as their accessible name. */
  private rowLabel = '';
  private withLabel(label: string, control: () => unknown) {
    this.rowLabel = label;
    try {
      return control();
    } finally {
      this.rowLabel = '';
    }
  }

  private async copyMcp(what: 'token' | 'command'): Promise<void> {
    await this.invoke('mcpCopy', what);
    this.note = t('set_mcp_copied');
    setTimeout(() => (this.note = ''), 2000);
  }

  private sw(key: string) {
    return this.toggle(!!this.p[key], (v) => void this.set(key, v), this.rowLabel || key);
  }

  private select(key: string, options: { id: string; name: string }[]) {
    return html`<vz-select label=${this.rowLabel || key} .value=${String(this.p[key] ?? '')} .options=${options} @change=${(e: CustomEvent<string>) => void this.set(key, e.detail)}></vz-select>`;
  }

  private seg(key: string, options: { id: string; name: string }[]) {
    return html`<div class="seg" role="group" aria-label=${key}>${options.map((o) => html`<button aria-pressed=${this.p[key] === o.id} @click=${() => void this.set(key, o.id)}>${o.name}</button>`)}</div>`;
  }

  private number(key: string, min: number, max: number, unit: string) {
    return html`<span style="display:inline-flex;align-items:center;gap:8px"><input type="text" inputmode="numeric" style="width:72px" .value=${String(this.p[key])}
      aria-label=${key} @change=${(e: Event) => {
        const n = Math.max(min, Math.min(max, Number((e.target as HTMLInputElement).value) || min));
        void this.set(key, n);
      }} /> <span class="muted">${unit}</span></span>`;
  }

  private rows(): Row[] {
    const d = this.data!;
    const L = (k: StringKey) => t(k);
    const rows: Row[] = [
      { section: 'general', label: L('set_search_engine'), desc: L('set_search_engine_desc'), control: () => this.select('search.engine', d.engines.map((e) => ({ ...e, icon: 'search' }))), keywords: 'google duckduckgo bing' },
      { section: 'general', label: L('set_custom_engine'), desc: this.engineError || L('set_custom_engine_desc'), keywords: 'search engine custom own site',
        control: () => this.customEngine() },
      { section: 'general', label: L('set_search_suggestions'), desc: L('set_search_suggestions_desc'), control: () => this.sw('search.suggestions'), keywords: 'autocomplete suggestions search' },
      { section: 'general', label: L('set_language'), control: () => this.select('appearance.locale', [{ id: 'auto', name: L('set_language_auto') }, ...d.locales, { id: 'pseudo', name: 'Pseudo-locale (test)' }]), keywords: 'locale french kinyarwanda swahili' },
      { section: 'general', label: L('set_restore'), desc: L('set_restore_desc'), control: () => this.sw('tabs.restoreOnStartup'), keywords: 'startup session' },
      { section: 'general', label: L('set_default_browser'), desc: d.isDefaultBrowser ? L('set_default_yes') : L('set_default_no'),
        control: () => (d.isDefaultBrowser ? html`<span class="ok">${icon('check', 14)} ${L('set_default_yes_short')}</span>` : html`<button class="btn" @click=${async () => ((d.isDefaultBrowser = await this.invoke<boolean>('setDefaultBrowser')), this.requestUpdate())}>${L('set_make_default')}</button>`) },
      { section: 'general', label: L('set_downloads_ask'), control: () => this.sw('downloads.askWhere') },
      { section: 'general', label: L('settings_updates_auto'), desc: L('settings_updates_auto_desc'), keywords: 'update upgrade version release',
        control: () => html`<button class="icon-btn" title=${L('cmd_check_updates')} aria-label=${L('cmd_check_updates')} @click=${() => this.invoke('command', { id: 'app.checkUpdates' })}>${icon('refresh', 15)}</button>${this.sw('updates.autoCheck')}` },
      { section: 'appearance', label: L('set_theme'), control: () => this.seg('appearance.theme', [{ id: 'system', name: L('theme_system') }, { id: 'light', name: L('theme_light') }, { id: 'dark', name: L('theme_dark') }, { id: 'high-contrast', name: L('theme_high_contrast') }]), keywords: 'dark light mode contrast' },
      { section: 'appearance', label: L('set_accent'), desc: L('set_accent_desc'), control: () => this.select('appearance.accent', ['indigo', 'teal', 'amber', 'rose', 'violet', 'emerald', 'sky', 'slate'].map((c) => ({ id: c, name: c[0]!.toUpperCase() + c.slice(1) }))), keywords: 'color' },
      { section: 'appearance', label: L('set_density'), control: () => this.seg('appearance.density', [{ id: 'comfortable', name: L('density_comfortable') }, { id: 'compact', name: L('density_compact') }]) },
      { section: 'appearance', label: L('set_layout'), desc: L('set_layout_desc'), control: () => this.seg('tabs.layout', [{ id: 'vertical', name: L('layout_vertical') }, { id: 'horizontal', name: L('layout_horizontal') }]), keywords: 'tabs top side' },
      { section: 'appearance', label: L('set_classic'), desc: L('set_classic_desc'), control: () => this.sw('tabs.classic'), keywords: 'traditional old' },
      { section: 'appearance', label: L('set_zoom'), control: () => this.select('appearance.defaultZoom', [0.8, 0.9, 1, 1.1, 1.25, 1.5].map((z) => ({ id: z as unknown as string, name: `${Math.round(z * 100)}%` }))), keywords: 'text size bigger' },
      { section: 'tabs', label: L('set_archive'), desc: L('set_archive_desc'), control: () => this.sw('tabs.archiveEnabled'), keywords: 'clean idle' },
      { section: 'tabs', label: L('set_archive_after'), control: () => this.number('tabs.archiveAfterHours', 1, 720, L('unit_hours')) },
      { section: 'tabs', label: L('set_memory_saver'), desc: L('set_memory_saver_desc'), control: () => this.number('tabs.memorySaverMinutes', 0, 1440, L('unit_minutes')), keywords: 'sleep discard ram' },
      { section: 'shields', label: L('set_shields'), desc: L('set_shields_desc'), control: () => this.sw('shields.enabled'), keywords: 'adblock ads trackers' },
      { section: 'shields', label: L('set_block_ads'), desc: L('set_block_ads_desc'), control: () => this.sw('shields.blockAds'), keywords: 'ads adblock advertising ad-free show ads' },
      { section: 'shields', label: L('set_ads_allowed'), desc: (this.p['shields.adsAllowedSites'] as string[]).length ? '' : L('set_ads_allowed_none'), control: () => html`${(this.p['shields.adsAllowedSites'] as string[]).map((s) => html`<button class="chip" style="border:0;cursor:pointer" @click=${async () => (this.data = { ...d, ...(await this.invoke<Data>('removeAdsAllowed', s)) })}>${s} ${icon('x', 10)}</button>`)}`, keywords: 'ads allowed sites' },
      { section: 'shields', label: L('set_shields_aggressive'), desc: L('set_shields_aggressive_desc'), control: () => this.sw('shields.aggressive'), keywords: 'strict aggressive' },
      { section: 'shields', label: L('set_3p_cookies'), desc: `${L('set_3p_cookies_desc')} ${L('set_restart_note')}`, control: () => this.sw('shields.blockThirdPartyCookies'), keywords: 'cookie tracking' },
      { section: 'shields', label: L('set_https_first'), desc: L('set_https_first_desc'), control: () => this.sw('shields.httpsFirst'), keywords: 'ssl secure' },
      { section: 'shields', label: L('set_doh'), desc: L('set_doh_desc'), control: () => this.seg('shields.doh', [{ id: 'off', name: L('doh_off') }, { id: 'automatic', name: L('doh_auto') }, { id: 'secure', name: L('doh_secure') }]), keywords: 'dns' },
      { section: 'shields', label: L('set_fingerprinting'), desc: L('set_fingerprinting_desc'), control: () => this.seg('shields.fingerprinting', [{ id: 'off', name: L('fp_off') }, { id: 'standard', name: L('fp_standard') }, { id: 'strict', name: L('fp_strict') }]) },
      { section: 'shields', label: L('set_cookie_banners'), desc: L('set_cookie_banners_desc'), control: () => this.sw('shields.cookieBanners'), keywords: 'consent gdpr' },
      { section: 'shields', label: L('set_shields_lists'), desc: t('set_shields_lists_desc', { source: d.shields.ruleSource, version: d.shields.engineVersion }),
        control: () => html`<button class="btn" @click=${async () => (this.note = await this.invoke<string>('updateShieldsLists'))}>${L('set_check_updates')}</button>` },
      { section: 'shields', label: L('set_exceptions'), desc: (this.p['shields.siteExceptions'] as string[]).join(', ') || L('set_exceptions_none'), control: () => html`${(this.p['shields.siteExceptions'] as string[]).map((s) => html`<button class="chip" style="border:0;cursor:pointer" @click=${async () => (this.data = { ...d, ...(await this.invoke<Data>('removeShieldsException', s)) })}>${s} ${icon('x', 10)}</button>`)}` },
      { section: 'shields', label: L('set_private_capture'), desc: L('set_private_capture_desc'), control: () => this.sw('privacy.privateCaptureProtection'), keywords: 'private incognito screenshot screen recording' },
      ...(d.touchId ? [{ section: 'shields', label: L('set_lock_private'), desc: L('set_lock_private_desc'), control: () => this.sw('privacy.lockPrivate'), keywords: 'private incognito lock touch id' }] : []),
      { section: 'developer', label: L('set_mcp'), desc: L('set_mcp_desc'), control: () => this.sw('dev.mcp'), keywords: 'mcp ai claude code cursor developer agent api' },
      ...(this.p['dev.mcp'] && d.mcp
        ? [
            { section: 'developer', label: L('set_mcp_endpoint'), desc: d.mcp.url ?? '…', control: () => html`<button class="btn" @click=${() => void this.copyMcp('command')}>${icon('copy', 13)} ${L('set_mcp_copy_command')}</button>` },
            { section: 'developer', label: L('set_mcp_token'), desc: `${d.mcp.token.slice(0, 4)}••••••••••••${d.mcp.token.slice(-4)}`, control: () => html`<button class="btn" @click=${() => void this.copyMcp('token')}>${L('set_mcp_copy_token')}</button>
              <button class="btn ghost" @click=${async () => (this.data = { ...d, ...(await this.invoke<Data>('mcpNewToken')) })}>${icon('refresh', 13)} ${L('set_mcp_new_token')}</button>` },
            { section: 'developer', label: L('set_mcp_clients'), desc: d.mcp.clients.length ? '' : L('set_mcp_clients_none'), control: () => html`${d.mcp!.clients.map((c) => html`<button class="chip" style="border:0;cursor:pointer" @click=${async () => (this.data = { ...d, ...(await this.invoke<Data>('mcpRemoveClient', c)) })}>${c} ${icon('x', 10)}</button>`)}` },
            ...(d.mcp.activity.length ? [{ section: 'developer', label: L('set_mcp_activity'), desc: d.mcp.activity.map((x) => `${new Date(x.at).toLocaleTimeString()} · ${x.client} · ${x.tool}${x.ok ? '' : ' ✕'}`).join('\n'), control: () => html`` }] : []),
          ]
        : []),
      { section: 'shields', label: L('set_telemetry'), desc: L('set_telemetry_desc'), control: () => this.sw('privacy.telemetry'), keywords: 'metrics usage' },
      { section: 'shields', label: L('set_crash'), desc: L('set_crash_desc'), control: () => this.sw('privacy.crashReports') },
      { section: 'shields', label: L('set_clear_data'), desc: L('set_clear_data_desc'), control: () => html`<button class="btn danger" @click=${() => this.clearData()}>${L('action_clear')}…</button>`, keywords: 'history cookies cache delete' },
      { section: 'ai', label: L('set_ai_answer_lang'), control: () => this.select('ai.answerLanguage', [{ id: 'auto', name: L('set_ai_lang_auto') }, ...d.locales]) },
      { section: 'ai', label: L('set_ai_save'), desc: L('set_ai_save_desc'), control: () => this.sw('ai.saveConversations') },
      { section: 'ai', label: L('set_ai_disclosures'), desc: (this.p['ai.disclosedSites'] as string[]).length ? t('set_ai_disclosures_desc', { count: (this.p['ai.disclosedSites'] as string[]).length }) : L('set_ai_disclosures_none'),
        control: () => html`<button class="btn" ?disabled=${!(this.p['ai.disclosedSites'] as string[]).length} @click=${async () => (this.data = { ...d, ...(await this.invoke<Data>('resetDisclosures')) })}>${L('action_reset')}</button>` },
      { section: 'memory', label: L('set_memory'), desc: L('set_memory_desc'), control: () => this.sw('memory.enabled'), keywords: 'recall remember index' },
      { section: 'memory', label: L('set_memory_retention'), control: () => this.number('memory.retentionDays', 1, 3650, L('unit_days')) },
      { section: 'memory', label: L('set_memory_battery'), desc: L('set_memory_battery_desc'), control: () => this.sw('memory.indexOnBattery') },
      { section: 'memory', label: L('set_memory_manage'), control: () => html`<button class="btn" @click=${() => this.invoke('open', { url: 'vizulla://memory' })}>${L('action_open')} ${icon('external', 12)}</button>` },
      { section: 'agent', label: L('set_agent_tester'), desc: L('set_agent_tester_desc'), control: () => this.sw('agent.testerOptIn'), keywords: 'automation task' },
      { section: 'agent', label: L('set_agent_grant'), desc: L('set_agent_grant_desc'), control: () => this.number('agent.grantMinutes', 5, 120, L('unit_minutes')) },
      { section: 'agent', label: L('cmd_agent_log'), control: () => html`<button class="btn" @click=${() => this.invoke('open', { url: 'vizulla://agent-log' })}>${L('action_open')} ${icon('external', 12)}</button>` },
    ];
    return rows.filter((r) => {
      const sec = SECTIONS.find((s) => s.id === r.section) as { feature?: string } | undefined;
      return !sec?.feature || d.features[sec.feature];
    });
  }

  private async clearData(): Promise<void> {
    if (!confirm(t('clear_data_confirm'))) return;
    await this.invoke('clearData', ['history', 'cookies', 'cache']);
    this.note = t('toast_history_cleared');
  }

  override render() {
    if (!this.data) return this.loading();
    const q = this.filter.trim().toLowerCase();
    const rows = this.rows();
    const visible = q ? rows.filter((r) => `${r.label} ${r.desc ?? ''} ${r.keywords ?? ''}`.toLowerCase().includes(q)) : rows.filter((r) => r.section === this.section);
    const sections = SECTIONS.filter((s) => !('feature' in s) || this.data!.features[s.feature]);
    return html`<div class="layout">
      <nav aria-label=${t('cmd_settings')}>
        <h1>${t('cmd_settings')}</h1>
        ${sections.map((s) => html`<button aria-current=${!q && this.section === s.id ? 'page' : 'false'} @click=${() => this.go(s.id)}>${icon(s.icon, 16)} ${t(s.title as StringKey)}</button>`)}
        <button @click=${() => this.invoke('open', { url: 'vizulla://about' })}>${icon('info', 16)} ${t('cmd_about')}</button>
      </nav>
      <main>
        <div class="search">${icon('search', 15)}<input type="search" placeholder=${t('set_search')} aria-label=${t('set_search')} .value=${this.filter} @input=${(e: InputEvent) => (this.filter = (e.target as HTMLInputElement).value)} /></div>
        ${this.note ? html`<div class="note" role="status">${icon('info', 14)} ${this.note}</div>` : nothing}
        ${q ? html`<h2 class="sec-title">${t('set_results', { count: visible.length })}</h2>` : html`<h2 class="sec-title">${t(SECTIONS.find((s) => s.id === this.section)?.title as StringKey)}</h2>`}
        ${!q && this.section === 'ai' ? this.renderAi() : nothing}
        ${!q && this.section === 'sync' ? this.renderSync() : nothing}
        ${visible.length ? html`<div class="card rise">${visible.map((r) => html`<div class="row"><div class="grow"><div class="title">${r.label}</div>${r.desc ? html`<div class="desc">${r.desc}</div>` : nothing}</div>${this.withLabel(r.label, r.control)}</div>`)}</div>` : nothing}
        ${!q && this.section === 'agent' && this.data!.features.VizullaAgentStageB ? this.renderAgentProfile() : nothing}
        ${!q && this.section === 'passwords' ? this.renderPasswords() : nothing}
        ${!q && this.section === 'import' ? this.renderImport() : nothing}
        ${!q && this.section === 'permissions' ? this.renderPermissions() : nothing}
      </main>
    </div>`;
  }

  private renderAi(): TemplateResult {
    const d = this.data!;
    const mode = this.p['ai.mode'];
    const modes = [
      { id: 'local', icon: 'cpu', title: t('ai_mode_local'), desc: t('ai_mode_local_desc') },
      { id: 'cloud', icon: 'cloud', title: t('ai_mode_cloud'), desc: t('ai_mode_cloud_desc') },
      { id: 'byo', icon: 'key', title: t('ai_mode_byo'), desc: t('ai_mode_byo_desc') },
      { id: 'off', icon: 'x', title: t('ai_mode_off'), desc: t('ai_mode_off_desc') },
    ];
    const providers = [
      { id: 'anthropic', name: 'Anthropic' },
      { id: 'openai', name: 'OpenAI' },
      { id: 'google', name: 'Google Gemini' },
      { id: 'openai-compatible', name: t('provider_compat') },
    ];
    const models = (this.p['ai.models'] ?? {}) as Record<string, string>;
    return html`<div class="card"><div class="mode-cards">
        ${modes.map((m) => html`<button class="mode-card" aria-pressed=${mode === m.id} @click=${() => {
          void this.set('ai.mode', m.id).then(() => {
            if (m.id === 'local') void this.set('ai.provider', 'local');
            if (m.id === 'cloud') void this.set('ai.provider', 'gateway');
            if (m.id === 'byo' && ['local', 'gateway'].includes(String(this.p['ai.provider']))) void this.set('ai.provider', 'anthropic');
          });
        }}>${icon(m.icon, 18)}<div><b>${m.title}</b><span>${m.desc}</span></div></button>`)}
      </div></div>
      ${mode === 'byo'
        ? html`<div class="group-label">${t('set_ai_providers')}</div><div class="card">
          <div class="row"><div class="grow"><div class="title">${t('set_ai_provider')}</div></div>${this.select('ai.provider', providers)}</div>
          ${providers.map((p) => html`<div class="row"><div class="grow"><div class="title">${p.name}</div>
              <div class="desc">${t('set_ai_model')}: <code>${models[p.id] ?? ''}</code>${p.id === 'openai-compatible' ? html` · ${this.p['ai.compatBaseUrl']}` : nothing}</div></div>
            <div class="key">
              ${d.providerKeys[p.id] ? html`<span class="ok">${icon('check', 13)} ${t('set_key_saved')}</span><button class="btn ghost" @click=${() => this.saveKey(p.id, '')}>${t('action_remove')}</button>` : html`
                <input type="password" autocomplete="off" placeholder=${p.id === 'openai-compatible' ? t('set_key_optional') : t('set_key_placeholder')} aria-label=${`${p.name} API key`}
                  .value=${this.keyDraft[p.id] ?? ''} @input=${(e: InputEvent) => (this.keyDraft = { ...this.keyDraft, [p.id]: (e.target as HTMLInputElement).value })} />
                <button class="btn" ?disabled=${!this.keyDraft[p.id]} @click=${() => this.saveKey(p.id, this.keyDraft[p.id] ?? '')}>${t('action_save')}</button>`}
            </div></div>`)}
          <div class="row"><div class="grow"><div class="title">${t('set_compat_url')}</div><div class="desc">${t('set_compat_url_desc')}</div></div>
            <input type="url" style="width:280px" .value=${String(this.p['ai.compatBaseUrl'])} @change=${(e: Event) => void this.set('ai.compatBaseUrl', (e.target as HTMLInputElement).value)} /></div>
          <div class="row"><div class="grow"><div class="desc">${icon('lock', 12)} ${t('set_keys_note', { where: d.encryption === 'os-keychain' ? t('set_keys_keychain') : t('set_keys_memory') })}</div></div></div>
        </div>`
        : nothing}
      ${mode === 'cloud' ? html`<div class="card"><div class="row"><div class="grow"><div class="title">${t('set_gateway_url')}</div><div class="desc">${t('set_gateway_desc')}</div></div>
          <input type="url" style="width:280px" .value=${String(this.p['ai.gatewayUrl'])} @change=${(e: Event) => void this.set('ai.gatewayUrl', (e.target as HTMLInputElement).value)} /></div></div>` : nothing}
      <div class="group-label">${t('set_ai_behaviour')}</div>`;
  }

  private async saveKey(provider: string, key: string): Promise<void> {
    try {
      this.data = { ...this.data!, ...(await this.invoke<Data>('setApiKey', { provider, key })) };
      this.keyDraft = { ...this.keyDraft, [provider]: '' };
    } catch (e) {
      this.note = (e as Error).message;
    }
  }

  private renderSync(): TemplateResult {
    const s = this.data!.sync;
    if (!s) return html`<div class="card"><div class="row">${t('sync_unavailable')}</div></div>`;
    return html`<div class="card">
      <div class="row"><div class="grow"><div class="title">${s.enabled ? t('sync_on') : t('sync_off')}</div>
        <div class="desc">${s.enabled ? (s.lastSync ? t('sync_last', { when: timeAgo(s.lastSync, getLocale()) }) : t('sync_never')) : t('sync_desc')}</div>
        ${s.error ? html`<div class="bad">${s.error}</div>` : nothing}</div>
        ${s.enabled
          ? html`<button class="btn" @click=${async () => ((this.data = { ...this.data!, sync: await this.invoke('syncNow') }), this.requestUpdate())}>${t('sync_now')}</button>
                 <button class="btn danger" @click=${async () => ((this.data = { ...this.data!, sync: await this.invoke('syncLeave') }), this.requestUpdate())}>${t('sync_leave')}</button>`
          : html`<button class="btn primary" @click=${async () => ((this.data = { ...this.data!, sync: await this.invoke('syncCreate') }), this.requestUpdate())}>${t('sync_create')}</button>
                 <button class="btn" @click=${async () => {
                   const code = prompt(t('sync_enter_code'));
                   if (code) this.data = { ...this.data!, sync: await this.invoke('syncJoin', code) };
                 }}>${t('sync_join')}</button>`}
      </div>
      ${s.code ? html`<div class="row"><div class="grow"><div class="title">${t('sync_code')}</div><div class="desc">${t('sync_code_desc')}</div>
        <code style="font-size:15px;letter-spacing:.04em;user-select:all">${s.code}</code></div></div>` : nothing}
      ${s.devices.map((dv) => html`<div class="row">${icon('cpu', 16)}<div class="grow"><div class="title">${dv.name}</div><div class="desc">${timeAgo(dv.lastSeen, getLocale())}</div></div></div>`)}
      <div class="row"><div class="grow"><div class="desc">${icon('lock', 12)} ${t('sync_e2ee_note')}</div></div></div>
    </div>`;
  }

  private agentProfile: Record<string, string> | null = null;

  /** Stage B personal data: shown to the agent model only as handles ({{profile.phone}}), filled by the browser after confirmation. */
  private renderAgentProfile(): TemplateResult {
    if (!this.agentProfile) {
      void this.invoke<Record<string, string>>('getAgentProfile').then((p) => ((this.agentProfile = p), this.requestUpdate()));
      return html``;
    }
    const fields = ['profile.name', 'profile.email', 'profile.phone', 'profile.address', 'profile.city', 'profile.country'];
    return html`<div class="group-label">${t('agent_profile_title')}</div><div class="card">
      ${fields.map((f) => html`<div class="row"><div class="grow"><div class="title">${t(`agent_field_${f.split('.')[1]}` as StringKey)}</div></div>
        <input type="text" style="width:280px" .value=${this.agentProfile![f] ?? ''} aria-label=${f}
          @change=${async (e: Event) => (this.agentProfile = await this.invoke('setAgentProfile', { ...this.agentProfile, [f]: (e.target as HTMLInputElement).value }))} /></div>`)}
      <div class="row"><div class="grow"><div class="desc">${icon('lock', 12)} ${t('agent_profile_note')}</div></div></div></div>`;
  }

  private renderPasswords(): TemplateResult {
    const logins = this.logins ?? [];
    return html`<div class="card" style="margin-top:16px">
      <div class="row"><div class="grow"><div class="title">${t('pw_count', { count: logins.length })}</div><div class="desc">${t('pw_desc')}</div></div>
        <button class="btn" ?disabled=${!!this.busy} @click=${async () => {
          this.busy = 'csv';
          const r = await this.invoke<{ imported: number; reminder?: string }>('importPasswordsCsv');
          this.busy = '';
          if (r.imported) this.note = `${t('pw_imported', { count: r.imported })} ${r.reminder ?? ''}`;
          this.logins = await this.invoke('listPasswords');
        }}>${icon('download', 14)} ${t('pw_import_csv')}</button>
        <button class="btn" ?disabled=${!logins.length || !!this.busy} @click=${async () => {
          this.busy = 'check';
          const r = await this.invoke<{ breached: number; logins: typeof logins }>('checkBreaches');
          this.busy = '';
          this.logins = r.logins;
          this.note = r.breached ? t('pw_breached', { count: r.breached }) : t('pw_no_breaches');
        }}>${icon('shield', 14)} ${this.busy === 'check' ? t('pw_checking') : t('pw_check')}</button></div>
      ${logins.length ? html`<table><tbody>${logins.map((l) => html`<tr>
          <td>${l.origin.replace(/^https:\/\//, '')}</td><td>${l.username}</td>
          <td class="pw">${this.revealed[l.id] ?? '••••••••'}</td>
          <td>${l.breached ? html`<span class="bad">${t('pw_breached_short')}</span>` : l.breached === false ? html`<span class="ok">${icon('check', 12)}</span>` : ''}</td>
          <td style="text-align:end">
            <button class="icon-btn" aria-label=${t('pw_reveal')} @click=${async () => {
              if (this.revealed[l.id]) return (this.revealed = { ...this.revealed, [l.id]: undefined as unknown as string });
              const r = await this.invoke<{ password: string } | null>('revealPassword', l.id);
              if (r) this.revealed = { ...this.revealed, [l.id]: r.password };
            }}>${icon(this.revealed[l.id] ? 'eye-off' : 'eye', 14)}</button>
            <button class="icon-btn" aria-label=${t('action_delete')} @click=${async () => {
              await this.invoke('deletePassword', l.id);
              this.logins = await this.invoke('listPasswords');
            }}>${icon('trash', 14)}</button></td></tr>`)}</tbody></table>` : nothing}
      <div class="row"><div class="grow"><div class="desc">${icon('info', 12)} ${t('pw_csv_help')}</div></div></div>
    </div>`;
  }

  private renderImport(): TemplateResult {
    const srcs = this.importSources;
    return html`<div class="card" style="margin-top:16px">
      ${srcs === null ? html`<div class="row">${t('import_detecting')}</div>` : !srcs.length ? html`<div class="row muted">${t('import_none')}</div>` : srcs.map((s) => html`<div class="row">${icon('globe', 18)}
        <div class="grow"><div class="title">${s.name}</div><div class="desc">${t('import_profile', { profile: s.profile })}</div></div>
        <button class="btn" ?disabled=${!!this.busy} @click=${async () => {
          this.busy = `imp${s.index}`;
          try {
            const r = await this.invoke<{ bookmarks: number; history: number }>('runImport', { index: s.index, bookmarks: true, history: true });
            this.importResult = t('import_done', { bookmarks: r.bookmarks, history: r.history, name: s.name });
          } catch (e) {
            this.importResult = (e as Error).message;
          }
          this.busy = '';
        }}>${this.busy === `imp${s.index}` ? t('import_running') : t('import_action')}</button></div>`)}
      ${this.importResult ? html`<div class="row"><span class="ok">${icon('check', 14)} ${this.importResult}</span></div>` : nothing}
      <div class="row"><div class="grow"><div class="desc">${t('import_passwords_hint')}</div></div><button class="btn" @click=${() => this.go('passwords')}>${t('settings_passwords')}</button></div>
      <div class="row"><div class="grow"><div class="desc">${t('import_extensions_hint')}</div></div></div>
    </div>`;
  }

  private renderPermissions(): TemplateResult {
    const perms = this.data!.permissions;
    return html`<div class="card" style="margin-top:16px">
      ${perms.length ? perms.map((p) => html`<div class="row">${icon(p.decision === 'allow' ? 'check' : 'x', 14)}<div class="grow"><div class="title">${p.origin}</div><div class="desc">${p.permission} · ${p.decision === 'allow' ? t('perm_allow') : t('perm_block')}</div></div>
        <button class="btn ghost" @click=${async () => (this.data = { ...this.data!, permissions: await this.invoke('removePermission', { origin: p.origin, permission: p.permission }) })}>${t('action_reset')}</button></div>`) : html`<div class="row muted">${t('perm_none')}</div>`}
    </div>`;
  }
}
customElements.define('vz-settings', VzSettings);
