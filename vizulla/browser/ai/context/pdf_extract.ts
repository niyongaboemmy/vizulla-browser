// PDF context (P2-AI-02): text per page, so chunks carry page numbers.
// Scanned PDFs have no text layer; R1 explains that OCR is unavailable.
import type { Block } from './chunker';

let pdfjs: typeof import('pdfjs-dist/legacy/build/pdf.mjs') | null = null;

export async function extractPdf(bytes: Uint8Array, maxPages = 300): Promise<{ blocks: Block[]; pages: number; scanned: boolean }> {
  pdfjs ??= await import('pdfjs-dist/legacy/build/pdf.mjs');
  const doc = await pdfjs.getDocument({ data: bytes, disableFontFace: true, useSystemFonts: false }).promise;
  const blocks: Block[] = [];
  const pages = Math.min(doc.numPages, maxPages);
  for (let i = 1; i <= pages; i++) {
    const page = await doc.getPage(i);
    const content = await page.getTextContent();
    let line = '';
    let lastY: number | null = null;
    const lines: string[] = [];
    for (const item of content.items as { str: string; transform: number[]; hasEOL?: boolean }[]) {
      const y = item.transform[5]!;
      if (lastY !== null && Math.abs(y - lastY) > 2 && line) {
        lines.push(line.trim());
        line = '';
      }
      line += item.str + (item.hasEOL ? ' ' : '');
      lastY = y;
    }
    if (line.trim()) lines.push(line.trim());
    // Join lines into paragraphs.
    let para = '';
    for (const l of lines) {
      para += (para ? ' ' : '') + l;
      if (/[.!?:]$/.test(l) || l.length < 40) {
        blocks.push({ tag: 'p', text: para, level: 0, page: i });
        para = '';
      }
    }
    if (para) blocks.push({ tag: 'p', text: para, level: 0, page: i });
    page.cleanup();
  }
  await doc.destroy();
  const textChars = blocks.reduce((n, b) => n + b.text.length, 0);
  return { blocks, pages: doc.numPages, scanned: textChars < 20 * pages };
}
