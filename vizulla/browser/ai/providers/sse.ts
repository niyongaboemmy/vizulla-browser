// Server-sent events parser for streaming provider responses. Handles chunk
// boundaries anywhere (mid-line, mid-UTF-8 is handled by TextDecoder stream mode).
export interface SseEvent {
  event: string;
  data: string;
}

export class SseParser {
  private buf = '';
  private decoder = new TextDecoder();

  push(chunk: Uint8Array | string): SseEvent[] {
    this.buf += typeof chunk === 'string' ? chunk : this.decoder.decode(chunk, { stream: true });
    const out: SseEvent[] = [];
    let idx: number;
    while ((idx = this.buf.search(/\r?\n\r?\n/)) >= 0) {
      const raw = this.buf.slice(0, idx);
      this.buf = this.buf.slice(idx).replace(/^\r?\n\r?\n/, '');
      let event = 'message';
      const data: string[] = [];
      for (const line of raw.split(/\r?\n/)) {
        if (!line || line.startsWith(':')) continue;
        const i = line.indexOf(':');
        const field = i < 0 ? line : line.slice(0, i);
        const value = i < 0 ? '' : line.slice(i + 1).replace(/^ /, '');
        if (field === 'event') event = value;
        else if (field === 'data') data.push(value);
      }
      if (data.length) out.push({ event, data: data.join('\n') });
    }
    if (this.buf.length > 1_000_000) throw new Error('SSE event too large');
    return out;
  }
}
