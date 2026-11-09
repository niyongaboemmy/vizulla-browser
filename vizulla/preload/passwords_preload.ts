// Password manager, page side (top frame of web pages, isolated world). Tells the
// browser whether the page has a login form, reports a submitted username and
// password so the browser can offer to save them, and fills an account the user
// picked from the key button. The browser checks the frame and origin of every
// message; nothing here is reachable from page scripts.
import { ipcRenderer } from 'electron';

if (/^https?:$/.test(location.protocol) && window.top === window) {
  const USERNAME_HINT = /user|login|e-?mail|mail|phone|account|identifier|^id$/i;

  const visible = (el: HTMLElement) => {
    const r = el.getBoundingClientRect();
    return r.width > 0 && r.height > 0 && getComputedStyle(el).visibility !== 'hidden';
  };
  const passwordFields = (scope: ParentNode = document) =>
    [...scope.querySelectorAll<HTMLInputElement>('input[type=password]')].filter((f) => !f.disabled && visible(f));

  /** The username is the closest text-like field before the password, preferring explicit hints. */
  const usernameField = (pw: HTMLInputElement): HTMLInputElement | null => {
    const scope = pw.form ?? document;
    const fields = [...scope.querySelectorAll<HTMLInputElement>('input')].filter(
      (f) => ['text', 'email', 'tel', ''].includes(f.type) && !f.disabled && visible(f) && pw.compareDocumentPosition(f) & Node.DOCUMENT_POSITION_PRECEDING,
    );
    const hinted = fields.filter((f) => /username|email/.test(f.autocomplete) || USERNAME_HINT.test(`${f.name} ${f.id} ${f.getAttribute('aria-label') ?? ''}`));
    return hinted.at(-1) ?? fields.at(-1) ?? null;
  };

  let lastForm = '';
  const report = () => {
    const fields = passwordFields();
    const state = JSON.stringify({ form: fields.length > 0, newPassword: fields.some((f) => f.autocomplete === 'new-password') || fields.length >= 2 });
    if (state === lastForm) return;
    lastForm = state;
    ipcRenderer.send('vz:pw-form', JSON.parse(state));
  };

  let lastSent = '';
  let lastAt = 0;
  const capture = (scope: ParentNode) => {
    const filled = passwordFields(scope).filter((f) => f.value);
    if (!filled.length) return;
    // Sign-up and change-password forms put the new password last.
    const password = filled.at(-1)!.value;
    const username = usernameField(filled[0]!)?.value.trim() ?? '';
    const key = `${username}\u0000${password}`;
    if (key === lastSent && Date.now() - lastAt < 3000) return;
    lastSent = key;
    lastAt = Date.now();
    ipcRenderer.send('vz:pw-submit', { username: username.slice(0, 256), password: password.slice(0, 1024) });
  };

  document.addEventListener('submit', (e) => capture(e.target as HTMLFormElement), true);
  document.addEventListener('keydown', (e) => {
    const t = e.target as HTMLInputElement;
    if (e.key === 'Enter' && t instanceof HTMLInputElement && (t.type === 'password' || t.form?.querySelector('input[type=password]'))) capture(t.form ?? document);
  }, true);
  // Script-driven logins (no real submit): a click on a submit-looking button next to a password.
  document.addEventListener('click', (e) => {
    const b = (e.target as Element).closest?.('button, input[type=submit], [role=button]');
    if (b && passwordFields(b.closest('form') ?? document).some((f) => f.value)) capture(b.closest('form') ?? document);
  }, true);

  const setValue = (el: HTMLInputElement, value: string) => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(el, value);
    el.dispatchEvent(new Event('input', { bubbles: true }));
    el.dispatchEvent(new Event('change', { bubbles: true }));
  };

  ipcRenderer.on('vz:pw-fill', (_e, d: { username?: string; password: string; generated?: boolean }) => {
    const fields = passwordFields();
    if (!fields.length) return;
    if (d.generated) {
      const targets = fields.filter((f) => f.autocomplete === 'new-password');
      for (const f of targets.length ? targets : fields.filter((f) => !f.value)) setValue(f, d.password);
      return;
    }
    const pw = fields[0]!;
    const user = usernameField(pw);
    if (user && d.username) setValue(user, d.username);
    setValue(pw, d.password);
    pw.focus();
  });

  let timer = 0;
  const schedule = () => {
    clearTimeout(timer);
    timer = window.setTimeout(report, 400);
  };
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', report, { once: true });
  else report();
  window.addEventListener('load', schedule, { once: true });
  // Only inserted elements matter (forms that appear later). Watching attributes too made
  // heavy web apps, which restyle constantly, call this on nearly every frame.
  new MutationObserver((records) => {
    for (const r of records) {
      for (const n of r.addedNodes) {
        if (n.nodeType === 1 && ((n as Element).tagName === 'INPUT' || (n as Element).firstElementChild)) return schedule();
      }
    }
  }).observe(document, { subtree: true, childList: true });
  // A password field that was there but hidden, or switched from type=text, shows up on focus.
  document.addEventListener('focusin', (e) => (e.target as HTMLInputElement | null)?.type === 'password' && schedule(), true);
}
