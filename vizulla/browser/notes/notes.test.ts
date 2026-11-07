import { describe, expect, it } from 'vitest';
import { NotesStore, noteTitle, textFragmentUrl } from './notes_service';

describe('Notes (P4-BRW-04)', () => {
  it('builds text fragments back to the passage', () => {
    expect(textFragmentUrl('https://a.com/p#x', 'Question Coffee in Gishushu')).toBe('https://a.com/p#:~:text=Question%20Coffee%20in%20Gishushu');
    const long = textFragmentUrl('https://a.com/', 'one two three four five six seven eight nine ten eleven twelve thirteen-x');
    expect(long).toBe('https://a.com/#:~:text=one%20two%20three%20four%20five,nine%20ten%20eleven%20twelve%20thirteen%2Dx');
  });
  it('stores, searches, exports Markdown with source links', () => {
    const s = new NotesStore(':memory:');
    const id = s.create('> Rwanda grows Arabica coffee\n\nGreat for the report', { url: 'https://coffee.rw/#:~:text=Rwanda', title: 'Coffee guide' }, 'space1');
    s.create('# Shopping\n- beans');
    expect(s.list('arabica').map((n) => n.id)).toEqual([id]);
    expect(noteTitle('# Shopping\n- beans')).toBe('Shopping');
    expect(s.toMarkdown([id])).toContain('— [Coffee guide](https://coffee.rw/#:~:text=Rwanda)');
    s.update(id, 'changed');
    expect(s.list('arabica')).toHaveLength(0);
    s.remove(id);
    expect(s.list()).toHaveLength(1);
  });
});
