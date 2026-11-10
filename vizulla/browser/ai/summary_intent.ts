// A typed request for a summary ("Summarize this page", "tl;dr", "Résume cette page",
// "Fupisha ukurasa huu", "Incamake…") runs the summary task, like the quick actions, instead of
// a search for those words on the page. Pure (summary_intent.test.ts).

export type SummaryStyle = 'tldr' | 'key-points' | 'outline';

const TLDR = /^\s*(tl;?\s*dr|in (one|a) (sentence|line)|en une phrase|kwa sentensi moja)(?!\p{L})/iu;
const OUTLINE = /^\s*(outline|give (me )?an outline|plan( de)? (la|cette) page|muhtasari wa vichwa)(?!\p{L})/iu;
const SUMMARY = /^\s*(please\s+)?(can you\s+|could you\s+)?(summari[sz]e|sum (it|this) up|summary|key points|main points|give (me )?(a |the )?(summary|key points|main points|gist)|r[ée]sum(e|é|er)|points cl[ée]s|fupisha|muhtasari|incamake|vuga muri make)(?!\p{L})/iu;

/** The summary a typed request asks for, or null when it's a question about the page. */
export function summaryIntent(text: string): SummaryStyle | null {
  const q = text.trim();
  // Long requests carry their own instructions ("summarize the pricing section for a child"): a question.
  if (!q || q.length > 80) return null;
  if (TLDR.test(q)) return 'tldr';
  if (OUTLINE.test(q)) return 'outline';
  if (!SUMMARY.test(q)) return null;
  // "Summarize the section about pricing" asks about part of the page: the question path finds it.
  return /\b(section|paragraph|part|chapter|partie|paragraphe|sehemu|igice)\b/i.test(q) ? null : 'key-points';
}
