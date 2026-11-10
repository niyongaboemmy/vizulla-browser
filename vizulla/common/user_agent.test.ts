import { describe, expect, it } from 'vitest';
import { webUserAgent } from './user_agent';

describe('web user agent', () => {
  it('is Chrome’s, without the Electron and app tokens sign-in providers refuse', () => {
    const electron = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Vizulla/0.4.7 Chrome/156.0.8078.80 Electron/45.2.3 Safari/537.36';
    expect(webUserAgent(electron)).toBe('Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/156.0.8078.80 Safari/537.36');
    const win = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) vizulla/0.4.7 Chrome/156.0.8078.80 Electron/45.2.3 Safari/537.36';
    expect(webUserAgent(win)).not.toMatch(/Electron|vizulla/i);
    expect(webUserAgent(webUserAgent(electron))).toBe(webUserAgent(electron));
  });
});
