// ai_runtime utility process (P4-AI-01): on-device inference behind one RPC
// interface: generate (extractive engine), embed, classify, status. No network.
// Model weights would arrive as read-only handles chosen by the browser; the
// built-in engines need none.
import { answerExtractive, embed, type EngineTask } from './extractive';
import { classifyIntent } from './intent';
import { serve } from '../utility_child';

const started = Date.now();
let requests = 0;

serve({
  __init: () => true,
  generate: (p: { task: EngineTask; chunks: { id: string; text: string }[] }) => {
    requests++;
    return answerExtractive(p.task, p.chunks.slice(0, 200));
  },
  embed: (p: { texts: string[] }) => {
    requests++;
    // Transfer as plain arrays (structured clone).
    return p.texts.slice(0, 256).map((t) => Array.from(embed(t)));
  },
  classify: (p: { text: string }) => classifyIntent(String(p.text).slice(0, 500)),
  status: () => ({ models: ['vz-extractive-1', 'vz-embed-hash-384', 'vz-intent-1'], rssMb: Math.round(process.memoryUsage().rss / 1048576), uptimeS: Math.round((Date.now() - started) / 1000), requests }),
  crash: () => process.exit(3), // test hook: simulates a runtime crash (REL-02)
});
