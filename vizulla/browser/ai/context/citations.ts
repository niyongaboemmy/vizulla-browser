// Citation engine (P2-AI-05, DD-5): parse [cN] markers, validate them against the
// chunks that were actually sent, and drop invalid ones. Answers with dropped or
// no citations are marked partially sourced (AIQ-01 is measured on this output).
import type { Chunk } from './chunker';

export interface CitationCheck {
  /** Answer text with invalid markers removed. */
  text: string;
  cited: string[];
  invalid: string[];
  status: 'sourced' | 'partially-sourced' | 'unsourced';
}

const MARKER = /\[((?:[a-z]+\d+|t\d+c\d+)(?:\s*,\s*(?:[a-z]+\d+|t\d+c\d+))*)\]/gi;

export function checkCitations(answer: string, chunks: Chunk[]): CitationCheck {
  const ids = new Set(chunks.map((c) => c.id));
  const cited = new Set<string>();
  const invalid = new Set<string>();
  const text = answer.replace(MARKER, (_m, list: string) => {
    const keep = list
      .split(',')
      .map((x) => x.trim().toLowerCase())
      .filter((id) => {
        if (ids.has(id)) {
          cited.add(id);
          return true;
        }
        invalid.add(id);
        return false;
      });
    return keep.length ? `[${keep.join(', ')}]` : '';
  });
  const sentences = text.split(/(?<=[.!?])\s+(?!\[)/).filter((s) => s.trim().length > 30);
  const uncited = sentences.filter((s) => !/\[[a-z]+\d+/i.test(s)).length;
  const status = !cited.size ? 'unsourced' : invalid.size || uncited > sentences.length / 2 ? 'partially-sourced' : 'sourced';
  return { text, cited: [...cited], invalid: [...invalid], status };
}

/** Streaming helper: finds complete markers in accumulated text. */
export function markersIn(text: string): string[] {
  const out: string[] = [];
  for (const m of text.matchAll(MARKER)) out.push(...m[1]!.split(',').map((x) => x.trim().toLowerCase()));
  return out;
}

/** Fuzzy containment (≥ 0.9 token overlap) used to validate quoted spans. */
export function quoteMatches(quote: string, chunk: string): boolean {
  const norm = (s: string) => s.toLowerCase().replace(/[^\p{L}\p{N}\s]/gu, ' ').split(/\s+/).filter(Boolean);
  const q = norm(quote);
  if (!q.length) return false;
  const c = new Set(norm(chunk));
  return q.filter((w) => c.has(w)).length / q.length >= 0.9;
}

/** A short exact span from the chunk to scroll to and highlight (text fragment). */
export function revealSpan(chunk: Chunk): string {
  const first = chunk.text.split('\n').find((l) => l.length > 20) ?? chunk.text;
  return first.replace(/^• /, '').split(/(?<=[.!?])\s/)[0]!.slice(0, 160);
}
