// Preload for vizulla:// pages (chrome UI, overlay, internal pages in tabs).
// It exposes the IPC bridge only when the document is a vizulla:// page; on web
// origins it exposes nothing. The browser also checks every call's sender.
import { contextBridge, ipcRenderer } from 'electron';

if (location.protocol === 'vizulla:') {
  const listeners = new Map<string, Set<(payload: unknown) => void>>();
  ipcRenderer.on('vz:event', (_e, iface: string, event: string, payload: unknown) => {
    for (const fn of listeners.get(`${iface}:${event}`) ?? []) fn(payload);
  });
  contextBridge.exposeInMainWorld('vz', {
    call: (iface: string, method: string, ...args: unknown[]) => ipcRenderer.invoke(`vz:${iface}.${method}`, ...args),
    on: (iface: string, event: string, fn: (payload: unknown) => void) => {
      const key = `${iface}:${event}`;
      if (!listeners.has(key)) listeners.set(key, new Set());
      listeners.get(key)!.add(fn);
      return () => listeners.get(key)?.delete(fn);
    },
    platform: process.platform,
  });
}
