// The built-in on-device engine ("vz-extractive-1"). It needs no model download:
// summaries and answers are built from the page's own sentences, ranked with
// BM25 against the question (or by centrality for summaries), and every
// sentence carries its chunk citation, so answers are faithful by construction.
// A generative local model (D-6) plugs in behind the same interface.

export interface EngineChunk {
  id: string;
  text: string;
}

const STOP = new Set(
  ('a an the and or but if of to in on at by for with from as is are was were be been being it its this that these those what which who whom how why when where do does did can could will would should may might must i you he she we they me my your our their not no yes so than then there here about into over under also just only very more most such any all each other some le la les un une des du de et ou est sont que qui quoi dans pour par sur avec ce cet cette ces il elle nous vous ils elles na ya wa kwa ni za la cya ku mu ba').split(' '),
);

export function tokenize(s: string): string[] {
  return s
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .split(/[^\p{L}\p{N}]+/u)
    .filter((w) => w.length > 1 && !STOP.has(w))
    .map(stem);
}

function stem(w: string): string {
  return w.length > 4 ? w.replace(/(ing|ies|ied|es|s|ed|ly|ment)$/, '') : w;
}

interface Sentence {
  chunk: string;
  text: string;
  tokens: string[];
  pos: number;
}

function sentences(chunks: EngineChunk[]): Sentence[] {
  const out: Sentence[] = [];
  let pos = 0;
  for (const c of chunks) {
    for (const line of c.text.split('\n')) {
      for (const s of line.match(/[^.!?]+[.!?]+["')\]]*|[^.!?]+$/g) ?? []) {
        const text = s.replace(/^•\s*/, '').trim();
        if (text.length < 25) continue;
        out.push({ chunk: c.id, text, tokens: tokenize(text), pos: pos++ });
      }
    }
  }
  return out;
}

export function bm25(query: string[], docs: string[][], k1 = 1.4, b = 0.75): number[] {
  const N = docs.length;
  const avg = docs.reduce((n, d) => n + d.length, 0) / Math.max(1, N);
  const df = new Map<string, number>();
  for (const d of docs) for (const w of new Set(d)) df.set(w, (df.get(w) ?? 0) + 1);
  return docs.map((d) => {
    const tf = new Map<string, number>();
    for (const w of d) tf.set(w, (tf.get(w) ?? 0) + 1);
    let s = 0;
    for (const q of new Set(query)) {
      const f = tf.get(q);
      if (!f) continue;
      const idf = Math.log(1 + (N - (df.get(q) ?? 0) + 0.5) / ((df.get(q) ?? 0) + 0.5));
      s += idf * ((f * (k1 + 1)) / (f + k1 * (1 - b + (b * d.length) / Math.max(1, avg))));
    }
    return s;
  });
}

export type EngineTask = { kind: 'summarize'; style: 'tldr' | 'key-points' | 'outline' } | { kind: 'ask' | 'compare'; question: string } | { kind: 'selection'; action: string; text: string };

export const NOT_FOUND = "I couldn't find that on this page.";

export function answerExtractive(task: EngineTask, chunks: EngineChunk[]): string {
  const sents = sentences(chunks);
  if (!sents.length) return NOT_FOUND;
  if (task.kind === 'summarize') {
    // Centrality: sentences sharing vocabulary with the whole page, earlier ones favoured.
    const all = sents.flatMap((s) => s.tokens);
    const freq = new Map<string, number>();
    for (const w of all) freq.set(w, (freq.get(w) ?? 0) + 1);
    const scored = sents.map((s) => ({
      s,
      v: s.tokens.reduce((n, w) => n + Math.log(1 + (freq.get(w) ?? 0)), 0) / Math.sqrt(1 + s.tokens.length) + 1.5 / (1 + s.pos * 0.3),
    }));
    const n = task.style === 'tldr' ? 2 : task.style === 'key-points' ? 5 : 6;
    const top = pickDiverse(scored.sort((a, b) => b.v - a.v).map((x) => x.s), n).sort((a, b) => a.pos - b.pos);
    if (task.style === 'tldr') return top.map((s) => `${s.text} [${s.chunk}]`).join(' ');
    return top.map((s) => `- ${s.text} [${s.chunk}]`).join('\n');
  }
  if (task.kind === 'selection') {
    return `${task.action}: “${task.text.slice(0, 400)}”\n\n${NOT_FOUND.replace('that', 'more context for this')}`;
  }
  const q = tokenize(task.question);
  if (!q.length) return NOT_FOUND;
  const scores = bm25(q, sents.map((s) => s.tokens));
  // A sentence must cover enough of the question to count ("World Cup" ≠ "fruity cup").
  const qs = new Set(q);
  const coverage = (s: Sentence) => s.tokens.filter((w, i, a) => qs.has(w) && a.indexOf(w) === i).length / qs.size;
  const ranked = sents
    .map((s, i) => ({ s, v: scores[i]! }))
    .filter((x) => x.v > 0 && coverage(x.s) >= (qs.size <= 2 ? 0.5 : 0.4))
    .sort((a, b) => b.v - a.v);
  if (!ranked.length || ranked[0]!.v < 0.5) return NOT_FOUND;
  const best = ranked[0]!.v;
  const keep = pickDiverse(ranked.filter((x) => x.v >= best * 0.45).map((x) => x.s), 3).sort((a, b) => a.pos - b.pos);
  return keep.map((s) => `${s.text} [${s.chunk}]`).join(' ');
}

function pickDiverse(list: Sentence[], n: number): Sentence[] {
  const out: Sentence[] = [];
  for (const s of list) {
    if (out.length >= n) break;
    const set = new Set(s.tokens);
    const dup = out.some((o) => {
      const inter = o.tokens.filter((w) => set.has(w)).length;
      return inter / Math.max(1, Math.min(o.tokens.length, s.tokens.length)) > 0.7;
    });
    if (!dup) out.push(s);
  }
  return out;
}

// ---- Small on-device helpers used in R2 (embeddings, classification) ----

/** Hashed bag-of-words embedding (384 dims, L2-normalized): a deterministic stand-in embedding model. */
export function embed(text: string, dims = 384): Float32Array {
  const v = new Float32Array(dims);
  const toks = tokenize(text);
  for (let i = 0; i < toks.length; i++) {
    for (const g of [toks[i]!, i + 1 < toks.length ? `${toks[i]} ${toks[i + 1]}` : '']) {
      if (!g) continue;
      let h = 2166136261;
      for (let k = 0; k < g.length; k++) h = Math.imul(h ^ g.charCodeAt(k), 16777619);
      const idx = (h >>> 0) % dims;
      v[idx]! += (h & 1 ? 1 : -1) * (g.includes(' ') ? 0.5 : 1);
    }
  }
  let norm = 0;
  for (const x of v) norm += x * x;
  norm = Math.sqrt(norm) || 1;
  for (let i = 0; i < dims; i++) v[i]! /= norm;
  return v;
}
