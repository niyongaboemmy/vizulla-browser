// Extension background workers: Electron never fires chrome.runtime.onInstalled for
// extensions it loads, yet many set up context menus and defaults there. This records
// the worker's onInstalled listeners and fires them once per installed version, with
// the reason Chrome would give ("install" or "update").
import { contextBridge, ipcRenderer } from 'electron';

// Registered on the profile session, which web pages' workers share: the browser only
// answers for extension workers, and the call simply fails for the rest.
{
  contextBridge.executeInMainWorld({
    func: () => {
      const g = globalThis as unknown as { chrome?: { runtime?: { onInstalled?: { addListener(fn: (d: unknown) => void): void } } }; __vzInstalled?: (d: unknown) => void };
      const ev = g.chrome?.runtime?.onInstalled;
      if (!ev) return;
      const listeners: ((d: unknown) => void)[] = [];
      const add = ev.addListener.bind(ev);
      ev.addListener = (fn) => {
        listeners.push(fn);
        add(fn);
      };
      g.__vzInstalled = (d) => {
        for (const fn of listeners) {
          try {
            fn(d);
          } catch (err) {
            console.error(err);
          }
        }
      };
    },
  });
  ipcRenderer
    .invoke('vz:ext-installed')
    .then((details: unknown) => {
      if (details) contextBridge.executeInMainWorld({ func: (d: unknown) => (globalThis as unknown as { __vzInstalled?: (d: unknown) => void }).__vzInstalled?.(d), args: [details] });
    })
    .catch(() => undefined);
}
