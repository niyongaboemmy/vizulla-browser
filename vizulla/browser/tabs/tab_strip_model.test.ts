import { beforeEach, describe, expect, it } from 'vitest';
import { TabStripModel } from './tab_strip_model';

let m: TabStripModel;
let clock = 0;
const add = (id: number, spaceId = 'work', extra: Partial<{ pinned: boolean; afterId: number; activate: boolean; openerId: number }> = {}) =>
  m.add({ id, spaceId, openerId: extra.openerId ?? null, pinned: extra.pinned ?? false }, { afterId: extra.afterId, activate: extra.activate });
const ids = (space?: string) => m.visible(space).map((t) => t.id);

beforeEach(() => {
  clock = 1000;
  m = new TabStripModel('work', () => ++clock);
});

describe('TabStripModel (DD-1)', () => {
  it('lists pinned first, keeps per-Space active tab', () => {
    add(1);
    add(2, 'work', { activate: true });
    add(3, 'work', { pinned: true });
    add(10, 'study');
    expect(ids()).toEqual([3, 1, 2]);
    expect(m.activeTabId).toBe(2);
    m.switchSpace('study');
    expect(m.activeTabId).toBe(10);
    expect(ids()).toEqual([10]);
    m.switchSpace('work');
    expect(m.activeTabId).toBe(2);
  });

  it('cycling skips tabs of other Spaces (Ctrl+Tab)', () => {
    add(1);
    add(2);
    add(10, 'study');
    add(3);
    m.activate(1);
    expect(m.cycle(1)).toBe(2);
    expect(m.cycle(1)).toBe(3);
    expect(m.cycle(1)).toBe(1);
    expect(m.cycle(-1)).toBe(3);
    expect(m.activeSpaceId).toBe('work');
  });

  it('closing the active tab activates the opener, else the right neighbour', () => {
    add(1);
    add(2);
    add(3);
    add(4, 'work', { afterId: 1, openerId: 1, activate: true });
    expect(ids()).toEqual([1, 4, 2, 3]);
    expect(m.remove(4)).toBe(1);
    m.activate(2);
    expect(m.remove(2)).toBe(3);
    expect(m.remove(3)).toBe(1);
    expect(m.remove(1)).toBeNull();
    expect(m.activeTabId).toBeNull();
  });

  it('activating a tab in another Space switches Space', () => {
    add(1);
    add(10, 'study');
    m.activate(10);
    expect(m.activeSpaceId).toBe('study');
  });

  it('moves tabs to another Space and repairs the old active tab', () => {
    add(1);
    add(2, 'work', { activate: true });
    m.moveToSpace(2, 'study');
    expect(ids('work')).toEqual([1]);
    expect(m.activeTabId).toBe(1);
    expect(ids('study')).toEqual([2]);
    expect(m.activeForSpace('study')).toBe(2);
  });

  it('groups are contiguous, links open inside the opener group, empty groups vanish', () => {
    add(1);
    add(2);
    add(3);
    const g = m.createGroup([1, 3], 'Research', 'teal')!;
    expect(ids()).toEqual([1, 3, 2]);
    add(4, 'work', { afterId: 1, openerId: 1 });
    expect(ids()).toEqual([1, 4, 3, 2]);
    expect(m.get(4)!.groupId).toBe(g);
    m.remove(1);
    m.remove(3);
    m.remove(4);
    expect(m.groupList()).toHaveLength(0);
  });

  it('drag into the pinned zone pins; out of it unpins', () => {
    add(1, 'work', { pinned: true });
    add(2);
    add(3);
    m.move(3, 0);
    expect(m.get(3)!.pinned).toBe(true);
    expect(ids()).toEqual([3, 1, 2]);
    m.move(3, 2);
    expect(m.get(3)!.pinned).toBe(false);
    expect(ids()).toEqual([1, 2, 3]);
  });

  it('selectIndex is Chrome-compatible (9 = last)', () => {
    [1, 2, 3, 4].forEach((i) => add(i));
    expect(m.selectIndex(2)).toBe(2);
    expect(m.selectIndex(9)).toBe(4);
    expect(m.selectIndex(7)).toBeNull();
  });

  it('survives 2,000 random operations without losing a tab', () => {
    const spaces = ['a', 'b', 'c'];
    m = new TabStripModel('a');
    let next = 1;
    const live = new Set<number>();
    let seed = 42;
    const rnd = (n: number) => ((seed = (seed * 1103515245 + 12345) % 2 ** 31), seed % n);
    for (let i = 0; i < 2000; i++) {
      const op = rnd(7);
      const any = [...live][rnd(Math.max(1, live.size))];
      if (op <= 1 || live.size === 0) {
        const id = next++;
        m.add({ id, spaceId: spaces[rnd(3)]!, openerId: null }, { activate: rnd(2) === 0 });
        live.add(id);
      } else if (op === 2 && any !== undefined) {
        m.remove(any);
        live.delete(any);
      } else if (op === 3 && any !== undefined) m.moveToSpace(any, spaces[rnd(3)]!);
      else if (op === 4 && any !== undefined) m.move(any, rnd(10));
      else if (op === 5) m.switchSpace(spaces[rnd(3)]!);
      else if (op === 6 && any !== undefined) m.setPinned(any, rnd(2) === 0);
      const all = spaces.flatMap((s) => m.visible(s).map((t) => t.id));
      expect(new Set(all).size).toBe(live.size);
      for (const s of spaces) {
        const active = m.activeForSpace(s);
        if (m.visible(s).length) expect(m.visible(s).some((t) => t.id === active)).toBe(true);
      }
    }
  });
});
