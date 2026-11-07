// Egress content matching (P6-SEC-01, C7b): before a navigation or submit, scan
// the outgoing URL and body for private values that belong to other origins
// (profile fields, Memory, vault usernames). A match blocks and asks the user.
export interface PrivateValue {
  value: string;
  /** Origins allowed to receive it (e.g. the site the user approved in the plan). */
  allowedOrigins: string[];
  label: string;
}

function variants(v: string): string[] {
  const base = v.trim();
  const out = new Set([base, base.toLowerCase(), encodeURIComponent(base), encodeURIComponent(base).replace(/%20/g, '+')]);
  const digits = base.replace(/\D/g, '');
  if (digits.length >= 7) out.add(digits);
  try {
    out.add(Buffer.from(base).toString('base64').replace(/=+$/, ''));
  } catch {
    /* ignore */
  }
  return [...out].filter((x) => x.length >= 4);
}

export function scanEgress(destOrigin: string, url: string, body: string, values: PrivateValue[]): PrivateValue[] {
  const hay = `${url}\n${body}`;
  const lower = hay.toLowerCase();
  const digits = hay.replace(/\D/g, '');
  return values.filter((pv) => {
    if (pv.allowedOrigins.includes(destOrigin)) return false;
    return variants(pv.value).some((v) => lower.includes(v.toLowerCase()) || (/^\d+$/.test(v) && v.length >= 7 && digits.includes(v)));
  });
}
