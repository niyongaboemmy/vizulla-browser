// Shared component styles (Lit). Everything is token-based: no raw colors.
import { css } from 'lit';

export const base = css`
  :host { font-family: var(--vz-font); color: var(--vz-text); font-size: var(--vz-text-m); -webkit-font-smoothing: antialiased; }
  *, *::before, *::after { box-sizing: border-box; }
  button { font: inherit; color: inherit; }
  .vz-icon { flex: none; display: block; }
  :focus-visible { outline: 2px solid var(--vz-focus); outline-offset: 2px; border-radius: var(--vz-radius-s); }
  .btn {
    display: inline-flex; align-items: center; justify-content: center; gap: 6px; height: 32px; padding: 0 14px;
    border-radius: 999px; border: 1px solid var(--vz-border); background: var(--vz-bg-elev);
    cursor: pointer; font-size: var(--vz-text-m); font-weight: 500; transition: background var(--vz-dur) var(--vz-ease), border-color var(--vz-dur);
    white-space: nowrap;
  }
  .btn:hover { background: var(--vz-surface-hover); }
  .btn:active { transform: translateY(0.5px); }
  .btn.primary { background: var(--vz-accent); color: var(--vz-on-accent); border-color: transparent; }
  .btn.primary:hover { filter: brightness(1.06); }
  .btn.danger { color: var(--vz-danger); }
  .btn.danger.primary { background: var(--vz-danger); color: #fff; }
  .btn.ghost { background: transparent; border-color: transparent; }
  .btn.ghost:hover { background: var(--vz-surface-hover); }
  .btn[disabled] { opacity: .5; cursor: default; }
  .icon-btn {
    display: inline-grid; place-items: center; width: 30px; height: 30px; border-radius: 50%;
    border: 0; background: transparent; color: var(--vz-text-2); cursor: pointer; transition: background var(--vz-dur), color var(--vz-dur);
  }
  .icon-btn:hover:not([disabled]) { background: var(--vz-surface-hover); color: var(--vz-text); }
  .icon-btn:active:not([disabled]) { background: var(--vz-surface-active); }
  .icon-btn[disabled] { opacity: .35; cursor: default; }
  .icon-btn.on { color: var(--vz-accent); background: var(--vz-accent-soft); }
  input[type=text], input[type=search], input[type=password], input[type=url], textarea, select {
    font: inherit; color: var(--vz-text); background: var(--vz-bg-elev); border: 1px solid var(--vz-border);
    border-radius: var(--vz-radius-s); padding: 6px 10px; outline: none; transition: border-color var(--vz-dur), box-shadow var(--vz-dur);
  }
  input:focus, textarea:focus, select:focus { border-color: var(--vz-accent); box-shadow: 0 0 0 3px color-mix(in srgb, var(--vz-accent) 22%, transparent); }
  .muted { color: var(--vz-text-2); }
  .faint { color: var(--vz-text-3); }
  .sr-only { position: absolute; width: 1px; height: 1px; overflow: hidden; clip: rect(0 0 0 0); white-space: nowrap; }
  .chip { display: inline-flex; align-items: center; gap: 4px; padding: 2px 8px; border-radius: 999px; font-size: var(--vz-text-xs); font-weight: 600; background: var(--vz-surface-2); color: var(--vz-text-2); }
  .kbd { font-family: var(--vz-font-mono); font-size: 10.5px; padding: 1px 5px; border-radius: 4px; border: 1px solid var(--vz-border); color: var(--vz-text-3); background: var(--vz-surface-2); }
  @keyframes vz-spin { to { transform: rotate(360deg); } }
  .spin { animation: vz-spin 0.9s linear infinite; }
  @media (prefers-reduced-motion: reduce) { * { animation-duration: 0.001s !important; transition-duration: 0.001s !important; } }
  :host-context([data-theme=high-contrast]) .btn, :host-context([data-theme=high-contrast]) .icon-btn { border: 1px solid var(--vz-border); }
`;

/** Styles for full vizulla:// pages in tabs. */
export const pageStyles = css`
  :host { display: block; min-height: 100vh; background: var(--vz-bg); }
  .page { max-width: 920px; margin: 0 auto; padding: 40px 28px 80px; }
  header.page-head { display: flex; align-items: center; gap: 12px; margin-bottom: 24px; }
  header.page-head h1 { font-size: var(--vz-text-2xl); font-weight: 700; letter-spacing: -0.02em; margin: 0; flex: 1; }
  .card { background: var(--vz-bg-elev); border: 1px solid var(--vz-border); border-radius: var(--vz-radius-l); box-shadow: var(--vz-shadow); }
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
