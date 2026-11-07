// On-device intent classifier for the Command Bar (P4-AI-12, CMD-02 R2).
// Labels: navigate · search · ask · command · recall · agent. The deterministic
// URL route always wins before this runs; chips show below 0.7 confidence.
import { tokenize } from './extractive';

export type Intent = 'search' | 'ask' | 'command' | 'recall' | 'agent';

const CUES: Record<Intent, RegExp[]> = {
  ask: [/^(what|why|how|who|when|where|which|does|is|are|can|should|explain|summari[sz]e)\b/i, /\?$/, /\b(this page|this article|the page)\b/i],
  recall: [/\b(yesterday|last (week|month|night)|earlier|i (saw|read|looked at|visited)|that (article|page|video))\b/i, /\b(remember|find again)\b/i],
  command: [/^(open|close|mute|unmute|pin|unpin|switch|move|new|create|rename|delete|group|split|show|hide|make|turn|zoom|toggle|go to (my )?(settings|history|downloads))\b/i, /\b(space|tab|tabs|sidebar|theme|dark mode|text bigger|zoom)\b/i],
  agent: [/^(book|buy|order|reserve|fill|apply|subscribe|schedule|send|pay|sign up)\b/i, /\bfor me\b/i],
  search: [/./],
};

export function classifyIntent(text: string): { label: Intent; confidence: number }[] {
  const q = text.trim();
  const scores: Record<Intent, number> = { search: 0.35, ask: 0, command: 0, recall: 0, agent: 0 };
  for (const [label, res] of Object.entries(CUES) as [Intent, RegExp[]][]) {
    if (label === 'search') continue;
    for (const re of res) if (re.test(q)) scores[label] += 0.45;
  }
  const words = tokenize(q).length;
  if (words <= 2 && !scores.command) scores.search += 0.3;
  if (words >= 5 && scores.ask) scores.ask += 0.1;
  const total = Object.values(scores).reduce((a, b) => a + b, 0) || 1;
  return (Object.entries(scores) as [Intent, number][])
    .map(([label, s]) => ({ label, confidence: Math.min(0.99, s / total) }))
    .sort((a, b) => b.confidence - a.confidence);
}
