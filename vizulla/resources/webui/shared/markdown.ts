// Minimal, safe Markdown → Lit templates for assistant answers: paragraphs,
// bullets, numbered lists, bold, code, tables, and [cN] citation chips.
// No raw HTML is ever rendered: all text goes through Lit's escaping.
import { html, nothing, type TemplateResult } from 'lit';

export type CiteRenderer = (id: string) => TemplateResult;

function inline(text: string, cite: CiteRenderer): (TemplateResult | string)[] {
  const out: (TemplateResult | string)[] = [];
  const re = /\[((?:[a-z]+\d+|t\d+c\d+)(?:\s*,\s*(?:[a-z]+\d+|t\d+c\d+))*)\]|\*\*([^*]+)\*\*|`([^`]+)`/gi;
  let last = 0;
  for (const m of text.matchAll(re)) {
    if (m.index! > last) out.push(text.slice(last, m.index));
    if (m[1]) for (const id of m[1].split(',')) out.push(cite(id.trim().toLowerCase()));
    else if (m[2]) out.push(html`<strong>${m[2]}</strong>`);
    else if (m[3]) out.push(html`<code>${m[3]}</code>`);
    last = m.index! + m[0].length;
  }
  if (last < text.length) out.push(text.slice(last));
  return out;
}

export function renderMarkdown(src: string, cite: CiteRenderer): TemplateResult {
  const lines = src.replace(/\r/g, '').split('\n');
  const blocks: TemplateResult[] = [];
  let i = 0;
  while (i < lines.length) {
    const line = lines[i]!;
    if (!line.trim()) {
      i++;
      continue;
    }
    if (/^\s*\|.*\|\s*$/.test(line)) {
      const rows: string[][] = [];
      while (i < lines.length && /^\s*\|.*\|\s*$/.test(lines[i]!)) {
        const cells = lines[i]!.trim().slice(1, -1).split('|').map((c) => c.trim());
        if (!cells.every((c) => /^:?-{2,}:?$/.test(c))) rows.push(cells);
        i++;
      }
      const [head, ...body] = rows;
      blocks.push(html`<div class="md-table"><table><thead><tr>${head?.map((c) => html`<th>${inline(c, cite)}</th>`)}</tr></thead>
        <tbody>${body.map((r) => html`<tr>${r.map((c) => html`<td>${inline(c, cite)}</td>`)}</tr>`)}</tbody></table></div>`);
      continue;
    }
    if (/^\s*([-*•]|\d+[.)])\s+/.test(line)) {
      const ordered = /^\s*\d/.test(line);
      const items: string[] = [];
      while (i < lines.length && /^\s*([-*•]|\d+[.)])\s+/.test(lines[i]!)) items.push(lines[i++]!.replace(/^\s*([-*•]|\d+[.)])\s+/, ''));
      const lis = items.map((it) => html`<li>${inline(it, cite)}</li>`);
      blocks.push(ordered ? html`<ol>${lis}</ol>` : html`<ul>${lis}</ul>`);
      continue;
    }
    const h = /^(#{1,4})\s+(.*)$/.exec(line);
    if (h) {
      blocks.push(html`<p class="md-h">${inline(h[2]!, cite)}</p>`);
      i++;
      continue;
    }
    const para: string[] = [];
    while (i < lines.length && lines[i]!.trim() && !/^\s*([-*•]|\d+[.)])\s+|^\s*\|/.test(lines[i]!)) para.push(lines[i++]!);
    blocks.push(html`<p>${inline(para.join(' '), cite)}</p>`);
  }
  return blocks.length ? html`${blocks}` : html`${nothing}`;
}
