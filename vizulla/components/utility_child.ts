// Child side of a utility-process service. Also removes network access from the
// JS environment as defense in depth (the runtime must never reach the network,
// SEC-02); the real boundary is the OS sandbox policy of the shipped build.
type Handler = (params: any) => unknown | Promise<unknown>;

declare const process: NodeJS.Process & { parentPort: { on(e: 'message', fn: (m: { data: any }) => void): void; postMessage(m: unknown): void } };

export function serve(handlers: Record<string, Handler>, opts: { allowNetwork?: boolean } = {}): void {
  if (!opts.allowNetwork) {
    const deny = () => {
      throw new Error('network access is not allowed in this process');
    };
    (globalThis as { fetch?: unknown }).fetch = deny;
    for (const mod of ['http', 'https', 'net', 'tls', 'dgram', 'child_process']) {
      try {
        const m = require(mod) as Record<string, unknown>;
        for (const k of Object.keys(m)) if (typeof m[k] === 'function') m[k] = deny;
      } catch {
        /* module not present */
      }
    }
  }
  process.parentPort.on('message', async ({ data }) => {
    const { id, method, params } = data as { id: number; method: string; params: unknown };
    const fn = handlers[method];
    try {
      if (!fn) throw new Error(`unknown method ${method}`);
      const result = await fn(params);
      if (id) process.parentPort.postMessage({ id, result });
    } catch (e) {
      if (id) process.parentPort.postMessage({ id, error: (e as Error).message });
    }
  });
}
