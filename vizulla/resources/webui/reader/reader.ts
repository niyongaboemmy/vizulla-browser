// Reader view (PA-07): clean typography presets and read-aloud (local speech synthesis).
import { css, html, nothing } from 'lit';
import { base, pageStyles } from '../shared/styles';
import { icon } from '../shared/icons';
import { VzPage } from '../shared/page_base';
import { t } from '@vz/common/i18n';

interface Article { url: string; title: string; site: string; blocks: { tag: string; text: string; level: number }[] }
const PRESETS = { serif: "Charter, 'Iowan Old Style', Georgia, serif", sans: 'var(--vz-font)', mono: 'var(--vz-font-mono)' } as const;

class VzReader extends VzPage<unknown> {
  static override properties = { ...VzPage.properties, article: { state: true }, font: { state: true }, size: { state: true }, speaking: { state: true } };
  article: Article | null = null;
  font: keyof typeof PRESETS = 'serif';
  size = 19;
  speaking = false;
  static override styles = [base, pageStyles, css`
    :host { background: var(--vz-bg-elev); }
    .bar { position: sticky; top: 0; display: flex; gap: 6px; align-items: center; justify-content: flex-end; padding: 10px 16px; background: color-mix(in srgb, var(--vz-bg-elev) 88%, transparent); backdrop-filter: blur(8px); }
    .bar .site { margin-inline-end: auto; color: var(--vz-text-3); font-size: var(--vz-text-s); }
    article { max-width: 680px; margin: 0 auto; padding: 24px 28px 120px; line-height: 1.7; }
    h1 { font-size: 2em; line-height: 1.2; letter-spacing: -0.02em; margin: 0 0 .6em; }
    h2, h3 { margin: 1.6em 0 .4em; line-height: 1.3; } p, li, blockquote { margin: 0 0 1em; } blockquote { border-inline-start: 3px solid var(--vz-accent); padding-inline-start: 14px; color: var(--vz-text-2); }
    pre { white-space: pre-wrap; font-family: var(--vz-font-mono); font-size: .85em; background: var(--vz-surface-2); padding: 12px; border-radius: 8px; }`];

  protected override loaded(): void {
    const id = new URLSearchParams(location.search).get('id') ?? '';
    void this.invoke<Article | null>('get', id).then((a) => {
      this.article = a;
      if (a) document.title = a.title;
    });
  }

  private speak(): void {
    if (this.speaking) {
      speechSynthesis.cancel();
      this.speaking = false;
      return;
    }
    const text = this.article!.blocks.map((b) => b.text).join('\n');
    const u = new SpeechSynthesisUtterance(text);
    u.lang = document.documentElement.lang || 'en';
    u.onend = () => (this.speaking = false);
    speechSynthesis.speak(u);
    this.speaking = true;
  }

  override render() {
    const a = this.article;
    if (!this.data && !a) return this.loading();
    if (!a) return html`<div class="empty">${t('reader_expired')}</div>`;
    return html`<div class="bar"><span class="site">${a.site}</span>
        ${(Object.keys(PRESETS) as (keyof typeof PRESETS)[]).map((f) => html`<button class="btn ${this.font === f ? 'primary' : 'ghost'}" @click=${() => (this.font = f)}>${t(`reader_font_${f}` as never)}</button>`)}
        <button class="icon-btn" aria-label=${t('cmd_zoom_out')} @click=${() => (this.size = Math.max(14, this.size - 1))}>A−</button>
        <button class="icon-btn" aria-label=${t('cmd_zoom_in')} @click=${() => (this.size = Math.min(28, this.size + 1))}>A+</button>
        <button class="btn ghost" @click=${() => this.speak()}>${icon(this.speaking ? 'stop' : 'volume', 14)} ${this.speaking ? t('reader_stop') : t('reader_listen')}</button>
        <button class="btn ghost" @click=${() => this.invoke('open', a.url)}>${icon('external', 14)} ${t('reader_original')}</button></div>
      <article style="font-family:${PRESETS[this.font]};font-size:${this.size}px" lang="">
        ${a.blocks[0]?.level === 1 ? nothing : html`<h1>${a.title}</h1>`}
        ${a.blocks.map((b) => (b.level === 1 ? html`<h1>${b.text}</h1>` : b.level === 2 ? html`<h2>${b.text}</h2>` : b.level ? html`<h3>${b.text}</h3>` : b.tag === 'li' ? html`<p>• ${b.text}</p>` : b.tag === 'blockquote' ? html`<blockquote>${b.text}</blockquote>` : b.tag === 'pre' ? html`<pre>${b.text}</pre>` : html`<p>${b.text}</p>`))}
      </article>`;
  }
}
customElements.define('vz-reader', VzReader);
