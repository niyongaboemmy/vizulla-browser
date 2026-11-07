import { describe, expect, it } from 'vitest';
import { BadMessageError, v, validateArgs } from './schema';
import { ShellInterface } from './shell';

describe('IPC schema validation (handbook §9 rule 2)', () => {
  it('accepts well-formed arguments', () => {
    expect(validateArgs(ShellInterface.methods.navigate, [3, 'example.com'], 'navigate')).toEqual([3, 'example.com']);
    expect(validateArgs(ShellInterface.methods.setSidebar, [{ width: 300 }], 'setSidebar')).toEqual([{ width: 300 }]);
  });
  it.each([
    ['wrong type', ShellInterface.methods.closeTab, ['1']],
    ['float id', ShellInterface.methods.closeTab, [1.5]],
    ['negative id', ShellInterface.methods.closeTab, [-1]],
    ['too many args', ShellInterface.methods.closeTab, [1, 2]],
    ['oversized string', ShellInterface.methods.navigate, [1, 'x'.repeat(10000)]],
    ['unknown field', ShellInterface.methods.setSidebar, [{ width: 300, evil: true }]],
    ['out of range', ShellInterface.methods.setSidebar, [{ width: 5000 }]],
    ['bad enum', ShellInterface.methods.openCommandBar, ['root-shell']],
    ['bad id chars', ShellInterface.methods.switchSpace, ['../../etc']],
    ['huge array', ShellInterface.methods.createGroup, [Array.from({ length: 501 }, (_, i) => i)]],
  ])('rejects %s', (_n, schemas, args) => {
    expect(() => validateArgs(schemas, args as unknown[], 'm')).toThrow(BadMessageError);
  });
  it('json() bounds payload size and strips functions/prototypes', () => {
    expect(() => v.json({ maxBytes: 10 }).parse({ a: 'x'.repeat(20) }, 'p')).toThrow(BadMessageError);
    const out = v.json().parse(JSON.parse('{"__proto__":{"polluted":1},"a":1}'), 'p') as Record<string, unknown>;
    expect(({} as Record<string, unknown>).polluted).toBeUndefined();
    expect(out.a).toBe(1);
  });
});
