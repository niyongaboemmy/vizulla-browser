import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { SpacesService } from './spaces_service';

const tmp = () => join(mkdtempSync(join(tmpdir(), 'vz-spaces-')), 'vizulla_spaces.db');

describe('SpacesService (P2-BRW-03)', () => {
  it('starts with one Space and never deletes the last', () => {
    const s = new SpacesService(':memory:');
    expect(s.list()).toHaveLength(1);
    expect(s.remove(s.list()[0]!.id)).toBe(false);
  });

  it('CRUD + ordering + name sanitizing', () => {
    const s = new SpacesService(':memory:');
    const a = s.create({ name: '  Work\u0000 ', color: 'teal', icon: 'briefcase' });
    const b = s.create({ name: '' });
    expect(a.name).toBe('Work');
    expect(b.name).toBe('Space');
    s.reorder([b.id, a.id]);
    expect(s.list().slice(0, 2).map((x) => x.id)).toEqual([b.id, a.id]);
    s.update(a.id, { name: 'Office', color: 'rose' });
    expect(s.get(a.id)).toMatchObject({ name: 'Office', color: 'rose', icon: 'briefcase' });
    // Invalid enum values from a compromised renderer are ignored.
    s.update(a.id, { color: 'chartreuse' as never });
    expect(s.get(a.id)!.color).toBe('rose');
  });

  it('archives, restores, and purges by retention (TAB-04)', () => {
    let now = 1_000_000_000_000;
    const s = new SpacesService(':memory:', () => now);
    const space = s.list()[0]!.id;
    const id = s.archive({ spaceId: space, url: 'https://a.com/', title: 'A', favicon: null, nav: { entries: [{ url: 'https://a.com/', title: 'A' }], index: 0 } });
    now += 31 * 86_400_000;
    s.archive({ spaceId: space, url: 'https://b.com/', title: 'B', favicon: null, nav: null });
    expect(s.archiveCount()).toBe(2);
    expect(s.purgeArchive(30)).toBe(1);
    expect(s.takeArchived(id)).toBeUndefined();
    expect(s.listArchive()[0]!.title).toBe('B');
  });

  it('persists Space membership for session restore across reopen (CORE-09)', () => {
    const path = tmp();
    const s1 = new SpacesService(path);
    const work = s1.create({ name: 'Work' });
    const home = s1.list()[0]!.id;
    s1.saveWindow({
      key: 'w1', activeSpaceId: work.id, bounds: { x: 1, y: 2, width: 800, height: 600 },
      groups: [{ id: 'g1', spaceId: work.id, title: 'Research', color: 'teal', collapsed: true, aiGenerated: false }],
      tabs: [
        { spaceId: home, groupId: null, pinned: true, url: 'https://mail.example/', title: 'Mail', favicon: null, nav: null, lastActive: 1, active: true },
        { spaceId: work.id, groupId: 'g1', pinned: false, url: 'https://docs.example/', title: 'Docs', favicon: null, nav: { entries: [{ url: 'https://x/', title: 'x' }, { url: 'https://docs.example/', title: 'Docs' }], index: 1 }, lastActive: 2, active: true },
      ],
    });
    s1.close();
    const s2 = new SpacesService(path);
    const [w] = s2.loadWindows();
    expect(w!.activeSpaceId).toBe(work.id);
    expect(w!.tabs.map((t) => [t.spaceId, t.pinned, t.groupId])).toEqual([[home, true, null], [work.id, false, 'g1']]);
    expect(w!.tabs[1]!.nav!.index).toBe(1);
    expect(w!.groups[0]).toMatchObject({ title: 'Research', collapsed: true });
  });

  it('a failed write leaves the previous session intact (transactions)', () => {
    const s = new SpacesService(':memory:');
    const space = s.list()[0]!.id;
    const tab = { spaceId: space, groupId: null, pinned: false, url: 'https://a/', title: 'A', favicon: null, nav: null, lastActive: 1, active: true };
    s.saveWindow({ key: 'w', activeSpaceId: space, bounds: null, groups: [], tabs: [tab] });
    // A tab whose nav state can't be serialized throws mid-transaction.
    const bad = { ...tab, nav: { entries: [], index: 0, toJSON() { throw new Error('boom'); } } as never };
    expect(() => s.saveWindow({ key: 'w', activeSpaceId: space, bounds: null, groups: [], tabs: [tab, bad] })).toThrow('boom');
    expect(s.loadWindows()[0]!.tabs).toHaveLength(1);
  });
});
