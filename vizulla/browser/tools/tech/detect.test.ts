import { describe, expect, it } from 'vitest';
import { detect, probeTargets, type Evidence } from './detect';

const ev = (p: Partial<Evidence>): Evidence => ({ url: 'https://x.example/', headers: {}, cookies: [], meta: {}, js: {}, scripts: [], resources: [], dom: {}, html: '', ...p });
const names = (d: ReturnType<typeof detect>) => d.map((x) => x.name);

describe('tech detection', () => {
  it('finds a Next.js site on Vercel behind Cloudflare, with versions', () => {
    const d = detect(ev({
      headers: { 'x-vercel-id': 'cdg1::abc', server: 'cloudflare', 'x-powered-by': 'Next.js 15.1.0' },
      js: { __NEXT_DATA__: true, 'React.version': '19.0.0' },
      resources: ['https://x.example/_next/static/chunks/main.js'],
      html: '<div class="flex items-center gap-4 px-6 md:flex-row">',
    }));
    expect(names(d)).toEqual(expect.arrayContaining(['Next.js', 'React', 'Vercel', 'Cloudflare', 'Tailwind CSS']));
    expect(d.find((x) => x.name === 'Next.js')).toMatchObject({ confidence: 'certain', version: '15.1.0' });
    expect(d.find((x) => x.name === 'React')?.version).toBe('19.0.0');
    expect(d.find((x) => x.name === 'Tailwind CSS')?.confidence).toBe('likely');
  });

  it('finds WordPress with WooCommerce and implies PHP', () => {
    const d = detect(ev({ meta: { generator: 'WordPress 6.6.2' }, resources: ['https://x.example/wp-content/plugins/woocommerce/a.js'], js: { woocommerce_params: true }, headers: { server: 'nginx/1.25.3' } }));
    expect(d.find((x) => x.name === 'WordPress')?.version).toBe('6.6.2');
    expect(names(d)).toEqual(expect.arrayContaining(['WooCommerce', 'PHP', 'Nginx']));
    expect(d.find((x) => x.name === 'Nginx')?.version).toBe('1.25.3');
  });

  it('reads cookies and back-end markers, and stays quiet on a plain page', () => {
    expect(names(detect(ev({ cookies: ['csrftoken', 'sessionid'] })))).toEqual(expect.arrayContaining(['Django', 'Python']));
    expect(detect(ev({ html: '<p>Hello</p>' }))).toEqual([]);
  });

  it('collects every global and selector the rules need', () => {
    const t = probeTargets();
    expect(t.js).toContain('jQuery.fn.jquery');
    expect(t.dom).toContain('#__next');
  });
});
