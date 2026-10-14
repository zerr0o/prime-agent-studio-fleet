#!/usr/bin/env node
// Multi-machine Prime Agent Studio simulator (public API v1) for Prime Fleet tests and demos.
// Dependency-free Node ES module. CLI: node sim/studio-sim.mjs [--base-port 3101] [--speed 1]
import { createServer } from 'node:http';
import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import {
  ApiError,
  canonicalJson,
  checkTargets,
  clone,
  contentHash,
  diffCount,
  emptyDoc,
  mergeDocs,
  mutateDoc,
  toDto,
} from './roadmap.mjs';
import { MACHINE_DEFS, MODEL, THINKING, buildSeed, projectIdFor } from './seed.mjs';

const HOUR = 3600_000;
const SYNC_DELAY = 300;
const STUDIO_VERSION = '0.9.8-sim';
const ID = /^[A-Za-z0-9][A-Za-z0-9_-]{0,199}$/;
const REQUEST_ID = /^[A-Za-z0-9_-]{16,100}$/;
const THINKING_LEVELS = ['off', 'minimal', 'low', 'medium', 'high', 'xhigh', 'max'];
const fail = (status, code, message, extra) => new ApiError(status, code, message, extra);
const missing = () => fail(404, 'not_found', 'Resource not found.');
const invalidRequest = (message) => fail(400, 'invalid_request', message);
const hex = (n = 8) => randomBytes(n).toString('hex');
const sha = (value) => createHash('sha256').update(value).digest('hex');
const isoNow = () => new Date().toISOString();

const MODELS = [
  { id: MODEL, name: 'Claude Sonnet 5.5', provider: 'anthropic', input: 'text,image', reasoning: true, thinkingLevels: THINKING_LEVELS, contextWindow: 1000000, availability: 'available' },
  { id: 'openai-codex/gpt-6-astra', name: 'GPT-6 Astra', provider: 'openai-codex', input: 'text,image', reasoning: true, thinkingLevels: THINKING_LEVELS, contextWindow: 1000000, availability: 'available' },
  { id: 'openai/gpt-5.5', name: 'GPT-5.5', provider: 'openai', input: 'text,image', reasoning: true, thinkingLevels: THINKING_LEVELS.slice(0, 6), contextWindow: 400000, availability: 'available' },
];

const pick = (value, keys) => Object.fromEntries(keys.filter((key) => value?.[key] !== undefined).map((key) => [key, value[key]]));
const messageDto = (message) => ({
  ...pick(message, ['id', 'role', 'text', 'thinking', 'timestamp', 'usage', 'model', 'provider', 'error', 'stopReason', 'customType', 'contextKind', 'agentMessage']),
  tools: (message.tools || []).map((tool) => pick(tool, ['id', 'name', 'args', 'status', 'result', 'isError'])),
  attachments: (message.attachments || []).map((a) => pick(a, ['type', 'id', 'name', 'size', 'mimeType'])),
});

// ---------------------------------------------------------------------------------------------
// HTTP helpers
// ---------------------------------------------------------------------------------------------
function send(res, status, value, headers = {}) {
  if (res.destroyed || res.writableEnded) return;
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', ...headers });
  res.end(JSON.stringify(value));
}
function sendError(res, error) {
  const status = Number.isInteger(error?.status) && error.status >= 400 && error.status <= 599 ? error.status : 500;
  if (res.headersSent) return res.destroy();
  const headers = status === 401 ? { 'WWW-Authenticate': 'Bearer realm="Prime Agent Studio"' } : {};
  send(
    res,
    status,
    {
      error: status >= 500 ? 'The operation could not be completed.' : error.message,
      code: typeof error.code === 'string' ? error.code : 'internal_error',
      ...(Number.isSafeInteger(error.currentRevision) ? { currentRevision: error.currentRevision } : {}),
    },
    headers,
  );
}
async function readJson(req, { required = false } = {}) {
  const chunks = [];
  let bytes = 0;
  for await (const chunk of req) {
    bytes += chunk.length;
    if (bytes > 1024 * 1024) throw fail(413, 'body_too_large', 'Request body too large.');
    chunks.push(chunk);
  }
  const raw = Buffer.concat(chunks).toString('utf8').trim();
  if (!raw) {
    if (required) throw invalidRequest('A JSON body is required.');
    return {};
  }
  try {
    return JSON.parse(raw);
  } catch {
    throw invalidRequest('Invalid JSON body.');
  }
}
function pagination(url, allowed = ['limit', 'offset']) {
  const seen = new Set();
  for (const key of url.searchParams.keys()) {
    if (!allowed.includes(key) || seen.has(key)) throw fail(400, 'invalid_query', 'Unknown or repeated query parameter.');
    seen.add(key);
  }
  const integer = (key, fallback, maximum) => {
    const raw = url.searchParams.get(key);
    if (raw === null) return fallback;
    const value = Number(raw);
    if (!/^\d+$/.test(raw) || !Number.isSafeInteger(value) || value > maximum || value < (key === 'limit' ? 1 : 0))
      throw fail(400, 'invalid_query', 'Invalid pagination or event cursor.');
    return value;
  };
  return { limit: integer('limit', 50, 200), offset: integer('offset', 0, Number.MAX_SAFE_INTEGER) };
}
const page = (items, { limit, offset }) => ({
  items: items.slice(offset, offset + limit),
  nextOffset: offset + limit < items.length ? offset + limit : null,
});
const isRecord = (v) => !!v && typeof v === 'object' && !Array.isArray(v);
function hasForbiddenKeys(value, depth = 0) {
  if (depth > 100) return true;
  if (Array.isArray(value)) return value.some((v) => hasForbiddenKeys(v, depth + 1));
  if (isRecord(value))
    return Object.entries(value).some(([k, v]) => ['completion', 'machineId', 'completedAt'].includes(k) || hasForbiddenKeys(v, depth + 1));
  return false;
}
function checkOptionalCommon(body) {
  if (body.sessionId !== undefined && (typeof body.sessionId !== 'string' || !ID.test(body.sessionId)))
    throw invalidRequest('sessionId is invalid.');
  if (body.model !== undefined && (typeof body.model !== 'string' || body.model.length > 300 || /[\r\n\0]/.test(body.model)))
    throw invalidRequest('model is invalid.');
  if (body.thinking !== undefined && !THINKING_LEVELS.includes(body.thinking)) throw invalidRequest('thinking is invalid.');
}
function checkRequestId(value) {
  if (typeof value !== 'string' || !REQUEST_ID.test(value)) throw invalidRequest('requestId must match [A-Za-z0-9_-]{16,100}.');
}
function checkUnknown(body, allowed, label) {
  if (!isRecord(body)) throw invalidRequest(`${label} must be a JSON object.`);
  for (const key of Object.keys(body)) if (!allowed.includes(key)) throw invalidRequest(`${label} has an unknown field: ${key}.`);
}

// Operation table: [method, path, scopes, id]
const OPS = [
  ['GET', '/api/v1/machine', ['read'], 'machine'],
  ['GET', '/api/v1/computer-use', ['read'], 'computerUse'],
  ['POST', '/api/v1/computer-use', ['read', 'computer:write'], 'setComputerUse'],
  ['GET', '/api/v1/sync', ['read'], 'syncState'],
  ['GET', '/api/v1/projects', ['read'], 'projects'],
  ['GET', '/api/v1/models', ['read'], 'models'],
  ['GET', '/api/v1/projects/{projectId}/sessions', ['read'], 'sessions'],
  ['GET', '/api/v1/sessions/{sessionId}/messages', ['read'], 'messages'],
  ['POST', '/api/v1/sessions/{sessionId}/messages', ['read', 'runs:write'], 'sendMessage'],
  ['POST', '/api/v1/projects/{projectId}/runs', ['read', 'runs:write'], 'createRun'],
  ['GET', '/api/v1/runs', ['read'], 'runs'],
  ['GET', '/api/v1/runs/{runId}', ['read'], 'run'],
  ['GET', '/api/v1/runs/{runId}/events', ['read'], 'events'],
  ['POST', '/api/v1/runs/{runId}/stop', ['read', 'runs:write'], 'stop'],
  ['POST', '/api/v1/runs/{runId}/interactions', ['read', 'runs:write'], 'interaction'],
  ['POST', '/api/v1/projects/{projectId}/sync', ['read', 'sync:write'], 'syncProject'],
  ['GET', '/api/v1/projects/{projectId}/roadmap', ['read'], 'roadmap'],
  ['POST', '/api/v1/projects/{projectId}/roadmap/mutations', ['read', 'roadmaps:write'], 'mutateRoadmap'],
  ['POST', '/api/v1/projects/{projectId}/roadmap/work', ['read', 'runs:write', 'roadmaps:write'], 'roadmapWork'],
  ['GET', '/api/v1/sessions/{sessionId}/files', ['read'], 'files'],
  ['GET', '/api/v1/sessions/{sessionId}/files/{fileId}', ['read', 'files:download'], 'download'],
  ['HEAD', '/api/v1/sessions/{sessionId}/files/{fileId}', ['read', 'files:download'], 'fileHead'],
].map(([method, path, scopes, operationId]) => ({
  method,
  path,
  scopes,
  operationId,
  names: [...path.matchAll(/\{(\w+)\}/g)].map((m) => m[1]),
  pattern: new RegExp('^' + path.replace(/\{\w+\}/g, '([^/]+)') + '$'),
}));

// ---------------------------------------------------------------------------------------------
// Simulator
// ---------------------------------------------------------------------------------------------
/**
 * @param {{ basePort?: number, speed?: number, seed?: string, heartbeatMs?: number }} [options]
 */
export async function startSimulator({ basePort = 3101, speed = 1, seed = 'demo', heartbeatMs = 15000 } = {}) {
  const sim = { speed: Math.max(0.01, Number(speed) || 1), seed, heartbeatMs, bucket: new Map(), bucketDown: false, chain: Promise.resolve(), closed: false };
  /** @type {any[]} */
  const machines = MACHINE_DEFS.map((def) => ({
    def,
    name: def.name,
    machineId: def.machineId,
    token: def.token,
    readOnlyToken: def.token.replace('-token', '-readonly-token'),
    port: 0,
    url: '',
    server: null,
    sockets: new Set(),
    offline: false,
    projects: new Map(),
    runs: new Map(),
    requests: new Map(),
    activity: new Map(),
    activityRevision: 0,
    instanceId: randomUUID(),
    nextScenario: 'normal',
    lastSync: null,
    syncing: 0,
  }));
  const byName = (name) => {
    const m = machines.find((x) => x.name.toLowerCase() === String(name).toLowerCase());
    if (!m) throw fail(404, 'unknown_machine', `Unknown machine: ${name}`);
    return m;
  };

  // ----- seed / reset -----
  function abortRuns(m) {
    for (const run of m.runs.values()) {
      run.aborted = true;
      run.wake?.();
      run.waiting?.resolve({ cancelled: true });
      for (const client of run.clients) client.end();
      run.clients.clear();
      clearInterval(run.heartbeat);
    }
  }
  function loadSeed() {
    const t0 = Date.now();
    const data = buildSeed(sim.seed, t0, machines.map((m) => m.machineId));
    sim.bucket = new Map(Object.entries(data.bucket).map(([syncId, e]) => [syncId, { doc: clone(e.doc), sessions: new Map(e.sessions.map((s) => [s.id, clone(s)])) }]));
    sim.bucketDown = false;
    machines.forEach((m, i) => {
      abortRuns(m);
      m.projects = new Map();
      m.runs = new Map();
      m.requests = new Map();
      m.activity = new Map();
      m.activityRevision++;
      m.nextScenario = 'normal';
      m.lastSync = m.def.syncConfigured ? { at: new Date(t0 - 25 * 60_000).toISOString(), ok: true, sent: 0, received: 0 } : null;
      for (const p of data.machines[i]) {
        const id = projectIdFor(sim.seed, m.name, p.name);
        m.projects.set(id, {
          id,
          name: p.name,
          syncId: p.syncId,
          exists: true,
          sync: true,
          doc: clone(p.doc),
          sessions: new Map(p.sessions.map((s) => [s.id, clone(s)])),
        });
      }
    });
  }
  loadSeed();

  // ----- lookups / DTOs -----
  const projectDto = (m, p) => ({ id: p.id, name: p.name, syncId: p.syncId, exists: p.exists, machineId: m.machineId });
  const sessionDto = (m, p, s) => ({ ...pick(s, ['id', 'title', 'createdAt', 'updatedAt', 'model', 'thinking']), machineId: m.machineId, projectId: p.id });
  function findSession(m, id) {
    for (const p of m.projects.values()) if (p.sessions.has(id)) return { project: p, session: p.sessions.get(id) };
    return null;
  }
  function pruneRuns(m) {
    for (const [id, run] of m.runs) if (run.finished && Date.now() - Date.parse(run.endedAt) > HOUR) m.runs.delete(id);
  }
  const activeRuns = (m) => [...m.runs.values()].filter((r) => ['running', 'stopping'].includes(r.status));
  function runDto(m, run) {
    return {
      ...pick(run, ['id', 'status', 'startedAt', 'endedAt', 'error', 'model', 'thinking', 'allowQuestions']),
      sessionId: run.sessionId || null,
      projectId: run.project.id,
      machineId: m.machineId,
      interactions: clone(run.interactions),
      ...(run.apiRequestId ? { requestId: run.apiRequestId } : {}),
    };
  }
  function roadmapDto(m, p) {
    return {
      ...toDto(p.name, p.doc),
      instanceId: m.instanceId,
      activityRevision: m.activityRevision,
      activity: [...m.activity.values()].filter((a) => a.projectId === p.id).map(({ projectId, ...item }) => clone(item)),
      linkWarnings: [],
    };
  }
  const roadmapEnvelope = (m, p) => ({ machineId: m.machineId, projectId: p.id, roadmap: roadmapDto(m, p) });
  const setDoc = (p, doc) => {
    p.doc = doc;
  };

  // ----- idempotency (one hour per project, failures cached too) -----
  function once(m, key, value, action) {
    for (const [id, entry] of m.requests) if (entry.until <= Date.now()) m.requests.delete(id);
    const hash = sha(canonicalJson(value));
    const old = m.requests.get(key);
    if (old) {
      if (old.hash !== hash) throw fail(409, 'request_conflict', 'This requestId was used for different input.');
      return old.result;
    }
    if (m.requests.size >= 1000) throw fail(429, 'too_many_requests', 'Too many retained requests.');
    const result = Promise.resolve().then(action);
    result.catch(() => {});
    m.requests.set(key, { hash, result, until: Date.now() + HOUR });
    return result;
  }

  // ----- run events (mirrors server.mjs pushEvent / subscribe) -----
  function setActivity(m, run, on) {
    if (on) {
      m.activity.set(run.id, {
        projectId: run.project.id,
        sessionId: run.sessionId,
        rootSessionId: run.sessionId,
        name: 'Prime Agent',
        targets: clone(run.targets),
      });
      m.activityRevision++;
    } else if (m.activity.delete(run.id)) m.activityRevision++;
  }
  const wireEvent = (m, run, item) => {
    const value = { ...item };
    if (value.message) value.message = messageDto(value.message);
    return { ...value, machineId: m.machineId, projectId: run.project.id, runId: run.id };
  };
  function pushEvent(m, run, event) {
    if (run.finished) return;
    if (event.kind === 'interaction') {
      const index = run.interactions.findIndex((i) => i.id === event.request.id);
      if (index < 0) run.interactions.push(clone(event.request));
      else run.interactions[index] = clone(event.request);
    }
    if (event.kind === 'session' && event.sessionId) run.sessionId = event.sessionId;
    if (event.kind === 'done') {
      run.finished = true;
      run.status = event.status || ((event.code ?? 0) === 0 ? 'completed' : 'failed');
      run.error = event.error || null;
      run.endedAt = isoNow();
      setActivity(m, run, false);
    }
    const item = { ...event, seq: ++run.seq };
    const wire = `id: ${item.seq}\ndata: ${JSON.stringify(wireEvent(m, run, item))}\n\n`;
    run.events.push({ item, wire });
    for (const client of run.clients) client.write(wire);
    if (run.finished) {
      clearInterval(run.heartbeat);
      for (const client of run.clients) client.end();
      run.clients.clear();
      run.resolveDone();
    }
  }
  function subscribe(m, req, res, run, url) {
    let after = Number(req.headers['last-event-id'] || url.searchParams.get('after') || 0);
    if (!Number.isSafeInteger(after) || after < 0) after = 0;
    res.writeHead(200, {
      'Content-Type': 'text/event-stream; charset=utf-8',
      'Cache-Control': 'no-cache, no-transform',
      Connection: 'keep-alive',
      'X-Accel-Buffering': 'no',
    });
    res.write(': connected\n\n');
    if (run.events[0] && run.events[0].item.seq > after + 1)
      res.write(`data: ${JSON.stringify({ kind: 'replay_truncated', sessionId: run.sessionId, machineId: m.machineId, projectId: run.project.id, runId: run.id })}\n\n`);
    for (const e of run.events) if (e.item.seq > after) res.write(e.wire);
    if (run.finished) return void res.end();
    run.clients.add(res);
    const beat = setInterval(() => res.write(': heartbeat\n\n'), sim.heartbeatMs);
    beat.unref();
    res.on('close', () => {
      clearInterval(beat);
      run.clients.delete(res);
    });
  }

  // ----- scenario flags -----
  function scenarioFlags(m, texts) {
    const flags = new Set();
    const joined = texts.join('\n').toLowerCase();
    for (const f of ['fail', 'nocheck', 'ask', 'slow']) if (joined.includes(`[${f}]`)) flags.add(f);
    if (m.nextScenario !== 'normal') flags.add(m.nextScenario);
    m.nextScenario = 'normal';
    return flags;
  }

  // ----- run creation -----
  function newRun(m, project, { session, message, model, thinking, allowQuestions, apiRequestId, targets = [], flags, kind }) {
    const run = {
      id: randomUUID(),
      kind,
      sessionId: session.id,
      project,
      status: 'running',
      startedAt: isoNow(),
      model: model || MODEL,
      thinking: thinking || THINKING,
      allowQuestions: allowQuestions ?? true,
      interactions: [],
      apiRequestId,
      targets,
      flags,
      seq: 0,
      events: [],
      clients: new Set(),
      finished: false,
      stopRequested: false,
      aborted: false,
      wake: null,
      waiting: null,
      heartbeat: null,
    };
    run.done = new Promise((r) => (run.resolveDone = r));
    m.runs.set(run.id, run);
    const at = Date.now();
    session.messages.push({ id: 'm_' + hex(12), role: 'user', text: message, timestamp: new Date(at).toISOString(), tools: [], attachments: [] });
    session.updatedAt = new Date(at).toISOString();
    return run;
  }
  function newSession(project, title, model, thinking) {
    const at = isoNow();
    const session = { id: randomUUID(), title: title.slice(0, 80) || 'New conversation', createdAt: at, updatedAt: at, model: model || MODEL, thinking: thinking || THINKING, messages: [] };
    project.sessions.set(session.id, session);
    return session;
  }
  const FILES = {
    'Nimbus API': ['src/ratelimit/limiter.ts', 'src/auth/keys.ts', 'docs/api.md'],
    'Orbit Web': ['src/components/Dashboard.tsx', 'src/charts/MainChart.tsx', 'src/a11y/focus.ts'],
    'Atlas Mobile': ['app/db/schema.ts', 'app/trips/cache.ts', 'app/sync/queue.ts'],
  };

  // ----- simulated agent -----
  const STOP = Symbol('stop');
  async function agent(m, run, plan) {
    const { project, flags } = run;
    const k = flags.has('slow') ? 4 : 1;
    const nap = (ms) =>
      new Promise((resolveNap) => {
        const timer = setTimeout(finish, Math.max(1, (ms * k) / sim.speed));
        function finish() {
          clearTimeout(timer);
          run.wake = null;
          resolveNap();
        }
        run.wake = finish;
      });
    const wait = async (ms) => {
      await nap(ms);
      if (run.aborted) throw STOP;
      if (run.stopRequested) throw STOP;
    };
    const emit = (event) => !run.aborted && pushEvent(m, run, event);
    const session = project.sessions.get(run.sessionId);
    let transcript = '';
    const tools = [];
    const say = async (textValue) => {
      for (const chunk of textValue.match(/\S+\s*/g) || []) {
        emit({ kind: 'text', delta: chunk });
        transcript += chunk;
        await wait(40);
      }
    };
    const tool = async (name, args, result, { ms = 300, isError = false, update } = {}) => {
      const id = 'toolu_' + hex(8);
      emit({ kind: 'tool_start', id, name, args });
      await wait(ms / 2);
      if (update) {
        emit({ kind: 'tool_update', id, name, result: update });
        await wait(ms / 2);
      }
      emit({ kind: 'tool_end', id, name, result, isError });
      tools.push({ id, name, args, status: isError ? 'error' : 'done', result, isError });
      await wait(ms / 4);
    };
    const finish = (status, extra = {}) => {
      if (run.finished || run.aborted) return;
      const text = transcript.trim();
      if (text || tools.length) {
        const final = {
          id: 'm_' + hex(12),
          role: 'assistant',
          text,
          timestamp: isoNow(),
          model: run.model,
          provider: 'anthropic',
          stopReason: status === 'completed' ? 'stop' : status === 'stopped' ? 'aborted' : 'error',
          ...(status === 'failed' ? { error: extra.error } : {}),
          tools: clone(tools),
          attachments: [],
        };
        session.messages.push(final);
        session.updatedAt = final.timestamp;
        emit({ kind: 'message', message: final });
      }
      emit({ kind: 'status', status: 'turn_end' });
      emit({ kind: 'done', status, code: status === 'completed' ? 0 : status === 'stopped' ? 130 : 1, ...extra });
    };

    try {
      // Activity shows from the first event: the agent has declared its selection.
      if (run.kind === 'work') setActivity(m, run, true);
      await wait(150);
      emit({ kind: 'session', sessionId: session.id, cwd: `/work/${project.name.toLowerCase().replace(/\W+/g, '-')}` });
      await wait(100);
      emit({ kind: 'status', status: 'running' });
      emit({ kind: 'message_start', role: 'assistant' });

      if (run.kind === 'chat') {
        await say('This is a short reply from the simulated agent. ');
        await wait(600);
        if (flags.has('ask')) await ask();
        await say('Nothing in the Roadmap was changed. ');
        await wait(500);
        if (flags.has('fail')) return finish('failed', { error: FAIL_TEXT });
        return finish('completed');
      }

      // Roadmap work.
      const files = FILES[project.name] || ['src/index.ts', 'README.md', 'package.json'];
      await say(`I will read the Roadmap first, then work on "${plan.task}". `);
      await tool('roadmap_read', {}, { revision: project.doc.revision, plans: project.doc.plans.length }, { ms: 500 });
      await tool('roadmap_work', { targets: run.targets }, { active: true, targets: run.targets }, { ms: 400 });
      await say('The task is clear. Let me look at the code. ');
      if (flags.has('ask')) await ask();
      await tool('read', { path: files[0] }, `// ${files[0]}\n(${120 + files[0].length} lines)`, { ms: 500 });
      await say('I found the place to change and I am editing it now. ');
      await tool('edit', { path: files[0], summary: plan.task }, 'Applied 1 edit (+24 -6).', { ms: 700 });
      if (flags.has('fail')) {
        await tool('bash', { command: 'npm test' }, 'FAIL  2 tests failed', { ms: 800, isError: true, update: 'Running 48 tests...' });
        await say('The tests fail and I cannot continue. ');
        return finish('failed', { error: FAIL_TEXT });
      }
      await tool('bash', { command: 'npm test' }, 'PASS  48 tests passed', { ms: 1400, update: 'Running 48 tests...' });
      if (!flags.has('nocheck')) {
        await wait(200);
        const checked = checkPlanTargets(m, run, plan);
        await tool('roadmap_check', { done: true, targets: run.targets }, checked ? `Checked ${plan.task}` : 'Nothing to check', { ms: 500 });
        await say(`Done. I checked "${plan.task}" in the Roadmap. `);
      } else {
        await say('Done. I left the Roadmap step unchecked for you to review. ');
      }
      await wait(300);
      return finish('completed');
    } catch (error) {
      if (error !== STOP) throw error;
      if (run.aborted) return;
      run.waiting = null;
      for (const pending of run.interactions) if (pending.status === 'pending') {
        pending.status = 'cancelled';
        emit({ kind: 'interaction', request: clone(pending) });
      }
      finish('stopped');
    }

    async function ask() {
      const labels = [
        ['Extend the existing module', 'Lowest risk and reuses the current tests'],
        ['Write a new module', 'Cleaner design but more work'],
      ];
      const request = {
        id: 'ui_' + hex(8),
        method: 'select',
        title: 'Which approach should I take?',
        options: [...labels.map(([l, d], i) => `${i + 1}. ${l} — ${d}`), 'Autre réponse / Other answer'],
        optionDetails: [...labels.map(([label, description]) => ({ label, description })), null],
        message: 'The task can be done in two ways. Pick one to continue.',
        toolId: 'toolu_' + hex(8),
        status: 'pending',
        allowCustom: true,
        createdAt: Date.now(),
      };
      const answer = new Promise((resolveAnswer) => (run.waiting = { id: request.id, resolve: resolveAnswer }));
      emit({ kind: 'interaction', request: clone(request) });
      const reply = await answer;
      run.waiting = null;
      if (run.stopRequested || run.aborted) throw STOP;
      await say(reply?.cancelled ? 'No answer given, I will use the safest option. ' : `Thanks, I will go with "${reply.value ?? reply.confirmed}". `);
    }
  }
  const FAIL_TEXT = 'Provider error: the model returned an invalid response (simulated failure).';

  /** The agent's roadmap_check: stamps completion on this machine and bumps the local revision once. */
  function checkPlanTargets(m, run, plan) {
    const project = run.project;
    const jobs = plan.jobs.filter((j) => project.doc.plans.some((p) => p.id === j.planId));
    const actor = { by: 'agent', sessionId: run.sessionId, rootSessionId: run.sessionId, name: 'Prime Agent' };
    const result = checkTargets(project.doc, { jobs, backlogNumbers: plan.backlogNumbers, actor, machineId: m.machineId });
    if (result.changed) setDoc(project, result.doc);
    return result.changed;
  }

  // ----- roadmap work selection (port of lib/roadmap-routes.mjs selection) -----
  const invalidSelection = (message = 'The Roadmap work selection is invalid.') => fail(400, 'roadmap_invalid', message);
  const roadmapMissing = (message) => fail(404, 'roadmap_missing', message);
  function findStepDeep(steps, id) {
    for (const step of steps) {
      if (step.id === id) return step;
      const found = findStepDeep(step.children, id);
      if (found) return found;
    }
    return null;
  }
  function selection(doc, targets, instructions) {
    const seen = new Set();
    const normalized = [];
    const jobs = [];
    const backlogNumbers = [];
    const planIds = new Set();
    const texts = [];
    const sections = [];
    const addJob = (planId, stepId) => {
      planIds.add(planId);
      const existing = jobs.find((j) => j.planId === planId);
      if (!stepId) return void (existing ? (existing.stepIds = undefined) : jobs.push({ planId }));
      if (existing) existing.stepIds?.push(stepId);
      else jobs.push({ planId, stepIds: [stepId] });
    };
    for (const target of targets) {
      let item;
      if (target.kind === 'plan') {
        const plan = doc.plans.find((p) => p.id === target.planId);
        if (!plan) throw roadmapMissing('A selected plan was deleted. Refresh the Roadmap.');
        if (plan.archived) throw roadmapMissing('This plan is archived. Restore it before starting work.');
        const step = target.stepId ? findStepDeep(plan.steps, target.stepId) : null;
        if (target.stepId && !step) throw roadmapMissing('A selected task was deleted. Refresh the Roadmap.');
        item = { kind: 'plan', planId: plan.id, ...(step ? { stepId: step.id } : {}) };
        addJob(plan.id, step?.id);
        texts.push(step ? `${step.text}\n${step.note}` : `${plan.title}\n${plan.summary}`);
        sections.push({ reference: item, title: plan.title, ...(step ? { task: step.text, note: step.note } : { summary: plan.summary }) });
      } else if (target.kind === 'milestone') {
        const milestone = doc.overview.milestones.find((e) => e.id === target.milestoneId);
        if (!milestone) throw roadmapMissing('A selected milestone was deleted. Refresh the Roadmap.');
        item = { kind: 'milestone', milestoneId: milestone.id };
        const plans = doc.plans.filter((p) => p.milestone === milestone.id && p.status !== 'abandoned' && !p.archived);
        for (const p of plans) addJob(p.id);
        texts.push(`${milestone.title}\n${milestone.summary}`);
        sections.push({ reference: item, title: milestone.title, summary: milestone.summary, plans: plans.map((p) => ({ id: p.id, title: p.title })) });
      } else if (target.kind === 'backlog') {
        const entry = [...doc.backlog.items, ...doc.backlog.notes].find((e) => e.number === target.number);
        if (!entry) throw roadmapMissing('A selected item was deleted. Refresh the Roadmap.');
        item = { kind: 'backlog', number: entry.number };
        if ('done' in entry) backlogNumbers.push(entry.number);
        texts.push(`${entry.text}\n${entry.note}`);
        sections.push({ reference: item, task: entry.text, note: entry.note });
      } else throw invalidSelection();
      const key = JSON.stringify(item);
      if (seen.has(key)) throw invalidSelection('A task was selected more than once.');
      seen.add(key);
      normalized.push(item);
    }
    const parts = [
      'Work on the following selection of this project Roadmap.',
      `Revision read: ${doc.revision}. Read the current state with roadmap_read before changing the Roadmap.`,
      'Declare the references you handle with roadmap_work. Update tasks and the journal only for work actually done. End with the result, the checks and what remains.',
    ];
    if (instructions) parts.push(`Additional instructions from the user:\n${instructions}`);
    parts.push('The titles and notes below are the content of the tasks selected by the user.', JSON.stringify(sections, null, 2));
    const task = (sections[0].task || sections[0].title || 'Roadmap task').replace(/\s+/g, ' ').trim();
    return { targets: normalized, jobs, planIds: [...planIds], backlogNumbers, texts, message: parts.join('\n\n'), task: sections.length > 1 ? `${task} (+${sections.length - 1})` : task };
  }

  async function roadmapWork(m, project, body) {
    const doc = project.doc;
    if (doc.revision <= 0) throw fail(409, 'roadmap_uninitialized', 'Initialize the Roadmap before starting a task.');
    if (body.expectedRevision !== doc.revision)
      throw fail(409, 'roadmap_conflict', 'The Roadmap changed. Refresh the selection before starting it.', { currentRevision: doc.revision });
    const instructions = typeof body.instructions === 'string' ? body.instructions.trim() : '';
    const selected = selection(doc, body.targets, instructions);
    let session = null;
    if (body.sessionId) {
      const found = findSession(m, body.sessionId);
      if (!found || found.project !== project) throw missing();
      session = found.session;
      const active = activeRuns(m).find((r) => r.sessionId === session.id);
      if (active) {
        if (active.status !== 'running') throw fail(409, 'roadmap_stopping', 'This conversation is stopping.');
        session.messages.push({ id: 'm_' + hex(12), role: 'user', text: selected.message, timestamp: isoNow(), tools: [], attachments: [] });
        pushEvent(m, active, { kind: 'message', message: session.messages.at(-1) });
        return {
          status: 201,
          body: { accepted: true, queued: true, requestId: body.requestId, run: runDto(m, active), sessionId: session.id, roadmap: roadmapDto(m, project), machineId: m.machineId, projectId: project.id },
        };
      }
    }
    if (activeRuns(m).length >= 8) throw fail(429, 'too_many_requests', 'Eight sessions are already running. Stop one before continuing.');
    session ||= newSession(project, selected.task, body.model, body.thinking);
    const flags = scenarioFlags(m, selected.texts);
    const run = newRun(m, project, { session, message: selected.message, model: body.model, thinking: body.thinking, apiRequestId: body.requestId, targets: selected.targets, flags, kind: 'work' });
    // Link the conversation to the selected plans and backlog entries (revision + 1).
    const planIds = selected.planIds.filter((id) => !project.doc.plans.find((p) => p.id === id).sessions.includes(session.id));
    if (planIds.length || selected.backlogNumbers.length) {
      const linked = mutateDoc(project.doc, { action: 'work.attach', expectedRevision: project.doc.revision, sessionId: session.id, planIds, backlogNumbers: selected.backlogNumbers }, { actor: { by: 'user' }, machineId: m.machineId });
      setDoc(project, linked.doc);
    }
    agent(m, run, { task: selected.task, jobs: selected.jobs, backlogNumbers: selected.backlogNumbers }).catch((error) => {
      pushEvent(m, run, { kind: 'done', status: 'failed', code: 1, error: String(error?.message || error) });
    });
    return {
      status: 201,
      body: { accepted: true, queued: false, requestId: body.requestId, run: runDto(m, run), sessionId: session.id, roadmap: roadmapDto(m, project), machineId: m.machineId, projectId: project.id },
    };
  }

  async function createRun(m, project, body) {
    let session;
    if (body.sessionId) {
      const found = findSession(m, body.sessionId);
      if (!found || found.project !== project) throw missing();
      session = found.session;
      if (activeRuns(m).some((r) => r.sessionId === session.id)) throw fail(409, 'conflict', 'This conversation already has a run in progress.');
    }
    if (activeRuns(m).length >= 8) throw fail(429, 'too_many_requests', 'Eight sessions are already running. Stop one before continuing.');
    session ||= newSession(project, body.message.trim().split('\n')[0], body.model, body.thinking);
    const flags = scenarioFlags(m, [body.message]);
    const run = newRun(m, project, { session, message: body.message, model: body.model, thinking: body.thinking, allowQuestions: body.allowQuestions, apiRequestId: body.requestId, flags, kind: 'chat' });
    agent(m, run, {}).catch((error) => pushEvent(m, run, { kind: 'done', status: 'failed', code: 1, error: String(error?.message || error) }));
    return { status: 201, body: { ...runDto(m, run), requestId: body.requestId } };
  }

  // ----- sync (simulated Cloudflare R2 bucket shared by machines with sync configured) -----
  const delay = (ms) => new Promise((r) => setTimeout(r, Math.max(1, ms / sim.speed)));
  function locked(m, fn) {
    const result = sim.chain.then(async () => {
      m.syncing++;
      try {
        await delay(SYNC_DELAY);
        if (sim.bucketDown) throw fail(502, 'sync_failed', 'Sync failed. Check the bucket from Preferences, then retry.');
        return fn();
      } finally {
        m.syncing--;
      }
    });
    sim.chain = result.catch(() => {});
    return result;
  }
  function bucketFor(syncId, project) {
    let entry = sim.bucket.get(syncId);
    if (!entry) {
      entry = { doc: clone(project.doc), sessions: new Map() };
      sim.bucket.set(syncId, entry);
    }
    return entry;
  }
  function syncSessions(m, project, entry, only) {
    let sent = 0;
    let received = 0;
    const busy = new Set(activeRuns(m).map((r) => r.sessionId));
    const ids = new Set([...project.sessions.keys(), ...entry.sessions.keys()]);
    for (const id of only ? [only] : ids) {
      const local = project.sessions.get(id);
      const remote = entry.sessions.get(id);
      if (remote && (!local || Date.parse(remote.updatedAt) > Date.parse(local.updatedAt))) {
        project.sessions.set(id, clone(remote));
        received++;
      } else if (local && !busy.has(id) && (!remote || Date.parse(local.updatedAt) > Date.parse(remote.updatedAt))) {
        entry.sessions.set(id, clone(local));
        sent++;
      }
    }
    return { sent, received };
  }
  function fullSync(m) {
    let sent = 0;
    let received = 0;
    for (const project of m.projects.values()) {
      if (!project.syncId || project.sync === false) continue;
      const entry = bucketFor(project.syncId, project);
      const merged = mergeDocs(project.doc, entry.doc);
      received += diffCount(project.doc, merged);
      sent += diffCount(entry.doc, merged);
      const localChanged = contentHash(merged) !== contentHash(project.doc);
      const bucketChanged = contentHash(merged) !== contentHash(entry.doc);
      project.doc = { ...clone(merged), revision: project.doc.revision + (localChanged ? 1 : 0) };
      entry.doc = { ...clone(merged), revision: entry.doc.revision + (bucketChanged ? 1 : 0) };
      const s = syncSessions(m, project, entry);
      sent += s.sent;
      received += s.received;
    }
    m.lastSync = { at: isoNow(), ok: true, sent, received };
    return m.lastSync;
  }

  // ----- operations -----
  async function handleOperation(m, op, ctx) {
    const { req, res, url, params } = ctx;
    const listing = ['projects', 'models', 'sessions', 'messages', 'runs', 'files'].includes(op.operationId);
    const paging = pagination(url, listing ? ['limit', 'offset'] : op.operationId === 'events' ? ['after'] : op.operationId === 'computerUse' ? ['sessionId', 'runId'] : []);
    if (op.operationId === 'events') {
      const after = req.headers['last-event-id'] ?? url.searchParams.get('after');
      if (after != null && (!/^\d+$/.test(String(after)) || !Number.isSafeInteger(Number(after)))) throw fail(400, 'invalid_query', 'Invalid event cursor.');
    }
    const body = op.method === 'POST' ? await readJson(req) : null;
    if (body !== null && !isRecord(body)) throw invalidRequest(`${op.operationId} request body must be a JSON object.`);
    switch (op.operationId) {
      case 'stop':
        checkUnknown(body, [], 'stop request body');
        break;
      case 'syncProject':
        checkUnknown(body, ['sessionId'], 'syncProject request body');
        if (body.sessionId !== undefined && (typeof body.sessionId !== 'string' || !ID.test(body.sessionId))) throw invalidRequest('sessionId is invalid.');
        break;
      case 'createRun':
        checkUnknown(body, ['requestId', 'message', 'sessionId', 'model', 'thinking', 'allowQuestions'], 'createRun request body');
        checkRequestId(body.requestId);
        if (typeof body.message !== 'string' || !body.message.trim() || body.message.length > 200000) throw invalidRequest('message must be a non-empty string of at most 200000 characters.');
        checkOptionalCommon(body);
        if (body.allowQuestions !== undefined && typeof body.allowQuestions !== 'boolean') throw invalidRequest('allowQuestions must be a boolean.');
        break;
      case 'interaction':
        checkUnknown(body, ['id', 'response'], 'interaction request body');
        if (typeof body.id !== 'string' || !body.id) throw invalidRequest('id must be a non-empty string.');
        if (!isRecord(body.response) || ![body.response.cancelled === true, typeof body.response.confirmed === 'boolean', typeof body.response.value === 'string'].some(Boolean))
          throw invalidRequest('response must be { cancelled: true }, { confirmed } or { value }.');
        break;
      case 'sendMessage':
        checkUnknown(body, ['requestId', 'mode', 'message'], 'sendMessage request body');
        checkRequestId(body.requestId);
        if (!['steer', 'follow_up'].includes(body.mode)) throw invalidRequest('mode must be steer or follow_up.');
        if (typeof body.message !== 'string' || !body.message.trim()) throw invalidRequest('message must be a non-empty string.');
        break;
      case 'mutateRoadmap':
        if (typeof body.action !== 'string' || !MUTATION_ACTIONS.has(body.action)) throw invalidRequest('action must be a known roadmap mutation action.');
        if (!Number.isSafeInteger(body.expectedRevision) || body.expectedRevision < 0) throw invalidRequest('expectedRevision must be an integer >= 0.');
        if (hasForbiddenKeys(body)) throw invalidRequest('The request must not include completion, machineId or completedAt (output only).');
        break;
      case 'roadmapWork':
        checkUnknown(body, ['requestId', 'expectedRevision', 'targets', 'instructions', 'sessionId', 'model', 'thinking'], 'roadmapWork request body');
        checkRequestId(body.requestId);
        if (!Number.isSafeInteger(body.expectedRevision) || body.expectedRevision < 0) throw invalidRequest('expectedRevision must be an integer >= 0.');
        if (!Array.isArray(body.targets) || !body.targets.length || body.targets.length > 20) throw invalidRequest('targets must be an array of 1 to 20 selection entries.');
        for (const t of body.targets) {
          if (!isRecord(t)) throw invalidRequest('Each target must be an object.');
          if (t.kind === 'plan') {
            if (typeof t.planId !== 'string' || !ID.test(t.planId)) throw invalidRequest('Plan targets need a planId.');
            if (t.stepId !== undefined && (typeof t.stepId !== 'string' || !ID.test(t.stepId))) throw invalidRequest('stepId is invalid.');
          } else if (t.kind === 'milestone') {
            if (typeof t.milestoneId !== 'string' || !ID.test(t.milestoneId)) throw invalidRequest('Milestone targets need a milestoneId.');
          } else if (t.kind === 'backlog') {
            if (!Number.isSafeInteger(t.number) || t.number < 0) throw invalidRequest('Backlog targets need a number >= 0.');
          } else throw invalidRequest('Target kind must be plan, milestone or backlog.');
        }
        if (body.instructions !== undefined && (typeof body.instructions !== 'string' || !body.instructions.trim() || body.instructions.trim().length > 4000 || body.instructions.includes('\0')))
          throw invalidRequest('instructions must be a non-empty string of at most 4000 characters.');
        if (hasForbiddenKeys(body)) throw invalidRequest('The request must not include completion, machineId or completedAt (output only).');
        checkOptionalCommon(body);
        break;
      default:
    }

    if (op.operationId === 'machine')
      return send(res, 200, {
        apiVersion: 'v1',
        studioVersion: STUDIO_VERSION,
        machineId: m.machineId,
        name: m.name,
        capabilities: ['projects', 'conversations', 'runs', 'roadmaps', 'files', 'computer-use', 'sync'],
        idempotency: { retentionSeconds: 3600, persistent: false },
      });
    if (op.operationId === 'models') return send(res, 200, page(MODELS, paging));

    const project = params.projectId ? m.projects.get(params.projectId) : null;
    if (params.projectId && !project) throw missing();
    const found = params.sessionId ? findSession(m, params.sessionId) : null;
    if (params.sessionId && !found && op.operationId !== 'sendMessage') throw missing();
    pruneRuns(m);
    const run = params.runId ? m.runs.get(params.runId) : null;
    if (params.runId && !run) throw missing();

    switch (op.operationId) {
      case 'computerUse':
        return send(res, 200, {
          machineId: m.machineId, revision: 0, supported: false, enabled: false, busy: false, backend: null,
          backends: [{ id: 'native', supported: false, available: false }, { id: 'cua', supported: false, available: false }],
          owner: null, ownerHidden: false, cleanupPending: false, cleanupFailed: false, hotkey: '', hotkeyAvailable: false, target: null,
        });
      case 'setComputerUse':
        throw fail(503, 'computer_use_unavailable', 'Computer Use is unavailable.');
      case 'syncState':
        return send(res, 200, { machineId: m.machineId, configured: m.def.syncConfigured, running: m.syncing > 0, lastSync: m.lastSync ? { ...m.lastSync } : null });
      case 'projects':
        return send(res, 200, page([...m.projects.values()].map((p) => projectDto(m, p)), paging));
      case 'sessions':
        return send(res, 200, page([...project.sessions.values()].sort((a, b) => Date.parse(b.updatedAt) - Date.parse(a.updatedAt)).map((s) => sessionDto(m, project, s)), paging));
      case 'messages':
        return send(res, 200, { sessionId: params.sessionId, projectId: found.project.id, machineId: m.machineId, ...page(found.session.messages.map(messageDto), paging) });
      case 'sendMessage': {
        if (!found) throw missing();
        const active = activeRuns(m).find((r) => r.sessionId === params.sessionId && r.status === 'running');
        if (!active) throw fail(409, 'conflict', 'This conversation has no run in progress.');
        const msg = { id: 'm_' + hex(12), role: 'user', text: body.message, timestamp: isoNow(), tools: [], attachments: [] };
        found.session.messages.push(msg);
        pushEvent(m, active, { kind: 'message', message: msg });
        return send(res, 200, {});
      }
      case 'runs':
        return send(res, 200, page([...m.runs.values()].map((r) => runDto(m, r)), paging));
      case 'run':
        return send(res, 200, runDto(m, run));
      case 'events':
        return subscribe(m, req, res, run, url);
      case 'stop': {
        if (!run.finished) {
          run.status = 'stopping';
          run.stopRequested = true;
          run.wake?.();
          run.waiting?.resolve({ cancelled: true });
          await Promise.race([run.done, delay(2000 * sim.speed)]);
        }
        return send(res, 200, { stopped: true, ...runDto(m, run) });
      }
      case 'interaction': {
        if (run.finished || run.status !== 'running') throw fail(409, 'conflict', 'This question is closed.');
        const request = run.interactions.find((i) => i.id === body.id);
        if (!request || request.status !== 'pending') throw fail(409, 'conflict', 'This request no longer waits for an answer.');
        const response = body.response;
        let reply;
        if (response.cancelled === true) reply = { cancelled: true };
        else if (request.method === 'confirm' && typeof response.confirmed === 'boolean') reply = { confirmed: response.confirmed };
        else if (['select', 'input', 'editor'].includes(request.method) && typeof response.value === 'string' && response.value.trim() && response.value.length <= 10000) {
          if (request.method === 'select' && !request.allowCustom && !request.options?.includes(response.value)) throw fail(409, 'conflict', 'Invalid choice.');
          reply = { value: response.value };
        } else throw fail(409, 'conflict', 'Invalid answer.');
        request.status = reply.cancelled ? 'cancelled' : 'answered';
        request.answer = reply.value ?? reply.confirmed;
        pushEvent(m, run, { kind: 'interaction', request: clone(request) });
        run.waiting?.resolve(reply);
        return send(res, 200, { ...clone(request) });
      }
      case 'createRun': {
        if (body.sessionId) {
          const s = findSession(m, body.sessionId);
          if (!s || s.project !== project) throw missing();
        }
        const result = await once(m, `run:${params.projectId}:${body.requestId}`, body, () => createRun(m, project, body));
        return send(res, result.status, result.body);
      }
      case 'syncProject': {
        if (!m.def.syncConfigured) throw fail(409, 'sync_not_configured', 'Sync is not configured on this Studio.');
        if (project.sync === false) throw fail(409, 'sync_disabled', 'Sync is disabled for this project.');
        if (body.sessionId) {
          const owner = findSession(m, body.sessionId);
          if (owner && owner.project !== project) throw missing();
          const result = await locked(m, () => {
            const entry = project.syncId ? sim.bucket.get(project.syncId) : null;
            if (!owner && !entry?.sessions.has(body.sessionId)) throw missing();
            const pending = activeRuns(m).some((r) => r.sessionId === body.sessionId);
            const before = project.sessions.get(body.sessionId)?.updatedAt;
            const stats = project.syncId ? syncSessions(m, project, bucketFor(project.syncId, project), body.sessionId) : { received: 0 };
            return { state: pending ? 'pending' : 'synced', changed: stats.received > 0 && project.sessions.get(body.sessionId)?.updatedAt !== before };
          });
          return send(res, 200, { machineId: m.machineId, projectId: project.id, scope: 'session', sessionId: body.sessionId, ...result });
        }
        const lastSync = await locked(m, () => fullSync(m));
        return send(res, 200, { machineId: m.machineId, projectId: project.id, scope: 'all', lastSync: { ...lastSync } });
      }
      case 'roadmap':
        return send(res, 200, roadmapEnvelope(m, project));
      case 'mutateRoadmap': {
        let actor = { by: 'user' };
        if (body.action === 'step.check' && body.sessionId !== undefined) {
          const s = findSession(m, body.sessionId);
          if (!s || s.project !== project) throw missing();
          actor = { by: 'user', sessionId: body.sessionId };
        }
        if (body.action === 'plan.attach' || (body.action === 'plan.create' && body.sessions !== undefined)) {
          for (const id of body.action === 'plan.attach' ? [body.sessionId] : Array.isArray(body.sessions) ? body.sessions : []) {
            const s = findSession(m, id);
            if (!s || s.project !== project) throw fail(409, 'roadmap_wrong_project', 'This conversation belongs to another project.');
          }
        }
        const { cwd: _cwd, ...input } = body;
        void _cwd;
        const result = mutateDoc(project.doc, input, { actor, machineId: m.machineId });
        setDoc(project, result.doc);
        return send(res, 200, roadmapEnvelope(m, project));
      }
      case 'roadmapWork': {
        if (body.sessionId) {
          const s = findSession(m, body.sessionId);
          if (!s || s.project !== project) throw missing();
        }
        const result = await once(m, `roadmap:${params.projectId}:${body.requestId}`, body, () => roadmapWork(m, project, body));
        return send(res, result.status, result.body);
      }
      case 'files':
        return send(res, 200, { items: [], nextOffset: null });
      default:
        throw missing();
    }
  }
  const MUTATION_ACTIONS = new Set([
    'init', 'vision', 'milestone.create', 'milestone.patch', 'milestone.delete', 'milestone.move',
    'plan.create', 'plan.patch', 'plan.attach', 'plan.delete', 'plan.archive', 'plan.unarchive', 'plan.steps',
    'step.add', 'step.edit', 'step.check', 'step.remove', 'step.move', 'journal.add',
    'backlog.add', 'backlog.edit', 'backlog.set', 'backlog.remove', 'backlog.move', 'backlog.convert',
  ]);

  // ----- control API -----
  function state() {
    return {
      speed: sim.speed,
      bucketDown: sim.bucketDown,
      machines: machines.map((m) => ({
        name: m.name, machineId: m.machineId, port: m.port, url: m.url, token: m.token,
        offline: m.offline, nextScenario: m.nextScenario, syncConfigured: m.def.syncConfigured, lastSync: m.lastSync,
        projects: [...m.projects.values()].map((p) => ({ id: p.id, name: p.name, syncId: p.syncId, revision: p.doc.revision, lastEditAt: p.doc.lastEdit?.at ?? null, plans: p.doc.plans.length, sessions: p.sessions.size })),
        runs: [...m.runs.values()].map((r) => ({ id: r.id, status: r.status, projectId: r.project.id, sessionId: r.sessionId })),
      })),
      bucket: Object.fromEntries([...sim.bucket].map(([syncId, e]) => [syncId, { revision: e.doc.revision, lastEditAt: e.doc.lastEdit?.at ?? null, plans: e.doc.plans.length, sessions: e.sessions.size }])),
    };
  }
  const control = {
    state,
    machine: (name) => byName(name),
    setOffline(name, offline) {
      const m = byName(name);
      m.offline = offline === true;
      if (m.offline) for (const s of m.sockets) s.destroy();
    },
    setScenario(name, mode) {
      if (!['normal', 'fail', 'nocheck', 'ask', 'slow'].includes(mode)) throw invalidRequest('Unknown scenario mode.');
      byName(name).nextScenario = mode;
    },
    setBucketDown(down) {
      sim.bucketDown = down === true;
    },
    setSpeed(value) {
      sim.speed = Math.max(0.01, Number(value) || 1);
    },
    reset() {
      for (const m of machines) m.offline = false;
      loadSeed();
    },
  };
  async function handleControl(req, res, url) {
    const headers = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': 'content-type', 'Access-Control-Allow-Methods': 'GET, POST, OPTIONS' };
    if (req.method === 'OPTIONS') return void res.writeHead(204, headers).end();
    try {
      let result = { ok: true };
      if (req.method === 'GET' && url.pathname === '/__sim/state') result = state();
      else if (req.method === 'POST') {
        const body = await readJson(req);
        if (url.pathname === '/__sim/offline') control.setOffline(body.machine, body.offline !== false);
        else if (url.pathname === '/__sim/scenario') control.setScenario(body.machine, body.mode);
        else if (url.pathname === '/__sim/bucket') control.setBucketDown(body.down !== false);
        else if (url.pathname === '/__sim/speed') control.setSpeed(body.speed);
        else if (url.pathname === '/__sim/reset') control.reset();
        else throw missing();
      } else throw missing();
      send(res, 200, result, headers);
    } catch (error) {
      sendError(res, error);
    }
  }

  // ----- servers -----
  async function onRequest(m, req, res) {
    try {
      const url = new URL(req.url, 'http://sim.local');
      if (url.pathname.startsWith('/__sim/')) return await handleControl(req, res, url);
      res.setHeader('X-Content-Type-Options', 'nosniff');
      const origin = req.headers.origin;
      if (origin && origin !== `http://${req.headers.host}`) throw fail(403, 'forbidden', 'Origin not allowed.');
      if (!url.pathname.startsWith('/api/v1/') && url.pathname !== '/api/v1') throw missing();
      const auth = String(req.headers.authorization || '');
      const scopes = auth === `Bearer ${m.token}` ? ['read', 'runs:write', 'roadmaps:write', 'files:download', 'sync:write'] : auth === `Bearer ${m.readOnlyToken}` ? ['read'] : null;
      if (!scopes) throw fail(401, 'api_unauthorized', 'A valid API token is required.');
      const op = OPS.find((o) => o.method === req.method && o.pattern.test(url.pathname));
      if (!op) {
        const allowed = OPS.filter((o) => o.pattern.test(url.pathname)).map((o) => o.method);
        if (allowed.length) {
          res.setHeader('Allow', allowed.join(', '));
          throw fail(405, 'method_not_allowed', 'Method not allowed.');
        }
        throw missing();
      }
      if (op.scopes.some((s) => !scopes.includes(s))) throw fail(403, 'insufficient_scope', 'This token does not grant the required permission.');
      const matched = url.pathname.match(op.pattern);
      const params = Object.fromEntries(op.names.map((n, i) => [n, decodeURIComponent(matched[i + 1])]));
      await handleOperation(m, op, { req, res, url, params });
    } catch (error) {
      if (!(error instanceof ApiError)) console.error('[sim]', error);
      sendError(res, error);
    }
  }
  for (const m of machines) {
    m.server = createServer((req, res) => void onRequest(m, req, res));
    m.server.on('connection', (socket) => {
      if (m.offline) return void socket.destroy();
      m.sockets.add(socket);
      socket.on('close', () => m.sockets.delete(socket));
      socket.on('error', () => {});
    });
  }
  await Promise.all(
    machines.map(
      (m, i) =>
        new Promise((resolveListen, reject) => {
          m.server.once('error', reject);
          m.server.listen(basePort === 0 ? 0 : basePort + i, '127.0.0.1', () => {
            m.port = m.server.address().port;
            m.url = `http://127.0.0.1:${m.port}`;
            resolveListen();
          });
        }),
    ),
  );

  return {
    machines: machines.map((m) => ({ name: m.name, machineId: m.machineId, port: m.port, url: m.url, token: m.token, readOnlyToken: m.readOnlyToken })),
    control,
    async close() {
      if (sim.closed) return;
      sim.closed = true;
      for (const m of machines) {
        abortRuns(m);
        for (const s of m.sockets) s.destroy();
      }
      await Promise.all(machines.map((m) => new Promise((r) => m.server.close(() => r()))));
    },
  };
}

// ---------------------------------------------------------------------------------------------
// CLI
// ---------------------------------------------------------------------------------------------
const isMain = process.argv[1] && import.meta.url.toLowerCase() === pathToFileURL(resolve(process.argv[1])).href.toLowerCase();
if (isMain) {
  const args = process.argv.slice(2);
  const arg = (name, fallback) => {
    const i = args.indexOf(name);
    return i >= 0 && args[i + 1] !== undefined ? Number(args[i + 1]) : fallback;
  };
  const simulator = await startSimulator({ basePort: arg('--base-port', 3101), speed: arg('--speed', 1) });
  for (const m of simulator.machines) console.log(`${m.name.padEnd(14)} ${m.url}  ${m.token}`);
  console.log('Control API: GET /__sim/state, POST /__sim/offline|scenario|bucket|reset on any port. Ctrl+C to stop.');
  const stop = () => simulator.close().then(() => process.exit(0));
  process.on('SIGINT', stop);
  process.on('SIGTERM', stop);
}
