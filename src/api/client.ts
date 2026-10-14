// Typed client for one Studio (public API v1). One instance per machine.
import { ApiError } from './errors';
import { readSse, type SseFrame } from './sse';
import { directTransport, type Transport } from './transport';
import type {
  CreateRunBody,
  InteractionResponse,
  MachineInfo,
  MessagePage,
  Model,
  Page,
  Project,
  RoadmapEnvelope,
  RoadmapMutation,
  RoadmapWorkAccept,
  RoadmapWorkBody,
  Run,
  RunEvent,
  SendMessageBody,
  Session,
  StopResult,
  SyncResult,
  SyncState,
} from './types';

export type FetchLike = (input: string, init?: Record<string, unknown>) => Promise<{
  ok: boolean;
  status: number;
  headers: { get(name: string): string | null };
  body?: unknown;
  json(): Promise<unknown>;
  text(): Promise<string>;
}>;

export type ClientOptions = {
  baseUrl: string;
  token: string;
  transport?: Transport;
  fetch?: FetchLike;
  timeoutMs?: number;
};

type CallOptions = {
  query?: Record<string, string | number | undefined>;
  body?: unknown;
  signal?: AbortSignal;
  timeoutMs?: number;
  headers?: Record<string, string>;
};

const DEFAULT_TIMEOUT = 15_000;
const SYNC_TIMEOUT = 180_000; // a full R2 cycle can be long
const START_TIMEOUT = 60_000;
const SILENCE_LIMIT = 45_000; // Studio sends a heartbeat every 15 s

function linkSignals(timeoutMs: number, outer?: AbortSignal) {
  const controller = new AbortController();
  let timedOut = false;
  const timer = timeoutMs > 0 ? setTimeout(() => ((timedOut = true), controller.abort()), timeoutMs) : undefined;
  const onAbort = () => controller.abort();
  if (outer) {
    if (outer.aborted) controller.abort();
    else outer.addEventListener('abort', onAbort);
  }
  return {
    signal: controller.signal,
    timedOut: () => timedOut,
    done() {
      if (timer) clearTimeout(timer);
      outer?.removeEventListener('abort', onAbort);
    },
  };
}

export class StudioClient {
  readonly baseUrl: string;
  private readonly token: string;
  private readonly transport: Transport;
  private readonly fetchImpl: FetchLike;
  private readonly timeoutMs: number;

  constructor(options: ClientOptions) {
    this.baseUrl = options.baseUrl;
    this.token = options.token;
    this.transport = options.transport ?? directTransport;
    this.fetchImpl = options.fetch ?? ((input, init) => (globalThis.fetch as unknown as FetchLike)(input, init));
    this.timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT;
  }

  private request(method: string, path: string, options: CallOptions, accept = 'application/json') {
    const query = Object.entries(options.query ?? {})
      .filter(([, value]) => value !== undefined)
      .map(([key, value]) => `${encodeURIComponent(key)}=${encodeURIComponent(String(value))}`)
      .join('&');
    const target = this.transport.target(this.baseUrl, `/api/v1${path}${query ? `?${query}` : ''}`);
    const headers: Record<string, string> = {
      Accept: accept,
      Authorization: `Bearer ${this.token}`,
      ...target.headers,
      ...options.headers,
    };
    if (options.body !== undefined) headers['Content-Type'] = 'application/json';
    return { url: target.url, headers };
  }

  private async call<T>(method: string, path: string, options: CallOptions = {}): Promise<T> {
    const { url, headers } = this.request(method, path, options);
    const link = linkSignals(options.timeoutMs ?? this.timeoutMs, options.signal);
    let response;
    try {
      response = await this.fetchImpl(url, {
        method,
        headers,
        body: options.body === undefined ? undefined : JSON.stringify(options.body),
        signal: link.signal,
      });
    } catch {
      link.done();
      if (link.timedOut()) throw new ApiError('timeout', 'The Studio did not answer in time.');
      if (options.signal?.aborted) throw new ApiError('aborted', 'Request cancelled.');
      throw new ApiError('network', 'The Studio could not be reached.');
    }
    try {
      const text = await response.text();
      let data: unknown = null;
      if (text) {
        try {
          data = JSON.parse(text);
        } catch {
          if (response.ok) throw new ApiError('parse', 'The Studio sent an unreadable answer.', { status: response.status });
        }
      }
      if (!response.ok) {
        const body = (data ?? {}) as { error?: string; code?: string; currentRevision?: number };
        throw new ApiError('http', body.error || `HTTP ${response.status}`, {
          status: response.status,
          code: body.code,
          currentRevision: body.currentRevision,
        });
      }
      return data as T;
    } catch (error) {
      if (error instanceof ApiError) throw error;
      if (link.timedOut()) throw new ApiError('timeout', 'The Studio did not answer in time.');
      throw new ApiError('network', 'The connection to the Studio was interrupted.');
    } finally {
      link.done();
    }
  }

  private async all<T>(path: string, signal?: AbortSignal): Promise<T[]> {
    const items: T[] = [];
    let offset: number | null = 0;
    while (offset !== null) {
      const page: Page<T> = await this.call<Page<T>>('GET', path, { query: { limit: 200, offset }, signal });
      items.push(...page.items);
      offset = page.nextOffset;
    }
    return items;
  }

  machine(signal?: AbortSignal) {
    return this.call<MachineInfo>('GET', '/machine', { signal });
  }
  syncState(signal?: AbortSignal) {
    return this.call<SyncState>('GET', '/sync', { signal });
  }
  projects(signal?: AbortSignal) {
    return this.all<Project>('/projects', signal);
  }
  models(signal?: AbortSignal) {
    return this.all<Model>('/models', signal);
  }
  sessions(projectId: string, signal?: AbortSignal) {
    return this.all<Session>(`/projects/${encodeURIComponent(projectId)}/sessions`, signal);
  }
  messages(sessionId: string, page: { limit?: number; offset?: number } = {}, signal?: AbortSignal) {
    return this.call<MessagePage>('GET', `/sessions/${encodeURIComponent(sessionId)}/messages`, {
      query: { limit: page.limit ?? 200, offset: page.offset ?? 0 },
      signal,
    });
  }
  runs(signal?: AbortSignal) {
    return this.all<Run>('/runs', signal);
  }
  run(runId: string, signal?: AbortSignal) {
    return this.call<Run>('GET', `/runs/${encodeURIComponent(runId)}`, { signal });
  }
  stop(runId: string) {
    return this.call<StopResult>('POST', `/runs/${encodeURIComponent(runId)}/stop`, { body: {} });
  }
  answer(runId: string, id: string, response: InteractionResponse) {
    return this.call<unknown>('POST', `/runs/${encodeURIComponent(runId)}/interactions`, { body: { id, response } });
  }
  createRun(projectId: string, body: CreateRunBody) {
    return this.call<Run>('POST', `/projects/${encodeURIComponent(projectId)}/runs`, { body, timeoutMs: START_TIMEOUT });
  }
  sendMessage(sessionId: string, body: SendMessageBody) {
    return this.call<unknown>('POST', `/sessions/${encodeURIComponent(sessionId)}/messages`, { body });
  }
  syncProject(projectId: string, sessionId?: string) {
    return this.call<SyncResult>('POST', `/projects/${encodeURIComponent(projectId)}/sync`, {
      body: sessionId ? { sessionId } : {},
      timeoutMs: SYNC_TIMEOUT,
    });
  }
  roadmap(projectId: string, signal?: AbortSignal) {
    return this.call<RoadmapEnvelope>('GET', `/projects/${encodeURIComponent(projectId)}/roadmap`, { signal });
  }
  mutateRoadmap(projectId: string, mutation: RoadmapMutation) {
    return this.call<RoadmapEnvelope>('POST', `/projects/${encodeURIComponent(projectId)}/roadmap/mutations`, {
      body: mutation,
    });
  }
  roadmapWork(projectId: string, body: RoadmapWorkBody) {
    return this.call<RoadmapWorkAccept>('POST', `/projects/${encodeURIComponent(projectId)}/roadmap/work`, {
      body,
      timeoutMs: START_TIMEOUT,
    });
  }

  /**
   * Follows the event stream of a run until the server closes it (the run ended) or the
   * connection fails. Resolves with the last sequence seen; throws ApiError on failure.
   */
  async events(
    runId: string,
    options: { after?: number; signal?: AbortSignal; onEvent: (event: RunEvent) => void; onOpen?: () => void },
  ): Promise<{ lastSeq: number }> {
    const { url, headers } = this.request('GET', `/runs/${encodeURIComponent(runId)}/events`, {}, 'text/event-stream');
    if (options.after) headers['Last-Event-ID'] = String(options.after);
    const controller = new AbortController();
    const onAbort = () => controller.abort();
    options.signal?.addEventListener('abort', onAbort);
    let lastSeq = options.after ?? 0;
    let silent = false;
    let watchdog: ReturnType<typeof setTimeout> | undefined;
    const arm = () => {
      if (watchdog) clearTimeout(watchdog);
      watchdog = setTimeout(() => ((silent = true), controller.abort()), SILENCE_LIMIT);
    };
    try {
      arm();
      let response;
      try {
        response = await this.fetchImpl(url, { method: 'GET', headers, signal: controller.signal });
      } catch {
        if (options.signal?.aborted) throw new ApiError('aborted', 'Stream closed.');
        throw new ApiError(silent ? 'timeout' : 'network', 'The Studio could not be reached.');
      }
      if (!response.ok) {
        let body: { error?: string; code?: string } = {};
        try {
          body = (await response.json()) as typeof body;
        } catch {}
        throw new ApiError('http', body.error || `HTTP ${response.status}`, { status: response.status, code: body.code });
      }
      options.onOpen?.();
      try {
        await readSse(
          response,
          (frame: SseFrame) => {
            let event: RunEvent;
            try {
              event = JSON.parse(frame.data) as RunEvent;
            } catch {
              return;
            }
            const seq = Number(event.seq ?? frame.id);
            if (Number.isFinite(seq) && seq > lastSeq) lastSeq = seq;
            options.onEvent(event);
          },
          arm,
        );
      } catch {
        if (options.signal?.aborted) throw new ApiError('aborted', 'Stream closed.');
        throw new ApiError(silent ? 'timeout' : 'network', 'The event stream was interrupted.');
      }
      return { lastSeq };
    } finally {
      if (watchdog) clearTimeout(watchdog);
      options.signal?.removeEventListener('abort', onAbort);
    }
  }
}
