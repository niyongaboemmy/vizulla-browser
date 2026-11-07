import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { extractPdf } from './pdf_extract';
import { chunkBlocks } from './chunker';

describe('PDF context (P2-AI-02)', () => {
  it('extracts text per page so chunks carry page numbers', async () => {
    const bytes = new Uint8Array(readFileSync(join(__dirname, '../../../test/data/sample.pdf')));
    const r = await extractPdf(bytes);
    expect(r.pages).toBe(2);
    expect(r.scanned).toBe(false);
    const chunks = chunkBlocks(r.blocks, { origin: 'file://' });
    expect(chunks.find((c) => c.text.includes('500 Rwandan francs'))!.page).toBe(2);
    expect(chunks.find((c) => c.text.includes('one million'))!.page).toBe(1);
  });
});
