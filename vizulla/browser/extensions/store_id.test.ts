import { describe, expect, it } from 'vitest';
import { parseStoreId } from './store_id';
import { describePermissions } from './permissions';

describe('parseStoreId', () => {
  it('reads new and old store links and bare IDs', () => {
    expect(parseStoreId('https://chromewebstore.google.com/detail/dark-reader/eimadpbcbfnmbkopoojfekhnkhdbieeh')).toBe('eimadpbcbfnmbkopoojfekhnkhdbieeh');
    expect(parseStoreId('https://chrome.google.com/webstore/detail/ublock-origin-lite/ddkjiahejlhfcafbddmgiahcphecmpfh?hl=en')).toBe('ddkjiahejlhfcafbddmgiahcphecmpfh');
    expect(parseStoreId(' eimadpbcbfnmbkopoojfekhnkhdbieeh ')).toBe('eimadpbcbfnmbkopoojfekhnkhdbieeh');
  });
  it('rejects other sites and malformed IDs', () => {
    expect(parseStoreId('https://evil.example/detail/eimadpbcbfnmbkopoojfekhnkhdbieeh')).toBeNull();
    expect(parseStoreId('eimadpbcbfnmbkopoojfekhnkhdbiee')).toBeNull();
    expect(parseStoreId('EIMADPBCBFNMBKOPOOJFEKHNKHDBIEEH')).toBeNull();
  });
});

describe('describePermissions', () => {
  it('summarises site access and sensitive permissions', () => {
    expect(describePermissions({ name: 'x', version: '1', manifest_version: 3, host_permissions: ['<all_urls>'], permissions: ['tabs', 'storage', 'alarms'] } as never)).toEqual(['all-sites', 'tabs']);
    expect(describePermissions({ name: 'x', version: '1', manifest_version: 3, content_scripts: [{ matches: ['https://mail.google.com/*'], js: ['a.js'] }] } as never)).toEqual(['sites:mail.google.com']);
  });
});
