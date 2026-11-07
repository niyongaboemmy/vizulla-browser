// Typed access to the browser from WebUI. All calls go through the preload bridge
// (ipcRenderer.invoke); the browser validates the sender and every argument.
import type { ClientOf, InterfaceDef, Schema } from '@vz/common/mojom/schema';

interface VzBridge {
  call(iface: string, method: string, ...args: unknown[]): Promise<unknown>;
  on(iface: string, event: string, fn: (payload: unknown) => void): () => void;
  platform: string;
}

declare global {
  interface Window {
    vz: VzBridge;
  }
}

export function client<D extends InterfaceDef<Record<string, readonly Schema<unknown>[]>>>(def: D): ClientOf<D> {
  return new Proxy({} as ClientOf<D>, {
    get: (_t, method: string) => (...args: unknown[]) => window.vz.call(def.name, method, ...args),
  });
}

export function on<T = unknown>(iface: string, event: string, fn: (payload: T) => void): () => void {
  return window.vz.on(iface, event, fn as (p: unknown) => void);
}

/** Generic page RPC for vizulla:// pages. */
export const page = {
  init: <T = unknown>() => window.vz.call('Pages', 'getInitialData') as Promise<{ locale: string; theme: string; accent: string; data: T }>,
  invoke: <T = unknown>(method: string, payload?: unknown) => window.vz.call('Pages', 'invoke', method, payload) as Promise<T>,
  on: <T = unknown>(event: string, fn: (p: T) => void) => on<T>('Pages', event, fn),
};
