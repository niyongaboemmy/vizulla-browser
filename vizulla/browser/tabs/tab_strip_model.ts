// One TabStripModel per window (DD-1, option A). Tabs from inactive Spaces stay in
// the model but are hidden from the strip and skipped by tab-cycling commands.
// Each Space keeps its own active tab. Pinned tabs belong to their Space and are
// listed first. Groups are contiguous runs of unpinned tabs within one Space.
import { EventEmitter } from 'node:events';
import { randomUUID } from 'node:crypto';
import type { SpaceColor } from '@vz/common/types';

export interface TabMeta {
  id: number;
  spaceId: string;
  groupId: string | null;
  pinned: boolean;
  openerId: number | null;
  lastActive: number;
}

export interface GroupMeta {
  id: string;
  spaceId: string;
  title: string;
  color: SpaceColor;
  collapsed: boolean;
  aiGenerated: boolean;
}

export interface AddOptions {
  /** Insert right after this tab (e.g. links opened from it). Defaults to the end of the Space. */
  afterId?: number;
  activate?: boolean;
  index?: number;
}

export class TabStripModel extends EventEmitter {
  private order: TabMeta[] = [];
  private readonly groups = new Map<string, GroupMeta>();
  private readonly activeBySpace = new Map<string, number>();
  private _activeSpaceId: string;

  constructor(activeSpaceId: string, private readonly now: () => number = Date.now) {
    super();
    this._activeSpaceId = activeSpaceId;
  }

  get activeSpaceId(): string {
    return this._activeSpaceId;
  }

  get activeTabId(): number | null {
    return this.activeBySpace.get(this._activeSpaceId) ?? null;
  }

  get(id: number): TabMeta | undefined {
    return this.order.find((t) => t.id === id);
  }

  all(): readonly TabMeta[] {
    return this.order;
  }

  /** Tabs of a Space in display order: pinned first, then the rest, each in model order. */
  visible(spaceId = this._activeSpaceId): TabMeta[] {
    const inSpace = this.order.filter((t) => t.spaceId === spaceId);
    return [...inSpace.filter((t) => t.pinned), ...inSpace.filter((t) => !t.pinned)];
  }

  groupList(spaceId?: string): GroupMeta[] {
    return [...this.groups.values()].filter((g) => !spaceId || g.spaceId === spaceId);
  }

  getGroup(id: string): GroupMeta | undefined {
    return this.groups.get(id);
  }

  add(meta: Omit<TabMeta, 'lastActive' | 'groupId' | 'pinned'> & Partial<Pick<TabMeta, 'groupId' | 'pinned' | 'lastActive'>>, opts: AddOptions = {}): TabMeta {
    if (this.get(meta.id)) throw new Error(`tab ${meta.id} already in model`);
    const tab: TabMeta = { groupId: null, pinned: false, lastActive: this.now(), ...meta };
    if (tab.groupId && this.groups.get(tab.groupId)?.spaceId !== tab.spaceId) tab.groupId = null;
    let pos = this.order.length;
    if (opts.afterId !== undefined) {
      const i = this.order.findIndex((t) => t.id === opts.afterId);
      if (i >= 0) {
        pos = i + 1;
        // Opened from a grouped tab: join the opener's group (like upstream).
        const opener = this.order[i]!;
        if (opener.spaceId === tab.spaceId && opener.groupId && !tab.pinned && tab.groupId === null) tab.groupId = opener.groupId;
        // A tab that doesn't join the opener's group must not split it: skip past the group.
        if (tab.groupId !== opener.groupId) {
          while (pos < this.order.length && opener.groupId && this.order[pos]!.groupId === opener.groupId) pos++;
        }
      }
    } else if (opts.index !== undefined) {
      pos = this.modelIndexForVisible(tab.spaceId, opts.index);
    }
    this.order.splice(pos, 0, tab);
    if (opts.activate || !this.activeBySpace.has(tab.spaceId)) this.setActive(tab.id);
    this.changed();
    return tab;
  }

  /** Removes a tab. Returns the tab that became active in its Space (or null). */
  remove(id: number): number | null {
    const i = this.order.findIndex((t) => t.id === id);
    if (i < 0) return null;
    const tab = this.order[i]!;
    let next: number | null = null;
    if (this.activeBySpace.get(tab.spaceId) === id) {
      next = this.pickReplacement(tab);
      if (next === null) this.activeBySpace.delete(tab.spaceId);
    }
    this.order.splice(i, 1);
    if (next !== null) this.setActive(next);
    this.pruneEmptyGroups();
    this.changed();
    return next ?? this.activeBySpace.get(tab.spaceId) ?? null;
  }

  /** Activating a tab of another Space switches to that Space. */
  activate(id: number): void {
    const tab = this.get(id);
    if (!tab) return;
    if (tab.spaceId !== this._activeSpaceId) this._activeSpaceId = tab.spaceId;
    this.setActive(id);
    this.changed();
  }

  switchSpace(spaceId: string): number | null {
    this._activeSpaceId = spaceId;
    const active = this.activeBySpace.get(spaceId);
    if (active !== undefined && this.get(active)) {
      const tab = this.get(active)!;
      tab.lastActive = this.now();
    }
    this.changed();
    return this.activeTabId;
  }

  /** Ctrl+Tab / Ctrl+Shift+Tab: cycles the active Space only. Collapsed groups are skipped like upstream. */
  cycle(offset: number): number | null {
    const list = this.visible().filter((t) => !t.groupId || !this.groups.get(t.groupId)?.collapsed || t.id === this.activeTabId);
    if (!list.length) return null;
    const i = Math.max(0, list.findIndex((t) => t.id === this.activeTabId));
    const next = list[(((i + offset) % list.length) + list.length) % list.length]!;
    this.activate(next.id);
    return next.id;
  }

  /** Ctrl+1..8 selects the nth visible tab, Ctrl+9 the last (Chrome-compatible, USE-03). */
  selectIndex(n: number): number | null {
    const list = this.visible();
    const tab = n === 9 ? list.at(-1) : list[n - 1];
    if (!tab) return null;
    this.activate(tab.id);
    return tab.id;
  }

  /** Moves a tab to a position in its Space's visible list. Pinned/unpinned zones are respected. */
  move(id: number, toVisibleIndex: number, groupId: string | null | undefined = undefined): void {
    const tab = this.get(id);
    if (!tab) return;
    const list = this.visible(tab.spaceId);
    const pinnedCount = list.filter((t) => t.pinned).length;
    let target = Math.max(0, Math.min(toVisibleIndex, list.length - 1));
    // A pinned tab dragged into the unpinned zone gets unpinned, and vice versa.
    if (tab.pinned && target >= pinnedCount) tab.pinned = false;
    else if (!tab.pinned && target < pinnedCount) tab.pinned = true;
    if (groupId !== undefined) tab.groupId = groupId && !tab.pinned && this.groups.get(groupId)?.spaceId === tab.spaceId ? groupId : null;
    if (tab.pinned) tab.groupId = null;
    this.order.splice(this.order.indexOf(tab), 1);
    const rest = this.visible(tab.spaceId);
    target = Math.min(target, rest.length);
    const anchor = rest[target];
    const pos = anchor ? this.order.indexOf(anchor) : this.lastIndexOfSpace(tab.spaceId) + 1;
    this.order.splice(pos, 0, tab);
    this.pruneEmptyGroups();
    this.changed();
  }

  setPinned(id: number, pinned: boolean): void {
    const tab = this.get(id);
    if (!tab || tab.pinned === pinned) return;
    tab.pinned = pinned;
    if (pinned) tab.groupId = null;
    this.pruneEmptyGroups();
    this.changed();
  }

  moveToSpace(id: number, spaceId: string): void {
    const tab = this.get(id);
    if (!tab || tab.spaceId === spaceId) return;
    const wasActive = this.activeBySpace.get(tab.spaceId) === id;
    const oldSpace = tab.spaceId;
    if (wasActive) {
      const next = this.pickReplacement(tab);
      if (next !== null) this.activeBySpace.set(oldSpace, next);
      else this.activeBySpace.delete(oldSpace);
    }
    this.order.splice(this.order.indexOf(tab), 1);
    tab.spaceId = spaceId;
    tab.groupId = null;
    this.order.splice(this.lastIndexOfSpace(spaceId) + 1, 0, tab);
    if (!this.activeBySpace.has(spaceId)) this.activeBySpace.set(spaceId, id);
    this.pruneEmptyGroups();
    this.changed();
  }

  createGroup(tabIds: number[], title: string, color: SpaceColor, aiGenerated = false): string | null {
    const tabs = tabIds.map((id) => this.get(id)).filter((t): t is TabMeta => !!t && !t.pinned);
    if (!tabs.length) return null;
    const spaceId = tabs[0]!.spaceId;
    const members = tabs.filter((t) => t.spaceId === spaceId);
    const id = randomUUID();
    this.groups.set(id, { id, spaceId, title, color, collapsed: false, aiGenerated });
    // Gather members contiguously at the position of the first member.
    const first = Math.min(...members.map((t) => this.order.indexOf(t)));
    const anchor = this.order[first]!;
    this.order = this.order.filter((t) => !members.includes(t) || t === anchor);
    const pos = this.order.indexOf(anchor);
    const rest = members.filter((t) => t !== anchor);
    this.order.splice(pos + 1, 0, ...rest);
    for (const t of members) t.groupId = id;
    this.pruneEmptyGroups();
    this.changed();
    return id;
  }

  updateGroup(id: string, patch: Partial<Pick<GroupMeta, 'title' | 'color' | 'collapsed'>>): void {
    const g = this.groups.get(id);
    if (!g) return;
    Object.assign(g, patch);
    this.changed();
  }

  ungroup(id: string): void {
    for (const t of this.order) if (t.groupId === id) t.groupId = null;
    this.groups.delete(id);
    this.changed();
  }

  /** Restores a group record (session restore). */
  restoreGroup(g: GroupMeta): void {
    this.groups.set(g.id, { ...g });
  }

  setActiveForSpace(spaceId: string, tabId: number): void {
    if (this.get(tabId)?.spaceId === spaceId) this.activeBySpace.set(spaceId, tabId);
  }

  activeForSpace(spaceId: string): number | null {
    return this.activeBySpace.get(spaceId) ?? null;
  }

  private setActive(id: number): void {
    const tab = this.get(id);
    if (!tab) return;
    tab.lastActive = this.now();
    this.activeBySpace.set(tab.spaceId, id);
  }

  /** The opener if it's still in the Space, else the neighbour to the right, else to the left. */
  private pickReplacement(tab: TabMeta): number | null {
    const list = this.visible(tab.spaceId);
    const i = list.findIndex((t) => t.id === tab.id);
    const opener = tab.openerId !== null ? list.find((t) => t.id === tab.openerId) : undefined;
    if (opener) return opener.id;
    return (list[i + 1] ?? list[i - 1])?.id ?? null;
  }

  private modelIndexForVisible(spaceId: string, visibleIndex: number): number {
    const list = this.visible(spaceId);
    const anchor = list[visibleIndex];
    return anchor ? this.order.indexOf(anchor) : this.lastIndexOfSpace(spaceId) + 1;
  }

  private lastIndexOfSpace(spaceId: string): number {
    for (let i = this.order.length - 1; i >= 0; i--) if (this.order[i]!.spaceId === spaceId) return i;
    return this.order.length - 1;
  }

  private pruneEmptyGroups(): void {
    for (const id of this.groups.keys()) if (!this.order.some((t) => t.groupId === id)) this.groups.delete(id);
  }

  private changed(): void {
    this.emit('changed');
  }
}
