// A tiny runtime schema language for IPC arguments (the role Mojo's generated
// validation plays upstream). The browser process validates every argument that
// comes from a renderer, WebUI, or utility process (handbook §9 rule 2).

export class BadMessageError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'BadMessageError';
  }
}

export interface Schema<T> {
  readonly kind: string;
  parse(value: unknown, path: string): T;
}

export type Infer<S> = S extends Schema<infer T> ? T : never;

/** Object output: fields whose schema accepts undefined become optional keys. */
type Simplify<T> = { [K in keyof T]: T[K] } & {};
type ObjOut<S extends Record<string, Schema<unknown>>> = Simplify<
  { [K in keyof S as undefined extends Infer<S[K]> ? never : K]: Infer<S[K]> } & { [K in keyof S as undefined extends Infer<S[K]> ? K : never]?: Infer<S[K]> }
>;
/** Trailing arguments that accept undefined become optional parameters. */
type OptTail<T extends readonly unknown[]> = T extends readonly [...infer H, infer L] ? (undefined extends L ? [...OptTail<H>, L?] : [...H, L]) : T;

const fail = (path: string, msg: string): never => {
  throw new BadMessageError(`${path || 'arg'}: ${msg}`);
};

export const v = {
  string(opts: { max?: number; min?: number; pattern?: RegExp } = {}): Schema<string> {
    const max = opts.max ?? 4096;
    return {
      kind: 'string',
      parse(x, p) {
        if (typeof x !== 'string') fail(p, 'expected string');
        const s = x as string;
        if (s.length > max) fail(p, `string longer than ${max}`);
        if (opts.min !== undefined && s.length < opts.min) fail(p, `string shorter than ${opts.min}`);
        if (opts.pattern && !opts.pattern.test(s)) fail(p, 'string does not match pattern');
        return s;
      },
    };
  },
  int(opts: { min?: number; max?: number } = {}): Schema<number> {
    return {
      kind: 'int',
      parse(x, p) {
        if (typeof x !== 'number' || !Number.isInteger(x)) fail(p, 'expected integer');
        const n = x as number;
        if (opts.min !== undefined && n < opts.min) fail(p, `below ${opts.min}`);
        if (opts.max !== undefined && n > opts.max) fail(p, `above ${opts.max}`);
        return n;
      },
    };
  },
  number(opts: { min?: number; max?: number } = {}): Schema<number> {
    return {
      kind: 'number',
      parse(x, p) {
        if (typeof x !== 'number' || !Number.isFinite(x)) fail(p, 'expected finite number');
        const n = x as number;
        if (opts.min !== undefined && n < opts.min) fail(p, `below ${opts.min}`);
        if (opts.max !== undefined && n > opts.max) fail(p, `above ${opts.max}`);
        return n;
      },
    };
  },
  bool(): Schema<boolean> {
    return { kind: 'bool', parse: (x, p) => (typeof x === 'boolean' ? x : fail(p, 'expected boolean')) };
  },
  literal<const T extends readonly string[]>(...values: T): Schema<T[number]> {
    return {
      kind: 'enum',
      parse(x, p) {
        if (typeof x !== 'string' || !values.includes(x)) fail(p, `expected one of ${values.join('|')}`);
        return x as T[number];
      },
    };
  },
  optional<T>(inner: Schema<T>): Schema<T | undefined> {
    return { kind: `optional<${inner.kind}>`, parse: (x, p) => (x === undefined || x === null ? undefined : inner.parse(x, p)) };
  },
  array<T>(inner: Schema<T>, opts: { max?: number } = {}): Schema<T[]> {
    const max = opts.max ?? 1000;
    return {
      kind: `array<${inner.kind}>`,
      parse(x, p) {
        if (!Array.isArray(x)) fail(p, 'expected array');
        const a = x as unknown[];
        if (a.length > max) fail(p, `array longer than ${max}`);
        return a.map((el, i) => inner.parse(el, `${p}[${i}]`));
      },
    };
  },
  object<S extends Record<string, Schema<unknown>>>(shape: S): Schema<ObjOut<S>> {
    return {
      kind: 'object',
      parse(x, p) {
        if (typeof x !== 'object' || x === null || Array.isArray(x)) fail(p, 'expected object');
        const src = x as Record<string, unknown>;
        for (const k of Object.keys(src)) if (!(k in shape)) fail(`${p}.${k}`, 'unexpected field');
        const out: Record<string, unknown> = {};
        for (const [k, s] of Object.entries(shape)) {
          const val = s.parse(src[k], `${p}.${k}`);
          if (val !== undefined) out[k] = val;
        }
        return out as ObjOut<S>;
      },
    };
  },
  record<T>(inner: Schema<T>, opts: { maxKeys?: number } = {}): Schema<Record<string, T>> {
    return {
      kind: `record<${inner.kind}>`,
      parse(x, p) {
        if (typeof x !== 'object' || x === null || Array.isArray(x)) fail(p, 'expected object');
        const entries = Object.entries(x as Record<string, unknown>);
        if (entries.length > (opts.maxKeys ?? 200)) fail(p, 'too many keys');
        return Object.fromEntries(entries.map(([k, val]) => [k, inner.parse(val, `${p}.${k}`)]));
      },
    };
  },
  /** Any JSON-able value, bounded in size. Use sparingly: only for opaque data the browser does not act on. */
  json(opts: { maxBytes?: number } = {}): Schema<unknown> {
    return {
      kind: 'json',
      parse(x, p) {
        const s = JSON.stringify(x ?? null);
        if (s.length > (opts.maxBytes ?? 65536)) fail(p, 'payload too large');
        return JSON.parse(s);
      },
    };
  },
  id(): Schema<string> {
    return v.string({ max: 64, pattern: /^[A-Za-z0-9_-]+$/ });
  },
};

/** An interface definition: method name → argument schemas, plus event names sent the other way. */
export interface InterfaceDef<M extends Record<string, readonly Schema<unknown>[]>> {
  name: string;
  methods: M;
}

export function defineInterface<const M extends Record<string, readonly Schema<unknown>[]>>(name: string, methods: M): InterfaceDef<M> {
  return { name, methods };
}

type Methods = Record<string, readonly Schema<unknown>[]>;
type ArgsOf<T extends readonly Schema<unknown>[]> = { -readonly [I in keyof T]: Infer<T[I]> };

/** Browser-side implementation of an interface. `ctx` identifies the calling page; it is never taken from the message. */
export type HandlerOf<D, Ctx> = D extends InterfaceDef<infer M extends Methods>
  ? { [K in keyof M]: (ctx: Ctx, ...args: ArgsOf<M[K]>) => unknown }
  : never;

/** Renderer-side typed client for an interface. */
export type ClientOf<D> = D extends InterfaceDef<infer M extends Methods>
  ? { [K in keyof M]: (...args: OptTail<ArgsOf<M[K]>>) => Promise<any> }
  : never;

export function validateArgs(schemas: readonly Schema<unknown>[], args: unknown[], method: string): unknown[] {
  if (args.length > schemas.length) throw new BadMessageError(`${method}: too many arguments`);
  return schemas.map((s, i) => s.parse(args[i], `${method}#${i}`));
}
