import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { PrefsService } from './prefs_service';

const file = (data?: object) => {
  const path = join(mkdtempSync(join(tmpdir(), 'vz-prefs-')), 'prefs.json');
  if (data) writeFileSync(path, JSON.stringify(data));
  return path;
};

describe('PrefsService migrations', () => {
  it('moves side tabs from older builds back on top, once', () => {
    const path = file({ 'tabs.layout': 'vertical', 'tabs.sidebarCollapsed': true, 'appearance.theme': 'dark' });
    const p = new PrefsService(path);
    expect(p.get('tabs.layout')).toBe('horizontal');
    expect(p.get('tabs.sidebarCollapsed')).toBe(false);
    expect(p.get('appearance.theme')).toBe('dark');
    p.flush();
    expect(JSON.parse(readFileSync(path, 'utf8'))['prefs.version']).toBe(1);
    // Choosing side tabs again afterwards sticks.
    p.set('tabs.layout', 'vertical');
    p.flush();
    expect(new PrefsService(path).get('tabs.layout')).toBe('vertical');
  });

  it('leaves new profiles and current files alone', () => {
    expect(new PrefsService(file()).get('prefs.version')).toBe(1);
    const p = new PrefsService(file({ 'prefs.version': 1, 'tabs.layout': 'vertical' }));
    expect(p.get('tabs.layout')).toBe('vertical');
  });
});
