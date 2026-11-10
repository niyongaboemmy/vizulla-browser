import { describe, expect, it } from 'vitest';
import { summaryIntent } from './summary_intent';

describe('typed summary requests', () => {
  it('run the summary, in every UI language', () => {
    for (const q of ['Summarize this page', 'summarise the article', 'Summarize', 'summary please', 'Give me the key points of this page', 'Main points', 'Résume cette page', 'Résumé', 'Points clés de la page', 'Fupisha ukurasa huu', 'Incamake y’urupapuro', 'Can you summarize this page?'])
      expect(summaryIntent(q), q).toBe('key-points');
    expect(summaryIntent('TL;DR')).toBe('tldr');
    expect(summaryIntent('tldr of this page')).toBe('tldr');
    expect(summaryIntent('Outline this page')).toBe('outline');
  });

  it('leave questions, and requests about one part of the page, to the question path', () => {
    for (const q of ['Where can I drink coffee?', 'What does the summary table say about prices?', 'Summarize the section about pricing', 'summarize the paragraph on altitude', '', 'Summarize this page in the style of a pirate who explains everything to a five-year-old child, step by step'])
      expect(summaryIntent(q), q).toBeNull();
  });
});
