import { describe, expect, it } from 'vitest';
import { classifyInput, displayUrl, engineName, isValidEngineTemplate, searchUrl, securityStateOf, setCustomEngine, siteOf } from './url';

const nav = (input: string) => {
  const r = classifyInput(input);
  return r.route === 'navigate' ? r.url : `<${r.route}>`;
};

describe('classifyInput (P2-BRW-12)', () => {
  it.each([
    ['example.com', 'https://example.com/'],
    ['irembo.gov.rw', 'https://irembo.gov.rw/'],
    ['www.bbc.co.uk/news', 'https://www.bbc.co.uk/news'],
    ['localhost:3000', 'http://localhost:3000/'],
    ['localhost', 'http://localhost/'],
    ['127.0.0.1:8080/api', 'http://127.0.0.1:8080/api'],
    ['192.168.1.1', 'http://192.168.1.1/'],
    ['[::1]:9000', 'http://[::1]:9000/'],
    ['https://example.com/a b', 'https://example.com/a%20b'],
    ['http://neverssl.com', 'http://neverssl.com/'],
    ['vizulla://settings', 'vizulla://settings'],
    ['file:///etc/hosts', 'file:///etc/hosts'],
    ['café.fr', 'https://xn--caf-dma.fr/'],
    ['xn--caf-dma.fr', 'https://xn--caf-dma.fr/'],
    ['example.com?q=1', 'https://example.com/?q=1'],
    ['news.ycombinator.com/item?id=1', 'https://news.ycombinator.com/item?id=1'],
    ['mtn.co.rw', 'https://mtn.co.rw/'],
  ])('navigates %s', (input, url) => expect(nav(input)).toBe(url));

  it.each([
    'how to cook isombe',
    'readme.txt',
    'weather',
    'kigali',
    'what is example.com',
    'javascript:alert(1)',
    'localhost:99999',
    '1.2.3',
    'node.jsx',
    'C++ templates',
  ])('searches %s', (input) => expect(nav(input)).toBe('<search>'));

  it('routes > to commands and ? to ask', () => {
    expect(classifyInput('> new space')).toEqual({ route: 'command', text: 'new space' });
    expect(classifyInput('?what does the pro plan include')).toEqual({ route: 'ask', text: 'what does the pro plan include' });
    expect(classifyInput('   ')).toEqual({ route: 'empty' });
  });

  it('is fast: p95 well under 5 ms', () => {
    const inputs = ['example.com', 'how to cook', 'localhost:3000', '> mute', 'a.b.c.d.e.f.rw/x?y#z'];
    const times: number[] = [];
    for (let i = 0; i < 2000; i++) {
      const t = performance.now();
      classifyInput(inputs[i % inputs.length]!);
      times.push(performance.now() - t);
    }
    times.sort((a, b) => a - b);
    expect(times[Math.floor(times.length * 0.95)]!).toBeLessThan(5);
  });
});

describe('displayUrl (URL display is security UI)', () => {
  it('drops https and lone slash', () => {
    expect(displayUrl('https://example.com/')).toBe('example.com');
    expect(displayUrl('https://example.com/a/b?c=1')).toBe('example.com/a/b?c=1');
    expect(displayUrl('http://example.com/')).toBe('http://example.com');
  });
  it('shows IDNs as punycode and keeps hidden characters encoded', () => {
    expect(displayUrl('https://аpple.com/')).toBe('xn--pple-43d.com');
    expect(displayUrl('https://example.com/a%20b')).toBe('example.com/a%20b');
    expect(displayUrl('https://example.com/%E2%80%AEgpj.exe')).toContain('%E2%80%AE');
  });
  it('hides the new tab page URL', () => expect(displayUrl('vizulla://newtab')).toBe(''));
});

describe('securityStateOf / siteOf', () => {
  it('classifies', () => {
    expect(securityStateOf('https://a.com')).toBe('secure');
    expect(securityStateOf('http://a.com')).toBe('insecure');
    expect(securityStateOf('http://localhost:3000')).toBe('internal');
    expect(securityStateOf('vizulla://settings')).toBe('internal');
    expect(securityStateOf('https://a.com', true)).toBe('dangerous');
  });
  it('approximates eTLD+1', () => {
    expect(siteOf('https://a.b.example.com/x')).toBe('example.com');
    expect(siteOf('https://www.irembo.gov.rw/')).toBe('irembo.gov.rw');
    expect(siteOf('https://news.bbc.co.uk/')).toBe('bbc.co.uk');
  });
});

describe('custom search engine', () => {
  it('accepts only https templates with exactly one %s', () => {
    expect(isValidEngineTemplate('https://search.example.rw/?q=%s')).toBe(true);
    expect(isValidEngineTemplate('http://search.example.rw/?q=%s')).toBe(false);
    expect(isValidEngineTemplate('https://search.example.rw/?q=')).toBe(false);
    expect(isValidEngineTemplate('https://a.rw/?q=%s&r=%s')).toBe(false);
    expect(isValidEngineTemplate('https://user:pw@a.rw/?q=%s')).toBe(false);
    expect(isValidEngineTemplate('javascript:alert(%s)')).toBe(false);
  });

  it('is used for "custom" and falls back to DuckDuckGo when unset or invalid', () => {
    setCustomEngine({ name: 'Kigali Search', url: 'https://search.example.rw/find?q=%s' });
    expect(searchUrl('custom', 'umuganda & more')).toBe('https://search.example.rw/find?q=umuganda%20%26%20more');
    expect(engineName('custom')).toBe('Kigali Search');
    setCustomEngine({ name: 'Bad', url: 'http://x.rw/?q=%s' });
    expect(searchUrl('custom', 'a')).toBe('https://duckduckgo.com/?q=a');
    setCustomEngine(null);
    expect(engineName('custom')).toBe('DuckDuckGo');
    expect(searchUrl('google', 'a b')).toBe('https://www.google.com/search?q=a%20b');
  });
});
