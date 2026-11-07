// Binds interface definitions (vizulla/common/mojom) to browser-side handlers.
//
// Rules from handbook §9:
//  - The browser validates every argument (schema) and reports bad messages.
//  - The caller's identity comes from the browser: the sender frame's committed
//    URL must be a top-level vizulla://<host> page that the interface is bound to.
//    A web page can never reach these handlers, even if it found the channel name.
import { ipcMain, type IpcMainInvokeEvent, type WebContents } from 'electron';
import { BadMessageError, validateArgs, type HandlerOf, type InterfaceDef, type Schema } from '@vz/common/mojom/schema';

export interface CallContext {
  sender: WebContents;
  host: string;
}

type AnyDef = InterfaceDef<Record<string, readonly Schema<unknown>[]>>;

export const badMessages: { iface: string; method: string; reason: string; url: string }[] = [];

export function reportBadMessage(iface: string, method: string, reason: string, url: string): void {
  badMessages.push({ iface, method, reason, url });
  if (badMessages.length > 100) badMessages.shift();
  console.warn(`[vz] bad IPC message ${iface}.${method} from ${url}: ${reason}`);
}

export class IpcRouter {
  private readonly bound = new Set<string>();

  bind<D extends AnyDef>(def: D, impl: HandlerOf<D, CallContext>, opts: { hosts: readonly string[] }): void {
    if (this.bound.has(def.name)) throw new Error(`interface ${def.name} bound twice`);
    this.bound.add(def.name);
    for (const [method, schemas] of Object.entries(def.methods)) {
      const fn = (impl as Record<string, (...a: unknown[]) => unknown>)[method];
      if (typeof fn !== 'function') throw new Error(`${def.name}.${method} not implemented`);
      ipcMain.handle(`vz:${def.name}.${method}`, async (event: IpcMainInvokeEvent, ...raw: unknown[]) => {
        const url = event.senderFrame?.url ?? '';
        const host = authorizedHost(event, opts.hosts);
        if (!host) {
          reportBadMessage(def.name, method, 'unauthorized sender', url);
          throw new Error('unauthorized');
        }
        let args: unknown[];
        try {
          args = validateArgs(schemas, raw, `${def.name}.${method}`);
        } catch (e) {
          if (e instanceof BadMessageError) reportBadMessage(def.name, method, e.message, url);
          throw new Error('bad message');
        }
        return fn.call(impl, { sender: event.sender, host } satisfies CallContext, ...args);
      });
    }
  }
}

function authorizedHost(event: IpcMainInvokeEvent, hosts: readonly string[]): string | null {
  const frame = event.senderFrame;
  if (!frame || frame.parent) return null; // top-level frames only
  let u: URL;
  try {
    u = new URL(frame.url);
  } catch {
    return null;
  }
  if (u.protocol !== 'vizulla:') return null;
  return hosts.includes(u.hostname) ? u.hostname : null;
}

/** Push an event to a WebUI page: the `Page` half of a PageHandler/Page pair. */
export function emitTo(wc: WebContents | null | undefined, iface: string, event: string, payload?: unknown): void {
  if (!wc || wc.isDestroyed()) return;
  wc.send('vz:event', iface, event, payload);
}
