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

  // The window chrome draws extension buttons (electron-chrome-extensions' browserAction
  // API, always for Vizulla's extension session). Only vizulla://chrome gets this.
  if (location.host === 'chrome') {
    const P = 'vizulla-extensions';
    const call = (name: string, ...args: unknown[]) => ipcRenderer.invoke('crx-msg-remote', P, name, ...args);
    let observing = false;
    const watchers = new Set<() => void>();
    ipcRenderer.on('browserAction.update', () => watchers.forEach((fn) => fn()));
    contextBridge.exposeInMainWorld('vzExt', {
      getState: () => call('browserAction.getState'),
      activate: (details: unknown) => call('browserAction.activate', details),
      observe: (fn: () => void) => {
        watchers.add(fn);
        if (!observing) {
          observing = true;
          void call('browserAction.addObserver');
        }
        return () => watchers.delete(fn);
      },
    });
  }
}
