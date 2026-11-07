// ContextBuilder core (P2-AI-01): extracted page blocks → chunks with stable ids,
// heading paths, a trust level and origin (handbook §9 rule 5). Size-capped.
export type TrustLevel = 'UNTRUSTED_WEB' | 'USER' | 'MEMORY';

export interface Block {
  tag: string;
  text: string;
  /** Heading level for h1..h6, else 0. */
  level: number;
  /** PDF page number, when the source is a PDF. */
  page?: number;
}

export interface Chunk {
  id: string;
  text: string;
  headings: string[];
  origin: string;
  trust: TrustLevel;
  page?: number;
  /** Which tab the chunk came from (multi-tab synthesis, R2). */
  tabId?: number;
}

export interface ChunkOptions {
  origin: string;
  targetChars?: number;
  maxChunks?: number;
  idPrefix?: string;
  tabId?: number;
  trust?: TrustLevel;
}

const clean = (s: string) => s.replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f​-‏‪-‮⁦-⁩]/g, '').replace(/\s+/g, ' ').trim();

export function chunkBlocks(blocks: Block[], o: ChunkOptions): Chunk[] {
  const target = o.targetChars ?? 1800; // ≈ 450 tokens
  const max = o.maxChunks ?? 60;
  const prefix = o.idPrefix ?? 'c';
  const out: Chunk[] = [];
  const path: string[] = [];
  let buf: string[] = [];
  let len = 0;
  let page: number | undefined;
  const flush = () => {
    if (!buf.length) return;
    out.push({ id: `${prefix}${out.length + 1}`, text: buf.join('\n'), headings: [...path], origin: o.origin, trust: o.trust ?? 'UNTRUSTED_WEB', page, tabId: o.tabId });
    buf = [];
    len = 0;
  };
  for (const b of blocks) {
    const text = clean(b.text);
    if (!text) continue;
    if (b.page !== undefined && b.page !== page) {
      flush();
      page = b.page;
    }
    if (b.level > 0) {
      flush();
      path.length = Math.min(path.length, b.level - 1);
      path[b.level - 1] = text.slice(0, 120);
      buf.push(text);
      len += text.length;
      continue;
    }
    // Split very long paragraphs on sentence boundaries.
    const pieces = text.length > target ? splitSentences(text, target) : [text];
    for (const p of pieces) {
      if (len + p.length > target && len > target * 0.3) flush();
      buf.push(b.tag === 'li' ? `• ${p}` : p);
      len += p.length;
    }
    if (out.length >= max) break;
  }
  flush();
  return out.slice(0, max);
}

export function splitSentences(text: string, target: number): string[] {
  const sentences = text.match(/[^.!?。]+[.!?。]+["')\]]*\s*|[^.!?。]+$/g) ?? [text];
  const out: string[] = [];
  let cur = '';
  for (const s of sentences) {
    if ((cur + s).length > target && cur) {
      out.push(cur.trim());
      cur = '';
    }
    cur += s;
  }
  if (cur.trim()) out.push(cur.trim());
  return out;
}

export function totalChars(chunks: Chunk[]): number {
  return chunks.reduce((n, c) => n + c.text.length, 0);
}
