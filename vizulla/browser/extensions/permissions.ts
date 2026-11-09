// Kept free of Electron imports so it can be unit-tested.
/** Human-readable permission lines for the install prompt (Chrome's wording). */
export function describePermissions(m: chrome.runtime.Manifest): string[] {
  const perms = new Set((m.permissions ?? []).filter((p): p is string => typeof p === 'string'));
  const hosts = [...((m as { host_permissions?: string[] }).host_permissions ?? []), ...(m.content_scripts ?? []).flatMap((c) => c.matches ?? [])];
  const out: string[] = [];
  if (hosts.some((h) => h === '<all_urls>' || /^\*:\/\/\*\/|^https?:\/\/\*\/\*/.test(h))) out.push('all-sites');
  else if (hosts.length) out.push(`sites:${[...new Set(hosts.map((h) => h.replace(/^\*:\/\/|^https?:\/\//, '').replace(/\/.*$/, '')))].slice(0, 4).join(', ')}`);
  for (const p of ['tabs', 'history', 'bookmarks', 'cookies', 'downloads', 'clipboardRead', 'clipboardWrite', 'notifications', 'webRequest', 'declarativeNetRequest'])
    if (perms.has(p)) out.push(p);
  return out;
}
