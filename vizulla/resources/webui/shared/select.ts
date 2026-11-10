// <vz-select>: the select used on every vizulla:// page instead of the native one.
// A pill trigger opens a glass listbox (WAI-ARIA select-only combobox pattern):
// arrows/Home/End move, Enter/Space choose, Esc closes, typing jumps to a match.
// Fires `change` with `detail: value`.
import { LitElement, css, html, nothing } from 'lit';
import { base } from './styles';
import { icon } from './icons';

export interface SelectOption {
  id: string;
  name: string;
  /** Optional second line under the name. */
  hint?: string;
  /** Optional icon name from the shared icon set. */
  icon?: string;
}

let nextId = 0;

export class VzSelect extends LitElement {
  static override properties = {
    value: {},
    options: { attribute: false },
    label: {},
    open: { state: true },
    active: { state: true },
    above: { state: true },
  };
  value = '';
  options: SelectOption[] = [];
  label = '';
  open = false;
  active = 0;
  above = false;
  private readonly uid = `vzs${nextId++}`;
  private typed = '';
  private typedAt = 0;

  static override styles = [
    base,
    css`
      :host { display: inline-block; position: relative; min-width: 180px; max-width: 100%; }
      .trigger { all: unset; box-sizing: border-box; width: 100%; display: flex; align-items: center; gap: 8px; height: 36px; padding: 0 12px 0 14px; cursor: pointer;
        border-radius: 999px; background: var(--vz-omnibox); border: 1px solid transparent; color: var(--vz-text);
        transition: background var(--vz-dur), border-color var(--vz-dur), box-shadow var(--vz-dur); }
      .trigger:hover { background: var(--vz-omnibox-hover); }
      .trigger:focus-visible, :host([open]) .trigger { background: var(--vz-bg-elev); border-color: var(--vz-accent); box-shadow: 0 0 0 3px color-mix(in srgb, var(--vz-accent) 18%, transparent); outline: none; }
      .val { flex: 1; min-width: 0; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
      .chev { color: var(--vz-text-3); transition: transform 200ms var(--vz-ease); }
      :host([open]) .chev { transform: rotate(180deg); color: var(--vz-accent); }
      .list { position: absolute; left: 0; min-width: 100%; max-width: min(360px, 90vw); max-height: 300px; overflow: auto; z-index: 20; margin: 0; padding: 6px; list-style: none;
        top: calc(100% + 6px); border-radius: 18px; border: 1px solid var(--vz-glass-border);
        background: var(--vz-bg-elev); box-shadow: var(--vz-shadow-pop);
        transform-origin: top center; animation: drop 180ms var(--vz-ease); scrollbar-width: thin; }
      .list.above { top: auto; bottom: calc(100% + 6px); transform-origin: bottom center; }
      @keyframes drop { from { opacity: 0; transform: translateY(-4px) scale(.97); } }
      .opt { display: flex; align-items: center; gap: 10px; min-height: 36px; padding: 6px 10px 6px 12px; border-radius: 12px; cursor: pointer; color: var(--vz-text-2);
        transition: background 120ms, color 120ms; }
      .opt.active { background: var(--vz-surface-hover); color: var(--vz-text); }
      .opt[aria-selected='true'] { color: var(--vz-accent); font-weight: 600; }
      .opt .txt { flex: 1; min-width: 0; display: flex; flex-direction: column; }
      .opt .hint { font-size: var(--vz-text-xs); color: var(--vz-text-3); font-weight: 400; }
      .tick { width: 16px; color: var(--vz-accent); opacity: 0; transform: scale(.6); transition: opacity 150ms, transform 150ms var(--vz-ease); }
      .opt[aria-selected='true'] .tick { opacity: 1; transform: none; }
    `,
  ];

  override connectedCallback(): void {
    super.connectedCallback();
    document.addEventListener('pointerdown', this.onOutside, true);
  }

  override disconnectedCallback(): void {
    super.disconnectedCallback();
    document.removeEventListener('pointerdown', this.onOutside, true);
  }

  private readonly onOutside = (e: Event): void => {
    if (this.open && !e.composedPath().includes(this)) this.close(false);
  };

  private get index(): number {
    return Math.max(0, this.options.findIndex((o) => o.id === this.value));
  }

  private show(): void {
    if (this.open) return;
    const r = this.getBoundingClientRect();
    this.above = window.innerHeight - r.bottom < 320 && r.top > window.innerHeight - r.bottom;
    this.active = this.index;
    this.open = true;
    this.setAttribute('open', '');
    void this.updateComplete.then(() => this.renderRoot.querySelector('.opt.active')?.scrollIntoView({ block: 'nearest' }));
  }

  private close(refocus = true): void {
    this.open = false;
    this.removeAttribute('open');
    if (refocus) (this.renderRoot.querySelector('.trigger') as HTMLElement | null)?.focus();
  }

  private choose(i: number): void {
    const o = this.options[i];
    if (!o) return;
    this.close();
    if (o.id === this.value) return;
    this.value = o.id;
    this.dispatchEvent(new CustomEvent('change', { detail: o.id, bubbles: true, composed: true }));
  }

  private move(i: number): void {
    this.active = Math.max(0, Math.min(this.options.length - 1, i));
    void this.updateComplete.then(() => this.renderRoot.querySelector('.opt.active')?.scrollIntoView({ block: 'nearest' }));
  }

  private onKey(e: KeyboardEvent): void {
    const k = e.key;
    if (!this.open) {
      if (['ArrowDown', 'ArrowUp', 'Enter', ' '].includes(k)) {
        e.preventDefault();
        this.show();
      }
      return;
    }
    if (k === 'ArrowDown') this.move(this.active + 1);
    else if (k === 'ArrowUp') this.move(this.active - 1);
    else if (k === 'Home') this.move(0);
    else if (k === 'End') this.move(this.options.length - 1);
    else if (k === 'Enter' || k === ' ') this.choose(this.active);
    else if (k === 'Escape') this.close();
    else if (k === 'Tab') return this.close(false);
    else if (k.length === 1) {
      // Type-ahead: letters typed within a second build a prefix.
      const now = Date.now();
      this.typed = (now - this.typedAt < 1000 ? this.typed : '') + k.toLowerCase();
      this.typedAt = now;
      const i = this.options.findIndex((o) => o.name.toLowerCase().startsWith(this.typed));
      if (i >= 0) this.move(i);
    } else return;
    e.preventDefault();
  }

  override render() {
    const cur = this.options[this.index];
    const listId = `${this.uid}-list`;
    return html`<button class="trigger" role="combobox" aria-haspopup="listbox" aria-expanded=${this.open} aria-controls=${listId}
        aria-label=${this.label || nothing} aria-activedescendant=${this.open ? `${this.uid}-${this.active}` : nothing}
        @click=${() => (this.open ? this.close() : this.show())} @keydown=${(e: KeyboardEvent) => this.onKey(e)}>
        ${cur?.icon ? icon(cur.icon, 15) : nothing}<span class="val">${cur?.name ?? ''}</span><span class="chev">${icon('chevron-down', 15)}</span>
      </button>
      ${this.open
        ? html`<ul class="list ${this.above ? 'above' : ''}" id=${listId} role="listbox" aria-label=${this.label || nothing}>
            ${this.options.map((o, i) => html`<li id="${this.uid}-${i}" class="opt ${i === this.active ? 'active' : ''}" role="option" aria-selected=${o.id === this.value}
              @pointerenter=${() => (this.active = i)} @click=${() => this.choose(i)}>
              ${o.icon ? icon(o.icon, 15) : nothing}
              <span class="txt"><span>${o.name}</span>${o.hint ? html`<span class="hint">${o.hint}</span>` : nothing}</span>
              <span class="tick">${icon('check', 15)}</span></li>`)}
          </ul>`
        : nothing}`;
  }
}
if (!customElements.get('vz-select')) customElements.define('vz-select', VzSelect);
