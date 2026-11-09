// Task Manager (Shift+Esc): memory and CPU per process, with the tabs each renderer
// hosts (several tabs of one site share a process). "End process" on a tab process
// puts its tabs to sleep, which frees the memory; they reload when opened.
import { app } from 'electron';
import type { BrowserApp } from '../browser_app';

export interface TaskRow {
  pid: number;
  kind: 'browser' | 'gpu' | 'network' | 'audio' | 'utility' | 'tabs' | 'ui' | 'other';
  name: string;
  tabs: { id: number; title: string; favicon: string | null }[];
  memoryKb: number;
  cpu: number;
}

export function taskRows(a: BrowserApp): { rows: TaskRow[]; asleep: number } {
  const metrics = app.getAppMetrics();
  const tabsByPid = new Map<number, TaskRow['tabs']>();
  const uiPids = new Set<number>();
  let asleep = 0;
  for (const w of a.windows) {
    for (const wc of [w.chrome.webContents, w.overlay.webContents].filter(Boolean)) {
      try {
        uiPids.add(wc!.getOSProcessId());
      } catch {
        /* not started */
      }
    }
    for (const tab of w.tabs.values()) {
      const wc = tab.wc;
      if (!wc || wc.isDestroyed()) {
        asleep++;
        continue;
      }
      const pid = wc.getOSProcessId();
      if (!tabsByPid.has(pid)) tabsByPid.set(pid, []);
      tabsByPid.get(pid)!.push({ id: tab.id, title: tab.title || tab.url, favicon: tab.favicon ?? null });
    }
  }
  const rows: TaskRow[] = metrics.map((m) => {
    const tabs = tabsByPid.get(m.pid) ?? [];
    const service = (m as { serviceName?: string }).serviceName ?? '';
    const kind: TaskRow['kind'] =
      m.type === 'Browser' ? 'browser'
      : m.type === 'GPU' ? 'gpu'
      : m.type === 'Utility' && /network/i.test(service) ? 'network'
      : m.type === 'Utility' && /audio/i.test(service) ? 'audio'
      : m.type === 'Utility' ? 'utility'
      : tabs.length ? 'tabs'
      : uiPids.has(m.pid) ? 'ui'
      : 'other';
    return { pid: m.pid, kind, name: (m as { name?: string }).name ?? service, tabs, memoryKb: m.memory.workingSetSize, cpu: Math.round(m.cpu.percentCPUUsage * 10) / 10 };
  });
  const order: TaskRow['kind'][] = ['browser', 'gpu', 'network', 'audio', 'utility', 'ui', 'tabs', 'other'];
  rows.sort((x, y) => order.indexOf(x.kind) - order.indexOf(y.kind) || y.memoryKb - x.memoryKb);
  return { rows, asleep };
}

/** "Put background tabs to sleep": every tab that isn't visible, in every window. */
export function sleepBackgroundTabs(a: BrowserApp): number {
  let n = 0;
  for (const w of a.windows) {
    for (const tab of w.tabs.values()) if (w.discardTab(tab.id)) n++;
    w.pushState();
  }
  return n;
}

/** Puts every tab hosted by a renderer process to sleep (or closes the process if none). */
export function endProcess(a: BrowserApp, pid: number): void {
  for (const w of a.windows) {
    for (const tab of w.tabs.values()) {
      if (tab.wc && !tab.wc.isDestroyed() && tab.wc.getOSProcessId() === pid) {
        if (!w.discardTab(tab.id)) tab.wc.forcefullyCrashRenderer();
        w.pushState();
      }
    }
  }
}
