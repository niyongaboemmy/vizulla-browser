// Link privacy (Shields): Clean Links strips click-tracking parameters and skips
// known redirect hops before the page loads. Pure functions: no Electron,
// unit-tested in link_privacy.test.ts.

/** Parameters that only identify the click or the campaign: removing them never changes the page. */
const TRACKING_PARAMS = new Set([
  'fbclid', 'gclid', 'gclsrc', 'dclid', 'gbraid', 'wbraid', 'msclkid', 'yclid', 'twclid', 'ttclid', 'li_fat_id', 'igshid', 'igsh',
  'mc_cid', 'mc_eid', 'mkt_tok', '_hsenc', '_hsmi', '__hssc', '__hstc', '__hsfp', 'hsctatracking', 'oly_anon_id', 'oly_enc_id',
  'vero_id', 'vero_conv', 'rb_clickid', 's_cid', 'ml_subscriber', 'ml_subscriber_hash', 'srsltid', 'epik', 'scid', 'sc_cid',
  'ss_email_id', 'wickedid', 'irclickid', '_openstat', 'zanpid', 'cvid', 'oicd', 'gad_source', 'gad_campaignid',
]);
/** Prefix families: utm_source, utm_medium … and Piwik/Matomo's pk_campaign … */
const TRACKING_PREFIXES = ['utm_', 'pk_', 'mtm_', 'hsa_'];

/** Redirect hops that carry the real destination in a query parameter. */
const REDIRECTORS: { host: RegExp; path: RegExp; param: string }[] = [
  { host: /^(www\.)?google\.[a-z.]+$/, path: /^\/url$/, param: 'q' },
  { host: /^(www\.)?google\.[a-z.]+$/, path: /^\/url$/, param: 'url' },
  { host: /^(l|lm)\.facebook\.com$/, path: /^\/l\.php$/, param: 'u' },
  { host: /^l\.instagram\.com$/, path: /^\/$/, param: 'u' },
  { host: /^l\.messenger\.com$/, path: /^\/l\.php$/, param: 'u' },
  { host: /^out\.reddit\.com$/, path: /^\//, param: 'url' },
  { host: /^(www\.)?youtube\.com$/, path: /^\/redirect$/, param: 'q' },
  { host: /^steamcommunity\.com$/, path: /^\/linkfilter\/?$/, param: 'url' },
  { host: /^click\.linksynergy\.com$/, path: /^\//, param: 'murl' },
  { host: /^(www\.)?linkedin\.com$/, path: /^\/redir\/redirect\/?$/, param: 'url' },
];

function isTrackingParam(name: string): boolean {
  const n = name.toLowerCase();
  return TRACKING_PARAMS.has(n) || TRACKING_PREFIXES.some((p) => n.startsWith(p));
}

/**
 * The URL to load instead, or null when it's already clean. Idempotent:
 * cleanUrl(cleanUrl(x)) is null, so a redirect never loops.
 */
export function cleanUrl(url: string): string | null {
  let u: URL;
  try {
    u = new URL(url);
  } catch {
    return null;
  }
  if (u.protocol !== 'http:' && u.protocol !== 'https:') return null;
  for (const r of REDIRECTORS) {
    if (!r.host.test(u.hostname) || !r.path.test(u.pathname)) continue;
    const dest = u.searchParams.get(r.param);
    if (dest && /^https?:\/\//i.test(dest)) return cleanUrl(dest) ?? dest;
  }
  if (!u.search) return null;
  const keep = [...u.searchParams].filter(([k]) => !isTrackingParam(k));
  if (keep.length === [...u.searchParams].length) return null;
  u.search = new URLSearchParams(keep).toString();
  return u.href;
}
