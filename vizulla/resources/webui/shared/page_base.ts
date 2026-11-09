// Base class for vizulla:// pages in tabs: applies locale/theme and loads the
// page's initial data from its PageHandler.
import { LitElement, html } from 'lit';
import { page } from './bridge';
import { applyLocale, applyTheme } from './theme';
import { icon } from './icons';
import { installTooltips } from './tooltip';

export abstract class VzPage<T> extends LitElement {
  static override properties = { data: { state: true }, error: { state: true } };
  data: T | null = null;
  error = '';

  override connectedCallback(): void {
    super.connectedCallback();
    installTooltips();
    void page
      .init<T>()
      .then((r) => {
        applyLocale(r.locale);
        applyTheme(r.theme, r.accent);
        if ((r as { glass?: boolean }).glass) {
          const root = document.documentElement.style;
          root.setProperty('--vz-page-bg', 'color-mix(in srgb, var(--vz-bg) 74%, transparent)');
          root.setProperty('--vz-card-bg', 'color-mix(in srgb, var(--vz-bg-elev) 72%, transparent)');
          root.setProperty('--vz-ntp-bg', 'color-mix(in srgb, var(--vz-toolbar) 72%, transparent)');
          document.documentElement.style.background = 'transparent';
        }
        this.data = r.data;
        this.loaded();
      })
      .catch((e: Error) => (this.error = e.message));
  }

  protected loaded(): void {}

  protected invoke<R = unknown>(method: string, payload?: unknown): Promise<R> {
    return page.invoke<R>(method, payload);
  }

  protected toggle(checked: boolean, onChange: (v: boolean) => void, label: string) {
    return html`<button class="switch" role="switch" aria-checked=${checked} aria-label=${label} @click=${() => onChange(!checked)}></button>`;
  }

  protected loading() {
    return html`<div class="empty">${this.error || html`<span class="spin" style="display:inline-block">${icon('loader', 20)}</span>`}</div>`;
  }
}

export const switchStyles = `
  .switch { position: relative; width: 38px; height: 22px; border-radius: 999px; background: var(--vz-surface-active); border: 0; cursor: pointer; transition: background var(--vz-dur); flex: none; }
  .switch::after { content: ''; position: absolute; top: 3px; left: 3px; width: 16px; height: 16px; border-radius: 50%; background: #fff; transition: transform var(--vz-dur) var(--vz-ease); }
  .switch[aria-checked='true'] { background: var(--vz-accent); }
  .switch[aria-checked='true']::after { transform: translateX(16px); }
`;

export function timeAgo(t: number, locale: string): string {
  const rtf = new Intl.RelativeTimeFormat(locale, { numeric: 'auto' });
  const s = (t - Date.now()) / 1000;
  const abs = Math.abs(s);
  if (abs < 60) return rtf.format(Math.round(s), 'second');
  if (abs < 3600) return rtf.format(Math.round(s / 60), 'minute');
  if (abs < 86400) return rtf.format(Math.round(s / 3600), 'hour');
  return rtf.format(Math.round(s / 86400), 'day');
}

export function htmlPage(tag: string, title: string): string {
  return `<!doctype html><html><head><meta charset="utf-8"><title>${title}</title><script type="module" src="index.js"></script></head><body style="margin:0"><${tag}></${tag}></body></html>`;
}
