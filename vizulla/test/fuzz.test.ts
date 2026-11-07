// Fuzz-style property tests for parsers of untrusted input (P2-SEC-02): the SSE
// parser, citation parser, chunker, CSV importer, URL classifier, IPC schemas,
// and filter-list loading. Deterministic seed so failures reproduce.
import { describe, expect, it } from 'vitest';
import { SseParser } from '@vz/browser/ai/providers/sse';
import { checkCitations, markersIn } from '@vz/browser/ai/context/citations';
import { chunkBlocks } from '@vz/browser/ai/context/chunker';
import { contextBlock } from '@vz/browser/ai/context/prompt';
import { parsePasswordCsv, parseCsv } from '@vz/browser/importers/importers';
import { classifyInput, displayUrl } from '@vz/common/url';
import { BadMessageError, validateArgs } from '@vz/common/mojom/schema';
import { ShellInterface } from '@vz/common/mojom/shell';
import { ShieldsEngine } from '@vz/components/shields_engine/shields_engine';

let seed = 1337;
const rnd = (n: number) => ((seed = (seed * 1103515245 + 12345) & 0x7fffffff), seed % n);
const ALPHABET = 'abc<>/"\'[]c1,:\n\r\t \\{}()=&#;.-_|*•\u0000\u202e\u200bé漢🙂';
const junk = (len: number) => Array.from({ length: rnd(len) }, () => ALPHABET[rnd(ALPHABET.length)]).join('');
const ITER = 3000;

describe('fuzz', () => {
  it('SSE parser never throws on arbitrary chunking and returns well-formed events', () => {
    for (let i = 0; i < ITER; i++) {
      const p = new SseParser();
      const text = junk(400);
      let pos = 0;
      while (pos < text.length) {
        const n = 1 + rnd(30);
        for (const ev of p.push(text.slice(pos, pos + n))) {
          expect(typeof ev.event).toBe('string');
          expect(typeof ev.data).toBe('string');
        }
        pos += n;
      }
    }
  });

  it('citation checker only ever keeps ids that exist', () => {
    const chunks = chunkBlocks([{ tag: 'p', text: 'alpha beta gamma.', level: 0 }, { tag: 'h2', text: 'H', level: 2 }, { tag: 'p', text: 'delta.', level: 0 }], { origin: 'o' });
    const ids = new Set(chunks.map((c) => c.id));
    for (let i = 0; i < ITER; i++) {
      const r = checkCitations(junk(200) + ` [c${rnd(9)}] ` + junk(50), chunks);
      for (const id of r.cited) expect(ids.has(id)).toBe(true);
      for (const id of markersIn(r.text)) expect(ids.has(id)).toBe(true);
    }
  });

  it('page text can never break out of its <chunk> (spotlighting holds for any input)', () => {
    for (let i = 0; i < ITER; i++) {
      const chunks = chunkBlocks(Array.from({ length: 1 + rnd(5) }, () => ({ tag: 'p', text: junk(300), level: rnd(3) })), { origin: junk(30) });
      const block = contextBlock(chunks);
      expect((block.match(/<chunk /g) ?? []).length).toBe(chunks.length);
      expect((block.match(/<\/chunk>/g) ?? []).length).toBe(chunks.length);
      expect(block.replace(/<\/?chunk[^>]*>/g, '')).not.toMatch(/[<>]/);
    }
  });

  it('CSV parsers never throw beyond the documented header error', () => {
    for (let i = 0; i < ITER; i++) {
      const text = `url,username,password\n${junk(300)}`;
      expect(() => parseCsv(text)).not.toThrow();
      const rows = parsePasswordCsv(text);
      for (const r of rows) expect(r.origin).toMatch(/^https?:\/\//);
    }
  });

  it('classifier never routes to a javascript: URL and display never throws', () => {
    for (let i = 0; i < ITER; i++) {
      const s = (rnd(3) ? '' : 'javascript:') + junk(80);
      const r = classifyInput(s);
      if (r.route === 'navigate') expect(r.url).not.toMatch(/^javascript:/i);
      expect(() => displayUrl(s)).not.toThrow();
    }
  });

  it('IPC validation either returns typed args or throws BadMessageError, nothing else', () => {
    const values = [null, undefined, 0, -1, 1.5, 2 ** 40, '', 'x', 'x'.repeat(9000), [], [1, 2], {}, { width: 300 }, { __proto__: { a: 1 } }, true, NaN];
    for (const [name, schemas] of Object.entries(ShellInterface.methods)) {
      for (let i = 0; i < 200; i++) {
        const args = Array.from({ length: rnd(4) }, () => values[rnd(values.length)]);
        try {
          validateArgs(schemas, args, name);
        } catch (e) {
          expect(e).toBeInstanceOf(BadMessageError);
        }
      }
    }
  });

  it('filter list loader tolerates garbage lists', () => {
    for (let i = 0; i < 200; i++) {
      const e = ShieldsEngine.fromLists([Array.from({ length: 50 }, () => junk(60)).join('\n')]);
      expect(() => e.check('https://a.example/x.js', 'https://b.example/', 'script')).not.toThrow();
      expect(() => e.cosmetic('https://b.example/')).not.toThrow();
    }
  });
});
