import { describe, expect, it, vi } from 'vitest';
vi.mock('electron', () => ({ session: {} }));
import { parseOpenSearch } from './engine_suggest';

describe('parseOpenSearch', () => {
  it('keeps up to four distinct suggestions, without the query itself', () => {
    expect(parseOpenSearch(['kig', ['kig', 'kigali weather', 'kigali', 'kigali weather', 'kigali map', 'kigali airport', 'extra']], 'kig')).toEqual(['kigali weather', 'kigali', 'kigali map', 'kigali airport']);
  });
  it('ignores malformed responses', () => {
    expect(parseOpenSearch({ q: 1 }, 'x')).toEqual([]);
    expect(parseOpenSearch(['x', [1, null, ' ok ']], 'x')).toEqual(['ok']);
  });
});
