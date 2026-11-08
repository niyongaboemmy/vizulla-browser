// Multi-select and cross-window tab drag, shared by <vz-tabstrip> and <vz-sidebar>.
// Cmd/Ctrl-click toggles a tab, Shift-click selects a range from the anchor, a plain
// click clears. Dragged tabs carry their ids, so another window's strip can adopt
// them; a drop outside every strip opens them in a new window at the drop point.
import type { ReactiveController, ReactiveControllerHost } from 'lit';
import { shell } from './shell';

export const TAB_MIME = 'application/x-vizulla-tabs';

export class TabSelection implements ReactiveController {
  readonly ids = new Set<number>();
  private anchor: number | null = null;

  constructor(private readonly host: ReactiveControllerHost) {
    host.addController(this);
  }

  hostConnected(): void {
    window.addEventListener('keydown', this.onKey);
  }

  hostDisconnected(): void {
    window.removeEventListener('keydown', this.onKey);
  }

  private readonly onKey = (e: KeyboardEvent): void => {
    if (e.key === 'Escape' && this.ids.size) this.clear();
  };

  /** Handles a click on a tab. Returns true when it only changed the selection. */
  click(e: MouseEvent, id: number, order: number[], activeId: number | null): boolean {
    if (e.shiftKey) {
      const from = order.indexOf(this.anchor ?? activeId ?? id);
      const to = order.indexOf(id);
      if (from < 0 || to < 0) return false;
      this.ids.clear();
      for (const x of order.slice(Math.min(from, to), Math.max(from, to) + 1)) this.ids.add(x);
      this.host.requestUpdate();
      return true;
    }
    if (e.metaKey || e.ctrlKey) {
      // Starting a selection includes the tab you are on, like other browsers.
      if (!this.ids.size && activeId !== null) this.ids.add(activeId);
      if (this.ids.has(id) && this.ids.size > 1) this.ids.delete(id);
      else this.ids.add(id);
      this.anchor = id;
      this.host.requestUpdate();
      return true;
    }
    this.anchor = id;
    if (this.ids.size) this.clear();
    return false;
  }

  clear(): void {
    this.ids.clear();
    this.host.requestUpdate();
  }

  /** Drops ids that are no longer in this window. */
  prune(present: Iterable<number>): void {
    const keep = new Set(present);
    for (const id of this.ids) if (!keep.has(id)) this.ids.delete(id);
  }

  has(id: number): boolean {
    return this.ids.size > 1 && this.ids.has(id);
  }

  /** The tabs an action on `id` applies to: the selection if `id` is in it, else just `id`. */
  targets(id: number, order: number[]): number[] {
    return this.has(id) ? order.filter((x) => this.ids.has(x)) : [id];
  }
}

export function startTabDrag(e: DragEvent, ids: number[], url?: string): void {
  const dt = e.dataTransfer;
  if (!dt) return;
  dt.effectAllowed = 'move';
  dt.setData(TAB_MIME, JSON.stringify(ids));
  if (url && ids.length === 1) dt.setData('text/uri-list', url);
}

export function isTabDrag(e: DragEvent): boolean {
  return !!e.dataTransfer?.types.includes(TAB_MIME);
}

export function draggedTabIds(e: DragEvent): number[] {
  try {
    const ids = JSON.parse(e.dataTransfer?.getData(TAB_MIME) || '[]') as unknown;
    return Array.isArray(ids) ? ids.filter((x): x is number => Number.isInteger(x)) : [];
  } catch {
    return [];
  }
}

/** Called on dragend: tabs released outside this window and not taken by another strip tear off. */
export function endTabDrag(e: DragEvent, ids: number[]): void {
  if (e.dataTransfer?.dropEffect !== 'none') return;
  const outside = e.clientX < 0 || e.clientY < 0 || e.clientX > window.innerWidth || e.clientY > window.innerHeight;
  if (outside && ids.length) void shell.detachTabs(ids, { x: e.screenX, y: e.screenY });
}
