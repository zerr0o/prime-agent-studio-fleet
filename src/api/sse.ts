// Minimal Server-Sent Events reader over fetch streams (EventSource cannot send
// the Authorization header). Works with expo/fetch on Android, browsers and Node.
export type SseFrame = { id?: string; event?: string; data: string };

/** Incremental parser: feed text, get complete frames. Comments (": heartbeat") are skipped. */
export class SseParser {
  private buffer = '';
  private data: string[] = [];
  private id: string | undefined;
  private event: string | undefined;

  feed(text: string): SseFrame[] {
    this.buffer += text;
    const frames: SseFrame[] = [];
    let index: number;
    while ((index = this.buffer.search(/\r\n|\r|\n/)) >= 0) {
      const line = this.buffer.slice(0, index);
      const newline = this.buffer.startsWith('\r\n', index) ? 2 : 1;
      this.buffer = this.buffer.slice(index + newline);
      if (line === '') {
        if (this.data.length) frames.push({ id: this.id, event: this.event, data: this.data.join('\n') });
        this.data = [];
        this.event = undefined;
        continue;
      }
      if (line.startsWith(':')) continue;
      const colon = line.indexOf(':');
      const field = colon < 0 ? line : line.slice(0, colon);
      let value = colon < 0 ? '' : line.slice(colon + 1);
      if (value.startsWith(' ')) value = value.slice(1);
      if (field === 'data') this.data.push(value);
      else if (field === 'id') this.id = value;
      else if (field === 'event') this.event = value;
    }
    return frames;
  }
}

type StreamLike = { getReader(): { read(): Promise<{ done: boolean; value?: Uint8Array | string }>; cancel?(): Promise<void> } };

/**
 * Reads an SSE response until the server closes it. onActivity fires on every chunk
 * (heartbeats included) so callers can detect a silent connection.
 */
export async function readSse(
  response: { body?: unknown; text(): Promise<string> },
  onFrame: (frame: SseFrame) => void,
  onActivity?: () => void,
): Promise<void> {
  const parser = new SseParser();
  const body = response.body as StreamLike | null | undefined;
  if (!body || typeof body.getReader !== 'function') {
    // Fetch without streaming: frames arrive when the run ends.
    for (const frame of parser.feed((await response.text()) + '\n\n')) onFrame(frame);
    return;
  }
  const reader = body.getReader();
  const decoder = new TextDecoder();
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    onActivity?.();
    const text = typeof value === 'string' ? value : decoder.decode(value, { stream: true });
    for (const frame of parser.feed(text)) onFrame(frame);
  }
  for (const frame of parser.feed(decoder.decode() + '\n\n')) onFrame(frame);
}
