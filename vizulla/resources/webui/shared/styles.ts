// Shared component styles (Lit). Everything is token-based: no raw colors.
import { css } from 'lit';

export const base = css`
  :host { font-family: var(--vz-font); color: var(--vz-text); font-size: var(--vz-text-m); -webkit-font-smoothing: antialiased; }
  *, *::before, *::after { box-sizing: border-box; }
  button { font: inherit; color: inherit; }
  .vz-icon { flex: none; display: block; }
  /* Keyboard focus: one clean ring that follows the element's own shape. */
  :focus { outline: none; }
  :focus-visible { outline: 2px solid var(--vz-focus); outline-offset: 2px; }
  .btn {
    display: inline-flex; align-items: center; justify-content: center; gap: 6px; height: 32px; padding: 0 14px;
    border-radius: 999px; border: 1px solid var(--vz-border); background: var(--vz-bg-elev);
    cursor: pointer; font-size: var(--vz-text-m); font-weight: 500; transition: background var(--vz-dur) var(--vz-ease), border-color var(--vz-dur), transform var(--vz-dur) var(--vz-ease);
    white-space: nowrap;
  }
  .btn:hover { background: var(--vz-surface-hover); }
  .btn:active { transform: scale(.97); }
  .btn.primary { background: var(--vz-accent); color: var(--vz-on-accent); border-color: transparent; }
  .btn.primary:hover { filter: brightness(1.06); }
  .btn.danger { color: var(--vz-danger); }
  .btn.danger.primary { background: var(--vz-danger); color: #fff; }
  .btn.ghost { background: transparent; border-color: transparent; }
  .btn.ghost:hover { background: var(--vz-surface-hover); }
  .btn[disabled] { opacity: .5; cursor: default; }
  .icon-btn {
    display: inline-grid; place-items: center; width: 30px; height: 30px; border-radius: 50%;
    border: 0; background: transparent; color: var(--vz-text-2); cursor: pointer; transition: background var(--vz-dur), color var(--vz-dur), transform var(--vz-dur) var(--vz-ease);
  }
  .icon-btn:active:not([disabled]) { transform: scale(.92); }
  .icon-btn:hover:not([disabled]) { background: var(--vz-surface-hover); color: var(--vz-text); }
  .icon-btn:active:not([disabled]) { background: var(--vz-surface-active); }
  .icon-btn[disabled] { opacity: .35; cursor: default; }
  .icon-btn.on { color: var(--vz-accent); background: var(--vz-accent-soft); }
  /* Fields: soft filled pills; focus tints the border and adds one soft ring (no outline on top). */
  input[type=text], input[type=search], input[type=password], input[type=url], input[type=email], input[type=number], textarea, select {
    font: inherit; color: var(--vz-text); background: var(--vz-omnibox); border: 1px solid transparent;
    border-radius: 12px; padding: 7px 14px; min-height: 36px; outline: none; transition: border-color var(--vz-dur), box-shadow var(--vz-dur), background var(--vz-dur);
  }
  input[type=text], input[type=search], input[type=password], input[type=url], input[type=email], input[type=number] { border-radius: 999px; }
  input:hover, textarea:hover, select:hover { background: var(--vz-omnibox-hover); }
  input:focus, textarea:focus, select:focus { background: var(--vz-bg-elev); border-color: var(--vz-accent); box-shadow: 0 0 0 3px color-mix(in srgb, var(--vz-accent) 18%, transparent); }
  input:focus-visible, textarea:focus-visible, select:focus-visible { outline: none; }
  input::placeholder, textarea::placeholder { color: var(--vz-text-3); }
  /* Fields that live inside a composite control (composer, Command Bar, find bar) draw nothing themselves. */
  .bare, .bare:hover, .bare:focus { background: transparent !important; border: 0 !important; box-shadow: none !important; padding: 0; min-height: 0; }
  input[type=checkbox], input[type=radio] {
    appearance: none; width: 18px; height: 18px; margin: 0; flex: none; cursor: pointer; display: inline-grid; place-items: center;
    border: 1.5px solid var(--vz-border-strong); background: var(--vz-bg-elev); transition: background var(--vz-dur), border-color var(--vz-dur), transform var(--vz-dur) var(--vz-ease);
  }
  input[type=checkbox] { border-radius: 6px; }
  input[type=radio] { border-radius: 50%; }
  input[type=checkbox]:checked, input[type=radio]:checked { background: var(--vz-accent); border-color: var(--vz-accent); }
  input[type=checkbox]::after { content: ''; width: 9px; height: 5px; border: 2px solid var(--vz-on-accent); border-top: 0; border-right: 0; transform: translateY(-1px) rotate(-45deg) scale(0); transition: transform var(--vz-dur) var(--vz-ease); }
  input[type=checkbox]:checked::after { transform: translateY(-1px) rotate(-45deg) scale(1); }
  input[type=radio]::after { content: ''; width: 8px; height: 8px; border-radius: 50%; background: var(--vz-on-accent); transform: scale(0); transition: transform var(--vz-dur) var(--vz-ease); }
  input[type=radio]:checked::after { transform: scale(1); }
  input[type=checkbox]:active, input[type=radio]:active { transform: scale(.9); }
  input[type=checkbox]:focus-visible, input[type=radio]:focus-visible { outline: 2px solid var(--vz-focus); outline-offset: 2px; }
  input[type=range] { appearance: none; height: 6px; border-radius: 999px; background: var(--vz-surface-active); accent-color: var(--vz-accent); cursor: pointer; }
  input[type=range]::-webkit-slider-thumb { appearance: none; width: 18px; height: 18px; border-radius: 50%; background: var(--vz-bg-elev); border: 2px solid var(--vz-accent); transition: transform var(--vz-dur) var(--vz-ease); }
  input[type=range]:active::-webkit-slider-thumb { transform: scale(1.15); }
  .muted { color: var(--vz-text-2); }
  .faint { color: var(--vz-text-3); }
  .sr-only { position: absolute; width: 1px; height: 1px; overflow: hidden; clip: rect(0 0 0 0); white-space: nowrap; }
  .chip { display: inline-flex; align-items: center; gap: 4px; padding: 2px 8px; border-radius: 999px; font-size: var(--vz-text-xs); font-weight: 600; background: var(--vz-surface-2); color: var(--vz-text-2); }
  .kbd { font-family: var(--vz-font-mono); font-size: 10.5px; padding: 1px 5px; border-radius: 4px; border: 1px solid var(--vz-border); color: var(--vz-text-3); background: var(--vz-surface-2); }
  @keyframes vz-spin { to { transform: rotate(360deg); } }
  /* Entrance: rise + fade. Stagger with style="--i:<n>". */
  @keyframes vz-rise { from { opacity: 0; transform: translateY(8px) scale(.98); } }
  .rise { animation: vz-rise 380ms var(--vz-ease) both; animation-delay: calc(var(--i, 0) * 40ms); }
  .spin { animation: vz-spin 0.9s linear infinite; }
  @media (prefers-reduced-motion: reduce) { * { animation-duration: 0.001s !important; transition-duration: 0.001s !important; } }
  :host-context([data-theme=high-contrast]) .btn, :host-context([data-theme=high-contrast]) .icon-btn { border: 1px solid var(--vz-border); }
`;

/** Styles for full vizulla:// pages in tabs. */
export const pageStyles = css`
  :host { display: block; min-height: 100vh; background: var(--vz-bg); }
  .page { max-width: 920px; margin: 0 auto; padding: 40px 28px 80px; }
  /* Small windows: tighter gutters, rows wrap, nothing wider than the viewport. */
  @media (max-width: 600px) {
    .page { padding: 24px 16px 56px; }
    header.page-head { flex-wrap: wrap; }
    header.page-head h1 { font-size: var(--vz-text-xl); }
    .section { padding: 14px 16px; }
    .row { flex-wrap: wrap; }
    input, select, textarea { max-width: 100%; }
  }
  header.page-head { display: flex; align-items: center; gap: 12px; margin-bottom: 24px; }
  header.page-head h1 { font-size: var(--vz-text-2xl); font-weight: 700; letter-spacing: -0.02em; margin: 0; flex: 1; }
  .card { background: var(--vz-bg-elev); border: 1px solid var(--vz-border); border-radius: var(--vz-radius-l); }
  .card + .card { margin-top: 16px; }
  .card h2 { font-size: var(--vz-text-l); margin: 0 0 4px; font-weight: 650; }
  .section { padding: 18px 20px; }
  .section + .section { border-top: 1px solid var(--vz-border); }
  .row { display: flex; align-items: center; gap: 12px; min-height: 40px; }
  .row .grow { flex: 1; min-width: 0; }
  .row .title { font-weight: 550; }
  .row .desc { color: var(--vz-text-2); font-size: var(--vz-text-s); margin-top: 2px; }
  .list-item { display: flex; align-items: center; gap: 12px; padding: 8px 12px; border-radius: var(--vz-radius); }
  .list-item:hover { background: var(--vz-surface-hover); }
  .list-item img, .favicon { width: 16px; height: 16px; border-radius: 3px; flex: none; }
  .ellipsis { white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
  .empty { text-align: center; color: var(--vz-text-3); padding: 48px 0; }
  a { color: var(--vz-accent); }
`;
