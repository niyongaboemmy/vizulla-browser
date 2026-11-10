// <vz-overlay>: browser-owned surfaces above page content: the Command Bar
// (CMD-01), dialogs, and the Shields panel. Pages can't draw over this layer (C9).
import { LitElement, css, html, nothing, type TemplateResult } from 'lit';
import { base } from '../shared/styles';
import { icon } from '../shared/icons';
import { client, on } from '../shared/bridge';
import { installTooltips } from '../shared/tooltip';
import { applyLocale, applyTheme } from '../shared/theme';
import { OverlayInterface } from '@vz/common/mojom/shell';
import { t } from '@vz/common/i18n';
import type { CommandBarResult, Suggestion, WindowState } from '@vz/common/types';
import { DIALOGS, type DialogHost } from './dialogs';
import './dialogs_extra';
import '../shared/select';

const overlay = client(OverlayInterface);

type Surface =
  | { kind: 'command-bar'; mode: 'palette' | 'address' | 'tab-search' | 'ask'; anchor?: { x: number; y: number; width: number; height: number }; initial: string; newTab: boolean }
  | { kind: 'shields'; anchor: { x: number; y: number; width: number; height: number }; status: ShieldsStatus }
  | { kind: 'extensions'; anchor: { x: number; y: number; width: number; height: number }; items: unknown[] }
  | { kind: 'site-info'; anchor: { x: number; y: number; width: number; height: number }; info: SiteInfo }
  | { kind: 'tech'; anchor: { x: number; y: number; width: number; height: number }; host: string; url: string; result: Tech[] | null }
  | { kind: 'tools'; anchor: { x: number; y: number; width: number; height: number }; web: boolean }
  | { kind: 'app-menu'; anchor: { x: number; y: number; width: number; height: number }; menu: AppMenu }
  | { kind: 'dialog'; id: string; dialog: Record<string, unknown> & { type: string } };

interface ShieldsStatus { enabled: boolean; siteEnabled: boolean; blockAds: boolean; adsAllowed: boolean; strict: boolean; site: string; blocked: { ads: number; trackers: number; other: number; total: number }; ruleSource: string }

interface Tech { name: string; category: string; version: string | null; confidence: 'certain' | 'likely'; evidence: string[]; website?: string }
const TECH_ICONS: Record<string, string> = { cms: 'newspaper', 'site-builder': 'grid', ecommerce: 'cart', 'meta-framework': 'layers', framework: 'code', ui: 'grid', css: 'grid', library: 'book', build: 'zap', language: 'code', backend: 'cpu', server: 'cpu', hosting: 'cloud', cdn: 'cloud', analytics: 'eye', 'tag-manager': 'command', advertising: 'eye', 'ab-testing': 'columns', consent: 'check', payments: 'key', auth: 'lock', security: 'shield', chat: 'send', video: 'play', maps: 'globe', search: 'search', monitoring: 'info', fonts: 'edit' };

interface SiteInfo { origin: string; host: string; security: string; rows: { kind: string; setting: 'ask' | 'allow' | 'block'; isDefault: boolean; inUse: boolean; embargoed: boolean }[] }
const PERM_ICONS: Record<string, string> = { camera: 'eye', microphone: 'volume', geolocation: 'globe', notifications: 'info', 'display-capture': 'columns', 'clipboard-read': 'copy', 'file-system': 'folder', usb: 'cpu', serial: 'cpu', hid: 'cpu', bluetooth: 'cpu', midi: 'music', 'local-network': 'globe', 'local-fonts': 'edit' };
export const permName = (k: string) => t(`perm_name_${k.replace(/-/g, '_')}` as never);

interface AppMenuItem { id: string; label: string; shortcut: string; enabled: boolean; sub: boolean }
interface AppMenu { zoom: number; theme: string | null; update: string | null; groups: AppMenuItem[][] }

const TOOLS: { id: string; icon: string; label: string; web: boolean }[] = [
  { id: 'tools.screenshot', icon: 'focus', label: 'tool_screenshot', web: true },
  { id: 'tools.screenshotFull', icon: 'columns', label: 'tool_screenshot_full', web: true },
  { id: 'tools.savePdf', icon: 'reader', label: 'tool_save_pdf', web: true },
  { id: 'tools.print', icon: 'copy', label: 'tool_print', web: true },
  { id: 'tools.qr', icon: 'grid', label: 'tool_qr', web: true },
  { id: 'tools.readAloud', icon: 'volume', label: 'tool_read_aloud', web: true },
  { id: 'tools.pip', icon: 'play', label: 'tool_pip', web: true },
  { id: 'tools.colorPicker', icon: 'wand', label: 'tool_color_picker', web: true },
  { id: 'view.find', icon: 'search', label: 'cmd_find', web: true },
  { id: 'view.reader', icon: 'book', label: 'cmd_reader', web: true },
  { id: 'tools.clearSiteData', icon: 'trash', label: 'tool_clear_site', web: true },
  { id: 'tools.copyMarkdown', icon: 'note', label: 'tool_copy_markdown', web: true },
  { id: 'tools.techStack', icon: 'code', label: 'tool_tech', web: true },
  { id: 'page.taskManager', icon: 'cpu', label: 'cmd_task_manager', web: false },
];

const SECTION_ORDER: Suggestion['section'][] = ['top', 'tabs', 'browser', 'commands', 'memory', 'history', 'search', 'ai'];

export class VzOverlay extends LitElement {
  static override properties = { surface: { state: true }, result: { state: true }, selected: { state: true }, input: { state: true }, closing: { state: true } };
  surface: Surface | null = null;
  result: CommandBarResult | null = null;
  selected = 0;
  input = '';
  closing = false;
  private draft: Record<string, unknown> = {};
  private seq = 0;

  static override styles = [
    base,
    css`
      :host { position: fixed; inset: 0; display: block; }
      .backdrop { position: absolute; inset: 0; background: color-mix(in srgb, var(--vz-backdrop) 45%, transparent); animation: fade 140ms var(--vz-ease); }
      .backdrop.clear { background: transparent; }
      @keyframes fade { from { opacity: 0; } }
      @keyframes rise { from { opacity: 0; transform: translateY(-6px) scale(0.985); } }

      .cb { position: absolute; width: min(680px, calc(100vw - 32px)); left: 50%; top: 14vh; transform: translateX(-50%);
        background: var(--vz-bg-elev); border-radius: 22px; box-shadow: var(--vz-shadow-pop); border: 1px solid var(--vz-border);
        overflow: hidden; animation: rise 160ms var(--vz-ease); display: flex; flex-direction: column; max-height: 72vh; }
      .cb.anchored { border-radius: 20px; }
      .cb.anchored { transform: none; }
      .cb .cb-field { display: flex; align-items: center; gap: 12px; padding: 0 16px; height: 54px; border-bottom: 1px solid var(--vz-border); }
      .cb .cb-field .lead { color: var(--vz-text-3); }
      .cb input { flex: 1; border: 0; outline: none; box-shadow: none; background: transparent; font-size: 17px; padding: 0; height: 100%; color: var(--vz-text); }
      .cb input:focus { box-shadow: none; }
      .mode { font-size: var(--vz-text-xs); font-weight: 700; color: var(--vz-accent); background: var(--vz-accent-soft); padding: 3px 8px; border-radius: 999px; }
      .chips { display: flex; gap: 6px; padding: 8px 14px 0; flex-wrap: wrap; }
      .chips .lbl { font-size: var(--vz-text-xs); color: var(--vz-text-3); align-self: center; }
      .chip-btn { border: 1px solid var(--vz-border); background: var(--vz-surface-2); border-radius: 999px; padding: 3px 10px; font-size: var(--vz-text-s); cursor: pointer; }
      .chip-btn:hover { border-color: var(--vz-accent); color: var(--vz-accent); }
      .rows { overflow-y: auto; padding: 6px; }
      .sec { font-size: var(--vz-text-xs); font-weight: 700; text-transform: uppercase; letter-spacing: 0.06em; color: var(--vz-text-3); padding: 10px 10px 4px; }
      .row { display: flex; align-items: center; gap: 12px; height: 44px; padding: 0 10px; border-radius: var(--vz-radius); cursor: pointer; }
      .row.sel { background: color-mix(in srgb, var(--vz-accent) 12%, transparent); }
      .row .ic { width: 30px; height: 30px; border-radius: 10px; display: grid; place-items: center; background: var(--vz-surface-2); box-shadow: 0 0 0 1px var(--vz-border); color: var(--vz-text-2); flex: none; transition: all var(--vz-dur); }
      .row.sel .ic { background: var(--vz-accent); color: var(--vz-on-accent); }
      .row .ic img { width: 16px; height: 16px; border-radius: 3px; }
      .row .txt { flex: 1; min-width: 0; display: flex; flex-direction: column; }
      .row .t1 { white-space: nowrap; overflow: hidden; text-overflow: ellipsis; font-size: 14px; }
      .row .t2 { white-space: nowrap; overflow: hidden; text-overflow: ellipsis; font-size: var(--vz-text-s); color: var(--vz-text-2); }
      .row .enter { opacity: 0; font-size: var(--vz-text-xs); color: var(--vz-text-3); }
      .row.sel .enter { opacity: 1; }
      .row.destructive .t1 { color: var(--vz-danger); }
      .foot { display: flex; gap: 6px; align-items: center; padding: 8px 14px; border-top: 1px solid var(--vz-border); font-size: var(--vz-text-xs); color: var(--vz-text-3); }
      .foot .grow { flex: 1; }

      /* Overlay surfaces are solid: the overlay is a separate layer over the page, so CSS blur can't
         reach the page and "glass" would just let busy content show through behind text.
         Dialogs: a solid card that springs in. Centred with margins, not a transform, so the
         entrance animation never shifts it sideways. */
      .dlg { position: absolute; left: 0; right: 0; margin: 0 auto; top: 16vh; width: min(460px, calc(100vw - 32px)); padding: 22px 22px 18px;
        background: var(--vz-bg-elev); border-radius: 22px; border: 1px solid var(--vz-border); box-shadow: var(--vz-shadow-pop);
        animation: dlg-in 300ms cubic-bezier(.2,.9,.3,1.15); max-height: 76vh; overflow: auto; transform-origin: top center; }
      @keyframes dlg-in { from { opacity: 0; transform: translateY(10px) scale(.96); } }
      .dlg .actions .btn { height: 36px; min-width: 88px; }
      /* A page's own dialog drops from the top of the page, like Chrome's. */
      .dlg.page { top: 92px; width: min(440px, calc(100vw - 32px)); }
      .js-head { display: flex; align-items: center; gap: 10px; margin-bottom: 10px; }
      .js-site { width: 28px; height: 28px; border-radius: 9px; display: grid; place-items: center; flex: none; background: var(--vz-surface-2); color: var(--vz-text-2); overflow: hidden; }
      .js-site img { width: 18px; height: 18px; border-radius: 4px; }
      .dlg h2.js-who { margin: 0; font-size: 14px; font-weight: 650; color: var(--vz-text-2); letter-spacing: 0; overflow-wrap: anywhere; }
      .js-msg { font-size: 15px; line-height: 1.5; color: var(--vz-text); white-space: pre-wrap; overflow-wrap: anywhere; max-height: 40vh; overflow: auto; user-select: text; margin: 2px 0 4px; }
      .js-msg:focus-visible { outline: 2px solid var(--vz-focus); outline-offset: 4px; border-radius: 6px; }
      .js-input { width: 100%; height: 40px; margin-top: 12px; font-size: 15px; }
      .js-suppress { margin-top: 14px; }
      .dlg.wide { width: min(620px, calc(100vw - 32px)); }
      .dlg h2 { margin: 0 0 6px; font-size: 17px; font-weight: 700; letter-spacing: -0.01em; display: flex; align-items: center; gap: 8px; }
      .dlg p { margin: 0 0 14px; line-height: 1.5; }
      .dlg .browser-owned { display: flex; align-items: center; gap: 6px; font-size: var(--vz-text-xs); color: var(--vz-text-3); margin-bottom: 12px; font-weight: 600; }
      .actions { display: flex; justify-content: flex-end; gap: 8px; margin-top: 18px; }
      .pw-head { display: flex; gap: 12px; align-items: center; margin-bottom: 8px; } .pw-head h2 { margin: 0; }
      .pw-key { width: 44px; height: 44px; border-radius: 50%; display: grid; place-items: center; flex: none; background: var(--vz-accent-soft); color: var(--vz-accent); animation: vz-rise 300ms var(--vz-ease); }
      .field { display: flex; flex-direction: column; gap: 6px; margin: 12px 0; }
      .field > span { font-size: var(--vz-text-s); font-weight: 600; color: var(--vz-text-2); }
      .field input { height: 36px; font-size: 14px; }
      .swatches, .icons { display: flex; flex-wrap: wrap; gap: 8px; }
      .swatch { width: 26px; height: 26px; border-radius: 50%; border: 2px solid transparent; background: var(--c); cursor: pointer; box-shadow: inset 0 0 0 2px var(--vz-bg-elev); }
      .swatch.on { border-color: var(--c); }
      .icon-choice { width: 36px; height: 36px; border-radius: 10px; border: 1px solid var(--vz-border); background: var(--vz-surface-2); display: grid; place-items: center; cursor: pointer; color: var(--vz-text-2); }
      .icon-choice.on { background: color-mix(in srgb, var(--c) 18%, transparent); color: var(--c); border-color: var(--c); }
      .check { display: flex; align-items: center; gap: 8px; font-size: var(--vz-text-s); color: var(--vz-text-2); }
      .perm-head { display: flex; gap: 14px; align-items: flex-start; }
      .perm-head > .vz-icon { margin-top: 2px; color: var(--vz-accent); }

      .pop { position: absolute; width: 300px; padding: 16px; background: var(--vz-bg-elev); border-radius: 20px; box-shadow: var(--vz-shadow-pop); border: 1px solid var(--vz-border); animation: rise 140ms var(--vz-ease); }
      .pop h3 { margin: 0; font-size: 15px; display: flex; align-items: center; gap: 8px; }
      .pop .site { color: var(--vz-text-2); font-size: var(--vz-text-s); margin: 2px 0 14px; }
      .stats { display: grid; grid-template-columns: repeat(3, 1fr); gap: 8px; margin-bottom: 14px; }
      .stat { background: var(--vz-surface-2); border-radius: 14px; padding: 10px 6px; text-align: center; display: flex; flex-direction: column; align-items: center; gap: 4px; color: var(--vz-text-2); }
      .stat b { display: block; font-size: 20px; font-variant-numeric: tabular-nums; }
      .stat span { font-size: var(--vz-text-xs); color: var(--vz-text-2); }
      .toggle { display: flex; align-items: center; justify-content: space-between; gap: 12px; }
      .switch { position: relative; width: 38px; height: 22px; border-radius: 999px; background: var(--vz-surface-active); border: 0; cursor: pointer; transition: background var(--vz-dur); flex: none; }
      .switch::after { content: ''; position: absolute; top: 3px; left: 3px; width: 16px; height: 16px; border-radius: 50%; background: #fff; transition: transform var(--vz-dur) var(--vz-ease); }
      .switch[aria-checked='true'] { background: var(--vz-accent); }
      .switch[aria-checked='true']::after { transform: translateX(16px); }
      .lock-hero { display: grid; justify-items: center; gap: 10px; text-align: center; padding: 8px 4px 4px; }
      .lock-hero h2 { margin: 6px 0 0; }
      .lock-orb { width: 64px; height: 64px; border-radius: 50%; display: grid; place-items: center; color: #fff; background: linear-gradient(160deg, #3b82f6, #172554); }
      /* Installing a web app. */
      .ai-hero { display: flex; gap: 14px; align-items: center; }
      .ai-tile { position: relative; width: 64px; height: 64px; flex: none; display: grid; place-items: center; border-radius: 16px; background: var(--vz-surface-2); animation: ai-pop 520ms cubic-bezier(.34,1.56,.64,1); }
      .ai-tile.big { width: 84px; height: 84px; border-radius: 22px; }
      @keyframes ai-pop { 0% { transform: scale(.6); opacity: 0; } 70% { transform: scale(1.06); opacity: 1; } 100% { transform: scale(1); } }
      .ai-img { width: 78%; height: 78%; object-fit: contain; border-radius: 12px; }
      .ai-letter { width: 100%; height: 100%; border-radius: inherit; display: grid; place-items: center; background: var(--c); color: #fff; font-size: 30px; font-weight: 750; }
      .ai-id { flex: 1; min-width: 0; }
      .ai-id h2 { margin: 0 0 6px; font-size: 13px; font-weight: 650; color: var(--vz-text-2); }
      .ai-name { width: 100%; height: 36px; font-size: 16px; font-weight: 650; padding: 4px 12px; }
      .ai-origin { display: flex; align-items: center; gap: 4px; margin-top: 6px; font-size: var(--vz-text-s); }
      .ai-desc { margin: 12px 0 0 !important; font-size: var(--vz-text-s); display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical; overflow: hidden; }
      .ai-tabs { margin: 14px 0 10px; }
      .ai-tabs button { display: inline-flex; align-items: center; gap: 6px; }
      .ai-points { list-style: none; margin: 4px 0 14px; padding: 0; display: grid; gap: 10px; }
      .ai-points li { display: flex; align-items: flex-start; gap: 10px; font-size: 13.5px; line-height: 1.4; }
      .ai-points .vz-icon { flex: none; margin-top: 1px; color: var(--vz-accent); }
      .ai-points li { animation: ai-in 360ms var(--vz-ease) backwards; }
      .ai-points li:nth-child(2) { animation-delay: 50ms; } .ai-points li:nth-child(3) { animation-delay: 100ms; } .ai-points li:nth-child(4) { animation-delay: 150ms; }
      @keyframes ai-in { from { opacity: 0; transform: translateY(4px); } }
      .ai-phone { display: flex; gap: 16px; align-items: center; }
      .ai-qr { width: 150px; height: 150px; flex: none; padding: 8px; border-radius: 14px; }
      .ai-steps { margin: 0; padding-left: 18px; display: grid; gap: 12px; font-size: 13px; line-height: 1.45; }
      .ai-steps b { display: block; margin-bottom: 2px; }
      .ai-steps span { color: var(--vz-text-2); }
      .ai-note { margin: 12px 0 0 !important; font-size: var(--vz-text-s); }
      .ai-done { display: grid; justify-items: center; text-align: center; gap: 6px; padding-top: 6px; }
      .ai-done h2 { margin: 10px 0 0; }
      .ai-done p { margin: 0 !important; }
      .ai-check { position: absolute; right: -6px; bottom: -6px; width: 26px; height: 26px; border-radius: 50%; display: grid; place-items: center; background: var(--vz-ok); color: #fff; box-shadow: 0 0 0 3px var(--vz-bg-elev); animation: ai-pop 520ms 220ms cubic-bezier(.34,1.56,.64,1) backwards; }
      .qr-hero { display: grid; justify-items: center; gap: 12px; text-align: center; }
      .qr-hero h2 { margin: 0; }
      .qr-code { width: 220px; height: 220px; padding: 10px; border-radius: 18px; background: #fff; }
      .qr-code svg { width: 100%; height: 100%; display: block; }
      .qr-url { font-size: var(--vz-text-s); max-width: 340px; overflow-wrap: anywhere; }
      .perm-title { margin: 0 0 10px; font-size: 16px; overflow-wrap: anywhere; }
      .perm-asks { list-style: none; margin: 0 0 16px; padding: 0; display: grid; gap: 8px; }
      .perm-asks li { display: flex; gap: 10px; align-items: center; font-size: var(--vz-text-m); }
      .perm-asks li .vz-icon { color: var(--vz-accent); flex: none; }
      .perm-actions { display: grid; gap: 8px; }
      .perm-actions .btn { justify-content: center; }
      .dev-list { display: grid; gap: 6px; max-height: 240px; overflow: auto; margin: 6px 0 4px; }
      .dev { display: flex; gap: 10px; align-items: center; padding: 10px 12px; border-radius: 12px; border: 1px solid var(--vz-border); cursor: pointer; }
      .dev.on { border-color: var(--vz-accent); background: var(--vz-accent-soft); }
      .dev input { position: absolute; opacity: 0; pointer-events: none; }
      .dp-tabs { display: inline-flex; gap: 2px; padding: 3px; border-radius: 999px; background: var(--vz-surface-2); margin: 10px 0 12px; }
      .dp-tabs button { border: 0; background: transparent; color: var(--vz-text-2); padding: 6px 14px; border-radius: 999px; cursor: pointer; font: inherit; font-size: var(--vz-text-s); }
      .dp-tabs button[aria-selected=true] { background: var(--vz-toolbar); color: var(--vz-text); font-weight: 600; }
      .dp-tabs button:disabled { opacity: .4; cursor: default; }
      .dp-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(170px, 1fr)); gap: 10px; max-height: 340px; overflow: auto; padding: 2px; }
      .dp-src { all: unset; display: grid; gap: 6px; padding: 8px; border-radius: 14px; border: 2px solid transparent; cursor: pointer; }
      .dp-src:hover { background: var(--vz-surface-hover); }
      .dp-src.on { border-color: var(--vz-accent); background: var(--vz-accent-soft); }
      .dp-thumb { aspect-ratio: 16 / 10; border-radius: 8px; overflow: hidden; display: grid; place-items: center; background: var(--vz-surface-2); }
      .dp-thumb img { width: 100%; height: 100%; object-fit: contain; }
      .dp-name { display: flex; gap: 6px; align-items: center; font-size: var(--vz-text-s); overflow: hidden; white-space: nowrap; text-overflow: ellipsis; }
      .dp-name img { width: 14px; height: 14px; }
      .dp-tablist { display: grid; gap: 4px; max-height: 320px; overflow: auto; }
      .dp-tab { all: unset; display: flex; gap: 10px; align-items: center; padding: 9px 12px; border-radius: 10px; cursor: pointer; font-size: var(--vz-text-m); }
      .dp-tab:hover { background: var(--vz-surface-hover); }
      .dp-tab.on { background: var(--vz-accent-soft); outline: 2px solid var(--vz-accent); }
      .dp-tab img { width: 16px; height: 16px; border-radius: 3px; }
      .site-info { width: 360px; }
      .site-info h3 { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; display: block; }
      .conn { display: flex; gap: 6px; align-items: center; font-size: var(--vz-text-s); margin: 6px 0 12px; }
      .conn.ok { color: var(--vz-ok); } .conn.bad { color: var(--vz-danger); }
      .sec-title { font-size: 11px; font-weight: 700; color: var(--vz-text-3); text-transform: uppercase; letter-spacing: .06em; margin-bottom: 4px; }
      .perm-rows { list-style: none; margin: 0 -6px; padding: 0; max-height: 320px; overflow: auto; }
      .perm-rows li { display: flex; align-items: center; gap: 10px; padding: 6px; border-radius: 10px; }
      .perm-rows li.in-use { background: color-mix(in srgb, #dc2626 10%, transparent); }
      .perm-rows .pi { width: 28px; height: 28px; border-radius: 50%; display: grid; place-items: center; background: var(--vz-surface-2); flex: none; }
      .perm-rows .pn { flex: 1; min-width: 0; display: grid; font-size: var(--vz-text-m); }
      .perm-rows .pn small { font-size: 11px; color: var(--vz-text-3); }
      .perm-rows .live-tag { color: #dc2626 !important; font-weight: 600; }
      .perm-rows vz-select { width: 132px; }
      .site-info .links { display: flex; gap: 16px; flex-wrap: wrap; }
      .site-info .links .link { display: inline-flex; align-items: center; gap: 6px; }
      .tech { width: 400px; }
      .tech .site { font-size: var(--vz-text-s); color: var(--vz-text-3); margin: 2px 0 10px; }
      .tech-list { max-height: 420px; overflow: auto; margin: 0 -6px; padding: 0 6px; display: grid; gap: 10px; }
      .tech-row { display: flex; gap: 10px; align-items: center; padding: 6px; border-radius: 10px; animation: rise 160ms var(--vz-ease) both; }
      .tech-row:hover { background: var(--vz-surface-hover); }
      .tech-mono { width: 28px; height: 28px; border-radius: 8px; display: grid; place-items: center; background: var(--vz-accent-soft); color: var(--vz-accent); font-weight: 700; font-size: 12px; flex: none; }
      .tn { flex: 1; min-width: 0; display: grid; font-size: var(--vz-text-m); }
      .tn .ver { color: var(--vz-text-3); font-weight: 500; font-size: 12px; }
      .tn small { font-size: 11px; color: var(--vz-text-3); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
      .conf { font-size: 10.5px; font-weight: 700; padding: 2px 8px; border-radius: 999px; flex: none; }
      .conf.certain { background: color-mix(in srgb, var(--vz-ok) 16%, transparent); color: var(--vz-ok); }
      .conf.likely { background: var(--vz-surface-2); color: var(--vz-text-2); }
      .tech-wait { display: flex; gap: 8px; align-items: center; }
      .tech-wait .spin { display: inline-grid; animation: vz-spin 0.9s linear infinite; }
      .tech .links { display: flex; gap: 16px; } .tech .links .link { display: inline-flex; align-items: center; gap: 6px; }
      .tech-note { font-size: 11px; margin: 10px 0 0; }
      .tools { width: 340px; }
      .tool-grid { display: grid; grid-template-columns: repeat(3, 1fr); gap: 6px; margin-top: 12px; }
      .tool { all: unset; display: grid; justify-items: center; gap: 6px; padding: 12px 6px; border-radius: 14px; text-align: center; font-size: 11.5px; cursor: pointer; color: var(--vz-text);
        animation: rise 180ms var(--vz-ease) both; transition: background var(--vz-dur), transform var(--vz-dur) var(--vz-ease); }
      .tool:hover:not([disabled]) { background: var(--vz-surface-hover); transform: translateY(-1px); }
      .tool:focus-visible { outline: 2px solid var(--vz-focus); }
      .tool[disabled] { opacity: .4; cursor: default; }
      .tool .vz-icon { color: var(--vz-accent); }
      .app-menu { width: 284px; padding: 6px; border-radius: 16px; }
      .app-menu .mi { all: unset; box-sizing: border-box; width: 100%; display: flex; align-items: center; gap: 10px; height: 32px; padding: 0 10px; border-radius: 9px; font-size: var(--vz-text-m); cursor: default; }
      .app-menu .mi:hover:not([disabled]), .app-menu .mi:focus-visible { background: var(--vz-surface-hover); outline: none; }
      .app-menu .mi[disabled] { opacity: .45; }
      .app-menu .mi.update { color: var(--vz-accent); font-weight: 600; }
      .app-menu .grow { flex: 1; }
      .app-menu .kbd { font-size: 11px; color: var(--vz-text-3); }
      .app-menu .sep { height: 1px; background: var(--vz-border); margin: 5px 6px; }
      .zoom-row { display: flex; align-items: center; gap: 4px; height: 34px; padding: 0 4px 0 10px; font-size: var(--vz-text-m); }
      .zoom-row .icon-btn { width: 28px; height: 28px; border-radius: 50%; }
      .zoom-row .pct { all: unset; min-width: 44px; text-align: center; font-variant-numeric: tabular-nums; font-size: 12.5px; border-radius: 8px; padding: 4px 2px; cursor: default; }
      .zoom-row .pct:hover, .zoom-row .pct:focus-visible { background: var(--vz-surface-hover); }
      .theme-seg { display: inline-flex; gap: 2px; padding: 2px; border-radius: 999px; background: var(--vz-surface-2); }
      .theme-seg button { width: 30px; height: 26px; border: 0; padding: 0; border-radius: 999px; display: grid; place-items: center; background: transparent; color: var(--vz-text-2); cursor: pointer; transition: background var(--vz-dur), color var(--vz-dur); }
      .theme-seg button:hover { color: var(--vz-text); }
      .theme-seg button[aria-checked='true'] { background: var(--vz-bg-elev); color: var(--vz-accent); box-shadow: 0 0 0 1px var(--vz-border), 0 1px 3px rgba(15, 23, 42, .12); }
      .ads { width: 330px; }
      .ads .stat { display: grid; justify-items: center; gap: 2px; }
      .ads .stat span { font-size: 10.5px; color: var(--vz-text-3); }
      .ads .toggle small { display: block; font-size: var(--vz-text-xs); color: var(--vz-text-3); margin-top: 1px; }
      .ads .strict { color: var(--vz-accent); font-weight: 600; }
      .ads .note { font-size: var(--vz-text-s); margin: 10px 0 0; }
      .ads .toggle + .toggle { margin-top: 12px; }
      .ads .links { display: flex; gap: 16px; flex-wrap: wrap; }
      .ads .links .link { display: inline-flex; align-items: center; gap: 6px; }
      .ext-menu { width: 320px; }
      .perm-list { margin: 0 0 6px; padding-left: 20px; font-size: var(--vz-text-m); line-height: 1.6; }
      .ext-list { list-style: none; margin: 10px -8px 0; padding: 0; max-height: 360px; overflow: auto; }
      .ext-list li { display: flex; align-items: center; gap: 4px; border-radius: 12px; padding: 2px 4px; }
      .ext-list li:hover { background: var(--vz-surface-hover); }
      .ext-open { all: unset; flex: 1; min-width: 0; display: flex; align-items: center; gap: 10px; padding: 7px 6px; border-radius: 10px; cursor: pointer; font-size: var(--vz-text-m); }
      .ext-open:disabled { cursor: default; }
      .ext-open:focus-visible { outline: 2px solid var(--vz-focus); }
      .ext-open span { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
      .ext-open img, .ext-mono { width: 20px; height: 20px; border-radius: 5px; flex: none; }
      .ext-mono { display: grid; place-items: center; background: var(--vz-accent-soft); color: var(--vz-accent); font-weight: 700; font-size: 11px; }
      .pin { width: 30px; height: 30px; color: var(--vz-text-3); }
      .pin.on { color: var(--vz-accent); }
      .pop .link { margin-top: 12px; display: block; font-size: var(--vz-text-s); background: none; border: 0; color: var(--vz-accent); cursor: pointer; padding: 0; }
    `,
  ];

  override connectedCallback(): void {
    super.connectedCallback();
    installTooltips();
    on<Surface>('Overlay', 'show', (s) => this.show(s));
    on('Overlay', 'hide', () => (this.surface = null));
    void overlay.getState().then((s: WindowState) => {
      applyLocale(s.locale);
      applyTheme(s.theme, s.accent, s.density);
    });
    on<WindowState>('Shell', 'state', (s) => applyTheme(s.theme, s.accent, s.density));
    window.addEventListener('keydown', (e) => this.onKey(e), true);
    void overlay.ready();
  }

  private show(s: Surface): void {
    this.surface = s;
    this.draft = {};
    void overlay.getState().then((st: WindowState) => {
      applyLocale(st.locale);
      applyTheme(st.theme, st.accent, st.density);
      this.requestUpdate();
    });
    if (s.kind === 'command-bar') {
      this.input = s.initial;
      this.selected = 0;
      void this.query();
      void this.updateComplete.then(() => {
        const el = this.renderRoot.querySelector('.cb input') as HTMLInputElement | null;
        el?.focus();
        el?.select();
      });
    } else {
      void this.updateComplete.then(() => (this.renderRoot.querySelector('[autofocus]') as HTMLElement | null)?.focus());
    }
  }

  private async query(): Promise<void> {
    const s = this.surface;
    if (s?.kind !== 'command-bar') return;
    const seq = ++this.seq;
    const r = (await overlay.query(this.input, s.mode)) as CommandBarResult;
    if (seq !== this.seq) return;
    this.result = r;
    this.selected = 0;
  }

  private get rows(): Suggestion[] {
    const list = this.result?.suggestions ?? [];
    return SECTION_ORDER.flatMap((sec) => list.filter((x) => x.section === sec));
  }

  private accept(sug?: Suggestion, newTab = false): void {
    const s = this.surface;
    if (s?.kind !== 'command-bar') return;
    // "@tabs" rows narrow the search instead of opening something.
    if (sug?.kind === 'scope') {
      this.input = sug.id.slice('scope:'.length);
      void this.query();
      return;
    }
    void overlay.accept(this.input, sug?.id, { newTab: newTab || s.newTab });
    this.surface = null;
  }

  private close(): void {
    if (this.surface?.kind === 'dialog') void overlay.dialogResult(this.surface.id, null);
    void overlay.close();
    this.surface = null;
  }

  private onKey(e: KeyboardEvent): void {
    if (!this.surface) return;
    if (e.key === 'Escape') {
      e.preventDefault();
      this.close();
      return;
    }
    if (this.surface.kind !== 'command-bar') return;
    const rows = this.rows;
    if (e.key === 'ArrowDown' || (e.key === 'n' && e.ctrlKey)) {
      e.preventDefault();
      this.selected = Math.min(rows.length - 1, this.selected + 1);
      this.scrollSel();
    } else if (e.key === 'ArrowUp' || (e.key === 'p' && e.ctrlKey)) {
      e.preventDefault();
      this.selected = Math.max(0, this.selected - 1);
      this.scrollSel();
    } else if (e.key === 'Enter') {
      e.preventDefault();
      this.accept(rows[this.selected], e.altKey || e.metaKey || e.ctrlKey);
    } else if (e.key === 'Tab' && rows[this.selected]?.kind === 'url') {
      e.preventDefault();
      this.input = rows[this.selected]!.title;
      void this.query();
    }
  }

  private scrollSel(): void {
    void this.updateComplete.then(() => this.renderRoot.querySelector('.row.sel')?.scrollIntoView({ block: 'nearest' }));
  }

  override render() {
    const s = this.surface;
    if (!s) return nothing;
    if (s.kind === 'command-bar') return this.renderCommandBar(s);
    if (s.kind === 'shields') return this.renderShields(s);
    if (s.kind === 'extensions') return this.renderExtensions(s);
    if (s.kind === 'tools') return this.renderTools(s);
    if (s.kind === 'site-info') return this.renderSiteInfo(s);
    if (s.kind === 'tech') return this.renderTech(s);
    if (s.kind === 'app-menu') return this.renderAppMenu(s);
    return this.renderDialog(s);
  }

  private renderCommandBar(s: Extract<Surface, { kind: 'command-bar' }>): TemplateResult {
    const rows = this.rows;
    let lastSection = '';
    const anchored = s.mode === 'address' && s.anchor && !s.newTab;
    // Anchored to the omnibox; on small windows it slides left so it always fits.
    const cbWidth = anchored ? Math.min(Math.max(560, Math.round(s.anchor!.width + 12)), window.innerWidth - 16) : 0;
    const cbLeft = anchored ? Math.max(8, Math.min(s.anchor!.x - 6, window.innerWidth - cbWidth - 8)) : 0;
    const style = anchored ? `left:${cbLeft}px; top:${Math.max(6, s.anchor!.y - 9)}px; width:${cbWidth}px` : '';
    const placeholder = s.mode === 'tab-search' ? t('cb_tab_search_placeholder') : s.mode === 'ask' ? t('cb_ask_placeholder') : t('cb_placeholder_long');
    const route = this.result?.route;
    const modeLabel = s.mode === 'tab-search' ? t('cb_mode_tabs') : route === 'command' ? t('cb_mode_command') : route === 'ask' || s.mode === 'ask' ? t('cb_mode_ask') : s.newTab ? t('cb_mode_new_tab') : '';
    const mac = navigator.platform.startsWith('Mac');
    return html`
      <div class="backdrop ${anchored ? 'clear' : ''}" @mousedown=${() => this.close()}></div>
      <div class="cb ${anchored ? 'anchored' : ''}" style=${style} role="dialog" aria-modal="true" aria-label=${t('cmd_command_bar')}>
        <div class="cb-field">
          <span class="lead">${icon(route === 'command' ? 'command' : route === 'ask' || s.mode === 'ask' ? 'sparkle' : 'search', 18)}</span>
          <input class="bare" type="text" spellcheck="false" autocomplete="off" .value=${this.input} placeholder=${placeholder}
            role="combobox" aria-expanded="true" aria-controls="cb-rows" aria-activedescendant=${rows[this.selected] ? `cb-${this.selected}` : ''}
            @input=${(e: InputEvent) => ((this.input = (e.target as HTMLInputElement).value), void this.query())} />
          ${modeLabel ? html`<span class="mode">${modeLabel}</span>` : nothing}
        </div>
        ${this.result?.chips.length
          ? html`<div class="chips"><span class="lbl">${t('cb_interpreted_as')}</span>${this.result.chips.map((c) => html`<button class="chip-btn" @click=${() => void overlay.accept(this.input, undefined, { route: c.route })}>${c.label}</button>`)}</div>`
          : nothing}
        <div class="rows" id="cb-rows" role="listbox">
          ${rows.map((r, i) => {
            const header = r.section !== lastSection && r.section !== 'top' ? html`<div class="sec">${t(`cb_section_${r.section}` as never)}</div>` : nothing;
            lastSection = r.section;
            return html`${header}<div class="row ${i === this.selected ? 'sel' : ''} ${r.destructive ? 'destructive' : ''}" id="cb-${i}" role="option" aria-selected=${i === this.selected}
              @mousemove=${() => this.selected !== i && (this.selected = i)} @click=${(e: MouseEvent) => this.accept(r, e.metaKey || e.ctrlKey)}>
              <span class="ic">${r.favicon ? html`<img src=${r.favicon} alt="" referrerpolicy="no-referrer" @error=${(e: Event) => ((e.target as HTMLImageElement).replaceWith(document.createTextNode('')))} />` : icon(r.icon ?? kindIcon(r.kind), 15)}</span>
              <span class="txt"><span class="t1">${r.title}</span>${r.detail ? html`<span class="t2">${r.detail}</span>` : nothing}</span>
              ${r.shortcut ? html`<span class="kbd">${r.shortcut}</span>` : nothing}
              <span class="enter">↵</span>
            </div>`;
          })}
        </div>
        <div class="foot" aria-hidden="true">
          <span class="kbd" title=${t('cb_hint_move')}>↑↓</span><span class="kbd" title=${t('cb_hint_open')}>↵</span><span class="kbd" title=${t('cb_hint_new_tab')}>${mac ? '⌘' : 'Ctrl'}↵</span>
          <span style="flex:1"></span>
          <span class="kbd" title=${t('cb_hint_commands')}>&gt;</span><span class="kbd" title=${t('cb_hint_ask')}>?</span></div>
      </div>`;
  }

  /** Site info (lock icon): connection security and this site's permissions, editable. */
  private renderSiteInfo(s: Extract<Surface, { kind: 'site-info' }>): TemplateResult {
    const i = s.info;
    const left = Math.max(8, Math.min(window.innerWidth - 368, s.anchor.x - 8));
    const update = (next: SiteInfo | null) => next && this.surface?.kind === 'site-info' && (this.surface = { ...this.surface, info: next });
    const secure = i.security === 'secure' || i.security === 'internal';
    return html`<div class="backdrop clear" @mousedown=${() => this.close()}></div>
      <div class="pop site-info" style="left:${left}px; top:${s.anchor.y + s.anchor.height + 8}px" role="dialog" aria-label=${t('si_open')}>
        <h3>${i.host}</h3>
        <div class="conn ${secure ? 'ok' : 'bad'}">${icon(secure ? 'lock' : 'alert', 14)} ${secure ? t('si_secure') : t('si_insecure')}</div>
        <div class="sec-title">${t('si_permissions')}</div>
        <ul class="perm-rows">${i.rows.map((r) => html`<li class=${r.inUse ? 'in-use' : ''}>
          <span class="pi">${icon(PERM_ICONS[r.kind] ?? 'key', 15)}</span>
          <span class="pn"><span>${permName(r.kind)}</span>${r.inUse ? html`<small class="live-tag">${t('si_in_use')}</small>` : r.embargoed ? html`<small>${t('si_embargo')}</small>` : nothing}</span>
          <vz-select label=${permName(r.kind)} .value=${r.isDefault ? 'ask-default' : r.setting}
            .options=${[{ id: 'ask-default', name: `${t('perm_opt_' + r.setting as never)} · ${t('perm_default')}` }, { id: 'allow', name: t('perm_opt_allow') }, { id: 'block', name: t('perm_opt_block') }]}
            @change=${async (e: CustomEvent<string>) => update((await overlay.setSitePermission(r.kind, e.detail === 'ask-default' ? 'ask' : e.detail)) as SiteInfo | null)}></vz-select>
        </li>`)}</ul>
        <div class="links">
          <button class="link" @click=${async () => update((await overlay.resetSitePermissions()) as SiteInfo | null)}>${icon('undo', 12)} ${t('si_reset')}</button>
          <button class="link" @click=${() => (this.close(), void overlay.runCommand('page.settingsPermissions'))}>${icon('settings', 12)} ${t('si_settings')}</button>
        </div>
      </div>`;
  }

  /** Site technologies: what the page is built with, grouped, with versions and evidence. */
  private renderTech(s: Extract<Surface, { kind: 'tech' }>): TemplateResult {
    const left = Math.max(8, Math.min(window.innerWidth - 408, s.anchor.x + s.anchor.width - 400));
    const groups = new Map<string, Tech[]>();
    for (const x of s.result ?? []) {
      if (!groups.has(x.category)) groups.set(x.category, []);
      groups.get(x.category)!.push(x);
    }
    const report = () => [`# ${s.host}`, '', ...[...groups].flatMap(([c, list]) => [`## ${t(`tech_cat_${c.replace(/-/g, '_')}` as never)}`, ...list.map((x) => `- ${x.name}${x.version ? ` ${x.version}` : ''} (${x.confidence})`), ''])].join('\n');
    return html`<div class="backdrop clear" @mousedown=${() => this.close()}></div>
      <div class="pop tech" style="left:${left}px; top:${s.anchor.y + s.anchor.height + 8}px" role="dialog" aria-label=${t('tool_tech')}>
        <h3>${icon('code', 18)} ${t('tool_tech')}</h3>
        <div class="site">${s.host}</div>
        ${s.result === null
          ? html`<p class="muted tech-wait" role="status"><span class="spin">${icon('loader', 16)}</span> ${t('tech_scanning')}</p>`
          : !s.result.length
            ? html`<p class="muted">${t('tech_none')}</p>`
            : html`<div class="tech-list">${[...groups].map(([c, list]) => html`<section aria-label=${t(`tech_cat_${c.replace(/-/g, '_')}` as never)}>
                <div class="sec-title">${icon(TECH_ICONS[c] ?? 'code', 12)} ${t(`tech_cat_${c.replace(/-/g, '_')}` as never)}</div>
                ${list.map((x) => html`<div class="tech-row" title=${x.evidence.join('\n')}>
                  <span class="tech-mono">${x.name.slice(0, 1)}</span>
                  <span class="tn"><b>${x.name}</b>${x.version ? html` <span class="ver">${x.version}</span>` : nothing}<small>${x.evidence[0] ?? ''}</small></span>
                  <span class="conf ${x.confidence}">${t(x.confidence === 'certain' ? 'tech_certain' : 'tech_likely')}</span>
                </div>`)}
              </section>`)}</div>`}
        <div class="links">
          ${s.result?.length ? html`<button class="link" @click=${() => void navigator.clipboard.writeText(report())}>${icon('copy', 12)} ${t('tech_copy')}</button>` : nothing}
          <button class="link" @click=${() => (this.close(), void overlay.runCommand('tools.techStack'))}>${icon('refresh', 12)} ${t('tech_rescan')}</button>
        </div>
        <p class="muted tech-note">${t('tech_note')}</p>
      </div>`;
  }

  /** Tools: a grid of quick tools for the current page. */
  private renderTools(s: Extract<Surface, { kind: 'tools' }>): TemplateResult {
    const left = Math.max(8, Math.min(window.innerWidth - 348, s.anchor.x + s.anchor.width - 340));
    return html`<div class="backdrop clear" @mousedown=${() => this.close()}></div>
      <div class="pop tools" style="left:${left}px; top:${s.anchor.y + s.anchor.height + 8}px" role="menu" aria-label=${t('cmd_tools')}>
        <h3>${icon('wand', 18)} ${t('cmd_tools')}</h3>
        ${s.web ? nothing : html`<p class="muted note">${t('tools_page_only')}</p>`}
        <div class="tool-grid">${TOOLS.map((x, i) => html`<button role="menuitem" class="tool" style="animation-delay:${i * 18}ms" ?disabled=${x.web && !s.web}
          @click=${() => (this.close(), void overlay.runCommand(x.id))}>${icon(x.icon, 18)}<span>${t(x.label as never)}</span></button>`)}</div>
      </div>`;
  }

  /** The ⋮ menu: glass, Chrome's layout, zoom row that stays open. */
  private renderAppMenu(s: Extract<Surface, { kind: 'app-menu' }>): TemplateResult {
    const m = s.menu;
    const left = Math.max(8, Math.min(window.innerWidth - 300, s.anchor.x + s.anchor.width - 292));
    const run = async (id: string) => {
      const next = (await overlay.appMenuAction(id)) as AppMenu | null;
      if (next && this.surface?.kind === 'app-menu') this.surface = { ...this.surface, menu: next };
      // The item may have opened another surface (Tools): only close the menu itself.
      else if (!next && this.surface?.kind === 'app-menu') this.surface = null;
    };
    const key = (e: KeyboardEvent) => {
      const items = [...this.renderRoot.querySelectorAll<HTMLElement>('.app-menu [role=menuitem]:not([disabled])')];
      const i = items.indexOf((this.renderRoot as ShadowRoot).activeElement as HTMLElement);
      const next = e.key === 'ArrowDown' ? items[(i + 1) % items.length] : e.key === 'ArrowUp' ? items[(i - 1 + items.length) % items.length] : e.key === 'Home' ? items[0] : e.key === 'End' ? items.at(-1) : null;
      if (next) {
        e.preventDefault();
        next.focus();
      }
    };
    return html`<div class="backdrop clear" @mousedown=${() => this.close()}></div>
      <div class="pop app-menu" style="left:${left}px; top:${s.anchor.y + s.anchor.height + 6}px" role="menu" aria-label=${t('menu_more')} @keydown=${key}>
        ${m.update ? html`<button role="menuitem" class="mi update" @click=${() => void run('app.update')}>${icon('update', 16)}<span>${m.update}</span></button><div class="sep"></div>` : nothing}
        ${m.groups.map((g, gi) => html`${gi === 1 ? html`<div class="zoom-row" role="group" aria-label=${t('menu_zoom')}>
            <span>${t('menu_zoom')}</span><span class="grow"></span>
            <button role="menuitem" class="icon-btn" aria-label=${t('cmd_zoom_out')} @click=${() => void run('view.zoomOut')}>${icon('minimize', 14)}</button>
            <button role="menuitem" class="pct" aria-label=${t('cmd_zoom_reset')} @click=${() => void run('view.zoomReset')}>${m.zoom}%</button>
            <button role="menuitem" class="icon-btn" aria-label=${t('cmd_zoom_in')} @click=${() => void run('view.zoomIn')}>${icon('plus', 14)}</button>
            <button role="menuitem" class="icon-btn" aria-label=${t('cmd_fullscreen')} @click=${() => void run('view.fullscreen')}>${icon('maximize', 14)}</button>
          </div>
          ${m.theme ? html`<div class="zoom-row theme-row" role="radiogroup" aria-label=${t('set_theme')}>
            <span>${t('set_theme')}</span><span class="grow"></span>
            <div class="theme-seg">${(['system', 'light', 'dark'] as const).map((id) => html`<button role="menuitemradio" aria-checked=${m.theme === id} title=${t(`theme_${id}`)}
              aria-label=${t(`theme_${id}`)} @click=${() => void run(`theme:${id}`)}>${icon(id === 'system' ? 'monitor' : id === 'light' ? 'sun' : 'moon', 14)}</button>`)}</div>
          </div>` : nothing}<div class="sep"></div>` : nothing}
          ${g.map((x) => html`<button role="menuitem" class="mi" ?disabled=${!x.enabled} aria-haspopup=${x.sub ? 'menu' : nothing} @click=${() => void run(x.id)}>
            <span>${x.label}</span><span class="grow"></span>${x.shortcut ? html`<span class="kbd">${x.shortcut}</span>` : nothing}${x.sub ? icon('chevron-right', 14) : nothing}</button>`)}
          ${gi < m.groups.length - 1 ? html`<div class="sep"></div>` : nothing}`)}
      </div>`;
  }

  /** The toolbar's extensions menu (Chrome's puzzle menu): open, pin or unpin, manage. */
  private renderExtensions(s: Extract<Surface, { kind: 'extensions' }>): TemplateResult {
    type Item = { id: string; name: string; icon: string | null; pinned: boolean; hasAction: boolean };
    const items = s.items as Item[];
    const left = Math.max(8, Math.min(window.innerWidth - 328, s.anchor.x + s.anchor.width - 320));
    const act = async (id: string, a: string) => {
      const next = (await overlay.extensionMenu(id, a)) as Item[];
      if (a === 'pin' || a === 'unpin') this.surface = { ...s, items: next };
    };
    return html`<div class="backdrop clear" @mousedown=${() => this.close()}></div>
      <div class="pop ext-menu" style="left:${left}px; top:${s.anchor.y + s.anchor.height + 8}px" role="dialog" aria-label=${t('ext_title')}>
        <h3>${icon('puzzle', 18)} ${t('ext_title')}</h3>
        ${items.length
          ? html`<ul class="ext-list">${items.map((x) => html`<li>
              <button class="ext-open" ?disabled=${!x.hasAction} @click=${() => void act(x.id, 'open')}>
                ${x.icon ? html`<img src=${x.icon} alt="" />` : html`<span class="ext-mono">${x.name.slice(0, 1)}</span>`}<span>${x.name}</span></button>
              <button class="icon-btn pin ${x.pinned ? 'on' : ''}" aria-pressed=${x.pinned} aria-label=${`${x.pinned ? t('ext_unpin') : t('ext_pin')}: ${x.name}`} title=${x.pinned ? t('ext_unpin') : t('ext_pin')}
                @click=${() => void act(x.id, x.pinned ? 'unpin' : 'pin')}>${icon('pin', 15)}</button></li>`)}</ul>`
          : html`<p class="muted">${t('ext_menu_empty')}</p>`}
        <button class="link" @click=${() => void act('', 'manage')}>${icon('settings', 12)} ${t('ext_manage')}</button>
      </div>`;
  }

  /** Ads & trackers panel (toolbar shield): live counts, protection and ads for this site. */
  private renderShields(s: Extract<Surface, { kind: 'shields' }>): TemplateResult {
    const st = s.status;
    const left = Math.max(8, Math.min(window.innerWidth - 348, s.anchor.x - 10));
    const update = (next: ShieldsStatus | null) => next && (this.surface = { ...s, status: next });
    return html`<div class="backdrop clear" @mousedown=${() => this.close()}></div>
      <div class="pop ads" style="left:${left}px; top:${s.anchor.y + s.anchor.height + 8}px" role="dialog" aria-label=${t('ads_panel_title')}>
        <h3>${icon(st.siteEnabled ? 'shield-check' : 'shield-off', 18)} ${t('ads_panel_title')}</h3>
        <div class="site">${st.site}${st.strict ? html` · <span class="strict">${t('ads_strict_on')}</span>` : nothing}</div>
        <div class="stats">
          <div class="stat" title=${t('shields_ads')}>${icon('grid', 16, t('shields_ads'))}<b>${st.blocked.ads}</b><span>${t('shields_ads')}</span></div>
          <div class="stat" title=${t('shields_trackers')}>${icon('eye-off', 16, t('shields_trackers'))}<b>${st.blocked.trackers}</b><span>${t('shields_trackers')}</span></div>
          <div class="stat" title=${t('shields_total')}>${icon('shield-check', 16, t('shields_total'))}<b>${st.blocked.total}</b><span>${t('shields_total')}</span></div>
        </div>
        <div class="toggle"><span>${t('ads_protection_site')}</span>
          <button class="switch" role="switch" aria-checked=${st.siteEnabled} aria-label=${t('ads_protection_site')} ?disabled=${!st.enabled}
            @click=${async () => update((await overlay.setShieldsForSite(!st.siteEnabled)) as ShieldsStatus | null)}></button></div>
        ${st.blockAds
          ? html`<div class="toggle"><span>${t('ads_show_site')}<small>${t('ads_show_site_desc')}</small></span>
              <button class="switch" role="switch" aria-checked=${st.adsAllowed} aria-label=${t('ads_show_site')} ?disabled=${!st.siteEnabled}
                @click=${async () => update((await overlay.setAdsForSite(!st.adsAllowed)) as ShieldsStatus | null)}></button></div>`
          : html`<p class="muted note">${t('ads_allowed_everywhere')}</p>`}
        <div class="links">
          <button class="link" @click=${() => (this.close(), void overlay.runCommand('page.settingsShields'))}>${icon('settings', 12)} ${t('ads_settings')}</button>
          <button class="link" title=${t('shields_breakage_hint')} @click=${() => (this.close(), void overlay.runCommand('page.privacy'))}>${icon('external', 12)} ${t('shields_open_dashboard')}</button>
        </div>
      </div>`;
  }

  private renderDialog(s: Extract<Surface, { kind: 'dialog' }>): TemplateResult {
    const render = DIALOGS.get(s.dialog.type);
    const host: DialogHost = {
      resolve: (r) => {
        void overlay.dialogResult(s.id, r ?? null);
        this.surface = null;
      },
      cancel: () => this.close(),
      requestUpdate: () => this.requestUpdate(),
      draft: this.draft,
    };
    const wide = ['agent-plan', 'agent-confirm', 'disclosure', 'display-picker'].includes(s.dialog.type);
    // A page's alert/confirm/prompt speaks for the page, so it isn't labelled as the browser's.
    const page = s.dialog.type === 'js-dialog';
    return html`<div class="backdrop"></div>
      <div class="dlg ${wide ? 'wide' : ''} ${page ? 'page' : ''}" role=${page && s.dialog.kind !== 'prompt' ? 'alertdialog' : 'dialog'} aria-modal="true" aria-labelledby="dlg-title" aria-describedby=${page ? 'js-msg' : nothing}>
        ${page ? nothing : html`<div class="browser-owned">${icon('shield', 12)} ${t('browser_owned_label')}</div>`}
        ${render ? render(s.dialog, host) : html`<p>${s.dialog.type}</p>`}
      </div>`;
  }
}

function kindIcon(k: Suggestion['kind']): string {
  return ({ url: 'globe', search: 'search', tab: 'layers', history: 'history', bookmark: 'star', command: 'command', ask: 'sparkle', memory: 'brain', archive: 'archive', 'nl-command': 'wand', destination: 'settings', scope: 'search' } as Record<string, string>)[k] ?? 'globe';
}

customElements.define('vz-overlay', VzOverlay);
