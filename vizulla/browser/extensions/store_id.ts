/** Extension ID from a Chrome Web Store link (old or new store) or a bare 32-letter ID. */
export function parseStoreId(input: string): string | null {
  const s = input.trim();
  if (/^[a-p]{32}$/.test(s)) return s;
  try {
    const u = new URL(s);
    if (!/^(chromewebstore\.google\.com|chrome\.google\.com)$/.test(u.hostname)) return null;
    const m = /\/([a-p]{32})(?:[/?#]|$)/.exec(u.pathname);
    return m ? m[1]! : null;
  } catch {
    return null;
  }
}
