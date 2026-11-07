// Provider adapters (P2-AI-03): Gateway, Anthropic, OpenAI, Google, OpenAI-compatible,
// and the on-device engine. All run in the browser process; keys never cross IPC.
import type { ChatMessage, Task } from '../context/prompt';
import type { Chunk } from '../context/chunker';
import { SseParser } from './sse';
import { answerExtractive } from '@vz/components/ai_runtime/extractive';
import type { ProviderId } from '../../prefs/prefs_schema';

export interface GenerateRequest {
  messages: ChatMessage[];
  model: string;
  maxTokens: number;
  signal: AbortSignal;
  /** For engines that work on chunks directly (on-device extractive). */
  task: Task;
  chunks: Chunk[];
}

export interface Provider {
  id: ProviderId;
  name: string;
  location: 'cloud' | 'on-device';
  generate(req: GenerateRequest, onToken: (t: string) => void): Promise<{ text: string }>;
}

export type Fetch = typeof fetch;

export class ProviderError extends Error {
  constructor(message: string, readonly code: 'no-key' | 'auth' | 'quota' | 'network' | 'http' | 'aborted' | 'bad-response') {
    super(message);
  }
}

async function streamSse(res: Response, onData: (event: string, data: string) => void): Promise<void> {
  if (!res.ok) {
    const body = (await res.text().catch(() => '')).slice(0, 300);
    throw new ProviderError(`HTTP ${res.status}: ${body}`, res.status === 401 || res.status === 403 ? 'auth' : res.status === 429 ? 'quota' : 'http');
  }
  if (!res.body) throw new ProviderError('empty response', 'bad-response');
  const parser = new SseParser();
  const reader = res.body.getReader();
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    for (const ev of parser.push(value)) onData(ev.event, ev.data);
  }
}

function wrap<T>(p: Promise<T>, signal: AbortSignal): Promise<T> {
  return p.catch((e: Error) => {
    if (signal.aborted) throw new ProviderError('stopped', 'aborted');
    if (e instanceof ProviderError) throw e;
    const cause = (e as Error & { cause?: { code?: string; message?: string } }).cause;
    throw new ProviderError(cause ? `${e.message}: ${cause.code ?? ''} ${cause.message ?? ''}`.trim() : e.message, 'network');
  });
}

const sys = (m: ChatMessage[]) => m.filter((x) => x.role === 'system').map((x) => x.content).join('\n');
const nonSys = (m: ChatMessage[]) => m.filter((x) => x.role !== 'system');

export function anthropic(key: string, fetcher: Fetch = fetch, base = 'https://api.anthropic.com'): Provider {
  return {
    id: 'anthropic', name: 'Anthropic', location: 'cloud',
    async generate(req, onToken) {
      let text = '';
      await wrap(
        fetcher(`${base}/v1/messages`, {
          method: 'POST', signal: req.signal,
          headers: { 'content-type': 'application/json', 'x-api-key': key, 'anthropic-version': '2023-06-01' },
          body: JSON.stringify({ model: req.model, max_tokens: req.maxTokens, stream: true, system: sys(req.messages), messages: nonSys(req.messages) }),
        }).then((res) =>
          streamSse(res, (event, data) => {
            if (event === 'error') throw new ProviderError(data.slice(0, 300), 'http');
            if (event !== 'content_block_delta') return;
            const d = JSON.parse(data) as { delta?: { type: string; text?: string } };
            if (d.delta?.type === 'text_delta' && d.delta.text) {
              text += d.delta.text;
              onToken(d.delta.text);
            }
          }),
        ),
        req.signal,
      );
      return { text };
    },
  };
}

export function openaiLike(id: ProviderId, name: string, base: string, key: string | null, location: 'cloud' | 'on-device', fetcher: Fetch = fetch): Provider {
  return {
    id, name, location,
    async generate(req, onToken) {
      let text = '';
      const headers: Record<string, string> = { 'content-type': 'application/json' };
      if (key) headers.authorization = `Bearer ${key}`;
      await wrap(
        fetcher(`${base.replace(/\/$/, '')}/chat/completions`, {
          method: 'POST', signal: req.signal, headers,
          body: JSON.stringify({ model: req.model, stream: true, max_tokens: req.maxTokens, messages: req.messages }),
        }).then((res) =>
          streamSse(res, (_e, data) => {
            if (data === '[DONE]') return;
            const d = JSON.parse(data) as { choices?: { delta?: { content?: string } }[] };
            const t = d.choices?.[0]?.delta?.content;
            if (t) {
              text += t;
              onToken(t);
            }
          }),
        ),
        req.signal,
      );
      return { text };
    },
  };
}

export function google(key: string, fetcher: Fetch = fetch, base = 'https://generativelanguage.googleapis.com'): Provider {
  return {
    id: 'google', name: 'Google Gemini', location: 'cloud',
    async generate(req, onToken) {
      let text = '';
      const contents = nonSys(req.messages).map((m) => ({ role: m.role === 'assistant' ? 'model' : 'user', parts: [{ text: m.content }] }));
      await wrap(
        fetcher(`${base}/v1beta/models/${encodeURIComponent(req.model)}:streamGenerateContent?alt=sse`, {
          method: 'POST', signal: req.signal,
          headers: { 'content-type': 'application/json', 'x-goog-api-key': key },
          body: JSON.stringify({ systemInstruction: { parts: [{ text: sys(req.messages) }] }, contents, generationConfig: { maxOutputTokens: req.maxTokens } }),
        }).then((res) =>
          streamSse(res, (_e, data) => {
            const d = JSON.parse(data) as { candidates?: { content?: { parts?: { text?: string }[] } }[] };
            const t = d.candidates?.[0]?.content?.parts?.map((p) => p.text ?? '').join('') ?? '';
            if (t) {
              text += t;
              onToken(t);
            }
          }),
        ),
        req.signal,
      );
      return { text };
    },
  };
}

/** The Vizulla AI Gateway: anonymous rotating device token, metering only (C14). */
export function gateway(base: string, deviceToken: () => Promise<string>, fetcher: Fetch = fetch): Provider {
  return {
    id: 'gateway', name: 'Vizulla Cloud', location: 'cloud',
    async generate(req, onToken) {
      let text = '';
      const token = await deviceToken();
      await wrap(
        fetcher(`${base.replace(/\/$/, '')}/v1/chat`, {
          method: 'POST', signal: req.signal,
          headers: { 'content-type': 'application/json', authorization: `Bearer ${token}` },
          body: JSON.stringify({ model: req.model, max_tokens: req.maxTokens, messages: req.messages }),
        }).then((res) =>
          streamSse(res, (event, data) => {
            if (event === 'error') throw new ProviderError(data, data.includes('quota') ? 'quota' : 'http');
            const d = JSON.parse(data) as { t?: string };
            if (d.t) {
              text += d.t;
              onToken(d.t);
            }
          }),
        ),
        req.signal,
      );
      return { text };
    },
  };
}

/** On-device extractive engine. Streams word by word so the UI behaves like any model. */
export function onDevice(run: (task: Task, chunks: Chunk[]) => Promise<string> = async (t, c) => answerExtractive(t, c)): Provider {
  return {
    id: 'local', name: 'Vizulla on-device', location: 'on-device',
    async generate(req, onToken) {
      const text = await run(req.task, req.chunks);
      for (const piece of text.match(/\S+\s*/g) ?? []) {
        if (req.signal.aborted) throw new ProviderError('stopped', 'aborted');
        onToken(piece);
        await new Promise((r) => setTimeout(r, 4));
      }
      return { text };
    },
  };
}

export function isLocalUrl(url: string): boolean {
  try {
    const h = new URL(url).hostname;
    return h === 'localhost' || h === '127.0.0.1' || h === '[::1]';
  } catch {
    return false;
  }
}
