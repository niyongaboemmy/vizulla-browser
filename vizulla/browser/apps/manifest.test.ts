import { describe, expect, it } from 'vitest';
import { bestIcon, inScope, notInstallable, parseManifest, shortcutName } from './manifest';

const doc = 'https://app.example.com/inbox/today?x=1';
const mf = 'https://app.example.com/static/manifest.webmanifest';
const parse = (o: unknown) => parseManifest(JSON.stringify(o), mf, doc);

describe('parseManifest', () => {
  it('resolves URLs against the manifest and fills spec defaults', () => {
    const m = parse({ name: 'Tasks', start_url: '../app/?src=pwa', icons: [{ src: 'icon-512.png', sizes: '512x512', type: 'image/png' }], display: 'standalone', theme_color: '#123456' })!;
    expect(m.startUrl).toBe('https://app.example.com/app/?src=pwa');
    expect(m.scope).toBe('https://app.example.com/app/');
    expect(m.id).toBe('https://app.example.com/app/?src=pwa');
    expect(m.icons[0]).toEqual({ src: 'https://app.example.com/static/icon-512.png', sizes: [512], type: 'image/png', purpose: ['any'] });
    expect(m.themeColor).toBe('#123456');
    expect(m.shortName).toBe('Tasks');
  });

  it('ignores a start URL or id on another origin, and a scope that excludes the start URL', () => {
    const m = parse({ name: 'X', start_url: 'https://evil.example/', scope: '/admin/', id: 'https://evil.example/id', icons: [] })!;
    expect(m.startUrl).toBe('https://app.example.com/inbox/today?x=1');
    expect(m.scope).toBe('https://app.example.com/inbox/');
    expect(m.id).toBe(m.startUrl);
  });

  it('uses short_name when name is missing; rejects non-JSON and non-objects', () => {
    expect(parse({ short_name: 'Short' })!.name).toBe('Short');
    expect(parseManifest('not json', mf, doc)).toBeNull();
    expect(parseManifest('[1,2]', mf, doc)).toBeNull();
  });

  it('drops unsafe colours and icon URLs', () => {
    const m = parse({ name: 'X', theme_color: 'red; background:url(x)', icons: [{ src: 'javascript:alert(1)' }, { src: 'ok.png' }] })!;
    expect(m.themeColor).toBeNull();
    expect(m.icons.map((i) => i.src)).toEqual(['https://app.example.com/static/ok.png']);
  });
});

describe('installability', () => {
  const icons = [{ src: 'i.png', sizes: '192x192' }];
  it('needs a name, an icon and a windowed display mode', () => {
    expect(notInstallable(null)).toBe('no-manifest');
    expect(notInstallable(parse({ icons, display: 'standalone' }))).toBe('no-name');
    expect(notInstallable(parse({ name: 'A', display: 'standalone' }))).toBe('no-icon');
    expect(notInstallable(parse({ name: 'A', icons }))).toBe('browser-display');
    expect(notInstallable(parse({ name: 'A', icons, display: 'minimal-ui' }))).toBeNull();
  });
});

describe('bestIcon', () => {
  it('prefers a regular raster icon that is big enough, maskable only as a last resort', () => {
    const m = parse({
      name: 'A',
      icons: [
        { src: 'm.png', sizes: '512x512', purpose: 'maskable' },
        { src: 'small.png', sizes: '96x96' },
        { src: 'big.png', sizes: '1024x1024' },
        { src: 'ok.png', sizes: '512x512' },
      ],
    })!;
    expect(bestIcon(m.icons)!.src).toMatch(/ok\.png$/);
    expect(bestIcon(parse({ name: 'A', icons: [{ src: 'm.png', sizes: '512x512', purpose: 'maskable' }] })!.icons)!.src).toMatch(/m\.png$/);
    expect(bestIcon([])).toBeNull();
  });
});

describe('helpers', () => {
  it('keeps navigation in scope and names shortcuts safely', () => {
    expect(inScope('https://app.example.com/app/x', 'https://app.example.com/app/')).toBe(true);
    expect(inScope('https://app.example.com/other', 'https://app.example.com/app/')).toBe(false);
    expect(inScope('https://evil.example/app/', 'https://app.example.com/app/')).toBe(false);
    expect(shortcutName('My App: Tasks / Today')).toBe('My App Tasks Today');
    expect(shortcutName('***')).toBe('Web App');
  });
});
